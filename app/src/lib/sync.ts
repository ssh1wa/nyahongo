// 多设备同步：手机、平板通过电脑交换学习数据（PC 端 /api/sync 只存一份合并好的数据）。
// 一次同步：拉取电脑上的 → 和本机的合并（规则见 syncMerge.ts）→ 写回本机 → 上传合并结果。
// 上传时带着拉取时的版本号，期间别的设备同步过就会被拒绝，重新拉取再合并，两台设备同时同步也不会互相覆盖。
// 不同步的：API Key、设置和界面偏好、学习包本身（每台设备自己从电脑下载）、小游戏里每台设备自己的每日上限和保底计数。
import { deviceId, getDb, kvGet, kvSet } from './db';
import { gameSyncData, mergeGameSync } from './game';
import { getPcUrl } from './packages';
import { listRoutines } from './routines';
import { emptyDoc, mergeDocs, type RoutineSync, type SyncDoc, type WordSync } from './syncMerge';

// 跟着同步的 kv：语法课程安排、语法中文简述、词条中文释义和 AI 释义缓存（省得每台设备都花钱再生成一遍）、搜索记录
const SYNCED_KV = /^(course:|grammarZh:|zh:|ai-gloss:|searchRecent$)/;

export type SyncStatus = { at: number; ok: boolean; message: string; changes: number };

// ---------- 导出本机数据 ----------

async function exportLocal(me: string): Promise<SyncDoc> {
  const db = await getDb();
  const doc = emptyDoc();
  doc.words = await db.getAllAsync<WordSync>(
    `SELECT uid, entry_id, headword, reading, entry, context, context_zh, package_id, clip_start, clip_end,
            card, due, added_at, mastered, detail, updated_at, card_at FROM words`,
  );
  doc.reviews = await db.getAllAsync<{ w: string; r: number; t: number }>(
    'SELECT word_uid AS w, rating AS r, reviewed_at AS t FROM review_log WHERE word_uid IS NOT NULL',
  );
  doc.records = await db.getAllAsync('SELECT uid, kind, title, data, created_at, updated_at FROM records');
  doc.grammar = await db.getAllAsync('SELECT id, status, lesson, quiz_correct, quiz_total, updated_at FROM grammar');

  // 精听进度：本机下载了的包 + 以前同步过来、本机还没下载的包
  doc.progress = { ...(await kvGet<SyncDoc['progress']>('sync:progress', {})) };
  for (const p of await db.getAllAsync<{ id: string; last_sentence: number; progress_at: number }>('SELECT id, last_sentence, progress_at FROM packages')) {
    if (p.progress_at && (!doc.progress[p.id] || p.progress_at > doc.progress[p.id].at)) doc.progress[p.id] = { last_sentence: p.last_sentence, at: p.progress_at };
  }

  for (const row of await db.getAllAsync<{ key: string; value: string; updated_at: number }>('SELECT key, value, updated_at FROM kv')) {
    if (!SYNCED_KV.test(row.key)) continue;
    try { doc.kv[row.key] = { v: JSON.parse(row.value), at: row.updated_at }; } catch {}
  }

  // 常读：本机的文章 id 换成跨设备的 uid
  const uidOf = new Map((await db.getAllAsync<{ id: number; uid: string }>('SELECT id, uid FROM records')).map((r) => [r.id, r.uid]));
  doc.routines = (await listRoutines()).map((r) => ({
    ...r, history: r.history.map((h) => ({ ...h, articleUid: h.articleUid ?? uidOf.get(h.articleId) })),
  })) as RoutineSync[];

  for (const t of await db.getAllAsync<{ kind: string; key: string; at: number }>('SELECT kind, key, at FROM tombstones')) {
    doc.tombstones[`${t.kind}|${t.key}`] = t.at;
  }
  doc.game = await gameSyncData();

  doc.usage[me] = await db.getAllAsync('SELECT day, kind, model, calls, input, output FROM usage');
  for (const r of await db.getAllAsync<{ device: string } & SyncDoc['usage'][string][number]>('SELECT * FROM usage_remote')) {
    const { device, ...row } = r;
    (doc.usage[device] ??= []).push(row);
  }
  return doc;
}

// ---------- 合并结果写回本机 ----------

const dead = (doc: SyncDoc, kind: string, key: string, at: number) => (doc.tombstones[`${kind}|${key}`] ?? -1) >= at;

