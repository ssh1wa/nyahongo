// 常读：保存下来的写作要求（比如「每天一篇科普」「今天的新闻」），每天点一次用同一个提示词写一篇新的
import { addTombstone, kvGet, kvSet } from './db';
import { award } from './game';
import { getRecord, getRecordByUid } from './records';
import {
  generateArticle, researchAndWrite, saveArticle, splitArticle, type Article, type ArticleLength, type ResearchStage,
} from './reading';
import { loadLlmSettings } from './settings';

// articleId 是本机的记录 id；articleUid 跨设备不变（同步过来的文章本机 id 不一样，按 uid 找）
export type RoutineEntry = { date: string; title: string; subject?: string; urls: string[]; articleId: number; articleUid?: string };

export type Routine = {
  id: string;
  name: string;
  prompt: string;
  length: ArticleLength;
  web: boolean;
  createdAt: number;
  history: RoutineEntry[]; // 最新的在前
};

const KEY = 'routines';
const HISTORY_LIMIT = 60;

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export const listRoutines = () => kvGet<Routine[]>(KEY, []);

const saveAll = (list: Routine[]) => kvSet(KEY, list);

export async function addRoutine(r: Pick<Routine, 'name' | 'prompt' | 'length' | 'web'>): Promise<Routine> {
  const routine: Routine = { ...r, id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, createdAt: Date.now(), history: [] };
  await saveAll([...(await listRoutines()), routine]);
  return routine;
}

export async function deleteRoutine(id: string): Promise<void> {
  await saveAll((await listRoutines()).filter((r) => r.id !== id));
  await addTombstone('routine', id);
}

/** 今天已经写过的那篇（被删掉了就当没写过）。 */
export async function todaysArticle(r: Routine): Promise<{ id: number; article: Article } | null> {
  const entry = r.history.find((h) => h.date === localDate());
  if (!entry) return null;
  const row = (entry.articleUid ? await getRecordByUid<Article>(entry.articleUid) : null) ?? (await getRecord<Article>(entry.articleId));
  return row ? { id: row.id, article: row.data } : null;
}

/** 按常读的提示词写今天的一篇：避开以前写过的主题和用过的网页，写好直接存进「读过的文章」。 */
export async function writeToday(
  routine: Routine,
  onStage: (stage: ResearchStage, detail?: string) => void,
): Promise<{ id: number; article: Article }> {
  // 中文主题比日语标题更能让 AI 看出「写过什么」
  const avoid = { titles: routine.history.map((h) => (h.subject ? `${h.subject}（${h.title}）` : h.title)), urls: routine.history.flatMap((h) => h.urls) };
  let out: { title: string; subject?: string; text: string; references: Array<{ title: string; url: string; site?: string }> };
  if (routine.web) {
    out = await researchAndWrite(routine.prompt, routine.length, onStage, avoid);
  } else {
    onStage('writing');
    out = { ...(await generateArticle(routine.prompt, routine.length, avoid)), references: [] };
  }
  if (!out.text.trim()) throw new Error('生成失败，请重试');

  const { level } = await loadLlmSettings();
  const article: Article = {
    title: out.title, source: 'ai', level, paragraphs: splitArticle(out.text),
    references: out.references.length ? out.references : undefined,
  };
  const id = await saveArticle(article);
  const saved = await getRecord<Article>(id);

  // 重新读一遍再写，避免覆盖生成期间对别的常读做的改动
  const list = await listRoutines();
  const entry: RoutineEntry = { date: localDate(), title: out.title, subject: out.subject || undefined, urls: out.references.map((x) => x.url), articleId: id, articleUid: saved?.uid };
  await saveAll(list.map((r) => (r.id === routine.id ? { ...r, history: [entry, ...r.history].slice(0, HISTORY_LIMIT) } : r)));
  award('routine', routine.id);
  return { id, article };
}
