// 生词本 + FSRS 间隔复习。词条内容来自 JMdict（学习包里的 dictionary.json），不让 AI 编词条。
import { createEmptyCard, fsrs, generatorParameters, Rating, TypeConvert, type Card, type Grade } from 'ts-fsrs';
import { getDb } from './db';
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
};

type RawRow = Omit<WordRow, 'entry' | 'card'> & { entry: string | null; card: string };

function parse(row: RawRow): WordRow {
  return {
    ...row,
    entry: row.entry ? (JSON.parse(row.entry) as DictEntry) : null,
    card: TypeConvert.card(JSON.parse(row.card)),
  };
}

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
  if (w.entry && (await isSaved(w.entry.id))) return false;
  if (!w.entry && (await db.getFirstAsync('SELECT 1 FROM words WHERE entry_id IS NULL AND headword = ?', w.headword))) return false;
  const card = createEmptyCard(new Date());
  await db.runAsync(
    `INSERT INTO words (entry_id, headword, reading, entry, context, context_zh, package_id, clip_start, clip_end, card, due, added_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    w.entry?.id ?? null,
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
    headword: entry ? entry.kanji[0] || entry.readings[0] : token.base,
    reading: entry ? entry.readings[0] ?? null : token.reading,
    context: sentence.text,
    contextZh: sentence.zh,
    packageId,
    clipStart: sentence.start,
    clipEnd: sentence.end,
  });
}

/** 生词本统计：总数、到期数、今天复习过的数量、连续学习天数。 */
export async function stats(): Promise<{ total: number; due: number; reviewedToday: number; streak: number }> {
  const db = await getDb();
  const now = Date.now();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const [t, d, r, days] = await Promise.all([
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words'),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words WHERE due <= ?', now),
    db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM review_log WHERE reviewed_at >= ?', start.getTime()),
    db.getAllAsync<{ d: string }>("SELECT DISTINCT date(reviewed_at / 1000, 'unixepoch', 'localtime') AS d FROM review_log ORDER BY d DESC LIMIT 400"),
  ]);
  // 连续天数：从今天（或昨天）往前数
  const set = new Set(days.map((x) => x.d));
  const day = new Date();
  const key = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
  if (!set.has(key(day))) day.setDate(day.getDate() - 1);
  let streak = 0;
  while (set.has(key(day))) { streak++; day.setDate(day.getDate() - 1); }
  return { total: t?.n ?? 0, due: d?.n ?? 0, reviewedToday: r?.n ?? 0, streak };
}

export async function listWords(): Promise<WordRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>('SELECT * FROM words ORDER BY added_at DESC');
  return rows.map(parse);
}

export async function dueWords(limit = 50): Promise<WordRow[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<RawRow>('SELECT * FROM words WHERE due <= ? ORDER BY due LIMIT ?', Date.now(), limit);
  return rows.map(parse);
}

export async function countDue(): Promise<number> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ n: number }>('SELECT COUNT(*) AS n FROM words WHERE due <= ?', Date.now());
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

export async function review(word: WordRow, grade: Grade): Promise<void> {
  const db = await getDb();
  const now = new Date();
  const { card } = scheduler.next(word.card, now, grade);
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE words SET card = ?, due = ? WHERE id = ?', JSON.stringify(card), card.due.getTime(), word.id);
    await db.runAsync('INSERT INTO review_log (word_id, rating, reviewed_at) VALUES (?, ?, ?)', word.id, grade, now.getTime());
  });
  award('review'); // 不看评分，免得为了小判乱按
}

export async function deleteWord(id: number): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM words WHERE id = ?', id);
}
