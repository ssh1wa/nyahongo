// 翻译、练习、追问的提示词和结果整理。提示词沿用「ことば日和」的设计，结果多了结构校验。
import { normalizeSegments } from './furigana';
import { arr, num, str, strArr } from './llm';
import type { FuriganaSegment } from './types';

const RUBY_RULES = `
FURIGANA RULES:
- Every Japanese sentence must be an array of segments: {"text":"学校","reading":"がっこう"}.
- Put readings only on kanji-bearing segments. Kana, punctuation, Latin letters and numbers use null.
- Reading must be hiragana and must match only that segment.
- Never write parenthetical readings, HTML ruby tags, Markdown, romaji, or combined forms like 学校(がっこう).
- Split at natural word/okurigana boundaries, e.g. [{"text":"食","reading":"た"},{"text":"べます","reading":null}].
`;

const segs = (v: unknown): FuriganaSegment[] => normalizeSegments(Array.isArray(v) ? v : []);

export type Example = { japanese: FuriganaSegment[]; chinese: string };
const examples = (v: unknown): Example[] =>
  arr(v, (x) => {
    const japanese = segs(x?.japanese);
    return japanese.length ? { japanese, chinese: str(x?.chinese) } : null;
  });

// ---------- 翻译 ----------

export type WordNote = { surface: string; reading: string; meaning: string; partOfSpeech: string };
export type GrammarPoint = { pattern: string; meaning: string; explanation: string; example: FuriganaSegment[]; exampleMeaning: string };
export type TranslationResult = {
  direction: 'ja-zh' | 'zh-ja';
  translationJapanese: FuriganaSegment[];
  translationChinese: string;
  naturalNote: string;
  words: WordNote[];
  grammar: GrammarPoint[];
};

export const TRANSLATION_PROMPT = `You are a rigorous Japanese-Chinese translator and Japanese tutor.
Detect whether the user's input is mainly Japanese or Simplified Chinese.

TRANSLATION CONTRACT:
- Chinese input: direction must be zh-ja. Put ONLY the Japanese translation in translationJapanese and set translationChinese to an empty string.
- Japanese input: direction must be ja-zh. Put ONLY the Chinese translation in translationChinese and set translationJapanese to an empty array.
- Never echo or paraphrase the source text as a second translation.
- naturalNote may briefly explain nuance or word choice in Simplified Chinese, but must not repeat the source or target sentence.
- Explain vocabulary and grammar from the Japanese side: for zh-ja use the Japanese translation; for ja-zh use the Japanese source.
- Do not invent grammar points that are not present.
${RUBY_RULES}
Return JSON only in this exact shape:
{
  "direction":"ja-zh|zh-ja",
  "translationJapanese":[{"text":"...","reading":"... or null"}],
  "translationChinese":"...",
  "naturalNote":"简短中文语感说明；没有则写空字符串",
  "words":[{"surface":"...","reading":"... or null","meaning":"中文释义","partOfSpeech":"词性"}],
  "grammar":[{"pattern":"...","meaning":"中文含义","explanation":"清晰简短的中文讲解","example":[{"text":"...","reading":"... or null"}],"exampleMeaning":"中文例句含义"}]
}`;

export function shapeTranslation(raw: any, source: string): TranslationResult {
  // 方向以模型判断为准；模型没给或给错时按原文是否含假名来猜
  const looksJapanese = /[぀-ヿ]/.test(source);
  const direction: TranslationResult['direction'] =
    raw?.direction === 'ja-zh' || raw?.direction === 'zh-ja' ? raw.direction : looksJapanese ? 'ja-zh' : 'zh-ja';
  return {
    direction,
    translationJapanese: direction === 'zh-ja' ? segs(raw?.translationJapanese) : [],
    translationChinese: direction === 'ja-zh' ? str(raw?.translationChinese) : '',
    naturalNote: str(raw?.naturalNote),
    words: arr(raw?.words, (w) =>
      str(w?.surface) ? { surface: str(w.surface), reading: str(w.reading), meaning: str(w.meaning), partOfSpeech: str(w.partOfSpeech) } : null,
    ),
    grammar: arr(raw?.grammar, (g) =>
      str(g?.pattern)
        ? { pattern: str(g.pattern), meaning: str(g.meaning), explanation: str(g.explanation), example: segs(g.example), exampleMeaning: str(g.exampleMeaning) }
        : null,
    ),
  };
}

// ---------- 练习 ----------

export type PracticeDirection = 'zh-ja' | 'ja-zh';
export type PracticeQuestion = {
  direction: PracticeDirection;
  sourceText: string;
  sourceJapanese: FuriganaSegment[];
  focus: string;
  hint: string;
  referenceChinese: string;
  referenceJapanese: FuriganaSegment[];
  answerNote: string;
};