/** 返回本机有多少条数据变了（新增、更新、删除） */
async function applyMerged(doc: SyncDoc, me: string): Promise<number> {
  const db = await getDb();
  let changes = 0;
  await db.withTransactionAsync(async () => {
    // 生词
    const words = new Map((await db.getAllAsync<{ id: number; uid: string; updated_at: number; card_at: number }>(
      'SELECT id, uid, updated_at, card_at FROM words')).map((w) => [w.uid, w]));
    for (const w of doc.words) {
      const local = words.get(w.uid);
      const cols = [w.entry_id, w.headword, w.reading, w.entry, w.context, w.context_zh, w.package_id, w.clip_start, w.clip_end,
        w.card, w.due, w.added_at, w.mastered, w.detail, w.updated_at, w.card_at];
      if (!local) {
        await db.runAsync(
          `INSERT OR IGNORE INTO words (entry_id, headword, reading, entry, context, context_zh, package_id, clip_start, clip_end,
             card, due, added_at, mastered, detail, updated_at, card_at, uid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ...cols, w.uid,
        );
        changes++;
      } else if (w.updated_at > local.updated_at || w.card_at > local.card_at) {
        await db.runAsync(
          `UPDATE words SET entry_id = ?, headword = ?, reading = ?, entry = ?, context = ?, context_zh = ?, package_id = ?, clip_start = ?, clip_end = ?,
             card = ?, due = ?, added_at = ?, mastered = ?, detail = ?, updated_at = ?, card_at = ? WHERE uid = ?`,
          ...cols, w.uid,
        );
        changes++;
      }
    }
    // 别的设备删掉的（墓碑比本机的修改新才删：同步过程中刚加的词不会被误删）
    for (const [uid, w] of words) {
      if (dead(doc, 'word', uid, w.updated_at)) { await db.runAsync('DELETE FROM words WHERE id = ?', w.id); changes++; }
    }

    // 删掉的生词，复习记录也删掉
    for (const k of Object.keys(doc.tombstones)) {
      if (!k.startsWith('word|')) continue;
      const uid = k.slice(5);
      if (!doc.words.some((w) => w.uid === uid)) await db.runAsync('DELETE FROM review_log WHERE word_uid = ?', uid);
    }

    // 复习记录（word_id 是本机的生词 id）
    const idOf = new Map((await db.getAllAsync<{ id: number; uid: string }>('SELECT id, uid FROM words')).map((w) => [w.uid, w.id]));
    const have = new Set((await db.getAllAsync<{ k: string }>("SELECT word_uid || '|' || reviewed_at AS k FROM review_log WHERE word_uid IS NOT NULL")).map((r) => r.k));
    for (const r of doc.reviews) {
      if (have.has(`${r.w}|${r.t}`)) continue;
      await db.runAsync('INSERT OR IGNORE INTO review_log (word_id, word_uid, rating, reviewed_at) VALUES (?, ?, ?, ?)', idOf.get(r.w) ?? 0, r.w, r.r, r.t);
    }

    // 记录（翻译、练习、阅读、问 AI）
    const records = new Map((await db.getAllAsync<{ id: number; uid: string; updated_at: number }>('SELECT id, uid, updated_at FROM records')).map((r) => [r.uid, r]));
    for (const r of doc.records) {
      const local = records.get(r.uid);
      if (!local) {
        await db.runAsync('INSERT OR IGNORE INTO records (uid, kind, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)', r.uid, r.kind, r.title, r.data, r.created_at, r.updated_at);
        changes++;
      } else if (r.updated_at > local.updated_at) {
        await db.runAsync('UPDATE records SET kind = ?, title = ?, data = ?, created_at = ?, updated_at = ? WHERE uid = ?', r.kind, r.title, r.data, r.created_at, r.updated_at, r.uid);
        changes++;
      }
    }
    for (const [uid, r] of records) {
      if (dead(doc, 'record', uid, r.updated_at)) { await db.runAsync('DELETE FROM records WHERE id = ?', r.id); changes++; }
    }

    // 语法进度和课文
    const grammar = new Map((await db.getAllAsync<{ id: string; updated_at: number }>('SELECT id, updated_at FROM grammar')).map((g) => [g.id, g.updated_at]));
    for (const g of doc.grammar) {
      if ((grammar.get(g.id) ?? -1) >= g.updated_at) continue;
      await db.runAsync(
        `INSERT OR REPLACE INTO grammar (id, status, lesson, quiz_correct, quiz_total, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        g.id, g.status, g.lesson, g.quiz_correct, g.quiz_total, g.updated_at,
      );
      changes++;
    }

    // 精听进度
    for (const p of await db.getAllAsync<{ id: string; progress_at: number }>('SELECT id, progress_at FROM packages')) {
      const remote = doc.progress[p.id];
      if (remote && remote.at > p.progress_at) {
        await db.runAsync('UPDATE packages SET last_sentence = ?, progress_at = ? WHERE id = ?', remote.last_sentence, remote.at, p.id);
        changes++;
      }
    }

    // 墓碑留在本机，下次同步继续告诉别的设备
    for (const [k, at] of Object.entries(doc.tombstones)) {
      const i = k.indexOf('|');
      await db.runAsync('INSERT OR REPLACE INTO tombstones (kind, key, at) VALUES (?, ?, ?)', k.slice(0, i), k.slice(i + 1), at);
    }

    // 别的设备的 API 用量
    await db.runAsync('DELETE FROM usage_remote');
    for (const [dev, rows] of Object.entries(doc.usage)) {
      if (dev === me) continue;
      for (const u of rows) {
        await db.runAsync('INSERT OR REPLACE INTO usage_remote (device, day, kind, model, calls, input, output) VALUES (?, ?, ?, ?, ?, ?, ?)',
          dev, u.day, u.kind, u.model, u.calls, u.input, u.output);
      }
    }
  });

  await kvSet('sync:progress', doc.progress);

  const localKv = new Map((await db.getAllAsync<{ key: string; updated_at: number }>('SELECT key, updated_at FROM kv')).map((r) => [r.key, r.updated_at]));
  for (const [k, e] of Object.entries(doc.kv)) {
    if (e.at > (localKv.get(k) ?? -1)) { await kvSet(k, e.v, e.at); changes++; }
  }

  // 常读：文章 uid 换回本机 id
  const idOfRec = new Map((await db.getAllAsync<{ id: number; uid: string }>('SELECT id, uid FROM records')).map((r) => [r.uid, r.id]));
  const routines = doc.routines.map((r) => ({
    ...r, history: r.history.map((h) => ({ ...h, articleId: (h.articleUid && idOfRec.get(h.articleUid)) || -1 })),
  }));
  if (JSON.stringify(routines) !== JSON.stringify(await listRoutines())) {
    await kvSet('routines', routines);
    changes++;
  }

  if (doc.game) await mergeGameSync(doc.game);
  return changes;
}

// ---------- 和电脑通信 ----------

async function request<T>(url: string, init?: RequestInit, timeoutMs = 30_000): Promise<{ status: number; body: T }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal, headers: { 'Content-Type': 'application/json' } });
    const body = (await res.json().catch(() => ({}))) as T;
    return { status: res.status, body };
  } finally {
    clearTimeout(timer);
  }
}

