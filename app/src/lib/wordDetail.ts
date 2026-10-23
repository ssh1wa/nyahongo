// 生词的详细释义（AI 详解）：第一次点开时让 AI 写，存进生词本；查词面板里也能生成。词条本身仍以词典为准，AI 只负责讲解用法、举例。
// 按词典词条缓存在 kv 的 word-detail:<词条 id>（跟着同步），同一个词在查词、生词本、别的设备上都不用重复花钱。
import { kvGet, kvSet } from './db';
import { arr, requestJson, str } from './llm';
import { RUBY_RULES, segs } from './prompts';
import { loadLlmSettings } from './settings';
import type { DictEntry } from './types';
import { saveDetail, type WordDetail, type WordRow } from './wordbook';

type DetailInput = { headword: string; reading?: string | null; entry?: DictEntry | null; context?: string | null; contextZh?: string | null };

const isEnglish = (w: DetailInput) => !!w.entry?.phonetic || /^[A-Za-z][A-Za-z'\- ]*$/.test(w.headword);
const cacheKey = (entry?: DictEntry | null) => (entry && entry.id > 0 ? `word-detail:${entry.id}` : null);

const JA_PROMPT = `你是给中文母语学习者讲解日语单词的老师。根据给出的词典释义和学习者遇到它的原句，写一份详细、实用的讲解。
- 释义以词典为准，不要编造词典里没有的意思；可以按常用程度重新组织，说明每个意思的语感和使用场合
- usage：用法要点（接续、搭配的助词、敬语/口语/书面语、常见误用等），每条一句话
- collocations：3~5 个常见搭配，text 写日语（不加注音），zh 写中文
- examples：3 个自然的例句（日常、正式各有），至少一个贴近原句的场景
- similar：1~3 个容易混淆的近义词，说清区别
${RUBY_RULES}
只返回 JSON：{"summary":"一句话概括","meanings":[{"meaning":"意思","note":"语感和使用场合"}],"usage":["..."],"collocations":[{"text":"日语搭配","zh":"中文"}],"examples":[{"japanese":[注音分段],"chinese":"中文"}],"similar":[{"word":"近义词","diff":"区别"}]}`;

const EN_PROMPT = `你是给中文母语学习者讲解英语单词的老师。根据给出的词典释义和学习者在美剧/播客里遇到它的原句，写一份详细、实用的讲解。
- 释义以词典为准，可以按常用程度重新组织，说明每个意思的语感、正式程度、美式/英式差异
- usage：用法要点（搭配的介词、及物/不及物、口语习惯、常见误用），每条一句话
- collocations：3~5 个常见搭配或短语，text 写英语，zh 写中文
- examples：3 个自然的英语例句，至少一个贴近原句的场景（japanese 字段里放英语句子，reading 一律为 null）
- similar：1~3 个容易混淆的近义词，说清区别
只返回 JSON：{"summary":"一句话概括","meanings":[{"meaning":"意思","note":"语感和使用场合"}],"usage":["..."],"collocations":[{"text":"英语搭配","zh":"中文"}],"examples":[{"japanese":[{"text":"English sentence","reading":null}],"chinese":"中文"}],"similar":[{"word":"近义词","diff":"区别"}]}`;

function shape(raw: any): WordDetail {
  return {
    summary: str(raw?.summary),
    meanings: arr(raw?.meanings, (x) => (str(x?.meaning) ? { meaning: str(x.meaning), note: str(x?.note) } : null)),
    usage: arr(raw?.usage, (x) => (typeof x === 'string' && x.trim() ? x : null)),
    collocations: arr(raw?.collocations, (x) => (str(x?.text) ? { text: str(x.text), zh: str(x?.zh) } : null)),
    examples: arr(raw?.examples, (x) => {
      const s = segs(x?.japanese);
      return s.length ? { segments: s, zh: str(x?.chinese) } : null;
    }),
    similar: arr(raw?.similar, (x) => (str(x?.word) ? { word: str(x.word), diff: str(x?.diff) } : null)),
  };
}

/** 生成并缓存。已经有了就直接返回（force 时重新生成） */
/** 生词本里的词：已有讲解直接用，没有就先找缓存、再让 AI 写，存进生词本 */
export async function wordDetail(w: WordRow, force = false): Promise<WordDetail> {
  if (w.detail && !force) return w.detail;
  const detail = await entryDetail({ headword: w.headword, reading: w.reading, entry: w.entry, context: w.context, contextZh: w.context_zh }, force);
  await saveDetail(w.id, detail);
  return detail;
}

/** 任意一个词（比如查词面板里查到的）：先找缓存，没有再让 AI 写 */
export async function entryDetail(w: DetailInput, force = false): Promise<WordDetail> {
  const key = cacheKey(w.entry);
  if (key && !force) {
    const cached = await kvGet<WordDetail | null>(key, null);
    if (cached) return cached;
  }
  const settings = await loadLlmSettings();
  const en = isEnglish(w);
  const detail = await requestJson(settings, [
    { role: 'system', content: en ? EN_PROMPT : JA_PROMPT },
    {
      role: 'user',
      content: JSON.stringify({
        word: w.headword,
        reading: w.reading,
        dictionary: w.entry?.senses.map((s) => ({ pos: s.pos, meaning: s.zh || s.en.join('; ') })) ?? null,
        sentence: w.context ?? null,
        sentenceTranslation: w.contextZh ?? null,
      }),
    },
  ], shape, { temperature: 0.3, maxTokens: 4000 });
  if (!detail.summary && !detail.meanings.length) throw new Error('没有生成出讲解，请重试');
  if (key) await kvSet(key, detail);
  return detail;
}

/** 已经生成过 AI 详解的话直接拿到（不花钱） */
export const cachedDetail = (entry?: DictEntry | null) => {
  const key = cacheKey(entry);
  return key ? kvGet<WordDetail | null>(key, null) : Promise.resolve(null);
};
