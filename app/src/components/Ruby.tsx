// 汉字上方注音。React Native 没有 <ruby>，用「上读音 / 下正文」的竖排小块拼成可换行的一行。
// 修正旧版问题：没有读音的文字拆成单字排列，长串假名不会因为不能换行而溢出屏幕。
// 长按可以选词（复制、查词），见 Selection.tsx。
import React, { memo, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useColors, useScale } from '../theme';
import type { FuriganaSegment, Token } from '../lib/types';
import { useSelectable } from './Selection';

type Common = {
  size?: number;
  color?: string;
  showRuby?: boolean;
  serif?: boolean;
  /** 这句话的中文意思：长按查词时作为例句的翻译一起存进生词本 */
  zh?: string;
};

function Cell({ text, reading, size, color, rubyColor, showRuby, serif, innerRef }: {
  text: string; reading?: string | null; size: number; color: string; rubyColor: string; showRuby: boolean; serif: boolean;
  innerRef?: (v: View | null) => void;
}) {
  const rubySize = Math.max(8, Math.round(size * 0.46));
  return (
    <View ref={innerRef} style={styles.cell}>
      <Text
        numberOfLines={1}
        style={{ fontSize: rubySize, lineHeight: rubySize + 3, color: reading && showRuby ? rubyColor : 'transparent', textAlign: 'center' }}
      >
        {reading || ' '}
      </Text>
      <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.35), color, fontFamily: serif ? fonts.jaSerif : undefined }}>{text}</Text>
    </View>
  );
}

/** 有读音的分段整格显示，没读音的拆成单字（可以在任意位置换行） */
const toCells = (segments: FuriganaSegment[]): FuriganaSegment[] =>
  segments.flatMap((seg) => (seg.reading ? [seg] : Array.from(seg.text).map((ch) => ({ text: ch, reading: null }))));

/** 渲染注音分段（AI 回复里的例句、译文）。 */
export const RubyText = memo(function RubyText({ segments, size: baseSize = 20, color, showRuby = true, serif = false, zh }: Common & { segments: FuriganaSegment[] }) {
  const c = useColors();
  const size = Math.round(baseSize * useScale()); // 设置里的日文字号
  const cells = useMemo(() => toCells(segments ?? []), [segments]);
  const units = useMemo(() => cells.map((x) => x.text), [cells]);
  const { cellRef, touch } = useSelectable(units, zh);
  if (!cells.length) return null;
  return (
    <View style={styles.line} accessibilityLabel={units.join('')} {...touch}>
      {kinsokuGroups(cells.map((cell, k) => ({ cell, k })), (x) => x.cell.text).map((group, i) => (
        <View key={i} style={styles.token}>
          {group.map(({ cell, k }) => (
            <Cell key={k} {...cell} size={size} color={color ?? c.ink} rubyColor={c.ruby} showRuby={showRuby} serif={serif} innerRef={cellRef(k)} />
          ))}
        </View>
      ))}
    </View>
  );
});

// 日文排版的「避头尾」：句号、逗号、右括号、小假名不能出现在行首，左括号不能留在行尾
const NO_LINE_START = /^[、。，．,.！？!?」』）)】〕〉》…‥・ーぁぃぅぇぉっゃゅょゎァィゥェォッャュョヮ々]+$/;
const NO_LINE_END = /^[「『（(【〔〈《]+$/;

/** 把不能单独换行的元素和前后的元素绑在一组，组内不换行。 */
function kinsokuGroups<T>(items: T[], textOf: (x: T) => string): T[][] {
  const groups: T[][] = [];
  let opening: T[] = [];
  for (const item of items) {
    const text = textOf(item);
    if (NO_LINE_END.test(text)) opening.push(item);
    else if (NO_LINE_START.test(text) && groups.length && !opening.length) groups[groups.length - 1].push(item);
    else {
      groups.push([...opening, item]);
      opening = [];
    }
  }
  if (opening.length) groups.push(opening);
  return groups;
}

const noop = () => {};

/** 渲染学习包里分好词的句子，每个词可以点按查词，长按自由选词。 */
export const TokenText = memo(function TokenText({
  tokens, size: baseSize = 20, color, showRuby = true, serif = false, onPressToken, highlight, zh,
}: Common & { tokens: Token[]; onPressToken?: (index: number) => void; highlight?: number | null }) {
  const c = useColors();
  const size = Math.round(baseSize * useScale());
  const english = tokens.length > 0 && !tokens[0].furigana;
  // 每个词拆成格子，记下每格在整句里的序号（选词时按格量位置）
  const { perToken, units } = useMemo(() => {
    let k = 0;
    const perToken = tokens.map((t) => toCells(t.furigana ?? [{ text: t.surface, reading: null }]).map((cell) => ({ cell, k: k++ })));
    return { perToken, units: perToken.flat().map((x) => x.cell.text) };
  }, [tokens]);
  const { cellRef, touch } = useSelectable(english ? [] : units, zh);

  // 英语学习包：没有注音，整句是一段普通文字，单词可以点（自然换行，不按词切块）
  if (english) {
    return (
      <Text style={{ color: color ?? c.ink, fontSize: size, lineHeight: size * 1.45 }}>
        {tokens.map((t, i) => (t.word && onPressToken ? (
          <Text key={i} onPress={() => onPressToken(i)} style={highlight === i ? { backgroundColor: c.accentSoft, color: c.accent } : undefined}>{t.surface}</Text>
        ) : t.surface))}
      </Text>
    );
  }
  return (
    <View style={styles.line} accessibilityLabel={tokens.map((t) => t.surface).join('')} {...touch}>
      {kinsokuGroups(tokens.map((t, i) => ({ t, i })), (x) => x.t.surface).map((group, g) => (
        // 标点和前面的词绑在一组，不会被单独换到下一行
        <View key={g} style={styles.token}>
          {group.map(({ t, i }) => {
            // 一个词内部不换行；词本身很长（超过一行）的情况极少
            const content = perToken[i].map(({ cell, k }) => (
              <Cell key={k} {...cell} size={size} color={color ?? c.ink} rubyColor={c.ruby} showRuby={showRuby} serif={serif} innerRef={cellRef(k)} />
            ));
            if (!onPressToken || ['補助記号', '記号', '空白'].includes(t.pos ?? '')) {
              return <View key={i} style={styles.token}>{content}</View>;
            }
            return (
              <Pressable
                key={i}
                onPress={() => onPressToken(i)}
                // 长按留给选词；设了 onLongPress 松手时才不会再当成点按
                onLongPress={noop}
                delayLongPress={400}
                style={({ pressed }) => [styles.token, { borderRadius: 4, backgroundColor: pressed || highlight === i ? c.accentSoft : 'transparent' }]}
              >
                {content}
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
});

const styles = StyleSheet.create({
  line: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'flex-end' },
  token: { flexDirection: 'row', alignItems: 'flex-end' },
  cell: { alignItems: 'center', justifyContent: 'flex-end' },
});
