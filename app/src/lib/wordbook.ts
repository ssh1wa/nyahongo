// 生词本 + FSRS 间隔复习。词条内容来自 JMdict（学习包里的 dictionary.json）；只有词典查不到的词才用 AI 释义，并标明「AI 释义」。
import { createEmptyCard, fsrs, generatorParameters, Rating, TypeConvert, type Card, type Grade } from 'ts-fsrs';
import { getDb } from './db';
import { AI_ENTRY_ID } from './dict';
import { award } from './game';
import type { DictEntry, Sentence, Token } from './types';

const scheduler = fsrs(generatorParameters({ enable_fuzz: true, request_retention: 0.9 }));

export type WordRow = {
  id: number;
  entry_id: number | null;
  headword: string;
  reading: string | null;
  entry: DictEntry | null;
  context: string | null; // 原句
  context_zh: string | null;
  package_id: string | null;
  clip_start: number | null; // 原声片段，复习时可以回放
  clip_end: number | null;
  card: Card;
  due: number;
  added_at: number;
  mastered: boolean; // 已掌握：不再出现在复习里，单独一个词本
  detail: WordDetail | null; // AI 详细释义（缓存）
};

/** AI 生成的详细释义。日语例句是注音分段；英语单词的例句 reading 都是 null */
export type WordDetail = {
  summary: string;
  meanings: Array<{ meaning: string; note: string }>;
  usage: string[];
  collocations: Array<{ text: string; zh: string }>;
  examples: Array<{ segments: Array<{ text: string; reading?: string | null }>; zh: string }>;
  similar: Array<{ word: string; diff: string }>;
};

type RawRow = Omit<WordRow, 'entry' | 'card' | 'mastered' | 'detail'> & { entry: string | null; card: string; mastered: number; detail: string | null };

function parse(row: RawRow): WordRow {
  let detail: WordDetail | null = null;
  try { detail = row.detail ? (JSON.parse(row.detail) as WordDetail) : null; } catch {}
  return {
    ...row,
    entry: row.entry ? (JSON.parse(row.entry) as DictEntry) : null,
    card: TypeConvert.card(JSON.parse(row.card)),
    mastered: !!row.mastered,
    detail,
  };
}

/** FSRS 预测的记忆稳定性（天）达到这么久、并且至少复习过这么多次，就算掌握了 */
export const MASTERED_STABILITY_DAYS = 60;
export const MASTERED_MIN_REPS = 4;
const isMastered = (card: Card) => card.stability >= MASTERED_STABILITY_DAYS && card.reps >= MASTERED_MIN_REPS;

export async function isSaved(entryId: number | undefined | null): Promise<boolean> {
  if (entryId == null) return false;
  const db = await getDb();
  return !!(await db.getFirstAsync('SELECT 1 FROM words WHERE entry_id = ?', entryId));
}

export type NewWord = {
  entry: DictEntry | null;
  headword: string;
  reading: string | null;
  context?: string | null; // 遇到这个词的原句
  contextZh?: string | null;
  packageId?: string | null; // 来自视频学习包时，复习可以回放原声
  clipStart?: number | null;
  clipEnd?: number | null;
};

