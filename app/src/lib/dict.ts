// 手机离线词典：JMdict（含预先翻译好的常用词中文释义）预装在 APK 里，第一次用时复制到手机存储，按原形+读音查词。
// 没有中文释义的词条，查到时再让 AI 只翻译英文义项（和 PC 端同样的规则），结果存在手机上。
// 词典文件由 pc/tools/export_phone_dict.py 生成（不进 git），版本信息在 data/dictInfo.json。
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import BUNDLED from '../data/dictInfo.json';
import { kvGet, kvSet } from './db';
import { toHiragana } from './furigana';
import { requestJson } from './llm';
import { loadLlmSettings } from './settings';
import type { DictEntry } from './types';

const DIR = new Directory(Paths.document, 'dict');
const NAME = 'jmdict.sqlite';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const BUNDLED_FILE = require('../../assets/dict/jmdict.sqlite');

export type DictInfo = { version: string; entries: number; zh: number; size: number };

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let installing: Promise<void> | null = null;

export async function localDictInfo(): Promise<DictInfo | null> {
  if (!new File(DIR, NAME).exists) return null;
  return kvGet<DictInfo | null>('dictInfo', null);
}

/**
 * 把 APK 里的词典取到缓存目录（expo-asset 放在 cache/ExponentAsset-<哈希>.sqlite，下次会直接复用这个文件）。
 * fresh：缓存里那份不对时删掉重取；Asset 对象一次运行里是同一个，要把「已取出」标记也清掉，不然直接返回旧路径
 */
async function extractBundled(fresh: boolean): Promise<File> {
  const asset = Asset.fromModule(BUNDLED_FILE);
  if (fresh) {
    if (asset.localUri) {
      try { const old = new File(asset.localUri); if (old.exists) old.delete(); } catch {}
    }
    asset.downloaded = false;
    asset.localUri = null;
  }
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('读取预装词典失败');
  return new File(asset.localUri);
}

/** 预装的词典还没复制到手机存储（或者 App 更新带来了新版词典）时复制一份。打开 App 时就在后台调用。 */
export function ensureDict(): Promise<void> {
  installing ??= (async () => {
    const info = await kvGet<DictInfo | null>('dictInfo', null);
    if (new File(DIR, NAME).exists && info?.version === BUNDLED.version) return;
    // 大小都和导出时记下的真实大小（dictInfo.json）比，不拿两个文件互相比
    let src = await extractBundled(false);
    if (src.size !== BUNDLED.size) src = await extractBundled(true); // 缓存里是旧的或坏的：删掉重取
    const extracted = src.size;
    if (extracted !== BUNDLED.size) throw new Error(`从安装包取出的词典大小不对（${extracted} / 应为 ${BUNDLED.size} 字节）`);
    if (dbPromise) {
      try { (await dbPromise).closeSync(); } catch {}
      dbPromise = null;
    }
    // 词典目录里只放这一个词典：整个清掉重建，旧版本和上次中断留下的文件都不会挡路
    if (DIR.exists) DIR.delete();
    DIR.create({ intermediates: true });
    // 注意 SDK 57 的 copy / move 是异步的（返回 Promise），同步版本叫 copySync / moveSync。
    // 以前没 await，检查时文件还没复制完，所以一直报「复制不完整」
    await src.copy(new File(DIR, NAME));
    const copied = new File(DIR, NAME);
    if (!copied.exists || copied.size !== BUNDLED.size) {
      throw new Error(`词典复制不完整（复制出 ${copied.exists ? copied.size : '无文件'} / 取出 ${extracted} / 应为 ${BUNDLED.size} 字节），下次打开会重试`);
    }
    // 缓存目录里取出来的那份、以前失败时留下的那份都删掉，省得多占 80 MB
    for (const f of [src, new File(Paths.cache, NAME)]) {
      try { if (f.exists) f.delete(); } catch {}
    }
    await kvSet('dictInfo', BUNDLED); // 最后才记版本：中途被杀掉的话下次打开会重来
  })();
  installing.catch(() => { installing = null; });
  return installing;
}

export async function openDict(): Promise<SQLite.SQLiteDatabase | null> {
  try { await ensureDict(); } catch { return null; }
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(NAME, { useNewConnection: true }, DIR.uri);
    dbPromise.catch(() => { dbPromise = null; });
  }
  return dbPromise;
}

const commonPrefix = (a: string, b: string) => {
  let n = 0;
  while (n < Math.min(a.length, b.length) && a[n] === b[n]) n++;
  return n;
};

/**
 * 查词：base 是原形（行く），reading 是平假名读音（可以是活用后的，比如 いっ）。
 * 打分规则和 PC 端 dictionary.py 的 lookup 一致：写法完全匹配、常用词、读音前缀越长越优先。
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
export async function withLocalZh(e: DictEntry): Promise<DictEntry> {
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

/** AI 释义词条的 id：不是 JMdict 词条，存进生词本时不占 entry_id（按写法去重） */
export const AI_ENTRY_ID = 0;

/**
 * 离线词典查不到的词（人名、新词、网络用语、整个短语、活用得认不出原形的词），让 AI 结合原句给一个简短释义。
 * 做成和词典词条一样的结构，查词面板和生词本都能直接显示。结果按「写法 + 原句」缓存，同一处不重复花钱。
 */
export async function aiGloss(text: string, context?: string, contextZh?: string): Promise<DictEntry> {
  const key = `ai-gloss:${text}|${context ?? ''}`;
  const cached = await kvGet<DictEntry | null>(key, null);
  if (cached) return cached;
  const settings = await loadLlmSettings();
  const raw = await requestJson(settings, [
    {
      role: 'system',
      content:
        '你是日语词典编辑。学习者选中了一个离线词典查不到的日语词或短语（可能是人名地名、新词、网络用语、固定说法、活用形，也可能选多了或选少了几个字）。' +
        '结合原句给出简洁准确的中文释义。base 写辞书形/原形（短语就写短语本身）；reading 只用平假名；pos 用中文词性（如 名词、动词、形容词、短语、人名）；' +
        'meanings 写 1~3 条中文释义，只写在这句话里说得通的意思，不要编造；note 用一句话补充说明（比如是什么的活用、口语/网络用法、选中的部分不成词时应该怎么选），没有就写空字符串。' +
        '如果选中的其实是中文而不是日语，meanings 里给出对应的日语说法。' +
        '只返回 JSON：{"base":"","reading":"","pos":"","meanings":[""],"note":""}',
    },
    { role: 'user', content: JSON.stringify({ selected: text, sentence: context ?? null, sentenceTranslation: contextZh ?? null }) },
  ], (r) => r, { temperature: 0.2, maxTokens: 800 });
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const meanings: string[] = Array.isArray(raw?.meanings) ? raw.meanings.map(str).filter(Boolean) : [];
  if (!meanings.length) throw new Error('AI 没有给出释义，请重试');
  const base = str(raw?.base) || text;
  const reading = toHiragana(str(raw?.reading));
  const pos = str(raw?.pos);
  const note = str(raw?.note);
  const entry: DictEntry = {
    id: AI_ENTRY_ID,
    kanji: [base],
    readings: reading && reading !== base ? [reading] : [],
    common: false,
    senses: meanings.map((m, i) => ({
      pos: i === 0 && pos ? [pos] : [],
      tags: i === 0 ? ['AI 释义'] : [],
      en: i === meanings.length - 1 && note ? [note] : [],
      zh: m,
    })),
  };
  await kvSet(key, entry);
  return entry;
}
