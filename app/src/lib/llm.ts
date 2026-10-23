// AI 接口客户端：支持 OpenAI 兼容、Anthropic（Claude）、Gemini 三种接口格式（OpenAI 兼容部分和 PC 端 llm.py 行为一致）。
// 输出被截断时直接报错（让模型"重发完整 JSON"没用，长度上限一样）；429/5xx 自动重试；
// 返回结果由调用方用 shape 函数做结构校验，字段缺失不会让界面崩溃。
import { visionEndpoint, visionModelOf, type ApiFormat, type LlmSettings } from './settings';
import { recordUsage } from './usage';

export class LlmError extends Error {}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type Message = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Endpoint = { url: string; key: string; format: ApiFormat };

/** 文字请求和识图请求可以走不同的接口（识图可以单独设置）。 */
function endpoint(s: LlmSettings, vision: boolean): Endpoint {
  const e = vision ? visionEndpoint(s) : { baseUrl: s.baseUrl, apiKey: s.apiKey, format: s.apiFormat };
  return { url: e.baseUrl.trim().replace(/\/+$/, ''), key: e.apiKey.trim(), format: e.format ?? 'openai' };
}

// Anthropic：地址填到 https://api.anthropic.com 或 …/v1 都行（DeepSeek 的是 https://api.deepseek.com/anthropic）
const anthropicUrl = (base: string, path: string) => `${/\/v1$/.test(base) ? base : `${base}/v1`}${path}`;
// Gemini：地址填到 https://generativelanguage.googleapis.com 或带上 /v1beta 都行
const geminiBase = (base: string) => (/\/v1(beta|alpha)?$/.test(base) ? base : `${base}/v1beta`);
const geminiModel = (m: string) => m.replace(/^models\//, '');

function headers(e: Endpoint): Record<string, string> {
  if (e.format === 'anthropic') return { 'x-api-key': e.key, 'anthropic-version': '2023-06-01' };
  if (e.format === 'gemini') return { 'x-goog-api-key': e.key };
  return { Authorization: `Bearer ${e.key}` };
}

const dataUrl = (url: string) => {
  const m = /^data:([^;]+);base64,([\s\S]*)$/.exec(url);
  return m ? { mime: m[1], data: m[2] } : null;
};
const textOf = (c: Message['content']) => (typeof c === 'string' ? c : c.map((p) => (p.type === 'text' ? p.text : '')).join('\n'));

type Call = { model: string; messages: Message[]; temperature: number; maxTokens: number };

// DeepSeek 官方默认先「思考」再回答：思考也算在 max_tokens 里（短回答会被截断），还更慢更贵。
// 翻译、讲解这些不需要，关掉（https://api-docs.deepseek.com/zh-cn/guides/thinking_mode）
const noThinking = (e: Endpoint) => (/api\.deepseek\.com/.test(e.url) ? { thinking: { type: 'disabled' } } : {});

/** 按接口格式拼请求：地址和请求体 */
function buildRequest(e: Endpoint, c: Call): { url: string; body: object } {
  const system = c.messages.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n');
  const chat = c.messages.filter((m) => m.role !== 'system');
  if (e.format === 'anthropic') {
    return {
      url: anthropicUrl(e.url, '/messages'),
      body: {
        model: c.model,
        max_tokens: c.maxTokens,
        temperature: c.temperature,
        ...noThinking(e),
        ...(system ? { system } : {}),
        messages: chat.map((m) => ({
          role: m.role,
          content: typeof m.content === 'string' ? m.content : m.content.map((p) => {
            if (p.type === 'text') return { type: 'text', text: p.text };
            const d = dataUrl(p.image_url.url);
            return { type: 'image', source: d ? { type: 'base64', media_type: d.mime, data: d.data } : { type: 'url', url: p.image_url.url } };
          }),
        })),
      },
    };
  }
  if (e.format === 'gemini') {
    return {
      url: `${geminiBase(e.url)}/models/${encodeURIComponent(geminiModel(c.model))}:generateContent`,
      body: {
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        contents: chat.map((m) => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: typeof m.content === 'string' ? [{ text: m.content }] : m.content.map((p) => {
            if (p.type === 'text') return { text: p.text };
            const d = dataUrl(p.image_url.url);
            return d ? { inline_data: { mime_type: d.mime, data: d.data } } : { file_data: { file_uri: p.image_url.url } };
          }),
        })),
        generationConfig: { temperature: c.temperature, maxOutputTokens: c.maxTokens, responseMimeType: 'application/json' },
      },
    };
  }
  return {
    url: `${e.url}/chat/completions`,
    body: {
      model: c.model, messages: c.messages, temperature: c.temperature, max_tokens: c.maxTokens,
      response_format: { type: 'json_object' }, ...noThinking(e),
    },
  };
}

