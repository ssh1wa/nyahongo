// 生词本 + FSRS 复习。分「生词」和「已掌握」两个词本：FSRS 判断记得很牢的词自动移到已掌握，也可以手动来回移。
// 点开一个词：词典释义、原句、AI 详细讲解（第一次点开时生成，存起来）。
import { BookMarked, CheckCheck, RefreshCw, RotateCcw, Sparkles, Trash2, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Card, EmptyState, ErrorNote, ScreenHeader, Segmented, SectionLabel, sheetBottom, Tag, Title } from '../components/Ui';
import { DetailView } from '../components/WordDetailView';
import { EntryView } from '../components/WordSheet';
import { onSynced } from '../lib/sync';
import { wordDetail } from '../lib/wordDetail';
import {
  deleteWord, dueWords, GRADES, listWords, MASTERED_STABILITY_DAYS, previewIntervals, review, setMastered, stats,
  type WordDetail, type WordRow,
} from '../lib/wordbook';
import { radius, useColors } from '../theme';

export function WordbookScreen({ active }: { active: boolean }) {
  const c = useColors();
  const [words, setWords] = useState<WordRow[]>([]);
  const [queue, setQueue] = useState<WordRow[] | null>(null);
  const [st, setSt] = useState({ total: 0, due: 0, reviewedToday: 0, streak: 0, mastered: 0 });
  const [tab, setTab] = useState<'learning' | 'mastered'>('learning');
  const [open, setOpen] = useState<WordRow | null>(null);

  const refresh = useCallback(async () => {
    const [w, s] = await Promise.all([listWords(), stats()]);
    setWords(w);
    setSt(s);
  }, []);
  // 每次切到生词本都刷新：别的页面可能刚加了词
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useEffect(() => onSynced((r) => { if (r.changes) void refresh(); }), [refresh]); // 别的设备同步过来的

  const begin = useCallback(async () => setQueue(await dueWords(100)), []);

  if (queue) {
    return (
      <Review
        queue={queue}
        onDone={() => { setQueue(null); void refresh(); }}
      />
    );
  }

  const now = Date.now();
  const due = st.due;
  const shown = words.filter((w) => (tab === 'mastered') === w.mastered);
  return (
    <>
      <FlatList
        data={shown}
        keyExtractor={(w) => String(w.id)}
        contentContainerStyle={styles.content}
        ListHeaderComponent={
          <View style={{ gap: 14, marginBottom: 6 }}>
            <ScreenHeader kicker="间隔复习 · FSRS" title="生词本" />
            <Card style={{ gap: 14 }}>
              <View style={styles.stats}>
                <Stat value={due} label="待复习" highlight />
                <Stat value={st.reviewedToday} label="今天已复习" />
                <Stat value={st.streak} label="连续天数" />
                <Stat value={st.mastered} label="已掌握" />
              </View>
              <Button label={due ? `开始复习（${due}）` : '今天的复习都完成了'} disabled={!due} onPress={begin} />
            </Card>
            {words.length ? (
              <Segmented
                options={[{ value: 'learning', label: `生词 ${st.total}` }, { value: 'mastered', label: `已掌握 ${st.mastered}` }]}
                value={tab}
                onChange={setTab}
              />
            ) : (
              <EmptyState
                icon={<BookMarked size={26} color={c.accent} />}
                title="生词本还是空的"
                text="在精听、阅读、翻译里点开一个词，选「加入生词本」。词条来自词典，会带上你遇到它的那句原文。"
              />
            )}
            {words.length && !shown.length ? (
              <Text selectable style={{ color: c.muted, fontSize: 13, lineHeight: 19 }}>
                {tab === 'mastered'
                  ? `还没有掌握的词。复习时一直记得、预计 ${MASTERED_STABILITY_DAYS} 天以上都不会忘的词会自动移到这里，也可以在词的详情里手动移过来。`
                  : '生词都掌握了。'}
              </Text>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <Pressable onPress={() => setOpen(item)} style={({ pressed }) => [styles.row, { borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}>
            <View style={{ flex: 1, gap: 2 }}>
              <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                <Text style={{ color: c.ink, fontSize: 17, fontWeight: '700' }}>{item.headword}</Text>
                <Text style={{ color: c.ruby, fontSize: 13 }}>{item.reading}</Text>
              </View>
              <Text numberOfLines={1} style={{ color: c.ink2, fontSize: 13 }}>
                {item.entry?.senses[0] ? item.entry.senses[0].zh || item.entry.senses[0].en.join('; ') : ''}
              </Text>
              <Text style={{ color: c.muted, fontSize: 11.5 }}>
                {item.mastered ? '已掌握' : item.due <= now ? '待复习' : `下次复习：${new Date(item.due).toLocaleDateString()}`}
              </Text>
            </View>
            {item.detail ? <Sparkles size={15} color={c.accent} /> : null}
          </Pressable>
        )}
      />
      {open ? (
        <WordDetailSheet
          word={open}
          onClose={() => setOpen(null)}
          onChanged={(w) => { setOpen(w); void refresh(); }}
          onDeleted={() => { setOpen(null); void refresh(); }}
        />
      ) : null}
    </>
  );
}

// ---------- 词的详情 ----------

function WordDetailSheet({ word, onClose, onChanged, onDeleted }: {
  word: WordRow; onClose: () => void; onChanged: (w: WordRow) => void; onDeleted: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [detail, setDetail] = useState<WordDetail | null>(word.detail);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const generate = useCallback(async (force = false) => {
    setLoading(true); setError('');
    try {
      const d = await wordDetail(word, force);
      setDetail(d);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [word]);
  // 第一次点开自动生成
  useEffect(() => { if (!word.detail) void generate(); }, [word.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const move = async () => {
    await setMastered(word.id, !word.mastered);
    onChanged({ ...word, mastered: !word.mastered, detail });
  };
  const remove = () => Alert.alert('删除生词', `从生词本删除「${word.headword}」？`, [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: async () => { await deleteWord(word.id); onDeleted(); } },
  ]);

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: sheetBottom(insets, 14) }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <Text style={{ color: c.ink, fontSize: 28, fontWeight: '800' }}>{word.headword}</Text>
              <Text style={{ color: c.ruby, fontSize: 16 }}>{word.reading}</Text>
              {word.mastered ? <Tag label="已掌握" tone="ok" /> : null}
            </View>
          </View>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={c.muted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 16, paddingBottom: 8 }}>
          {word.context ? (
            <View style={[styles.context, { backgroundColor: c.surface2 }]}>
              <Text selectable style={{ color: c.ink, fontSize: 15.5, lineHeight: 24 }}>{word.context}</Text>
              {word.context_zh ? <Text style={{ color: c.muted, fontSize: 13 }}>{word.context_zh}</Text> : null}
            </View>
          ) : null}
          {word.entry ? (
            <View style={{ gap: 8 }}>
              <SectionLabel>词典</SectionLabel>
              <EntryView entry={word.entry} />
            </View>
          ) : null}
          <View style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center' }}>
              <View style={{ flex: 1 }}><SectionLabel>AI 详细讲解</SectionLabel></View>
              {detail && !loading ? <Pressable onPress={() => generate(true)} hitSlop={8}><RefreshCw size={15} color={c.muted} /></Pressable> : null}
            </View>
            {loading ? (
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <ActivityIndicator color={c.accent} />
                <Text style={{ color: c.muted }}>正在生成释义、用法和例句…</Text>
              </View>
            ) : null}
            {error ? <ErrorNote message={error} /> : null}
            {error && !loading ? <Button label="重试" kind="secondary" small onPress={() => generate(true)} /> : null}
            {detail && !loading ? <DetailView detail={detail} /> : null}
          </View>
        </ScrollView>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button
            label={word.mastered ? '移回生词本' : '移到已掌握'}
            kind="secondary"
            onPress={move}
            icon={word.mastered ? <RotateCcw size={16} color={c.ink} /> : <CheckCheck size={16} color={c.ink} />}
            style={{ flex: 1 }}
          />
          <Button label="删除" kind="danger" onPress={remove} icon={<Trash2 size={16} color={c.err} />} />
        </View>
      </View>
    </Modal>
  );
}

// ---------- 复习 ----------

function Review({ queue, onDone }: { queue: WordRow[]; onDone: () => void }) {
  const c = useColors();
  const [i, setI] = useState(0);
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [masteredNow, setMasteredNow] = useState<string[]>([]);
  const word = queue[i];

  if (!word) {
    return (
      <View style={[styles.content, { flex: 1, justifyContent: 'center', gap: 16 }]}>
        <Title title="复习完成" />
        <Text style={{ color: c.ink2 }}>这一轮复习了 {queue.length} 个词。</Text>
        {masteredNow.length ? (
          <Text selectable style={{ color: c.ok, lineHeight: 21 }}>已经记得很牢、移到「已掌握」的词：{masteredNow.join('、')}</Text>
        ) : null}
        <Button label="回到生词本" onPress={onDone} />
      </View>
    );
  }

  const intervals = previewIntervals(word.card);
  const grade = async (g: (typeof GRADES)[number]['grade']) => {
    setBusy(true);
    try {
      if (await review(word, g)) setMasteredNow((m) => [...m, word.headword]);
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
          <Text selectable style={{ color: c.ink2, fontSize: 16, lineHeight: 26, textAlign: 'center' }}>{word.context}</Text>
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

function Stat({ value, label, highlight }: { value: number; label: string; highlight?: boolean }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, alignItems: 'center', gap: 2 }}>
      <Text style={{ color: highlight && value ? c.accent : c.ink, fontSize: 24, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 11.5 }}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 10, paddingBottom: 40 },
  stats: { flexDirection: 'row' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12, borderBottomWidth: StyleSheet.hairlineWidth },
  grades: { flexDirection: 'row', gap: 8, marginTop: 12 },
  grade: { flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: radius.md, borderWidth: 1, gap: 2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { maxHeight: '88%', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 14 },
  context: { padding: 12, borderRadius: radius.md, gap: 6 },
});
