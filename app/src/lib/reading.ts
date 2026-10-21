// 阅读精读：获取读物（粘贴 / 识图 / AI 生成 / 网页 / 维基百科）→ 分句 → AI 逐批精读注释
import Encoding from 'encoding-japanese';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { normalizeSegments, segmentsText } from './furigana';
import { arr, requestJson, str } from './llm';
import { addRecord, listRecords, updateRecord, type RecordRow } from './records';
import { deepseekFetch, deepseekSearch, searchMode, wikipediaSearch, wikipediaText } from './search';
import { loadLlmSettings, type LlmSettings } from './settings';
import type { FuriganaSegment } from './types';

export type ReadingWord = { surface: string; base: string; reading: string; meaning: string };
export type ReadingGrammar = { pattern: string; explanation: string };

export type ReadingSentence = {
  text: string;
  segments?: FuriganaSegment[]; // 注音分段；未解析时没有
  zh?: string;
  words?: ReadingWord[];
  grammar?: ReadingGrammar[];
  failed?: boolean;
};

export type ArticleSource = 'paste' | 'photo' | 'ai' | 'url' | 'wiki';

export type Article = {
  title: string;
  source: ArticleSource;
  sourceUrl?: string;
  level: string;
  paragraphs: ReadingSentence[][];
  references?: Array<{ title: string; url: string; site?: string }>; // AI 联网写读物时参考的资料
};

export const SOURCE_LABEL: Record<ArticleSource, string> = {
  paste: '粘贴', photo: '图片', ai: 'AI 读物', url: '网页', wiki: '维基百科',
};

// ---------- 分句 ----------

const SENTENCE_END = /([。！？!?]+[」』）)]*|\n)/;

/** 按段落（换行）和句末标点切分；保留句末的引号括号。 */
export function splitArticle(text: string): ReadingSentence[][] {
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      const out: string[] = [];
      let buf = '';
      for (const part of p.split(SENTENCE_END)) {
        if (!part) continue;
        buf += part;
        if (SENTENCE_END.test(part)) {
          if (buf.trim()) out.push(buf.trim());
          buf = '';
        }
      }
      if (buf.trim()) out.push(buf.trim());
      return out.map((t) => ({ text: t }));
    })
    .filter((p) => p.length);
}

export const countSentences = (a: Article) => a.paragraphs.reduce((n, p) => n + p.length, 0);
export const articleText = (a: Article) => a.paragraphs.map((p) => p.map((s) => s.text).join('')).join('\n');

// ---------- 保存 ----------

export const saveArticle = (a: Article) => addRecord<Article>('reading', a.title, a);
export const updateArticle = (id: number, a: Article) => updateRecord<Article>(id, a);
export const listArticles = (): Promise<Array<RecordRow<Article>>> => listRecords<Article>('reading', 100);

// ---------- 识图（书页 / 漫画） ----------

/** 压缩成长边不超过 1600 的 JPEG，再转成 base64。手机原图太大，发给模型又慢又贵。 */
async function prepareImage(uri: string, width?: number): Promise<string> {
  const ctx = ImageManipulator.manipulate(uri);
  if (!width || width > 1600) ctx.resize({ width: 1600 });
  const ref = await ctx.renderAsync();
  const out = await ref.saveAsync({ compress: 0.82, format: SaveFormat.JPEG, base64: true });
  return `data:image/jpeg;base64,${out.base64}`;
}

const OCR_PROMPT = `This image is a page from a Japanese book, magazine, screenshot, or manga.
Transcribe ALL Japanese text exactly as written, in natural reading order:
- Vertical text: columns from right to left.
- Manga: panels right-to-left, top-to-bottom; put each speech bubble on its own line.
- Skip small furigana above kanji (keep only the base text), page numbers, and decorative sound effects.
- Do not translate, explain, or correct anything.
Return JSON only: {"text":"...","kind":"book|manga|screenshot|other"}`;

export async function ocrImages(
  images: Array<{ uri: string; width?: number }>,
  onProgress: (done: number, total: number) => void,
): Promise<string> {
  const settings = await loadLlmSettings();
  const pages: string[] = [];
  for (let i = 0; i < images.length; i++) {
    onProgress(i, images.length);
    const url = await prepareImage(images[i].uri, images[i].width);
    const text = await requestJson(settings, [
      { role: 'user', content: [{ type: 'text', text: OCR_PROMPT }, { type: 'image_url', image_url: { url } }] },
    ], (raw) => str(raw?.text).trim(), { vision: true, maxTokens: 4000, temperature: 0, timeoutMs: 120000 });
    if (text) pages.push(text);
  }
  onProgress(images.length, images.length);
  return pages.join('\n\n');
}