type Reply = { text: string; truncated: boolean; inTokens: number; outTokens: number };

/** 按接口格式取出回答正文、是否被截断、用量 */
function parseReply(format: ApiFormat, p: any): Reply {
  if (format === 'anthropic') {
    const text = (Array.isArray(p?.content) ? p.content : []).filter((b: any) => b?.type === 'text').map((b: any) => b.text).join('');
    return { text, truncated: p?.stop_reason === 'max_tokens', inTokens: num(p?.usage?.input_tokens), outTokens: num(p?.usage?.output_tokens) };
  }
  if (format === 'gemini') {
    const cand = p?.candidates?.[0];
    const text = (Array.isArray(cand?.content?.parts) ? cand.content.parts : []).map((x: any) => (typeof x?.text === 'string' && !x.thought ? x.text : '')).join('');
    const u = p?.usageMetadata;
    return { text, truncated: cand?.finishReason === 'MAX_TOKENS', inTokens: num(u?.promptTokenCount), outTokens: num(u?.candidatesTokenCount) + num(u?.thoughtsTokenCount) };
  }
  const choice = p?.choices?.[0];
  return { text: choice?.message?.content ?? '', truncated: choice?.finish_reason === 'length', inTokens: num(p?.usage?.prompt_tokens), outTokens: num(p?.usage?.completion_tokens) };
}

async function post(settings: LlmSettings, call: Call, timeoutMs = 90000, vision = false): Promise<Reply> {
  const e = endpoint(settings, vision);
  if (!e.key) throw new LlmError(vision ? '识图接口还没有设置 API Key：请到「设置」里填写' : '还没有设置 API Key：请到「设置」里填写');
  if (!e.url) throw new LlmError('还没有填接口地址：请到「设置」里填写');
  const { url, body } = buildRequest(e, call);
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers(e) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) return parseReply(e.format, payload);
      if ([429, 500, 502, 503, 504, 529].includes(res.status) && attempt < 2) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401 || res.status === 403) throw new LlmError(`API Key 无效、已失效或没有权限（HTTP ${res.status}）`);
      if (res.status === 404) throw new LlmError(`接口地址或模型名不对（HTTP 404）：请检查「设置」里的接口地址、接口格式和模型`);
      throw new LlmError(payload?.error?.message || `接口返回错误 HTTP ${res.status}`);
    } catch (err) {
      if (err instanceof LlmError) throw err;
      if (attempt < 2) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (err instanceof Error && err.name === 'AbortError') throw new LlmError('请求超时，请检查网络');
      throw new LlmError(err instanceof Error ? `网络错误：${err.message}` : '网络错误');
    } finally {
      clearTimeout(timer);
    }
  }
  throw new LlmError('请求失败');
}

function parseJson(text: string): unknown {
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try {
    return JSON.parse(cleaned);
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1));
      } catch {}
    }
    return undefined;
  }
}

/**
 * 请求 JSON 结果。shape 负责把模型返回的任意结构整理成安全的类型（缺字段补默认值），
 * 这样界面上不会因为模型少给一个字段就崩溃。
 */
export async function requestJson<T>(
  settings: LlmSettings,
  messages: Message[],
  shape: (raw: any) => T,
  options: { temperature?: number; maxTokens?: number; vision?: boolean; timeoutMs?: number } = {},
): Promise<T> {
  const maxTokens = options.maxTokens ?? 4096;
  const model = (options.vision ? visionModelOf(settings) : settings.model).trim();
  if (!model) throw new LlmError(options.vision ? '还没有选择识图模型：请到「设置」里选择' : '还没有选择模型：请到「设置」里选择');
  const call = async (msgs: Message[], temperature: number) => {
    const reply = await post(settings, { model, messages: msgs, temperature, maxTokens }, options.timeoutMs, !!options.vision);
    void recordUsage(options.vision ? 'vision' : 'text', model, reply.inTokens, reply.outTokens);
    if (reply.truncated) throw new LlmError('回答太长被截断了，请把问题拆小一点再试');
    if (!reply.text.trim()) throw new LlmError('模型没有返回内容，请重试');
    return reply.text;
  };

  const content = await call(messages, options.temperature ?? 0.3);
  let parsed = parseJson(content);
  if (parsed === undefined) {
    const repaired = await call(
      [...messages, { role: 'assistant', content }, { role: 'user', content: '上一条回复不是合法的 JSON。请只输出同样内容的完整合法 JSON，不要 Markdown，不要解释。' }],
      0.1,
    );
    parsed = parseJson(repaired);
    if (parsed === undefined) throw new LlmError('模型连续两次返回了无法解析的结果，请重试');
  }
  return shape(parsed ?? {});
}