type Remote = { version: number; doc: SyncDoc | null };

let running: Promise<SyncStatus> | null = null;
const listeners = new Set<(s: SyncStatus) => void>();

/** 同步完成（不管成功失败）时通知，界面用来刷新 */
export function onSynced(fn: (s: SyncStatus) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export const lastSyncStatus = () => kvGet<SyncStatus | null>('sync:status', null);

/** 同步一次。正在同步时再调用会等同一次的结果 */
export function syncNow(): Promise<SyncStatus> {
  running ??= (async () => {
    let status: SyncStatus;
    try {
      const base = await getPcUrl();
      if (!base) throw new Error('还没有连接 PC 端：先在「设置」里填写 PC 端地址');
      const me = await deviceId();
      let changes = 0;
      for (let attempt = 0; ; attempt++) {
        const remote = await request<Remote>(`${base}/api/sync`, undefined, 15_000);
        if (remote.status !== 200) throw new Error(`PC 端返回错误（${remote.status}），PC 端可能需要更新`);
        const local = await exportLocal(me);
        const merged = remote.body.doc?.format === 1 ? mergeDocs(local, remote.body.doc) : local;
        changes = await applyMerged(merged, me);
        // 写回本机之后再导出一次：小游戏账本合并后会重算，以本机最终状态为准上传
        const final = mergeDocs(await exportLocal(me), merged);
        const put = await request<{ version?: number; detail?: string }>(`${base}/api/sync`, {
          method: 'PUT', body: JSON.stringify({ base: remote.body.version, doc: final, device: me }),
        });
        if (put.status === 200) break;
        if (put.status === 409 && attempt < 3) continue; // 期间别的设备同步过：重新拉取合并
        throw new Error(put.body.detail || `上传失败（${put.status}）`);
      }
      status = { at: Date.now(), ok: true, message: changes ? `同步完成，更新了 ${changes} 项` : '同步完成，两边已经一致', changes };
    } catch (e) {
      const msg = e instanceof Error ? (e.name === 'AbortError' ? '连接 PC 端超时' : e.message) : String(e);
      status = { at: Date.now(), ok: false, message: msg, changes: 0 };
    }
    await kvSet('sync:status', status);
    listeners.forEach((fn) => fn(status));
    return status;
  })().finally(() => { running = null; });
  return running;
}

let lastAuto = 0;
/**
 * 自动同步（打开 App、切回前台、退到后台时调用）：没连电脑就跳过，30 秒内不重复。
 * 失败不提示（电脑没开很正常），设置里能看到上次同步的结果。
 */
export async function autoSync(): Promise<void> {
  if (Date.now() - lastAuto < 30_000) return;
  if (!(await kvGet<boolean>('sync:auto', true)) || !(await getPcUrl())) return;
  lastAuto = Date.now();
  await syncNow();
}
