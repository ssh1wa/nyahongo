// 汉字上方注音。React Native 没有 <ruby>，用「上读音 / 下正文」的竖排小块拼成可换行的一行。
// 修正旧版问题：没有读音的文字拆成单字排列，长串假名不会因为不能换行而溢出屏幕。
import React, { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { fonts, useColors, useScale } from '../theme';
import type { FuriganaSegment, Token } from '../lib/types';

type Common = {
  size?: number;
  color?: string;
  showRuby?: boolean;
  serif?: boolean;
};

function Cell({ text, reading, size, color, rubyColor, showRuby, serif }: {
  text: string; reading?: string | null; size: number; color: string; rubyColor: string; showRuby: boolean; serif: boolean;
}) {
  const rubySize = Math.max(8, Math.round(size * 0.46));
  return (
    <View style={styles.cell}>
      <Text
        numberOfLines={1}
        style={{ fontSize: rubySize, lineHeight: rubySize + 3, color: reading && showRuby ? rubyColor : 'transparent', textAlign: 'center' }}
      >
        {reading || ' '}
      </Text>
      <Text style={{ fontSize: size, lineHeight: Math.round(size * 1.35), color, fontFamily: serif ? fonts.jaSerif : undefined }}>{text}</Text>
    </View>
  );
}

/** 渲染注音分段（AI 回复里的例句、译文）。 */
export const RubyText = memo(function RubyText({ segments, size: baseSize = 20, color, showRuby = true, serif = false }: Common & { segments: FuriganaSegment[] }) {
  const c = useColors();
  const size = Math.round(baseSize * useScale()); // 设置里的日文字号
  if (!segments?.length) return null;
  const cells: FuriganaSegment[] = [];
  for (const seg of segments) {
    if (seg.reading) cells.push(seg);
    else for (const ch of Array.from(seg.text)) cells.push({ text: ch, reading: null });
  }
  return (
    <View style={styles.line} accessibilityLabel={segments.map((s) => s.text).join('')}>
      {kinsokuGroups(cells, (x) => x.text).map((group, i) => (
        <View key={i} style={styles.token}>
          {group.map((cell, j) => (
            <Cell key={j} {...cell} size={size} color={color ?? c.ink} rubyColor={c.ruby} showRuby={showRuby} serif={serif} />
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

/** 渲染学习包里分好词的句子，每个词可以点按查词。 */
export const TokenText = memo(function TokenText({
  tokens, size: baseSize = 20, color, showRuby = true, serif = false, onPressToken, highlight,
}: Common & { tokens: Token[]; onPressToken?: (index: number) => void; highlight?: number | null }) {
  const c = useColors();
  const size = Math.round(baseSize * useScale());
  // 英语学习包：没有注音，整句是一段普通文字，单词可以点（自然换行，不按词切块）
  if (tokens.length && !tokens[0].furigana) {
    return (
      <Text style={{ color: color ?? c.ink, fontSize: size, lineHeight: size * 1.45 }}>
        {tokens.map((t, i) => (t.word && onPressToken ? (
          <Text key={i} onPress={() => onPressToken(i)} style={highlight === i ? { backgroundColor: c.accentSoft, color: c.accent } : undefined}>{t.surface}</Text>
        ) : t.surface))}
      </Text>
    );
  }
  return (
    <View style={styles.line} accessibilityLabel={tokens.map((t) => t.surface).join('')}>
      {kinsokuGroups(tokens.map((t, i) => ({ t, i })), (x) => x.t.surface).map((group, g) => (
        // 标点和前面的词绑在一组，不会被单独换到下一行
        <View key={g} style={styles.token}>
          {group.map(({ t, i }) => {
            // 一个词内部不换行；词本身很长（超过一行）的情况极少
            const cells = (t.furigana ?? [{ text: t.surface }]).flatMap((seg) => (seg.reading ? [seg] : Array.from(seg.text).map((ch) => ({ text: ch, reading: null }))));
            const content = cells.map((cell, j) => (
              <Cell key={j} {...cell} size={size} color={color ?? c.ink} rubyColor={c.ruby} showRuby={showRuby} serif={serif} />
            ));
            if (!onPressToken || ['補助記号', '記号', '空白'].includes(t.pos ?? '')) {
              return <View key={i} style={styles.token}>{content}</View>;
            }
            return (
              <Pressable
                key={i}
                onPress={() => onPressToken(i)}
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
