// 生词本 + FSRS 复习。复习卡片带原句，学习包还在手机上时可以回放原声。
import { useVideoPlayer } from 'expo-video';
import { Trash2, Volume2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, FlatList, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, SectionLabel, Title } from '../components/Ui';
import { EntryView } from '../components/WordSheet';
import { listLocal, mediaUri } from '../lib/packages';
import type { PackageMeta } from '../lib/types';
import { deleteWord, dueWords, GRADES, listWords, previewIntervals, review, type WordRow } from '../lib/wordbook';
import { radius, useColors } from '../theme';

export function WordbookScreen({ startReview, onReviewStarted }: { startReview?: boolean; onReviewStarted?: () => void }) {
  const c = useColors();
  const [words, setWords] = useState<WordRow[]>([]);
  const [queue, setQueue] = useState<WordRow[] | null>(null);
  const [packages, setPackages] = useState<Record<string, PackageMeta>>({});

  const refresh = useCallback(async () => {
    const [w, local] = await Promise.all([listWords(), listLocal()]);
    setWords(w);
    setPackages(Object.fromEntries(local.map((p) => [p.id, p])));
  }, []);
  useEffect(() => { void refresh(); }, [refresh]);

  const begin = useCallback(async () => setQueue(await dueWords(100)), []);
  useEffect(() => {
    if (startReview) { void begin(); onReviewStarted?.(); }
  }, [startReview, begin, onReviewStarted]);

  if (queue) {
    return (
      <Review
        queue={queue}
        packages={packages}
        onDone={() => { setQueue(null); void refresh(); }}
      />
    );
  }

  const now = Date.now();
  const due = words.filter((w) => w.due <= now).length;
  return (
    <FlatList
      data={words}
      keyExtractor={(w) => String(w.id)}
      contentContainerStyle={styles.content}
      ListHeaderComponent={
        <View style={{ gap: 14, marginBottom: 6 }}>
          <Title kicker="词条来自 JMdict 词典" title="生词本" />
          <Card style={{ gap: 10 }}>
            <Text style={{ color: c.ink, fontSize: 15 }}>
              共 {words.length} 个词，<Text style={{ color: c.accent, fontWeight: '800' }}>{due}</Text> 个到期需要复习
            </Text>
            <Button label={due ? `开始复习（${due}）` : '今天没有要复习的词'} disabled={!due} onPress={begin} />
          </Card>
          {words.length ? <SectionLabel>全部生词</SectionLabel> : (
            <Text style={{ color: c.muted, lineHeight: 21 }}>在播放器里点任意一个词，选「加入生词本」，就会出现在这里，并带上那句原文和原声。</Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <View style={[styles.row, { borderColor: c.line }]}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
              <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>{item.headword}</Text>
              <Text style={{ color: c.ruby, fontSize: 13 }}>{item.reading}</Text>
            </View>
            <Text numberOfLines={1} style={{ color: c.ink2, fontSize: 13 }}>
              {item.entry?.senses[0] ? item.entry.senses[0].zh || item.entry.senses[0].en.join('; ') : ''}
            </Text>
            <Text style={{ color: c.muted, fontSize: 11.5 }}>
              {item.due <= now ? '待复习' : `下次复习：${new Date(item.due).toLocaleDateString()}`}
            </Text>
          </View>
          <Pressable
            hitSlop={10}
            onPress={() => Alert.alert('删除生词', `从生词本删除「${item.headword}」？`, [
              { text: '取消', style: 'cancel' },
              { text: '删除', style: 'destructive', onPress: async () => { await deleteWord(item.id); void refresh(); } },
            ])}
          >
            <Trash2 size={17} color={c.muted} />
          </Pressable>
        </View>
      )}
    />
  );
}

function Review({ queue, packages, onDone }: { queue: WordRow[]; packages: Record<string, PackageMeta>; onDone: () => void }) {
  const c = useColors();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const word = queue[i];

  if (!word) {
    return (
      <View style={[styles.content, { flex: 1, justifyContent: 'center', gap: 16 }]}>
        <Title title="复习完成" />
        <Text style={{ color: c.ink2 }}>这一轮复习了 {queue.length} 个词。</Text>
        <Button label="回到生词本" onPress={onDone} />
      </View>
    );
  }

  const intervals = previewIntervals(word.card);
  const pkg = word.package_id ? packages[word.package_id] : undefined;
  const grade = async (g: (typeof GRADES)[number]['grade']) => {
    setBusy(true);
    try {
      await review(word, g);
      setShown(false);
      setI((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={[styles.content, { flex: 1 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={{ color: c.muted }}>{i + 1} / {queue.length}</Text>
        <Button label="结束" kind="ghost" small onPress={onDone} />
      </View>
      <Card style={{ flex: 1, padding: 0, overflow: 'hidden' }}>
        {/* 释义多的词（取る 这种）会超出卡片，所以卡片内容可以滚动 */}
        <ScrollView contentContainerStyle={{ gap: 14, padding: 16 }}>
        <Text style={{ color: c.ink, fontSize: 34, fontWeight: '800', textAlign: 'center', marginTop: 10 }}>{word.headword}</Text>
        {word.context ? (
          <Text style={{ color: c.ink2, fontSize: 16, lineHeight: 26, textAlign: 'center' }}>{word.context}</Text>
        ) : null}
        {pkg && word.clip_start != null && word.clip_end != null ? (
          <ClipButton meta={pkg} start={word.clip_start} end={word.clip_end} />
        ) : null}
        {shown ? (
          <View style={{ gap: 12, borderTopWidth: 1, borderColor: c.line, paddingTop: 14 }}>
            <Text style={{ color: c.ruby, fontSize: 18, textAlign: 'center' }}>{word.reading}</Text>
            {word.context_zh ? <Text style={{ color: c.muted, textAlign: 'center' }}>{word.context_zh}</Text> : null}
            {word.entry ? <EntryView entry={word.entry} /> : null}
          </View>
        ) : null}
        </ScrollView>
      </Card>
      {shown ? (
        <View style={styles.grades}>
          {GRADES.map((g) => (
            <Pressable
              key={g.grade}
              disabled={busy}
              onPress={() => grade(g.grade)}
              style={({ pressed }) => [styles.grade, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.7 : 1 }]}
            >
              <Text style={{ color: g.grade === 1 ? c.err : c.ink, fontWeight: '700' }}>{g.label}</Text>
              <Text style={{ color: c.muted, fontSize: 11 }}>{intervals[g.grade]}</Text>
            </Pressable>
          ))}
        </View>
      ) : (
        <Button label="显示答案" onPress={() => setShown(true)} style={{ marginTop: 12 }} />
      )}
    </View>
  );
}

/** 回放生词所在那一句的原声。 */
function ClipButton({ meta, start, end }: { meta: PackageMeta; start: number; end: number }) {
  const c = useColors();
  const player = useVideoPlayer(mediaUri(meta), (p) => { p.timeUpdateEventInterval = 0.1; });
  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime }) => {
      if (player.playing && currentTime >= end + 0.15) player.pause();
    });
    return () => sub.remove();
  }, [player, end]);
  return (
    <Pressable
      onPress={() => { player.currentTime = Math.max(0, start - 0.08); player.play(); }}
      style={[styles.clip, { backgroundColor: c.accentSoft }]}
    >
      <Volume2 size={18} color={c.accent} />
      <Text style={{ color: c.accent, fontWeight: '700' }}>听原句</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 10, paddingBottom: 40 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  grades: { flexDirection: 'row', gap: 8, marginTop: 12 },
  grade: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, gap: 2 },
  clip: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 8, borderRadius: 999 },
});
