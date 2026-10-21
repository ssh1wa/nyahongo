// 手机离线词典：从电脑下载 JMdict（含电脑上已经翻译好的中文释义），按原形+读音查词。
// 没有中文释义的词条，查到时再让 AI 只翻译英文义项（和电脑端同样的规则），结果存在手机上。
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { kvGet, kvSet } from './db';
import { toHiragana } from './furigana';
import { requestJson } from './llm';
import { loadLlmSettings } from './settings';
import type { DictEntry } from './types';

const DIR = new Directory(Paths.document, 'dict');
const NAME = 'jmdict.sqlite';

export type DictInfo = { version: string; entries: number; zh: number; size: number };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export async function localDictInfo(): Promise<DictInfo | null> {
  if (!new File(DIR, NAME).exists) return null;
  return kvGet<DictInfo | null>('dictInfo', null);
}

function openDict(): Promise<SQLite.SQLiteDatabase> | null {
  if (!new File(DIR, NAME).exists) return null;
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(NAME, { useNewConnection: true }, DIR.uri);
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

export async function remoteDictInfo(pcUrl: string): Promise<DictInfo & { exists: boolean }> {
  const res = await fetch(`${pcUrl}/api/dictionary`);
  if (!res.ok) throw new Error(`电脑端返回错误 HTTP ${res.status}`);
  return res.json();
}

/** 从电脑下载离线词典。先下到临时文件，完整下完再替换，下载中断不会弄坏旧词典。 */
export async function downloadDict(pcUrl: string, onProgress: (f: number) => void, signal?: AbortSignal): Promise<DictInfo> {
  const info = await remoteDictInfo(pcUrl);
  if (!info.exists) throw new Error('电脑上还没有生成离线词典');
  if (!DIR.exists) DIR.create({ intermediates: true });
  const tmp = new File(DIR, `${NAME}.part`);
  if (tmp.exists) tmp.delete();
  await File.downloadFileAsync(`${pcUrl}/api/dictionary/file`, tmp, {
    idempotent: true,
    signal,
    onProgress: ({ bytesWritten, totalBytes }) => onProgress(Math.min(bytesWritten / (totalBytes > 0 ? totalBytes : info.size || 1), 0.999)),
  });
  // 关掉旧连接再替换文件
  if (dbPromise) {
    try { (await dbPromise).closeSync(); } catch {}
    dbPromise = null;
  }
  const target = new File(DIR, NAME);
  if (target.exists) target.delete();
  tmp.rename(NAME);
  const local: DictInfo = { version: info.version, entries: info.entries, zh: info.zh, size: info.size };
  await kvSet('dictInfo', local);
  onProgress(1);
  return local;
}

export async function deleteDict(): Promise<void> {
  if (dbPromise) {
    try { (await dbPromise).closeSync(); } catch {}
    dbPromise = null;
  }
  const f = new File(DIR, NAME);
  if (f.exists) f.delete();
  await kvSet('dictInfo', null);
}

const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < Math.min(a.length, b.length) && a[n] === b[n]) n++;
  return n;
};

/**
 * 查词：base 是原形（行く），reading 是平假名读音（可以是活用后的，比如 いっ）。
 * 打分规则和电脑端 dictionary.py 的 lookup 一致：写法完全匹配、常用词、读音前缀越长越优先。
 */
export async function lookup(base: string, reading?: string | null): Promise<DictEntry | null> {
  const db = await openDict();
  if (!db || !base) return null;
  const keys = [...new Set([base, toHiragana(base)])];
  const rows = await db.getAllAsync<{ form: string; entry_id: number; common: number; rare: number }>(
    `SELECT form, entry_id, common, rare FROM forms WHERE form IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  if (!rows.length) return null;
  const ids = [...new Set(rows.map((r) => r.entry_id))].slice(0, 30);
  const entries = await db.getAllAsync<{ id: number; data: string }>(
    `SELECT id, data FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  const r = reading ? toHiragana(reading) : '';
  const kanaOnly = !/[㐀-鿿々]/.test(base);
  let best: DictEntry | null = null;
  let bestScore = -Infinity;
  for (const row of entries) {
    const e = JSON.parse(row.data) as DictEntry;
    const matched = rows.filter((x) => x.entry_id === row.id);
    let score = matched.some((x) => x.form === base) ? 100 : 40;
    if (e.common) score += 20;
    if (matched.every((x) => x.rare)) score -= 30;
    if (r && e.readings.length) {
      score += 8 * Math.max(...e.readings.map((x) => commonPrefix(r, toHiragana(x))));
      if (e.readings.some((x) => toHiragana(x) === r)) score += 25;
    }
    if (kanaOnly && e.kanji.length) score += e.senses[0]?.tags.includes('常写假名') ? 20 : -10;
    score -= row.id / 1e9;
    if (score > bestScore) { best = e; bestScore = score; }
  }
  return best ? withLocalZh(best) : null;
}

/** 合并手机上 AI 翻译过的中文义项。 */
async function withLocalZh(e: DictEntry): Promise<DictEntry> {
  if (e.senses.every((s) => s.zh)) return e;
  const zh = await kvGet<string[] | null>(`zh:${e.id}`, null);
  return zh && zh.length === e.senses.length ? { ...e, senses: e.senses.map((s, i) => ({ ...s, zh: s.zh || zh[i] })) } : e;
}

/** 让 AI 只翻译这个词条已有的英文义项（不编新义项），结果缓存在手机上。 */
export async function translateEntry(e: DictEntry): Promise<DictEntry> {
  if (e.senses.every((s) => s.zh)) return e;
  const settings = await loadLlmSettings();
  const senses = await requestJson(settings, [
    {
      role: 'system',
      content:
        '你是日语词典编辑。把 JMdict 词条的英文义项翻译成简洁准确的简体中文释义。每个义项译成一条，近义说法用「；」分隔。' +
        '输出的义项数量和顺序必须与输入一致，只翻译给出的含义，不补充、不举例。日语汉字词和中文同形但意思不同时，按英文义项翻译。' +
        '只返回 JSON：{"senses":["中文释义1","中文释义2"]}',
    },
    { role: 'user', content: JSON.stringify({ word: e.kanji[0] || e.readings[0], reading: e.readings[0], senses: e.senses.map((s) => s.en) }) },
  ], (raw) => (Array.isArray(raw?.senses) ? raw.senses.map((x: unknown) => String(x ?? '').trim()) : []), { temperature: 0.1, maxTokens: 1500 });
  if (senses.length !== e.senses.length || senses.some((s: string) => !s)) return e; // 义项数对不上就不用
  await kvSet(`zh:${e.id}`, senses);
  return { ...e, senses: e.senses.map((s, i) => ({ ...s, zh: s.zh || senses[i] })) };
}
