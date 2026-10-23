// 语法课程：语法点来自 Hanabira 开源语法库（hanabira.org，署名后可免费使用），
// AI 只负责按水平排课、写中文讲解、出例句和练习题，讲解以库里的原始说明为依据。
// 课程安排、中文简述、828 课课文都已经预先生成好打包进 App（pc/tools/pregen_grammar.py），打开就能学；
// 用户点「重新生成」才会调用 AI，结果存在本机，以本机的为准。
import data from '../data/grammar.json';
import bundledCourse from '../data/grammar/course.json';
import bundledZh from '../data/grammar/zh.json';
import { getDb, kvGet, kvSet } from './db';
import { normalizeSegments } from './furigana';
import { arr, num, requestJson, str } from './llm';
import { loadLlmSettings, type Level } from './settings';
import type { FuriganaSegment } from './types';

export type GrammarLevel = 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
export const GRAMMAR_LEVELS: GrammarLevel[] = ['N5', 'N4', 'N3', 'N2', 'N1'];

export type GrammarPoint = {
  id: string;
  title: string;
  short: string;
  long: string;
  formation: string;
  examples: Array<{ jp: string; en: string }>;
};

const LIBRARY = data as Record<GrammarLevel, GrammarPoint[]>;
const BY_ID = new Map(GRAMMAR_LEVELS.flatMap((lv) => LIBRARY[lv].map((g) => [g.id, g] as const)));

export const pointsOf = (level: GrammarLevel) => LIBRARY[level];
export const getPoint = (id: string) => BY_ID.get(id);
export const toGrammarLevel = (level: Level): GrammarLevel => (level === '入门' ? 'N5' : level);
export const ATTRIBUTION = '语法点来自 Hanabira 开源日语语法库（hanabira.org）';

/** 去掉标题里的罗马音括号：「〜てもいい (te mo ii)」→「〜てもいい」 */
export const cleanTitle = (t: string) => t.replace(/\s*[（(][^）)]*[a-z][^）)]*[）)]\s*$/i, '').trim();

// ---------- 课程（单元划分） ----------

export type Unit = { title: string; theme: string; ids: string[] };

/** 课程：本机重新设计过就用本机的，否则用打包的 */
export const loadCourse = async (level: GrammarLevel): Promise<Unit[] | null> =>
  (await kvGet<Unit[] | null>(`course:${level}`, null)) ?? ((bundledCourse as Record<string, Unit[]>)[level] ?? null);

/** 让 AI 把这一级的语法点排成循序渐进的单元。保证每个语法点都出现且只出现一次。 */
export async function designCourse(level: GrammarLevel): Promise<Unit[]> {
  const points = LIBRARY[level];
  const settings = await loadLlmSettings();
  const units = await requestJson(settings, [
    {
      role: 'system',
      content: `你是日语课程设计师，学生是中文母语者。把下面 ${level} 级的全部语法点排成一门循序渐进的课程：
- 分成若干单元，每单元 5-8 个语法点，相关的放在一起（比如同一类表达、意思相近需要对比的）
- 先易后难，先高频后低频
- 每个语法点必须出现且只出现一次，用给出的 id
- 单元标题和主题用简体中文，简短具体
只返回 JSON：{"units":[{"title":"单元标题","theme":"一句话说明这单元学什么","ids":["N5-001","N5-007"]}]}`,
    },
    { role: 'user', content: JSON.stringify(points.map((p) => ({ id: p.id, title: cleanTitle(p.title), meaning: p.short }))) },
  ], (raw) => arr<Unit>(raw?.units, (u) => (Array.isArray(u?.ids) ? { title: str(u.title, '单元'), theme: str(u.theme), ids: u.ids.map(String) } : null)),
  { temperature: 0.3, maxTokens: 8000, timeoutMs: 180000 });

  // 去重、去掉不存在的 id，漏掉的补到最后一个单元
  const valid = new Set(points.map((p) => p.id));
  const seen = new Set<string>();
  const fixed = units
    .map((u) => ({ ...u, ids: u.ids.filter((id) => valid.has(id) && !seen.has(id) && (seen.add(id), true)) }))
    .filter((u) => u.ids.length);
  const missing = points.map((p) => p.id).filter((id) => !seen.has(id));
  for (let k = 0; k < missing.length; k += 7) {
    fixed.push({ title: `补充语法 ${Math.floor(k / 7) + 1}`, theme: '其他常见语法', ids: missing.slice(k, k + 7) });
  }
  if (!fixed.length) throw new Error('课程设计失败，请重试');
  await kvSet(`course:${level}`, fixed);
  return fixed;
}

