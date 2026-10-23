// 输入即查：翻译页输入框里打日语单词时，下面直接列出离线词典的结果（不花 AI 费用）。
// 排序：写法完全一样 > 活用还原后一样（食べた → 食べる，只认动词、形容词） > 前缀匹配（短的、常用的在前）。
// 都查不到时退一步：取词典里有的最长前缀（勉強しなきゃ → 勉強）。
// 也能用中文查日语（吃 → 食べる）：词典导出时把中文释义拆成词建了 zh_terms 表（pc/src/nihongo_pc/phone_dict.py）。
// 输入是哪种语言的判断规则见 searchGroups。
import { baseCandidates } from './deinflect';
import { openDict, withLocalZh } from './dict';
import { toHiragana } from './furigana';
import type { TranslateDirection } from './prompts';
import type { DictEntry } from './types';

/** match：exact 写法完全一样 / inflected 活用还原 / prefix 前缀 / partial 只有开头一段对得上 / zh 中文释义 */
export type SearchHit = { entry: DictEntry; form: string; match: 'exact' | 'inflected' | 'prefix' | 'partial' | 'zh' };
export type SearchGroup = { kind: 'ja' | 'zh'; title: string; hits: SearchHit[] };

const JAPANESE = /[぀-ヿ㐀-鿿々〆ヶ]/;
const KANA = /[぀-ヿ]/;
const SENTENCE = /[。、！？!?\s]/;

/** 像一个日语单词（不是整句）才查：有假名或汉字、不长、没有句读和空格 */
export const looksLikeWord = (s: string) => {
  const t = s.trim();
  return t.length > 0 && t.length <= 12 && JAPANESE.test(t) && !SENTENCE.test(t);
};

type Row = { form: string; entry_id: number; common: number; rare: number };

const hasPos = (e: DictEntry, test: (pos: string) => boolean) => e.senses.some((s) => s.pos.some(test));
/** 活用还原出来的原形，词条得是对应的词性才算（不然 がっこう 会被当成意志形还原成 がっく） */
const fitsBase = (e: DictEntry, base: string) =>
  base.endsWith('い') ? hasPos(e, (p) => p.includes('形容词') || p.includes('动词')) : hasPos(e, (p) => p.includes('动词'));

async function loadEntries(ids: number[]): Promise<Map<number, DictEntry>> {
  const db = await openDict();
  if (!db || !ids.length) return new Map();
  const rows = await db.getAllAsync<{ id: number; data: string }>(
    `SELECT id, data FROM entries WHERE id IN (${ids.map(() => '?').join(',')})`,
    ...ids,
  );
  return new Map(rows.map((r) => [r.id, JSON.parse(r.data) as DictEntry]));
}

export async function searchWords(query: string, limit = 12): Promise<SearchHit[]> {
  const q = query.trim();
  if (!looksLikeWord(q)) return [];
  const db = await openDict();
  if (!db) return [];
  const variants = [...new Set([q, toHiragana(q)])];
  // 最多还原三层：食べさせられた → 食べさせられる → 食べさせる → 食べる；
  // 勉強します → 勉強する → 勉強（词典里サ变动词只收名词部分）
  let layer = variants;
  const all = new Set<string>();
  for (let i = 0; i < 3 && layer.length; i++) {
    layer = layer.flatMap(baseCandidates).filter((b) => !all.has(b) && !variants.includes(b));
    layer.forEach((b) => all.add(b));
  }
  const derived = [...all];
  const suru = derived.filter((b) => b.endsWith('する') && b.length > 2).map((b) => b.slice(0, -2));
  const keys = [...new Set([...variants, ...derived, ...suru])];

  const exactRows = await db.getAllAsync<Row>(
    `SELECT form, entry_id, common, rare FROM forms WHERE form IN (${keys.map(() => '?').join(',')})`,
    ...keys,
  );
  // 活用还原出来的匹配要看词性，先把这些词条取出来
  const derivedRows = exactRows.filter((r) => !variants.includes(r.form));
  const derivedEntries = await loadEntries([...new Set(derivedRows.map((r) => r.entry_id))]);
  const exact = exactRows.filter((r) => {
    if (variants.includes(r.form)) return true;
    const e = derivedEntries.get(r.entry_id);
    if (!e) return false;
    return suru.includes(r.form) ? hasPos(e, (p) => p.includes('サ变')) : fitsBase(e, r.form);
  });
  const prefix: Row[] = [];
  for (const v of variants) {
    // 按索引查前缀：form >= v AND form < v + U+FFFF
    prefix.push(...await db.getAllAsync<Row>(
      'SELECT form, entry_id, common, rare FROM forms WHERE form >= ? AND form < ? ORDER BY common DESC, length(form) LIMIT 60',
      v, `${v}\uffff`,
    ));
  }

  // 每个词条取最好的一个匹配打分
  const best = new Map<number, { score: number; form: string; match: SearchHit['match'] }>();
  const consider = (r: Row, base: number) => {
    let score = base + (r.common ? 100 : 0) - (r.rare ? 50 : 0) - r.entry_id / 1e9;
    if (base < 800) score -= (r.form.length - q.length) * 8; // 前缀匹配：越接近输入越靠前
    const match = base >= 1000 ? 'exact' : base >= 800 ? 'inflected' : base >= 500 ? 'prefix' : 'partial';
    const old = best.get(r.entry_id);
    if (!old || score > old.score) best.set(r.entry_id, { score, form: r.form, match });
  };
  for (const r of exact) consider(r, variants.includes(r.form) ? 1000 : 800);
  for (const r of prefix) consider(r, 500);
  if (!best.size) {
    // 还是查不到：取词典里有的最长前缀
    for (let n = q.length - 1; n >= 1 && !best.size; n--) {
      const head = [...new Set([q.slice(0, n), toHiragana(q.slice(0, n))])];
      const rows = await db.getAllAsync<Row>(
        `SELECT form, entry_id, common, rare FROM forms WHERE form IN (${head.map(() => '?').join(',')})`,
        ...head,
      );
      for (const r of rows) consider(r, 300);
    }
  }

  const top = [...best.entries()].sort((a, b) => b[1].score - a[1].score).slice(0, limit);
  if (!top.length) return [];
  const byId = await loadEntries(top.map(([id]) => id));
  const hits: SearchHit[] = [];
  for (const [id, { form, match }] of top) {
    const e = byId.get(id);
    if (e) hits.push({ entry: await withLocalZh(e), form, match });
  }
  return hits;
}

