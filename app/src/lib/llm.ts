// OpenAI 兼容接口客户端（与 PC 端 llm.py 行为一致）。
// 相比旧 App 的改动：输出被截断时直接报错（让模型"重发完整 JSON"没用，长度上限一样）；
// 429/5xx 自动重试；返回结果由调用方用 shape 函数做结构校验，字段缺失不会让界面崩溃。
import { visionEndpoint, type LlmSettings } from './settings';
import { recordUsage } from './usage';

export class LlmError extends Error {}

export type ContentPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };
type Message = { role: 'system' | 'user' | 'assistant'; content: string | ContentPart[] };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 文字请求和识图请求可以走不同的接口（识图可以单独设置）。 */
function endpoint(s: LlmSettings, vision: boolean): { url: string; key: string } {
  const e = vision ? visionEndpoint(s) : { baseUrl: s.baseUrl, apiKey: s.apiKey };
  return { url: e.baseUrl.trim().replace(/\/+$/, ''), key: e.apiKey.trim() };
}

async function post(settings: LlmSettings, body: object, timeoutMs = 90000, vision = false): Promise<any> {
  const { url: base, key } = endpoint(settings, vision);
  if (!key) throw new LlmError(vision ? '识图接口还没有设置 API Key：请到「设置」里填写' : '还没有设置 API Key：请到「设置」里填写');
  const url = `${base}/chat/completions`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const payload = await res.json().catch(() => null);
      if (res.ok) return payload;
      if ([429, 500, 502, 503, 504].includes(res.status) && attempt < 2) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (res.status === 401) throw new LlmError('API Key 无效或已失效（HTTP 401）');
      throw new LlmError(payload?.error?.message || `接口返回错误 HTTP ${res.status}`);
    } catch (e) {
      if (e instanceof LlmError) throw e;
      if (attempt < 2) {
        await sleep(2000 * 2 ** attempt);
        continue;
      }
      if (e instanceof Error && e.name === 'AbortError') throw new LlmError('请求超时，请检查网络');
      throw new LlmError(e instanceof Error ? `网络错误：${e.message}` : '网络错误');
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
  const model = options.vision ? settings.visionModel : settings.model;
  if (!model.trim()) throw new LlmError(options.vision ? '还没有选择识图模型：请到「设置」里选择' : '还没有选择模型：请到「设置」里选择');
  const call = async (msgs: Message[], temperature: number) => {
    const payload = await post(settings, {
      model,
      messages: msgs,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    }, options.timeoutMs, !!options.vision);
    void recordUsage(options.vision ? 'vision' : 'text', model, num(payload?.usage?.prompt_tokens), num(payload?.usage?.completion_tokens));
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason === 'length') throw new LlmError('回答太长被截断了，请把问题拆小一点再试');
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new LlmError('模型没有返回内容，请重试');
    return content;
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

// 模型列表接口一般不告诉你哪些能看图，按名字判断（VL、Vision、多模态系列）
const VISION_HINT = /(vl|vision|gemma-[34]|llama-4|pixtral|omni|gpt-4o|gemini|kimi-k[23])/i;
// 不能聊天的模型（向量、语音、生成图片和视频、重排序……）不列出来，免得新用户选了用不了
const NON_CHAT = /(embed|tts|asr|whisper|image|flux|stable-diffusion|sdxl|rerank|guard|ocr-only|voxtral|bge-|gte-|e5-|minilm|clip|t2v|t2i|i2v|wan2|hunyuanvideo|ltx-video|kokoro|orpheus|sesame|dia-|chatterbox|zonos|audio|bria|background|foreground|upscal|segment|depth|inpaint|remove|vector|sd3|kolors|recraft|ideogram|seedream|seededit|imagen)/i;

/** 读取接口上可用的对话模型。vision=true 时读识图接口（单独设置了的话）。 */
export async function listModels(settings: LlmSettings, vision = false): Promise<ModelInfo[]> {
  const { url, key } = endpoint(settings, vision);
  if (!key) throw new LlmError('请先填写 API Key');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: controller.signal });
    const payload = await res.json().catch(() => null);
    if (res.status === 401) throw new LlmError('API Key 无效（HTTP 401）');
    if (!res.ok) throw new LlmError(payload?.error?.message || `获取模型列表失败（HTTP ${res.status}）`);
    const ids: string[] = (Array.isArray(payload?.data) ? payload.data : []).map((m: any) => String(m?.id ?? '')).filter(Boolean);
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
