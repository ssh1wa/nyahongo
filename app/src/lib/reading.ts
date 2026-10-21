// 阅读精读：获取读物（粘贴 / 识图 / AI 生成 / 网页 / 维基百科）→ 分句 → AI 逐批精读注释
import Encoding from 'encoding-japanese';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { normalizeSegments, segmentsText } from './furigana';
import { arr, requestJson, str } from './llm';
import { addRecord, listRecords, updateRecord, type RecordRow } from './records';
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

export async function generateArticle(request: string, length: ArticleLength): Promise<{ title: string; text: string }> {
  const settings = await loadLlmSettings();
  return requestJson(settings, [
    {
      role: 'system',
      content: `你是给中文母语日语学习者写分级读物的作者。学习者水平：${settings.level}。
要求：
- 只用这个水平能理解的词汇和语法，偶尔出现一两个稍难的词也可以，但整体要读得懂
- 内容具体、有细节、自然，像真实的文章或故事，不要写成教科书例句的堆砌
- 正文分成几个自然段，段落之间用换行分隔；不要在文中加注音、括号读音或中文
- 长度：${LENGTHS[length]}
只返回 JSON：{"title":"日语标题","text":"日语正文"}`,
    },
    { role: 'user', content: request.trim() || '写一篇有意思的日常短文' },
  ], (raw) => ({ title: str(raw?.title, '读物'), text: str(raw?.text) }), { temperature: 0.8, maxTokens: 4000 });
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

/** 读取网页，自动识别 Shift_JIS / EUC-JP（青空文库是 Shift_JIS）。 */
export async function fetchPage(url: string): Promise<{ title: string; text: string }> {
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

const WIKI = 'https://ja.wikipedia.org/w/api.php';

export async function searchWikipedia(q: string): Promise<Array<{ title: string; snippet: string }>> {
  const res = await fetch(`${WIKI}?action=query&list=search&format=json&srlimit=12&origin=*&srsearch=${encodeURIComponent(q)}`);
  if (!res.ok) throw new Error(`维基百科返回错误 HTTP ${res.status}`);
  const data = await res.json();
  return (data?.query?.search ?? []).map((r: any) => ({
    title: String(r.title),
    snippet: decodeEntities(String(r.snippet ?? '').replace(/<[^>]+>/g, '')),
  }));
}

export async function fetchWikipedia(title: string): Promise<{ title: string; text: string; url: string }> {
  const res = await fetch(`${WIKI}?action=query&prop=extracts&explaintext=1&format=json&origin=*&titles=${encodeURIComponent(title)}`);
  const data = await res.json();
  const page = Object.values<any>(data?.query?.pages ?? {})[0];
  // 维基百科条目很长，精读取开头几段就够了
  const text = String(page?.extract ?? '')
    .split('\n')
    .filter((l) => l.trim() && !/^=+.*=+$/.test(l.trim()))
    .join('\n')
    .slice(0, 1500);
  return { title, text, url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(title)}` };
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
