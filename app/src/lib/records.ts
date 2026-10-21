// 翻译、练习的历史记录：每条一行，不会因为记录多了撞到存储上限
import { getDb } from './db';

export type RecordRow<T> = { id: number; kind: string; title: string; data: T; created_at: number };

export async function addRecord<T>(kind: string, title: string, data: T): Promise<number> {
  const db = await getDb();
  const r = await db.runAsync('INSERT INTO records (kind, title, data, created_at) VALUES (?, ?, ?, ?)', kind, title.slice(0, 200), JSON.stringify(data), Date.now());
  return r.lastInsertRowId;
}

export async function updateRecord<T>(id: number, data: T): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE records SET data = ? WHERE id = ?', JSON.stringify(data), id);
}

export async function listRecords<T>(kind: string, limit = 50): Promise<Array<RecordRow<T>>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: number; kind: string; title: string; data: string; created_at: number }>(
    'SELECT * FROM records WHERE kind = ? ORDER BY created_at DESC LIMIT ?', kind, limit,
  );
  return rows.flatMap((r) => {
    try {
      return [{ ...r, data: JSON.parse(r.data) as T }];
    } catch {
      return []; // 单条损坏只跳过这一条
    }
  });
}

export async function getRecord<T>(id: number): Promise<RecordRow<T> | null> {
  const db = await getDb();
  const r = await db.getFirstAsync<{ id: number; kind: string; title: string; data: string; created_at: number }>('SELECT * FROM records WHERE id = ?', id);
  if (!r) return null;
  try {
    return { ...r, data: JSON.parse(r.data) as T };
  } catch {
    return null;
  }
}

export async function deleteRecord(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM records WHERE id = ?', id);
}