type ZhRow = { term: string; entry_id: number; sense: number; part: number; glen: number; common: number; loan: number };

/** 中文查日语：按中文释义里的词查（只有预先翻译过中文的约 2.2 万个常用词条） */
export async function searchByChinese(query: string, limit = 8): Promise<SearchHit[]> {
  const q = query.trim();
  const db = await openDict();
  if (!db || !q) return [];
  let rows: ZhRow[];
  try {
    rows = await db.getAllAsync<ZhRow>(
      'SELECT term, entry_id, sense, part, glen, common, loan FROM zh_terms WHERE term >= ? AND term < ? LIMIT 400',
      q, `${q}\uffff`,
    );
  } catch {
    return []; // 旧版词典没有 zh_terms 表
  }
  const best = new Map<number, number>();
  for (const r of rows) {
    // 完全一样 > 以它开头；常用词、靠前的义项、越专一的义项（食べる「吃」比 喫する「吃；喝；抽（烟）…」）越靠前；外来语往后
    let score = (r.term === q ? 1000 : 400 - (r.term.length - q.length) * 15) + r.common * 200;
    score -= r.sense * 40 + r.part * 10 + r.glen * 4 + r.loan * 120;
    if (score > (best.get(r.entry_id) ?? -Infinity)) best.set(r.entry_id, score);
  }
  const top = [...best.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit);
  const byId = await loadEntries(top.map(([id]) => id));
  const hits: SearchHit[] = [];
  for (const [id] of top) {
    const e = byId.get(id);
    if (!e) continue;
    const usuallyKana = e.senses[0]?.tags.includes('常写假名');
    hits.push({ entry: await withLocalZh(e), form: (!usuallyKana && e.kanji[0]) || e.readings[0] || '', match: 'zh' });
  }
  return hits;
}

/**
 * 输入框即查，按翻译方向判断输入是日语还是中文：
 * - 「日 → 中」：只当日语查写法；「中 → 日」：只当中文查释义
 * - 「自动识别」：有假名一定是日语；纯汉字两边都查、分两组——
 *   日语里有这个写法而且是常用词（学校、安静）就「日语词」在前，否则（吃 只有冷门的麻将用语、电话 日语里没这个写法）「中文意思」在前；
 *   中文那组有结果时，日语那组只有「开头一段对得上」的凑数结果（学习 → 学）就不显示
 */
export async function searchGroups(query: string, dir: TranslateDirection): Promise<SearchGroup[]> {
  const q = query.trim();
  if (!looksLikeWord(q)) return [];
  const jaGroup = (hits: SearchHit[]): SearchGroup => ({ kind: 'ja', title: '日语词', hits });
  const zhGroup = (hits: SearchHit[]): SearchGroup => ({ kind: 'zh', title: `中文「${q}」→ 日语`, hits });
  if (dir === 'ja-zh' || (dir === 'auto' && KANA.test(q))) {
    const ja = await searchWords(q);
    return ja.length ? [jaGroup(ja)] : [];
  }
  const zh = await searchByChinese(q);
  if (dir === 'zh-ja') return zh.length ? [zhGroup(zh)] : [];

  let ja = await searchWords(q);
  if (zh.length) ja = ja.filter((h) => h.match !== 'partial');
  const jaFirst = ja.some((h) => h.match === 'exact' && h.entry.common);
  const groups = [ja.length ? jaGroup(ja.slice(0, 6)) : null, zh.length ? zhGroup(zh) : null]
    .filter((g): g is SearchGroup => !!g);
  return jaFirst ? groups : groups.reverse();
}

/** 列表里显示的一行释义：第一个义项，有中文用中文 */
export const shortMeaning = (e: DictEntry) => {
  const s = e.senses[0];
  return s ? s.zh || s.en.slice(0, 3).join('; ') : '';
};
