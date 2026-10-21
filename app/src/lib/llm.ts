// OpenAI 兼容接口客户端（与 PC 端 llm.py 行为一致）。
// 相比旧 App 的改动：输出被截断时直接报错（让模型"重发完整 JSON"没用，长度上限一样）；
// 429/5xx 自动重试；返回结果由调用方用 shape 函数做结构校验，字段缺失不会让界面崩溃。
import type { LlmSettings } from './settings';

export class LlmError extends Error {}

type Message = { role: 'system' | 'user' | 'assistant'; content: string };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function post(settings: LlmSettings, body: object): Promise<any> {
  const key = settings.apiKey.trim();
  if (!key) throw new LlmError('还没有设置 API Key：请到「设置」里填写');
  const url = `${settings.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
  for (let attempt = 0; attempt < 3; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 90000);
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
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<T> {
  const maxTokens = options.maxTokens ?? 4096;
  const call = async (msgs: Message[], temperature: number) => {
    const payload = await post(settings, {
      model: settings.model,
      messages: msgs,
      temperature,
      max_tokens: maxTokens,
      response_format: { type: 'json_object' },
    });
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

// ---------- 结构整理小工具 ----------

export const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : fallback);
export const arr = <T>(v: unknown, item: (x: any) => T | null): T[] =>
  Array.isArray(v) ? v.map(item).filter((x): x is T => x !== null) : [];
export const strArr = (v: unknown): string[] => arr(v, (x) => (typeof x === 'string' && x.trim() ? x : null));
export const num = (v: unknown, fallback = 0): number => {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
};
