// AI 接口设置。API Key 存在系统加密存储里，其余设置存在本地数据库。
import * as SecureStore from 'expo-secure-store';
import { kvGet, kvSet } from './db';

const KEY_NAME = 'llm-api-key';

export type LlmSettings = {
  baseUrl: string;
  model: string;
  apiKey: string;
  level: '入门' | 'N5' | 'N4' | 'N3' | 'N2' | 'N1';
};

export const DEFAULT_LLM: LlmSettings = {
  baseUrl: 'https://api.deepinfra.com/v1/openai',
  model: 'deepseek-ai/DeepSeek-V4.1-Flash',
  apiKey: '',
  level: 'N4',
};

export async function loadLlmSettings(): Promise<LlmSettings> {
  const saved = await kvGet<Partial<LlmSettings>>('llm', {});
  let apiKey = '';
  try {
    apiKey = (await SecureStore.getItemAsync(KEY_NAME)) ?? '';
  } catch {
    // 加密存储偶尔会因系统密钥变化读不出来，这时当作没设置
  }
  return { ...DEFAULT_LLM, ...saved, apiKey };
}

export async function saveLlmSettings(s: LlmSettings): Promise<void> {
  const { apiKey, ...rest } = s;
  await kvSet('llm', rest);
  if (apiKey.trim()) await SecureStore.setItemAsync(KEY_NAME, apiKey.trim());
  else await SecureStore.deleteItemAsync(KEY_NAME);
}
