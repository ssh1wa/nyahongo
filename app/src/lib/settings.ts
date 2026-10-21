// AI 接口设置。API Key 存在系统加密存储里，其余设置存在本地数据库。
import * as SecureStore from 'expo-secure-store';
import { kvGet, kvSet } from './db';

const KEY_NAME = 'llm-api-key';
const VISION_KEY_NAME = 'llm-vision-api-key';

export type Level = '入门' | 'N5' | 'N4' | 'N3' | 'N2' | 'N1';

export type LlmSettings = {
  baseUrl: string;
  model: string; // 文字模型：翻译、练习、精读、语法
  apiKey: string;
  visionModel: string; // 识图模型：拍照/截图精读
  // 识图可以用另一家接口（比如文字用 DeepSeek 官方、识图用 DeepInfra / 阿里云百炼）。留空表示和文字模型同一个接口
  visionBaseUrl: string;
  visionApiKey: string;
  level: Level;
};

export const DEFAULT_LLM: LlmSettings = {
  baseUrl: 'https://api.deepinfra.com/v1/openai',
  model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  apiKey: '',
  visionModel: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
  visionBaseUrl: '',
  visionApiKey: '',
  level: 'N4',
};

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

export async function loadLlmSettings(): Promise<LlmSettings> {
  const saved = await kvGet<Partial<LlmSettings>>('llm', {});
  const [apiKey, visionApiKey] = await Promise.all([readSecret(KEY_NAME), readSecret(VISION_KEY_NAME)]);
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
export function visionEndpoint(s: LlmSettings): { baseUrl: string; apiKey: string; separate: boolean } {
  const separate = !!s.visionBaseUrl.trim();
  return separate
    ? { baseUrl: s.visionBaseUrl, apiKey: s.visionApiKey || s.apiKey, separate }
    : { baseUrl: s.baseUrl, apiKey: s.apiKey, separate };
}
