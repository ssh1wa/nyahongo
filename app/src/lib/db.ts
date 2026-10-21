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
];

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

export async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await getDb();
  await db.runAsync('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, JSON.stringify(value));
}