// ---------- 中文简述 ----------

/** 每个语法点一句中文意思（库里只有英文），一次翻完一整级并缓存。 */
export const loadZhMeanings = async (level: GrammarLevel): Promise<Record<string, string>> => ({
  ...((bundledZh as Record<string, Record<string, string>>)[level] ?? {}),
  ...(await kvGet<Record<string, string>>(`grammarZh:${level}`, {})),
});

export async function translateMeanings(level: GrammarLevel): Promise<Record<string, string>> {
  const points = LIBRARY[level];
  const settings = await loadLlmSettings();
  const raw = await requestJson(settings, [
    {
      role: 'system',
      content: '把每个日语语法点的英文简要说明翻译成简体中文，15 字以内，说清楚意思和用法即可。只返回 JSON：{"meanings":{"语法点id":"中文意思"}}，id 原样保留，不要遗漏。',
    },
    { role: 'user', content: JSON.stringify(Object.fromEntries(points.map((p) => [p.id, `${cleanTitle(p.title)}: ${p.short}`]))) },
  ], (r) => (r?.meanings && typeof r.meanings === 'object' ? r.meanings as Record<string, unknown> : {}), { temperature: 0.1, maxTokens: 8000, timeoutMs: 180000 });
  const valid = new Set(points.map((p) => p.id));
  const out: Record<string, string> = {};
  for (const [id, zh] of Object.entries(raw)) if (valid.has(id) && typeof zh === 'string' && zh.trim()) out[id] = zh.trim();
  await kvSet(`grammarZh:${level}`, out);
  return out;
}

// ---------- 进度 ----------

export type Status = 'new' | 'learned' | 'review';
export type Progress = { status: Status; quiz_correct: number | null; quiz_total: number | null };

export async function progressMap(): Promise<Record<string, Progress>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string } & Progress>('SELECT id, status, quiz_correct, quiz_total FROM grammar');
  return Object.fromEntries(rows.map((r) => [r.id, r]));
}

export async function setStatus(id: string, status: Status, quiz?: { correct: number; total: number }) {
  const db = await getDb();
  await db.runAsync(
    `INSERT INTO grammar (id, status, quiz_correct, quiz_total, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET status = excluded.status,
       quiz_correct = COALESCE(excluded.quiz_correct, grammar.quiz_correct),
       quiz_total = COALESCE(excluded.quiz_total, grammar.quiz_total), updated_at = excluded.updated_at`,
    id, status, quiz?.correct ?? null, quiz?.total ?? null, Date.now(),
  );
}

/** 最近学会或需要复习的语法，给「练习」出题用。 */
export async function recentGrammar(limit = 8): Promise<string[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ id: string }>(
    "SELECT id FROM grammar WHERE status IN ('learned','review') ORDER BY CASE status WHEN 'review' THEN 0 ELSE 1 END, updated_at DESC LIMIT ?", limit,
  );
  return rows.map((r) => getPoint(r.id)).filter(Boolean).map((p) => cleanTitle(p!.title));
}

// ---------- 课文 ----------

export type QuizItem = { question: FuriganaSegment[]; prompt: string; options: string[]; answer: number; explanation: string };
export type Lesson = {
  meaning: string;
  formation: string;
  explanation: string;
  nuance: string;
  mistakes: string[];
  examples: Array<{ japanese: FuriganaSegment[]; chinese: string }>;
  quiz: QuizItem[];
};

// 打包的课文按级别分文件，第一次用到这一级时才加载（文件比较大，不在启动时加载）
const BUNDLED_LESSONS: Record<GrammarLevel, () => Record<string, Lesson>> = {
  N5: () => require('../data/grammar/lessons_N5.json'),
  N4: () => require('../data/grammar/lessons_N4.json'),
  N3: () => require('../data/grammar/lessons_N3.json'),
  N2: () => require('../data/grammar/lessons_N2.json'),
  N1: () => require('../data/grammar/lessons_N1.json'),
};