export const practiceQuestionPrompt = (direction: PracticeDirection, level: string, avoid: string[], focusWords: string[], focusGrammar: string[] = []) => `You create one fresh translation exercise for a ${level} Japanese learner.
Direction: ${direction === 'zh-ja' ? 'Simplified Chinese to Japanese' : 'Japanese to Simplified Chinese'}.
Use an everyday situation and test exactly one useful grammar point. Avoid ambiguous literary sentences.
${focusGrammar.length ? `Prefer testing one of these grammar points the learner recently studied or got wrong (pick one, vary across exercises): ${focusGrammar.join(' / ')}` : ''}
${avoid.length ? `Do not reuse or trivially paraphrase these recent sentences: ${avoid.join(' || ')}` : ''}
${focusWords.length ? `If natural, use one of these words the learner is currently reviewing: ${focusWords.join(' / ')}` : ''}
${RUBY_RULES}
Return JSON only:
{
  "sourceText":"plain source sentence",
  "sourceJapanese":[{"text":"only when source is Japanese","reading":"... or null"}],
  "focus":"要考察的语法点（中文）",
  "hint":"一个克制的中文提示，不直接泄露答案",
  "referenceChinese":"Japanese-to-Chinese reference answer, otherwise empty string",
  "referenceJapanese":[{"text":"Chinese-to-Japanese reference answer","reading":"... or null"}],
  "answerNote":"一句简短中文说明，解释参考答案中的核心语法"
}
For Chinese source, sourceJapanese and referenceChinese must be empty. For Japanese source, referenceJapanese must be empty.`;

export function shapeQuestion(raw: any, direction: PracticeDirection): PracticeQuestion {
  return {
    direction,
    sourceText: str(raw?.sourceText),
    sourceJapanese: direction === 'ja-zh' ? segs(raw?.sourceJapanese) : [],
    focus: str(raw?.focus),
    hint: str(raw?.hint),
    referenceChinese: str(raw?.referenceChinese),
    referenceJapanese: segs(raw?.referenceJapanese),
    answerNote: str(raw?.answerNote),
  };
}

export type PracticeGrade = {
  score: number;
  verdict: 'excellent' | 'good' | 'retry';
  feedback: string;
  strengths: string[];
  corrections: string[];
  correctChinese: string;
  correctJapanese: FuriganaSegment[];
  grammarTip: string;
};

export const practiceGradePrompt = (direction: PracticeDirection) => `You are a fair Japanese translation teacher. Grade the learner's answer against meaning, grammar, naturalness, and writing. Accept natural alternatives; do not require exact wording.
Direction: ${direction === 'zh-ja' ? 'Chinese to Japanese' : 'Japanese to Chinese'}.
${RUBY_RULES}
Return JSON only:
{
  "score":0,
  "feedback":"简洁、具体、友善的中文总评",
  "strengths":["做对的点"],
  "corrections":["需要修改的点"],
  "correctChinese":"Japanese-to-Chinese reference answer, otherwise empty string",
  "correctJapanese":[{"text":"Chinese-to-Japanese reference answer","reading":"... or null"}],
  "grammarTip":"一条可复用的中文语法提示"
}
Score 90-100 for excellent, 70-89 for good, below 70 for retry.`;

export function shapeGrade(raw: any): PracticeGrade {
  const score = Math.max(0, Math.min(100, Math.round(num(raw?.score))));
  // 评级由分数推出，不信模型单独给的 verdict，避免"90 分却显示再调整"这种不一致
  const verdict: PracticeGrade['verdict'] = score >= 90 ? 'excellent' : score >= 70 ? 'good' : 'retry';
  return {
    score,
    verdict,
    feedback: str(raw?.feedback),
    strengths: strArr(raw?.strengths),
    corrections: strArr(raw?.corrections),
    correctChinese: str(raw?.correctChinese),
    correctJapanese: segs(raw?.correctJapanese),
    grammarTip: str(raw?.grammarTip),
  };
}

// ---------- 追问 ----------

export type FollowUp = { question: string; answer: string; examples: Example[] };

/** 英语学习包（测试版）里追问一句话或一个词：用英语老师的身份，例句是英文，不需要注音 */
export const englishFollowUpPrompt = `You are a rigorous English tutor for a Chinese-speaking learner who is watching an English video (TV series, podcast, etc.).
Answer the learner's question about the supplied English sentence and word in clear Simplified Chinese, grounded in the context: meaning in this context, usage, slang or idioms, grammar, and nuance.
Return JSON only:
{"answer":"清晰具体的中文回答","examples":[{"japanese":[{"text":"English example sentence","reading":null}],"chinese":"中文含义"}]}
Use 0-3 short, natural English examples (put the English sentence in "japanese"[0].text; "reading" must be null).`;

export const followUpPrompt = (kind: 'translation' | 'practice' | 'sentence') => `You are a rigorous Japanese tutor answering a learner's follow-up question about the ${
  kind === 'translation' ? 'translation and its analysis' : kind === 'practice' ? 'exercise, the learner answer and grading' : 'Japanese sentence from a video the learner is studying'
} supplied in the user context.
- Answer the exact question in clear Simplified Chinese and stay grounded in the supplied context.
- Correct earlier explanations if the learner has identified a real problem.
- Put Japanese only in the structured examples array when giving a full example sentence, so the app can render furigana above kanji.
${RUBY_RULES}
Return JSON only:
{"answer":"清晰具体的中文回答","examples":[{"japanese":[{"text":"日语例句","reading":"... or null"}],"chinese":"中文含义"}]}
Use 0-3 examples.`;

export const shapeFollowUp = (raw: any, question: string): FollowUp => ({
  question,
  answer: str(raw?.answer) || '没有得到有效讲解，请换一种问法。',
  examples: examples(raw?.examples),
});