// ---------- 模型列表和连接测试 ----------

export type ModelInfo = { id: string; vision: boolean };

// 模型列表接口一般不告诉你哪些能看图，按名字判断（VL、Vision、多模态系列；DeepSeek 官方的 deepseek-flash 也能看图）
const VISION_HINT = /(vl|vision|gemma-[34]|llama-4|pixtral|omni|gpt-4o|gpt-[45]|gemini|claude|kimi-k[23]|^deepseek-flash$)/i;
// 不能聊天的模型（向量、语音、生成图片和视频、重排序……）不列出来，免得新用户选了用不了
const NON_CHAT = /(embed|tts|asr|whisper|image|flux|stable-diffusion|sdxl|rerank|guard|ocr-only|voxtral|bge-|gte-|e5-|minilm|clip|t2v|t2i|i2v|wan2|hunyuanvideo|ltx-video|kokoro|orpheus|sesame|dia-|chatterbox|zonos|audio|bria|background|foreground|upscal|segment|depth|inpaint|remove|vector|sd3|kolors|recraft|ideogram|seedream|seededit|imagen)/i;

/** 读取接口上可用的对话模型。vision=true 时读识图接口（单独设置了的话）。 */
export async function listModels(settings: LlmSettings, vision = false): Promise<ModelInfo[]> {
  const e = endpoint(settings, vision);
  if (!e.key) throw new LlmError('请先填写 API Key');
  if (!e.url) throw new LlmError('请先填写接口地址');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  const url = e.format === 'anthropic' ? anthropicUrl(e.url, '/models?limit=1000')
    : e.format === 'gemini' ? `${geminiBase(e.url)}/models?pageSize=1000` : `${e.url}/models`;
  try {
    const res = await fetch(url, { headers: headers(e), signal: controller.signal });
    const payload = await res.json().catch(() => null);
    if (res.status === 401 || res.status === 403) throw new LlmError(`API Key 无效（HTTP ${res.status}）`);
    if (!res.ok) throw new LlmError(payload?.error?.message || `获取模型列表失败（HTTP ${res.status}）。这家不提供模型列表的话，可以在选择模型时直接输入模型名`);
    const ids: string[] = e.format === 'gemini'
      ? (Array.isArray(payload?.models) ? payload.models : [])
        .filter((m: any) => !Array.isArray(m?.supportedGenerationMethods) || m.supportedGenerationMethods.includes('generateContent'))
        .map((m: any) => geminiModel(String(m?.name ?? '')))
        .filter(Boolean)
      : (Array.isArray(payload?.data) ? payload.data : []).map((m: any) => String(m?.id ?? '')).filter(Boolean);
    return [...new Set(ids)]
      .filter((id) => !NON_CHAT.test(id))
      .sort((a, b) => a.localeCompare(b))
      .map((id) => ({ id, vision: VISION_HINT.test(id) }));
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Error && e.name === 'AbortError') throw new LlmError('获取模型列表超时，请检查接口地址和网络');
    throw new LlmError(e instanceof Error ? `连接失败：${e.message}` : '连接失败');
  } finally {
    clearTimeout(timer);
  }
}

/** 用一个很小的请求测试模型能不能用，返回耗时（毫秒）。 */
export async function testModel(settings: LlmSettings, vision = false): Promise<number> {
  const started = Date.now();
  await requestJson(settings, [
    { role: 'system', content: 'Reply with JSON only.' },
    { role: 'user', content: 'Return {"ok":true}' },
  ], (raw) => raw, { maxTokens: 30, temperature: 0, vision, timeoutMs: 30000 });
  return Date.now() - started;
}

// ---------- 结构整理小工具 ----------

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
export const arr = <T>(v: unknown, item: (x: any) => T | null): T[] =>
  Array.isArray(v) ? v.map(item).filter((x): x is T => x !== null) : [];
export const strArr = (v: unknown): string[] => arr(v, (x) => (typeof x === 'string' && x.trim() ? x : null));
export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