function bundledLesson(id: string): Lesson | null {
  const level = id.slice(0, 2) as GrammarLevel;
  const l = BUNDLED_LESSONS[level]?.()[id];
  if (!l) return null;
  // 注音分段按 App 的规则再整理一遍（和 AI 实时生成的课文一样处理）
  return {
    ...l,
    examples: l.examples.map((e) => ({ ...e, japanese: normalizeSegments(e.japanese) })),
    quiz: l.quiz.map((q) => ({ ...q, question: normalizeSegments(q.question) })),
  };
}

const RUBY = `Japanese sentences are arrays of segments {"text":"学校","reading":"がっこう"}; readings (hiragana) only on kanji-bearing segments, null elsewhere; split kanji from okurigana.`;

export async function loadLesson(id: string, regenerate = false): Promise<Lesson> {
  const db = await getDb();
  if (!regenerate) {
    const row = await db.getFirstAsync<{ lesson: string | null }>('SELECT lesson FROM grammar WHERE id = ?', id);
    if (row?.lesson) {
      try { return JSON.parse(row.lesson) as Lesson; } catch {}
    }
    const bundled = bundledLesson(id);
    if (bundled) return bundled;
  }
  const p = getPoint(id);
  if (!p) throw new Error('找不到这个语法点');
  const settings = await loadLlmSettings();
  const lesson = await requestJson(settings, [
    {
      role: 'system',
      content: `你是耐心严谨的日语老师，学生是中文母语者，水平 ${settings.level}。根据给出的语法点资料（来自开源语法库，英文）写一课中文讲解。
- 以资料为依据，不要编造资料里没有的用法；资料有误时按标准日语纠正
- 例句自然、日常，难度符合学生水平，5 句
- 3 道选择题，考查是否真正理解这个语法（接续、意思、和相近语法的区别），每题 4 个选项
${RUBY}
只返回 JSON：
{"meaning":"一句话中文意思","formation":"接续方式（中文说明，如：动词て形 + もいい）","explanation":"用法讲解，2-4 段","nuance":"语感、和相近语法的区别","mistakes":["中文母语者常见错误"],
 "examples":[{"japanese":[{"text":"...","reading":null}],"chinese":"中文"}],
 "quiz":[{"question":[{"text":"日语题干，空白处用（　）","reading":null}],"prompt":"中文说明这题考什么","options":["选项1","选项2","选项3","选项4"],"answer":0,"explanation":"为什么"}]}`,
    },
    { role: 'user', content: JSON.stringify({ title: p.title, short: p.short, explanation: p.long, formation: p.formation, examples: p.examples }) },
  ], (raw) => ({
    meaning: str(raw?.meaning, p.short),
    formation: str(raw?.formation, p.formation),
    explanation: str(raw?.explanation),
    nuance: str(raw?.nuance),
    mistakes: arr(raw?.mistakes, (m) => (typeof m === 'string' && m.trim() ? m : null)),
    examples: arr(raw?.examples, (e) => {
      const japanese = normalizeSegments(e?.japanese);
      return japanese.length ? { japanese, chinese: str(e?.chinese) } : null;
    }),
    quiz: arr(raw?.quiz, (q) => {
      const options = arr(q?.options, (o) => (typeof o === 'string' || typeof o === 'number' ? String(o) : null));
      const answer = Math.round(num(q?.answer, -1));
      const question = normalizeSegments(q?.question);
      return options.length >= 2 && answer >= 0 && answer < options.length && question.length
        ? { question, prompt: str(q?.prompt), options, answer, explanation: str(q?.explanation) }
        : null;
    }),
  }), { temperature: 0.4, maxTokens: 6000, timeoutMs: 120000 });
  if (!lesson.explanation) throw new Error('生成课文失败，请重试');
  await db.runAsync(
    `INSERT INTO grammar (id, status, lesson, updated_at) VALUES (?, 'new', ?, ?)
     ON CONFLICT(id) DO UPDATE SET lesson = excluded.lesson, updated_at = excluded.updated_at`,
    id, JSON.stringify(lesson), Date.now(),
  );
  return lesson;
}
