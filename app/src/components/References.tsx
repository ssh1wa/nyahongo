// 参考资料列表（AI 联网写读物时用到的网页），点开原网页
import { ExternalLink } from 'lucide-react-native';
import React from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { useColors } from '../theme';
import { SectionLabel } from './Ui';

export type Reference = { title: string; url: string; site?: string };

export function References({ items }: { items: Reference[] }) {
  const c = useColors();
  if (!items.length) return null;
  return (
    <View style={{ gap: 6 }}>
      <SectionLabel>参考资料</SectionLabel>
      {items.map((r, i) => (
        <Pressable key={r.url} onPress={() => Linking.openURL(r.url)} style={({ pressed }) => [styles.row, { borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}>
          <Text style={{ color: c.muted, fontSize: 12, width: 18 }}>{i + 1}</Text>
          <View style={{ flex: 1 }}>
            <Text numberOfLines={1} style={{ color: c.ink, fontSize: 13.5 }}>{r.title}</Text>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 11.5 }}>{r.site || r.url.replace(/^https?:\/\//, '').split('/')[0]}</Text>
          </View>
          <ExternalLink size={14} color={c.muted} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, borderBottomWidth: StyleSheet.hairlineWidth },
});
