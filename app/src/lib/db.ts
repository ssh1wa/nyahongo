// 本地数据库。每条记录一行，不再把所有历史塞进一个大 JSON（旧 App 在安卓上会撞到 6MB 上限）。
import * as SQLite from 'expo-sqlite';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

const MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS packages (
     id TEXT PRIMARY KEY,
     meta TEXT NOT NULL,
     downloaded_at INTEGER NOT NULL,
     last_sentence INTEGER NOT NULL DEFAULT 0,
     opened_at INTEGER
   );
   CREATE TABLE IF NOT EXISTS words (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     entry_id INTEGER,
     headword TEXT NOT NULL,
     reading TEXT,
     entry TEXT,
     context TEXT,
     context_zh TEXT,
     package_id TEXT,
     clip_start REAL,
     clip_end REAL,
     card TEXT NOT NULL,
     due INTEGER NOT NULL,
     added_at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX IF NOT EXISTS words_entry ON words(entry_id) WHERE entry_id IS NOT NULL;
   CREATE INDEX IF NOT EXISTS words_due ON words(due);
   CREATE TABLE IF NOT EXISTS review_log (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     word_id INTEGER NOT NULL,
     rating INTEGER NOT NULL,
     reviewed_at INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS records (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     kind TEXT NOT NULL,
     title TEXT NOT NULL,
     data TEXT NOT NULL,
     created_at INTEGER NOT NULL
   );
   CREATE INDEX IF NOT EXISTS records_kind ON records(kind, created_at);`,
  // v2：语法课程进度。lesson 是 AI 生成的中文讲解（缓存），status: new / learned / review
  `CREATE TABLE IF NOT EXISTS grammar (
     id TEXT PRIMARY KEY,
     status TEXT NOT NULL DEFAULT 'new',
     lesson TEXT,
     quiz_correct INTEGER,
     quiz_total INTEGER,
     updated_at INTEGER NOT NULL
   );`,
  // v3：本机 API 用量，按天、类型、模型汇总（kind: text / vision / search / fetch）
  `CREATE TABLE IF NOT EXISTS usage (
     day TEXT NOT NULL,
     kind TEXT NOT NULL,
     model TEXT NOT NULL,
     calls INTEGER NOT NULL DEFAULT 0,
     input INTEGER NOT NULL DEFAULT 0,
     output INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (day, kind, model)
   );`,
  // v4：生词本的「已掌握」和 AI 详细释义（JSON，第一次点开时生成后缓存）
  `ALTER TABLE words ADD COLUMN mastered INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE words ADD COLUMN detail TEXT;`,
  // v5：多设备同步（见 sync.ts）。每条数据要有跨设备不变的 uid 和修改时间，删除留下墓碑，别的设备才知道要删
  // - 生词按词典词条（e123）或写法（h:写法）认同一个词；card_at 是复习进度的修改时间，和 AI 讲解分开合并
  // - 复习记录改用生词的 uid 关联（各设备的自增 id 不一样）
  // - usage_remote 存别的设备的 API 用量，用量页把两边加起来
  `ALTER TABLE words ADD COLUMN uid TEXT;
   ALTER TABLE words ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE words ADD COLUMN card_at INTEGER NOT NULL DEFAULT 0;
   UPDATE words SET uid = CASE WHEN entry_id IS NOT NULL THEN 'e' || entry_id ELSE 'h:' || headword END,
     updated_at = added_at,
     card_at = COALESCE((SELECT MAX(reviewed_at) FROM review_log WHERE review_log.word_id = words.id), added_at);
   CREATE UNIQUE INDEX IF NOT EXISTS words_uid ON words(uid);
   ALTER TABLE review_log ADD COLUMN word_uid TEXT;
   UPDATE review_log SET word_uid = (SELECT uid FROM words WHERE words.id = review_log.word_id);
   DELETE FROM review_log WHERE word_uid IS NOT NULL AND id NOT IN (SELECT MIN(id) FROM review_log GROUP BY word_uid, reviewed_at);
   CREATE UNIQUE INDEX IF NOT EXISTS review_log_uniq ON review_log(word_uid, reviewed_at);
   ALTER TABLE records ADD COLUMN uid TEXT;
   ALTER TABLE records ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
   UPDATE records SET uid = lower(hex(randomblob(8))), updated_at = created_at;
   CREATE UNIQUE INDEX IF NOT EXISTS records_uid ON records(uid);
   ALTER TABLE packages ADD COLUMN progress_at INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE kv ADD COLUMN updated_at INTEGER NOT NULL DEFAULT 0;
   CREATE TABLE IF NOT EXISTS tombstones (kind TEXT NOT NULL, key TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (kind, key));
   CREATE TABLE IF NOT EXISTS usage_remote (
     device TEXT NOT NULL, day TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL,
     calls INTEGER NOT NULL DEFAULT 0, input INTEGER NOT NULL DEFAULT 0, output INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (device, day, kind, model)
   );`,
];

/** 生成一个随机 id（同步用的 uid、设备 id） */
export const newUid = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('seichou.db');
      await db.execAsync('PRAGMA journal_mode = WAL;');
      const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
      const version = row?.user_version ?? 0;
      for (let v = version; v < MIGRATIONS.length; v++) {
        await db.withTransactionAsync(async () => {
          await db.execAsync(MIGRATIONS[v]);
          await db.execAsync(`PRAGMA user_version = ${v + 1}`);
        });
      }
      return db;
    })();
    dbPromise.catch(() => {
      dbPromise = null; // 打开失败时允许下次重试
    });
  }
  return dbPromise;
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>('SELECT value FROM kv WHERE key = ?', key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

export async function kvSet(key: string, value: unknown, at = Date.now()): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value, updated_at) VALUES (?, ?, ?)', key, JSON.stringify(value), at);
}

/** 记下删除（同步时告诉别的设备也删掉）。kind：word / record / routine */
export async function addTombstone(kind: string, key: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO tombstones (kind, key, at) VALUES (?, ?, ?)', kind, key, Date.now());
}

let deviceIdCache: string | null = null;
/** 这台设备的 id（第一次用时生成，不参与同步） */
export async function deviceId(): Promise<string> {
  if (!deviceIdCache) {
    deviceIdCache = await kvGet<string>('deviceId', '');
    if (!deviceIdCache) {
      deviceIdCache = newUid();
      await kvSet('deviceId', deviceIdCache);
    }
  }
  return deviceIdCache;
}