// ---------- AI 写读物 / 改写到我的水平 ----------

const LENGTHS = { short: '约 300 字', medium: '约 600 字', long: '约 1000 字' };
export type ArticleLength = keyof typeof LENGTHS;

/** 常读每天用同一个提示词，靠这些避免写重复：以前写过的标题、用过的网页。 */
export type AvoidRepeat = { titles?: string[]; urls?: string[] };

/** 只说「别重复标题」不够：AI 会写同一原理的另一面（蓝天→晚霞），所以要求连相近的主题一起避开。 */
const AVOID_RULE = '这次必须换一个明显不同的主题：不能是同一个现象、原理或事件的另一个角度、延伸或相关问题；最近几篇在同一个领域的话，换一个领域';

const avoidNote = (avoid?: AvoidRepeat) => (avoid?.titles?.length
  ? `\n- 用户以前已经读过下面这些（最新的在前）。${AVOID_RULE}：${avoid.titles.slice(0, 40).join('；')}`
  : '');

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export async function generateArticle(request: string, length: ArticleLength, avoid?: AvoidRepeat): Promise<{ title: string; text: string }> {
  const settings = await loadLlmSettings();
  return requestJson(settings, [
    {
      role: 'system',
      content: `你是给中文母语日语学习者写分级读物的作者。学习者水平：${settings.level}。
要求：
- 只用这个水平能理解的词汇和语法，偶尔出现一两个稍难的词也可以，但整体要读得懂
- 内容具体、有细节、自然，像真实的文章或故事，不要写成教科书例句的堆砌
- 正文分成几个自然段，段落之间用换行分隔；不要在文中加注音、括号读音或中文
- 长度：${LENGTHS[length]}${avoidNote(avoid)}
只返回 JSON：{"title":"日语标题","text":"日语正文"}`,
    },
    { role: 'user', content: request.trim() || '写一篇有意思的日常短文' },
  ], (raw) => ({ title: str(raw?.title, '读物'), text: str(raw?.text) }), { temperature: 0.8, maxTokens: 4000 });
}

export type Reference = { title: string; url: string; site?: string; text: string };
export type ResearchStage = 'keywords' | 'searching' | 'writing';

/** 新闻要的是最近几天的报道；没有日期的结果不确定新旧，排在后面。 */
const RECENT_DAYS = 10;
const isRecent = (date: string | null) => !!date && Date.now() - new Date(date).getTime() < RECENT_DAYS * 86400000;

/**
 * 先联网查资料，再以资料为依据按学习者水平写读物。
 * 有 DeepSeek Key 时全网搜索（日文、中文关键词各搜一次），没有时搜日语维基百科。
 */
