// 翻译、练习、阅读、问 AI 的历史记录：每条一行，不会因为记录多了撞到存储上限。
// uid 跨设备不变（同步用），updated_at 是最后修改时间，删除留墓碑
import { addTombstone, getDb, newUid } from './db';

export type RecordRow<T> = { id: number; uid: string; kind: string; title: string; data: T; created_at: number };

type Raw = { id: number; uid: string; kind: string; title: string; data: string; created_at: number };

export async function addRecord<T>(kind: string, title: string, data: T): Promise<number> {
  const db = await getDb();
  const now = Date.now();
  const r = await db.runAsync(
    'INSERT INTO records (uid, kind, title, data, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
    newUid(), kind, title.slice(0, 200), JSON.stringify(data), now, now,
  );
  return r.lastInsertRowId;
}

export async function updateRecord<T>(id: number, data: T): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE records SET data = ?, updated_at = ? WHERE id = ?', JSON.stringify(data), Date.now(), id);
}

const parse = <T,>(r: Raw): RecordRow<T> | null => {
  try {
    return { ...r, data: JSON.parse(r.data) as T };
  } catch {
    return null; // 单条损坏只跳过这一条
  }
};

export async function listRecords<T>(kind: string, limit = 50): Promise<Array<RecordRow<T>>> {
  const db = await getDb();
  const rows = await db.getAllAsync<Raw>('SELECT * FROM records WHERE kind = ? ORDER BY created_at DESC LIMIT ?', kind, limit);
  return rows.flatMap((r) => parse<T>(r) ?? []);
}

export async function getRecord<T>(id: number): Promise<RecordRow<T> | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Raw>('SELECT * FROM records WHERE id = ?', id);
  return r ? parse<T>(r) : null;
}

export async function getRecordByUid<T>(uid: string): Promise<RecordRow<T> | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<Raw>('SELECT * FROM records WHERE uid = ?', uid);
  return r ? parse<T>(r) : null;
}

export async function deleteRecord(id: number): Promise<void> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ uid: string }>('SELECT uid FROM records WHERE id = ?', id);
  await db.runAsync('DELETE FROM records WHERE id = ?', id);
  if (row?.uid) await addTombstone('record', row.uid);
}
