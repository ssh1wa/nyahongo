// 注音对齐，规则与 PC 端 furigana.py 一致：
// - 只有含汉字的段才有 reading，读音一律平假名
// - 汉字和送假名分开：行き/いき → 行(い) + き
// - 无法唯一对齐时整段不注音，宁缺毋错
import type { FuriganaSegment } from './types';

type Kind = 'kanji' | 'kana' | 'other';

export function charKind(ch: string): Kind {
  const c = ch.codePointAt(0)!;
  if ((c >= 0x4e00 && c <= 0x9fff) || (c >= 0x3400 && c <= 0x4dbf) || (c >= 0xf900 && c <= 0xfaff) || '々〆ヶヵ'.includes(ch)) {
    return 'kanji';
  }
  if ((c >= 0x3041 && c <= 0x309f) || (c >= 0x30a0 && c <= 0x30ff)) return 'kana';
  return 'other';
}

export const hasKanji = (text: string) => Array.from(text).some((ch) => charKind(ch) === 'kanji');

export function toHiragana(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const c = ch.codePointAt(0)!;
      return c >= 0x30a1 && c <= 0x30f6 && !'ヵヶ'.includes(ch) ? String.fromCodePoint(c - 0x60) : ch;
    })
    .join('');
}

function runs(text: string): Array<{ kind: Kind; text: string }> {
  const out: Array<{ kind: Kind; text: string }> = [];
  for (const ch of Array.from(text)) {
    const kind = charKind(ch);
    const last = out[out.length - 1];
    if (last && last.kind === kind) last.text += ch;
    else out.push({ kind, text: ch });
  }
  return out;
}

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function mergePlain(segments: FuriganaSegment[]): FuriganaSegment[] {
  const out: FuriganaSegment[] = [];
  for (const seg of segments) {
    const last = out[out.length - 1];
    if (last && !seg.reading && !last.reading) last.text += seg.text;
    else out.push({ ...seg });
  }
  return out;
}

/** 把一个词的读音对齐到汉字上。 */
export function align(surface: string, reading: string | null | undefined): FuriganaSegment[] {
  const plain = [{ text: surface, reading: null }];
  const r = (reading || '').trim();
  if (!surface || !r || /^[\s・･·•.。…\-—ー]+$/.test(r)) return plain;
  const parts = runs(surface);
  if (!parts.some((p) => p.kind === 'kanji')) return plain;
  const hira = toHiragana(r);

  const pattern = (lazy: boolean) =>
    '^' + parts.map((p) => (p.kind === 'kanji' ? (lazy ? '(.+?)' : '(.+)') : escapeRegExp(p.kind === 'kana' ? toHiragana(p.text) : p.text))).join('') + '$';
  const a = hira.match(new RegExp(pattern(true), 'u'));
  const b = hira.match(new RegExp(pattern(false), 'u'));
  if (!a || !b || a.slice(1).join('|') !== b.slice(1).join('|')) return plain; // 对不齐或有多种切法

  let g = 1;
  return mergePlain(parts.map((p) => (p.kind === 'kanji' ? { text: p.text, reading: a[g++] } : { text: p.text, reading: null })));
}

/**
 * 规范化 LLM 返回的注音分段：重新按规则对齐，纯假名不注音，对不齐就不注音。
 * PC 学习包里的分段已经规范过，不需要再调用。
 */
export function normalizeSegments(segments: FuriganaSegment[] | null | undefined): FuriganaSegment[] {
  if (!Array.isArray(segments)) return [];
  return mergePlain(
    segments.flatMap((seg) => {
      const text = typeof seg?.text === 'string' ? seg.text : '';
      if (!text) return [];
      const reading = typeof seg.reading === 'string' ? seg.reading : null;
      return reading && hasKanji(text) ? align(text, reading) : [{ text, reading: null }];
    }),
  );
}

export const segmentsText = (segments: FuriganaSegment[]) => segments.map((s) => s.text).join('');
