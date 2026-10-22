// 「问 AI」：直接问语法、或者「某个场合日语怎么说」。回答分段：中文讲解 + 带注音的日语句子
import { arr, requestJson, str } from './llm';
import { RUBY_RULES, segs } from './prompts';
import type { LlmSettings } from './settings';
import type { FuriganaSegment } from './types';

export type AskBlock =
  | { type: 'text'; text: string }
  | { type: 'japanese'; japanese: FuriganaSegment[]; chinese: string; note: string };
export type AskTurn = { question: string; blocks: AskBlock[] };
export type AskThread = { turns: AskTurn[] };

const ASK_PROMPT = `你是耐心、严谨的日语老师，学生母语是简体中文。学生会问两类问题：
1. 语法、词汇、用法的疑问（「〜てしまう 和 〜ちゃう 有什么区别」）
2. 某个场合用日语怎么说（「在便利店想要发票怎么说」「怎么礼貌地拒绝同事的邀请」）
回答要求：
- 用中文讲解，具体、直接，不要客套话；结合学生给出的场景
- 完整的日语句子不要写在中文段落里，单独放进 japanese 块，app 会在汉字上方显示注音；中文段落里只可以夹简短的日语词或语法形式（如「〜てしまう」）
- 「怎么说」类问题：给 2~4 种说法，按礼貌程度或场合区分，在 note 里说明适用场合
- 语法类问题：讲清意思、接续、语感区别，配 2~3 个例句
- 有多轮对话时，结合之前的内容回答；学生指出错误时要认真更正
${RUBY_RULES}
只返回 JSON：{"blocks":[{"type":"text","text":"中文讲解段落"},{"type":"japanese","japanese":[注音分段],"chinese":"中文意思","note":"适用场合/说明，可为空字符串"}]}
blocks 按阅读顺序排列，讲解和例句可以交替出现。`;

function shapeBlocks(raw: any): AskBlock[] {
  return arr(raw?.blocks, (b): AskBlock | null => {
    if (b?.type === 'japanese') {
      const japanese = segs(b?.japanese);
      return japanese.length ? { type: 'japanese', japanese, chinese: str(b?.chinese), note: str(b?.note) } : null;
    }
    const text = str(b?.text).trim();
    return text ? { type: 'text', text } : null;
  });
}

export async function ask(settings: LlmSettings, thread: AskThread, question: string): Promise<AskTurn> {
  const history = thread.turns.slice(-6).flatMap((t) => [
    { role: 'user' as const, content: t.question },
    { role: 'assistant' as const, content: JSON.stringify({ blocks: t.blocks }) },
  ]);
  const blocks = await requestJson(settings, [
    { role: 'system', content: ASK_PROMPT },
    ...history,
    { role: 'user', content: question },
  ], shapeBlocks, { temperature: 0.3, maxTokens: 4000 });
  if (!blocks.length) throw new Error('没有得到有效回答，请换一种问法');
  return { question, blocks };
}
