// 活用形还原：选中的文字（行われます、高かった）词典里查不到原样时，猜几个原形试试。够用就好，不追求完整
import { lookup } from './dict';
import type { DictEntry } from './types';

const U_ROW: Record<string, string> = {
  か: 'く', き: 'く', け: 'く', こ: 'く', が: 'ぐ', ぎ: 'ぐ', げ: 'ぐ', ご: 'ぐ', さ: 'す', し: 'す', せ: 'す', そ: 'す',
  た: 'つ', ち: 'つ', て: 'つ', と: 'つ', な: 'ぬ', に: 'ぬ', ね: 'ぬ', の: 'ぬ', ば: 'ぶ', び: 'ぶ', べ: 'ぶ', ぼ: 'ぶ',
  ま: 'む', み: 'む', め: 'む', も: 'む', ら: 'る', り: 'る', れ: 'る', ろ: 'る', わ: 'う', い: 'う', え: 'う', お: 'う',
};
// 音便：書いて→書く、読んで→読む、待って→待つ
const ONBIN: Record<string, string[]> = { い: ['く', 'ぐ'], っ: ['う', 'つ', 'る'], ん: ['む', 'ぶ', 'ぬ'] };
const SUFFIXES = [
  'ませんでした', 'なかった', 'ました', 'ません', 'ましょう', 'させる', 'られる', 'ている', 'てる', 'ます', 'ない', 'たい', 'せる', 'れる',
  'った', 'って', 'んだ', 'んで', 'いた', 'いて', 'いだ', 'いで', 'た', 'て', 'だ', 'で', 'ば', 'う', 'よう',
];

export function baseCandidates(s: string): string[] {
  const out = [s];
  // 形容词：高かった / 高くない / 高く / 高くて / 高ければ → 高い
  for (const suf of ['かった', 'くない', 'くなかった', 'くて', 'ければ', 'く', 'さ']) {
    if (s.endsWith(suf) && s.length > suf.length) out.push(s.slice(0, -suf.length) + 'い');
  }
  for (const suf of SUFFIXES) {
    if (!s.endsWith(suf) || s.length <= suf.length) continue;
    const stem = s.slice(0, -suf.length);
    const keep = suf[0] === 'っ' || suf[0] === 'ん' || suf[0] === 'い' ? suf[0] : '';
    if (keep) {
      for (const end of ONBIN[keep] ?? []) out.push(stem + end);
      continue;
    }
    out.push(stem + 'る'); // 一段：食べた → 食べる
    const last = stem.slice(-1);
    if (U_ROW[last]) out.push(stem.slice(0, -1) + U_ROW[last]); // 五段：書きます → 書く
    if (stem.endsWith('し')) out.push(stem.slice(0, -1) + 'する'); // 勉強します → 勉強する
    if (stem.endsWith('き') || stem.endsWith('こ')) out.push(stem.slice(0, -1) + 'くる');
  }
  return [...new Set(out)];
}

export async function findEntry(s: string): Promise<{ entry: DictEntry; base: string } | null> {
  for (const base of baseCandidates(s)) {
    const entry = await lookup(base);
    if (entry) return { entry, base };
  }
  return null;
}

export const isSkippable = (ch: string) => /[\s、。，．,.！？!?「」『』（）()【】・…ー〜~"'：:；;]/.test(ch);

/** 从第 i 个单元开始，找词典里最长的词，返回 [起, 止]（含）。都查不到就只选这一个 */
export async function longestWord(units: string[], i: number, maxLen = 8): Promise<[number, number]> {
  if (isSkippable(units[i])) return [i, i];
  for (let len = Math.min(maxLen, units.length - i); len > 1; len--) {
    if (isSkippable(units[i + len - 1])) continue;
    if (await findEntry(units.slice(i, i + len).join(''))) return [i, i + len - 1];
  }
  return [i, i];
}