export async function researchAndWrite(
  request: string,
  length: ArticleLength,
  onStage: (stage: ResearchStage, detail?: string) => void,
  avoid?: AvoidRepeat,
): Promise<{ title: string; subject: string; text: string; references: Array<{ title: string; url: string; site?: string }> }> {
  const settings = await loadLlmSettings();
  const mode = await searchMode();

  onStage('keywords');
  const keywords = await requestJson(settings, [
    {
      role: 'system',
      content: `把用户想读的内容变成网络搜索关键词。今天是 ${today()}。
只返回 JSON：{"subject":"这次具体写什么（一句中文）","ja":"日语关键词（用于搜日文资料）","zh":"中文关键词","topic":"这个主题在日语维基百科上的词条名","recent":是否需要最近几天的新闻}。
- 要求很宽泛时（如「每天一篇科普」「今天的新闻」），先自己选一个具体主题或事件写进 subject，关键词围绕它
- 要求是新闻、时事、最近发生的事时 recent 为 true，关键词里不要写具体日期
- 关键词要短（2-6 个词），用主题的正式叫法；topic 只写词条名本身，不加其他词${avoid?.titles?.length ? `
- 用户以前已经读过下面这些（最新的在前）。${AVOID_RULE}：${avoid.titles.slice(0, 40).join('；')}` : ''}
例：「随机森林是什么」→ {"subject":"随机森林的原理","ja":"ランダムフォレスト 仕組み","zh":"随机森林 原理","topic":"ランダムフォレスト","recent":false}`,
    },
    { role: 'user', content: request },
  ], (r) => ({ subject: str(r?.subject), ja: str(r?.ja), zh: str(r?.zh), topic: str(r?.topic), recent: r?.recent === true }), { temperature: avoid?.titles?.length ? 0.7 : 0.1, maxTokens: 300 });
  const usedUrls = new Set(avoid?.urls ?? []);

  onStage('searching', mode === 'deepseek' ? '全网搜索' : '日语维基百科');
  let refs: Reference[] = [];
  if (mode === 'deepseek') {
    const results = await Promise.allSettled(
      [keywords.ja, keywords.zh].filter(Boolean).map((q) => deepseekSearch(q, { count: keywords.recent ? 10 : 6, needContent: true, question: keywords.subject || request })),
    );
    // 两路都失败（Key 无效、余额不足等）要把原因报出来，不能当成「没搜到」
    const failed = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    if (failed && results.every((r) => r.status === 'rejected')) throw failed.reason;
    const lists = results.map((r) => (r.status === 'fulfilled' ? r.value : []));
    const seen = new Set<string>();
    // 同一个网站最多取 2 篇（中文搜索常常一个站点返回好几篇几乎一样的页面）
    const perSite = new Map<string, number>();
    const host = (u: string) => u.replace(/^https?:\/\//, '').split('/')[0];
    refs = lists.flat()
      .filter((h) => h.content.trim() && !usedUrls.has(h.url) && !seen.has(h.url) && (seen.add(h.url), true))
      // 新闻优先最近几天的报道，同样新的再按相关度
      .sort((a, b) => (keywords.recent ? Number(isRecent(b.date)) - Number(isRecent(a.date)) : 0) || b.score - a.score)
      .filter((h) => {
        const n = perSite.get(host(h.url)) ?? 0;
        perSite.set(host(h.url), n + 1);
        return n < 2;
      })
      .slice(0, 4)
      .map((h) => ({ title: h.title, url: h.url, site: h.site, text: h.content.slice(0, 2500) }));
  } else {
    // 维基百科是全文搜索，多加的词（仕組み 等）会把结果带偏，所以先按词条名直接取，取不到再搜
    const topic = keywords.topic || keywords.ja.split(/\s+/)[0] || request;
    // 网络或接口出错要直接报出来，不能当成「没搜到」
    const directUrl = `https://ja.wikipedia.org/wiki/${encodeURIComponent(topic)}`;
    const direct = usedUrls.has(directUrl) ? '' : await wikipediaText(topic, 3000);
    if (direct) {
      refs = [{ title: topic, url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(topic)}`, site: '日语维基百科', text: direct }];
    } else {
      const hits = await wikipediaSearch(topic, 3);
      refs = (await Promise.all(hits.filter((h) => !usedUrls.has(h.url)).slice(0, 2).map(async (h) => ({ title: h.title, url: h.url, site: h.site, text: await wikipediaText(h.title, 2500) }))))
        .filter((r) => r.text);
    }
  }
  if (!refs.length) throw new Error('没有搜到可用的资料。可以换个说法，或者关掉「联网查资料」直接让 AI 写');

  onStage('writing', `参考 ${refs.length} 篇资料`);
  const out = await requestJson(settings, [
    {
      role: 'system',
      content: `你是给中文母语日语学习者写科普/分级读物的作者。学习者水平：${settings.level}。
下面给你几篇网上找到的资料（编号 0、1、2…）。根据资料写一篇日语读物，回答用户想了解的问题：
- 内容以资料为准，资料里没有的事实不要编；资料之间矛盾时按更可靠的写，或者说明有不同说法
- 语言用 ${settings.level} 能读懂的词汇和语法；专业术语可以保留，但第一次出现时用简单的日语解释
- 用具体的例子把概念讲清楚，像写给普通人看的科普，不要堆砌术语
- 正文分自然段，段落之间换行；不要加注音、括号读音或中文，不要在正文里写资料编号
- 长度：${LENGTHS[length]}${avoidNote(avoid)}
只返回 JSON：{"title":"日语标题","text":"日语正文","used":[实际参考了的资料编号]}`,
    },
    { role: 'user', content: JSON.stringify({ request, subject: keywords.subject || undefined, today: keywords.recent ? today() : undefined, references: refs.map((r, i) => ({ id: i, title: r.title, text: r.text })) }) },
  ], (r) => ({
    title: str(r?.title, '读物'),
    text: str(r?.text),
    used: Array.isArray(r?.used) ? r.used.map(Number).filter((n: number) => Number.isInteger(n) && n >= 0 && n < refs.length) : [],
  }), { temperature: 0.5, maxTokens: 5000, timeoutMs: 150000 });
  if (!out.text.trim()) throw new Error('生成失败，请重试');
  const used: number[] = out.used.length ? out.used : refs.map((_, i) => i);
  return { title: out.title, subject: keywords.subject, text: out.text, references: [...new Set(used)].map((i) => ({ title: refs[i].title, url: refs[i].url, site: refs[i].site })) };
}

export async function rewriteToLevel(text: string): Promise<string> {
  const settings = await loadLlmSettings();
  return requestJson(settings, [
    {
      role: 'system',
      content: `把下面的日语文章改写成 ${settings.level} 水平的学习者能读懂的日语。保留原文的主要内容和顺序，难词换成简单说法，长句拆短。保留段落换行，不加注音和中文。
只返回 JSON：{"text":"改写后的日语正文"}`,
    },
    { role: 'user', content: text.slice(0, 6000) },
  ], (raw) => str(raw?.text), { temperature: 0.3, maxTokens: 6000 });
}

// ---------- 网页 / 维基百科 ----------

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(s: string) {
  return s.replace(/&(#x?[0-9a-f]+|\w+);/gi, (m, code: string) => {
    if (code[0] === '#') {
      const n = code[1].toLowerCase() === 'x' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** 从网页 HTML 里取正文：去掉脚本样式和注音（<rt>），优先取青空文库的 main_text、<article>、<p>。 */
export function extractText(html: string): { title: string; text: string } {
  const title = decodeEntities((html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim());
  let body = html
    .replace(/<(script|style|noscript|header|footer|nav|aside)[\s\S]*?<\/\1>/gi, '')
    .replace(/<rt[\s\S]*?<\/rt>|<rp[\s\S]*?<\/rp>/gi, '');
  const main = body.match(/<div class="main_text">([\s\S]*?)<\/div>/i)?.[1] ?? body.match(/<article[\s\S]*?<\/article>/i)?.[0];
  if (main) body = main;
  else {
    const ps = body.match(/<p[\s>][\s\S]*?<\/p>/gi);
    if (ps && ps.join('').length > 200) body = ps.join('\n');
  }
  const text = decodeEntities(
    body.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|h\d|li)>/gi, '\n').replace(/<[^>]+>/g, ''),
  )
    .split('\n')
    .map((l) => l.replace(/[ \t　]+/g, ' ').trim())
    .filter((l) => l.length > 0)
    .join('\n');
  return { title, text };
}

/** 读取网页正文：有 DeepSeek Key 时用 DeepSeek Fetch（整理成 Markdown，适应各种网站），失败再自己解析。 */
export async function fetchPage(url: string): Promise<{ title: string; text: string }> {
  if ((await searchMode()) === 'deepseek') {
    try {
      const page = await deepseekFetch(url);
      const text = page.text
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '') // 图片
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接只留文字
        .replace(/^#+\s*/gm, '')
        .replace(/[*_`>|]/g, '')
        .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
      if (text.length >= 20) return { title: page.title, text };
    } catch {
      // DeepSeek 读不了就自己解析 HTML
    }
  }
  return fetchHtml(url);
}

