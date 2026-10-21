// 联网搜索：优先用 DeepSeek 的 Search / Fetch 工具接口（https://api-docs.deepseek.com/guides/search/），
// 没有 DeepSeek Key 时退回日语维基百科（免费、不用 Key，但只能搜维基）。
import { kvGet, kvSet } from './db';
import { loadLlmSettings, type LlmSettings } from './settings';
import * as SecureStore from 'expo-secure-store';

const DEEPSEEK = 'https://api.deepseek.com';
const KEY_NAME = 'search-api-key';

export type SearchHit = {
  title: string;
  url: string;
  site: string;
  snippet: string; // 给界面显示的短摘要
  content: string; // 给 AI 看的正文（可能为空）
  score: number; // 相关度 0-3，DeepSeek 认为 1.5 以上是高质量
  date: string | null;
};

export type SearchMode = 'deepseek' | 'wikipedia';

// ---------- Key ----------

/** 搜索用的 DeepSeek Key：单独填了用单独的；文字模型本来就是 DeepSeek 官方接口时直接复用。 */
export async function searchKey(settings?: LlmSettings): Promise<string> {
  let own = '';
  try { own = (await SecureStore.getItemAsync(KEY_NAME)) ?? ''; } catch {}
  if (own.trim()) return own.trim();
  const s = settings ?? (await loadLlmSettings());
  return s.baseUrl.includes('api.deepseek.com') ? s.apiKey.trim() : '';
}

export async function loadOwnSearchKey(): Promise<string> {
  try { return (await SecureStore.getItemAsync(KEY_NAME)) ?? ''; } catch { return ''; }
}

export async function saveOwnSearchKey(key: string): Promise<void> {
  if (key.trim()) await SecureStore.setItemAsync(KEY_NAME, key.trim());
  else await SecureStore.deleteItemAsync(KEY_NAME);
}

export async function searchMode(): Promise<SearchMode> {
  return (await searchKey()) ? 'deepseek' : 'wikipedia';
}

// ---------- DeepSeek Search / Fetch ----------

async function callTool(path: string, body: object, key: string, timeoutMs = 25000): Promise<any> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(`${DEEPSEEK}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) return payload;
      // 文档建议 408 / 429 / 5xx 等一下再试
      if ((res.status === 408 || res.status === 429 || res.status >= 500) && attempt === 0) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      const msg = payload?.error?.message;
      if (res.status === 401) throw new Error('DeepSeek 搜索：API Key 无效（HTTP 401）');
      if (res.status === 402) throw new Error('DeepSeek 搜索：账户余额不足（HTTP 402）');
      if (res.status === 403) throw new Error('这个网页不允许读取（HTTP 403）');
      if (res.status === 404) throw new Error('这个网页里没有可用的正文（HTTP 404）');
      throw new Error(msg || `DeepSeek 搜索出错（HTTP ${res.status}）`);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        if (attempt === 0) continue;
        throw new Error('联网搜索超时');
      }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error('联网搜索失败');
}

/** query 最多 128 字。needContent=true 时每条带网页正文，给 AI 写文章参考用。 */
export async function deepseekSearch(query: string, opts: { count?: number; needContent?: boolean; question?: string } = {}): Promise<SearchHit[]> {
  const key = await searchKey();
  if (!key) throw new Error('还没有 DeepSeek Key，不能全网搜索');
  const payload = await callTool('/v1/tools/search', {
    query: query.trim().slice(0, 128),
    count: opts.count ?? 8,
    need_content: !!opts.needContent,
    ...(opts.question?.trim() ? { ori_question: opts.question.trim().slice(0, 128) } : {}),
  }, key);
  return (Array.isArray(payload?.results) ? payload.results : [])
    .map((r: any): SearchHit => ({
      title: String(r?.title ?? ''),
      url: String(r?.url ?? ''),
      site: String(r?.site_name ?? ''),
      snippet: String(r?.snippet ?? ''),
      content: String(r?.content || r?.summary || ''),
      score: Number(r?.rerank_score ?? 0),
      date: r?.date ? String(r.date) : null,
    }))
    .filter((h: SearchHit) => h.url && h.title);
}

/** 读取网页正文（Markdown）。比自己解析 HTML 稳，能处理大多数网站。 */
export async function deepseekFetch(url: string): Promise<{ title: string; text: string }> {
  const key = await searchKey();
  if (!key) throw new Error('还没有 DeepSeek Key');
  const payload = await callTool('/v1/tools/fetch', { url }, key, 40000);
  return { title: String(payload?.title ?? ''), text: String(payload?.content ?? '') };
}

// ---------- 维基百科（兜底） ----------

const WIKI = 'https://ja.wikipedia.org/w/api.php';
// 维基百科会拒绝默认的 okhttp 标识（HTTP 403，见 https://w.wiki/4wJS），必须带一个说明用途的 User-Agent
const WIKI_HEADERS = { 'User-Agent': 'KotobaSeichou/0.2 (personal Japanese learning app)', 'Api-User-Agent': 'KotobaSeichou/0.2' };

async function wikiGet(params: string): Promise<any> {
  const res = await fetch(`${WIKI}?${params}&format=json&origin=*`, { headers: WIKI_HEADERS });
  if (!res.ok) throw new Error(`维基百科返回错误 HTTP ${res.status}`);
  return res.json();
}

const stripTags = (s: string) => s.replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

export async function wikipediaSearch(q: string, limit = 12): Promise<SearchHit[]> {
  const data = await wikiGet(`action=query&list=search&srlimit=${limit}&srsearch=${encodeURIComponent(q)}`);
  return (data?.query?.search ?? []).map((r: any): SearchHit => ({
    title: String(r.title),
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(String(r.title))}`,
    site: '日语维基百科',
    snippet: stripTags(String(r.snippet ?? '')),
    content: '',
    score: 0,
    date: null,
  }));
}

/** 维基百科条目正文（纯文本，去掉章节标题），截取前 maxChars 字。词条不存在时返回空字符串。 */
export async function wikipediaText(title: string, maxChars = 1500): Promise<string> {
  // redirects=1：「日本文化」这类别名会跳到正式词条「日本の文化」
  const data = await wikiGet(`action=query&prop=extracts&explaintext=1&redirects=1&titles=${encodeURIComponent(title)}`);
  const page = Object.values<any>(data?.query?.pages ?? {})[0];
  return String(page?.extract ?? '')
    .split('\n')
    .filter((l) => l.trim() && !/^=+.*=+$/.test(l.trim()))
    .join('\n')
    .slice(0, maxChars);
}

// ---------- 最近的搜索词 ----------

export const recentQueries = () => kvGet<string[]>('searchRecent', []);
export async function rememberQuery(q: string) {
  const list = (await recentQueries()).filter((x) => x !== q);
  await kvSet('searchRecent', [q, ...list].slice(0, 8));
}
