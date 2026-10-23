// AI 接口设置。API Key 存在系统加密存储里，其余设置存在本地数据库。
import * as SecureStore from 'expo-secure-store';
import { kvGet, kvSet } from './db';

const KEY_NAME = 'llm-api-key';
const VISION_KEY_NAME = 'llm-vision-api-key';

export type Level = '入门' | 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

/** 接口格式：OpenAI 兼容（大多数服务商）、Anthropic（Claude，DeepSeek 也提供）、Gemini（Google） */
export type ApiFormat = 'openai' | 'anthropic' | 'gemini';

export type LlmSettings = {
  baseUrl: string;
  apiFormat: ApiFormat;
  model: string; // 文字模型：翻译、练习、精读、语法
  apiKey: string;
  // 识图模型：拍照/截图精读。留空表示和文字模型相同（DeepSeek 的 deepseek-flash 本身就能看图）
  visionModel: string;
  // 识图可以用另一家接口（文字模型不能看图时）。留空表示和文字模型同一个接口
  visionBaseUrl: string;
  visionApiFormat: ApiFormat;
  visionApiKey: string;
  level: Level;
};

// 默认推荐 DeepSeek 官方：一个 Key 文字、看图、联网搜索都能用
export const DEEPSEEK_URL = 'https://api.deepseek.com';
export const DEFAULT_LLM: LlmSettings = {
  baseUrl: DEEPSEEK_URL,
  apiFormat: 'openai',
  model: 'deepseek-flash',
  apiKey: '',
  visionModel: '',
  visionBaseUrl: '',
  visionApiFormat: 'openai',
  visionApiKey: '',
  level: 'N4',
};

export const isDeepSeek = (url: string) => /api\.deepseek\.com/.test(url);

async function readSecret(name: string): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(name)) ?? '';
  } catch {
    return ''; // 加密存储偶尔会因系统密钥变化读不出来，这时当作没设置
  }
}

async function writeSecret(name: string, value: string): Promise<void> {
  if (value.trim()) await SecureStore.setItemAsync(name, value.trim());
  else await SecureStore.deleteItemAsync(name);
}

/** 以前的默认模型（DeepInfra 上不带日期的版本，长回答经常排队卡住），读设置时换成固定版本 */
const STALLING_MODELS: Record<string, string> = { 'deepseek-ai/DeepSeek-V4.1-Flash': 'deepseek-ai/DeepSeek-V4.1-Flash-1017' };

// 0.5 以前的默认值（DeepInfra）。没填过 Key、设置也没动过的老用户，换成现在的默认（DeepSeek 官方）
const OLD_DEFAULT = { baseUrl: 'https://api.deepinfra.com/v1/openai', visionModel: 'Qwen/Qwen3-VL-235B-A22B-Instruct' };
const OLD_DEFAULT_MODELS = ['deepseek-ai/DeepSeek-V4.1-Flash', 'deepseek-ai/DeepSeek-V4.1-Flash-1017'];

export async function loadLlmSettings(): Promise<LlmSettings> {
  const saved = await kvGet<Partial<LlmSettings>>('llm', {});
  const [apiKey, visionApiKey] = await Promise.all([readSecret(KEY_NAME), readSecret(VISION_KEY_NAME)]);
  if (!apiKey && saved.baseUrl === OLD_DEFAULT.baseUrl && (!saved.model || OLD_DEFAULT_MODELS.includes(saved.model)) && !saved.visionBaseUrl) {
    delete saved.baseUrl;
    delete saved.model;
    if (saved.visionModel === OLD_DEFAULT.visionModel) delete saved.visionModel;
  }
  if (saved.model && STALLING_MODELS[saved.model]) saved.model = STALLING_MODELS[saved.model];
  return { ...DEFAULT_LLM, ...saved, apiKey, visionApiKey };
}

export async function saveLlmSettings(s: LlmSettings): Promise<void> {
  const { apiKey, visionApiKey, ...rest } = s;
  await kvSet('llm', rest);
  await Promise.all([writeSecret(KEY_NAME, apiKey), writeSecret(VISION_KEY_NAME, visionApiKey)]);
}

/** 只改日语水平（语法、练习页面里切换时用）。 */
export async function saveLevel(level: Level): Promise<void> {
  const s = await loadLlmSettings();
  await saveLlmSettings({ ...s, level });
}

/** 识图实际用的接口：单独设置了就用单独的，否则和文字模型一样。 */
export function visionEndpoint(s: LlmSettings): { baseUrl: string; apiKey: string; format: ApiFormat; separate: boolean } {
  const separate = !!s.visionBaseUrl.trim();
  return separate
    ? { baseUrl: s.visionBaseUrl, apiKey: s.visionApiKey || s.apiKey, format: s.visionApiFormat, separate }
    : { baseUrl: s.baseUrl, apiKey: s.apiKey, format: s.apiFormat, separate };
}

/** 识图实际用的模型：没单独选就用文字模型（另选了一家接口时必须自己选） */
export const visionModelOf = (s: LlmSettings) => s.visionModel.trim() || (s.visionBaseUrl.trim() ? '' : s.model.trim());

/** 拍照识字能不能用：接口有 Key、有模型 */
export const visionReady = (s: LlmSettings) => !!visionEndpoint(s).apiKey.trim() && !!visionModelOf(s);