/** 自己下载并解析网页，自动识别 Shift_JIS / EUC-JP（青空文库是 Shift_JIS）。 */
async function fetchHtml(url: string): Promise<{ title: string; text: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`网页返回错误 HTTP ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const header = res.headers.get('content-type') ?? '';
    const head = String.fromCharCode(...bytes.slice(0, 2048));
    const charset = (header.match(/charset=([\w-]+)/i)?.[1] ?? head.match(/charset=["']?([\w-]+)/i)?.[1] ?? '').toLowerCase();
    const from = /shift_?jis|sjis|windows-31j|cp932/.test(charset) ? 'SJIS' : /euc-?jp/.test(charset) ? 'EUCJP' : charset ? 'UTF8' : 'AUTO';
    const html = Encoding.convert(Array.from(bytes), { to: 'UNICODE', from: from as Encoding.Encoding, type: 'string' });
    const page = extractText(html);
    if (page.text.length < 20) throw new Error('这个网页里没有找到正文，可能需要登录或者是动态加载的页面');
    return page;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') throw new Error('打开网页超时');
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

// ---------- 精读注释 ----------

const ANNOTATE_BATCH = 8;

const annotatePrompt = (level: string) => `You are a Japanese close-reading tutor for a Chinese-speaking learner at level ${level}.
For EACH sentence (keep its id), return:
- segments: the sentence split into furigana segments. Concatenating all segment texts must reproduce the sentence EXACTLY (same characters, same punctuation). Put hiragana readings only on kanji-bearing segments; kana, punctuation, numbers and Latin use null. Split kanji from okurigana, e.g. [{"text":"食","reading":"た"},{"text":"べます","reading":null}].
- zh: a natural Simplified Chinese translation (use the surrounding sentences for context).
- words: 0-4 words worth learning at this level (skip basic particles and words a ${level} learner surely knows). Each: surface as in the sentence, base (dictionary form), reading (hiragana of the base form), meaning (short Simplified Chinese meaning in this context).
- grammar: 0-2 grammar points actually used in the sentence that matter at this level. Each: pattern, explanation (clear short Simplified Chinese).
Return JSON only: {"sentences":[{"id":0,"segments":[{"text":"...","reading":"... or null"}],"zh":"...","words":[{"surface":"...","base":"...","reading":"...","meaning":"..."}],"grammar":[{"pattern":"...","explanation":"..."}]}]}`;

function shapeAnnotated(raw: any, s: ReadingSentence): ReadingSentence {
  const segs = normalizeSegments(raw?.segments);
  const clean = (t: string) => t.replace(/\s+/g, '');
  // 注音分段拼起来必须和原句一致，否则模型改了原文，只保留不带注音的原句
  const segments = segs.length && clean(segmentsText(segs)) === clean(s.text) ? segs : [{ text: s.text, reading: null }];
  return {
    text: s.text,
    segments,
    zh: str(raw?.zh),
    words: arr(raw?.words, (w) => (str(w?.surface) || str(w?.base)
      ? { surface: str(w.surface) || str(w.base), base: str(w.base) || str(w.surface), reading: str(w.reading), meaning: str(w.meaning) }
      : null)),
    grammar: arr(raw?.grammar, (g) => (str(g?.pattern) ? { pattern: str(g.pattern), explanation: str(g.explanation) } : null)),
  };
}

/**
 * 逐批注释还没解析的句子，每完成一批就回调一次（界面可以边解析边看）。
 * 同时最多 2 批并发；某批失败只标记那几句，不影响其他句子。
 */
export async function annotateArticle(
  article: Article,
  onUpdate: (a: Article) => void,
  shouldStop: () => boolean,
): Promise<Article> {
  const settings: LlmSettings = await loadLlmSettings();
  const flat: Array<{ p: number; i: number }> = [];
  article.paragraphs.forEach((para, p) => para.forEach((s, i) => { if (!s.segments) flat.push({ p, i }); }));
  let current = article;
  const batches: Array<typeof flat> = [];
  for (let k = 0; k < flat.length; k += ANNOTATE_BATCH) batches.push(flat.slice(k, k + ANNOTATE_BATCH));

  const runBatch = async (batch: typeof flat) => {
    const all = current.paragraphs.flat();
    const first = article.paragraphs.slice(0, batch[0].p).reduce((n, para) => n + para.length, 0) + batch[0].i;
    const context = all.slice(Math.max(0, first - 2), first).map((s) => s.text);
    let results: Record<number, any> = {};
    try {
      const raw = await requestJson(settings, [
        { role: 'system', content: annotatePrompt(settings.level) },
        { role: 'user', content: JSON.stringify({ previousSentences: context, sentences: batch.map((b, id) => ({ id, text: current.paragraphs[b.p][b.i].text })) }) },
      ], (r) => r, { temperature: 0.2, maxTokens: 8000 });
      for (const item of Array.isArray(raw?.sentences) ? raw.sentences : []) results[Number(item?.id)] = item;
    } catch {
      results = {};
    }
    const paragraphs = current.paragraphs.map((para) => para.slice());
    batch.forEach((b, id) => {
      const s = paragraphs[b.p][b.i];
      paragraphs[b.p][b.i] = results[id] ? shapeAnnotated(results[id], s) : { ...s, failed: true };
    });
    current = { ...current, paragraphs };
    onUpdate(current);
  };

  for (let k = 0; k < batches.length; k += 2) {
    if (shouldStop()) break;
    await Promise.all(batches.slice(k, k + 2).map(runBatch));
  }
  return current;
}

/** 把失败的句子重置为未解析，下次 annotateArticle 会重试。 */
export function resetFailed(a: Article): Article {
  return { ...a, paragraphs: a.paragraphs.map((p) => p.map((s) => (s.failed ? { text: s.text } : s))) };
}
