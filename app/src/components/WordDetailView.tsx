// AI 详解的内容：释义和语感、用法、搭配、例句（带注音）、近义词辨析。生词本和查词面板共用
import React from 'react';
import { Text, View } from 'react-native';
import type { WordDetail } from '../lib/wordbook';
import { useColors } from '../theme';
import { RubyText } from './Ruby';

export function DetailView({ detail }: { detail: WordDetail }) {
  const c = useColors();
  return (
    <View style={{ gap: 14 }}>
      {detail.summary ? <Text selectable style={{ color: c.ink, fontSize: 15, lineHeight: 23, fontWeight: '600' }}>{detail.summary}</Text> : null}
      {detail.meanings.length ? (
        <View style={{ gap: 8 }}>
          {detail.meanings.map((m, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
              <Text style={{ color: c.muted, width: 16 }}>{i + 1}.</Text>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={{ color: c.ink, fontSize: 15 }}>{m.meaning}</Text>
                {m.note ? <Text selectable style={{ color: c.ink2, fontSize: 13, lineHeight: 19 }}>{m.note}</Text> : null}
              </View>
            </View>
          ))}
        </View>
      ) : null}
      {detail.usage.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink2, fontSize: 13, fontWeight: '700' }}>用法</Text>
          {detail.usage.map((u, i) => <Text key={i} style={{ color: c.ink, fontSize: 14, lineHeight: 21 }}>・{u}</Text>)}
        </View>
      ) : null}
      {detail.collocations.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink2, fontSize: 13, fontWeight: '700' }}>常见搭配</Text>
          {detail.collocations.map((x, i) => (
            <View key={i} style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }}>
              <Text style={{ color: c.ink, fontSize: 15 }}>{x.text}</Text>
              <Text style={{ color: c.muted, fontSize: 13.5 }}>{x.zh}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {detail.examples.length ? (
        <View style={{ gap: 10 }}>
          <Text style={{ color: c.ink2, fontSize: 13, fontWeight: '700' }}>例句</Text>
          {detail.examples.map((e, i) => (
            <View key={i} style={{ gap: 2 }}>
              <RubyText segments={e.segments} size={16} zh={e.zh} />
              <Text style={{ color: c.muted, fontSize: 13 }}>{e.zh}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {detail.similar.length ? (
        <View style={{ gap: 6 }}>
          <Text style={{ color: c.ink2, fontSize: 13, fontWeight: '700' }}>近义词辨析</Text>
          {detail.similar.map((x, i) => (
            <Text key={i} style={{ color: c.ink, fontSize: 14, lineHeight: 21 }}><Text selectable style={{ fontWeight: '700' }}>{x.word}</Text>：{x.diff}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}
