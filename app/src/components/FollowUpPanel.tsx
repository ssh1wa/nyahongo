// 追问面板：翻译和练习共用
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { FollowUp } from '../lib/prompts';
import { radius, useColors } from '../theme';
import { RubyText } from './Ruby';
import { Button, SectionLabel } from './Ui';

export function FollowUpPanel({ turns, loading, onAsk }: { turns: FollowUp[]; loading: boolean; onAsk: (q: string) => Promise<boolean> }) {
  const c = useColors();
  const [input, setInput] = useState('');
  const submit = async () => {
    const q = input.trim();
    if (!q) return;
    if (await onAsk(q)) setInput('');
  };
  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>继续追问</SectionLabel>
      {turns.map((t, i) => (
        <View key={i} style={[styles.turn, { backgroundColor: c.surface2 }]}>
          <Text style={{ color: c.muted, fontSize: 12.5 }}>问：{t.question}</Text>
          <Text selectable style={{ color: c.ink, fontSize: 14.5, lineHeight: 22 }}>{t.answer}</Text>
          {t.examples.map((ex, j) => (
            <View key={j} style={{ gap: 2 }}>
              <RubyText segments={ex.japanese} size={16} zh={ex.chinese} />
              <Text style={{ color: c.muted, fontSize: 12.5 }}>{ex.chinese}</Text>
            </View>
          ))}
        </View>
      ))}
      <View style={styles.row}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder="哪里不明白？比如：这里为什么用は不用が"
          placeholderTextColor={c.muted}
          style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
          multiline
        />
        <Button label="提问" small onPress={submit} loading={loading} disabled={!input.trim()} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  turn: { padding: 12, borderRadius: radius.md, gap: 6 },
  row: { flexDirection: 'row', gap: 8, alignItems: 'flex-end' },
  input: { flex: 1, minHeight: 40, maxHeight: 110, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
});