/** 加入生词本。同一个 JMdict 词条只收一次，已存在则返回 false。 */
export async function addWord(w: NewWord): Promise<boolean> {
  const db = await getDb();
  // AI 释义的词条（id 0）不是词典词条，和没有词条的词一样按写法去重
  const entryId = w.entry && w.entry.id !== AI_ENTRY_ID ? w.entry.id : null;
  if (entryId != null && (await isSaved(entryId))) return false;
  if (entryId == null && (await db.getFirstAsync('SELECT 1 FROM words WHERE entry_id IS NULL AND headword = ?', w.headword))) return false;
  const card = createEmptyCard(new Date());
  await db.runAsync(
    `INSERT INTO words (entry_id, headword, reading, entry, context, context_zh, package_id, clip_start, clip_end, card, due, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    entryId,
    w.headword,
    w.reading,
    w.entry ? JSON.stringify(w.entry) : null,
    w.context ?? null,
    w.contextZh ?? null,
    w.packageId ?? null,
    w.clipStart ?? null,
    w.clipEnd ?? null,
    JSON.stringify(card),
    card.due.getTime(),
    Date.now(),
  );
  award('word');
  return true;
}

/** 从学习包的一个词加入生词本，带上原句和原声片段位置。 */
export function addFromToken(token: Token, entry: DictEntry | null, sentence: Sentence, packageId: string): Promise<boolean> {
  return addWord({
    entry,
    headword: entry ? entry.kanji[0] || entry.readings[0] : token.base ?? token.surface,
    // 英语单词存音标当「读音」
    reading: entry?.phonetic ? `/${entry.phonetic}/` : entry ? entry.readings[0] ?? null : token.reading ?? null,
    context: sentence.text,
    contextZh: sentence.zh,
    packageId,
    clipStart: sentence.start,
    clipEnd: sentence.end,
  });
}

/** 生词本统计：总数、到期数、今天复习过的数量、连续学习天数。 */
export async function stats(): Promise<{ total: number; due: number; reviewedToday: number; streak: number; mastered: number }> {
  const db = await getDb();
  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [t, d, r, days, m] = await Promise.all([
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words WHERE mastered = 0'),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words WHERE due <= ? AND mastered = 0', now),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ?', start.getTime()),
    db.getAllAsync<{ d: string }>("SELECT DISTINCT date(reviewed_at / 1000, 'unixepoch', 'localtime') AS d FROM review_log ORDER BY d DESC LIMIT 400"),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words WHERE mastered = 1'),
  ]);
  // 连续天数：从今天（或昨天）往前数
  const set = new Set(days.map((x) => x.d));
  const day = new Date();
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (!set.has(key(day))) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (set.has(key(day))) { streak++; day.setDate(day.getDate() - 1); }
  return { total: t?.n ?? 0, due: d?.n ?? 0, reviewedToday: r?.n ?? 0, streak, mastered: m?.n ?? 0 };
}

export async function listWords(): Promise<WordRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>('SELECT * FROM words ORDER BY added_at DESC');
  return rows.map(parse);
}

export async function dueWords(limit = 50): Promise<WordRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>('SELECT * FROM words WHERE due <= ? AND mastered = 0 ORDER BY due LIMIT ?', Date.now(), limit);
  return rows.map(parse);
}

export async function countDue(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words WHERE due <= ? AND mastered = 0', Date.now());
  return row?.n ?? 0;
}

export const GRADES: Array<{ grade: Grade; label: string }> = [
  { grade: Rating.Again, label: '忘了' },
  { grade: Rating.Hard, label: '模糊' },
  { grade: Rating.Good, label: '记得' },
  { grade: Rating.Easy, label: '简单' },
];

/** 每个评分对应的下次复习间隔，显示在按钮上。 */
export function previewIntervals(card: Card): Record<number, string> {
  const now = new Date();
  const out: Record<number, string> = {};
  for (const { grade } of GRADES) {
    const next = scheduler.next(card, now, grade).card.due.getTime();
    out[grade] = formatInterval(next - now.getTime());
  }
  return out;
}

function formatInterval(ms: number): string {
  const min = Math.round(ms / 60000);
  if (min < 60) return `${Math.max(1, min)} 分钟`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} 小时`;
  const d = Math.round(h / 24);
  if (d < 31) return `${d} 天`;
  const m = Math.round(d / 30);
  return m < 12 ? `${m} 个月` : `${(d / 365).toFixed(1)} 年`;
}

/** 复习一次。返回 true 表示这次之后算掌握了（自动移到「已掌握」） */
export async function review(word: WordRow, grade: Grade): Promise<boolean> {
  const db = await getDb();
  const now = new Date();
  const { card } = scheduler.next(word.card, now, grade);
  const mastered = isMastered(card);
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE words SET card = ?, due = ?, mastered = ? WHERE id = ?', JSON.stringify(card), card.due.getTime(), mastered ? 1 : 0, word.id);
    await db.runAsync('INSERT INTO review_log (word_id, rating, reviewed_at) VALUES (?, ?, ?)', word.id, grade, now.getTime());
  });
  award('review'); // 不看评分，免得为了小判乱按
  return mastered;
}

/** 手动在「生词」和「已掌握」之间移动。移回生词时，明天就会出现在复习里 */
export async function setMastered(id: number, mastered: boolean): Promise<void> {
  const db = await getDb();
  if (mastered) await db.runAsync('UPDATE words SET mastered = 1 WHERE id = ?', id);
  else await db.runAsync('UPDATE words SET mastered = 0, due = MIN(due, ?) WHERE id = ?', Date.now() + 86_400_000, id);
}

export async function saveDetail(id: number, detail: WordDetail): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE words SET detail = ? WHERE id = ?', JSON.stringify(detail), id);
}

export async function deleteWord(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM words WHERE id = ?', id);
}
