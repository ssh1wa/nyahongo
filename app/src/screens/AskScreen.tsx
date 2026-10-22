// 语法页的「问 AI」：直接提问，回答里的日语句子带注音。对话存进记录，可以接着问
import { Clock3, MessageSquarePlus, Send, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RubyText } from '../components/Ruby';
import { Button, ErrorNote, SectionLabel } from '../components/Ui';
import { ask, type AskThread, type AskTurn } from '../lib/ask';
import { award } from '../lib/game';
import { addRecord, deleteRecord, listRecords, updateRecord, type RecordRow } from '../lib/records';
import { loadLlmSettings } from '../lib/settings';
import { useNav } from '../nav';
import { radius, useColors } from '../theme';

const SAMPLES = [
  '〜てしまう 和 〜ちゃう 有什么区别？',
  '在便利店想要一个袋子怎么说？',
  '怎么礼貌地拒绝同事的聚餐邀请？',
  'は 和 が 到底怎么分？',
];

export function AskScreen() {
  const c = useColors();
  const nav = useNav();
  const [thread, setThread] = useState<AskThread>({ turns: [] });
  const [recordId, setRecordId] = useState<number | null>(null);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [ruby, setRuby] = useState(true);
  const [history, setHistory] = useState<Array<RecordRow<AskThread>>>([]);
  const scroll = useRef<ScrollView>(null);

  const loadHistory = useCallback(() => listRecords<AskThread>('ask', 30).then(setHistory), []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const submit = async (text = input) => {
    const question = text.trim();
    if (!question || loading) return;
    const settings = await loadLlmSettings();
    if (!settings.apiKey) { nav.openSettings(); return; }
    setLoading(true); setError('');
    try {
      const turn = await ask(settings, thread, question);
      award('ask');
      const next = { turns: [...thread.turns, turn] };
      setThread(next);
      setInput('');
      if (recordId) await updateRecord(recordId, next);
      else setRecordId(await addRecord('ask', question, next));
      void loadHistory();
      setTimeout(() => scroll.current?.scrollToEnd({ animated: true }), 100);
    } catch (e) {
      setError(e instanceof Error ? e.message : '提问失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const newThread = () => { setThread({ turns: [] }); setRecordId(null); setInput(''); setError(''); };
  const remove = (h: RecordRow<AskThread>) => Alert.alert('删除对话', `删除「${h.title}」？`, [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: async () => { await deleteRecord(h.id); void loadHistory(); } },
  ]);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView ref={scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {thread.turns.length ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={() => setRuby((r) => !r)} style={[styles.chip, { backgroundColor: ruby ? c.accentSoft : c.surface2 }]}>
                <Text style={{ color: ruby ? c.accent : c.ink2, fontSize: 12.5, fontWeight: '700' }}>注音 {ruby ? '开' : '关'}</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={newThread} style={[styles.chip, { backgroundColor: c.surface2, flexDirection: 'row', gap: 4 }]}>
                <MessageSquarePlus size={14} color={c.ink2} />
                <Text style={{ color: c.ink2, fontSize: 12.5, fontWeight: '700' }}>新对话</Text>
              </Pressable>
            </View>
            {thread.turns.map((t, i) => <Turn key={i} turn={t} ruby={ruby} />)}
          </>
        ) : (
          <View style={{ gap: 12 }}>
            <Text selectable style={{ color: c.ink2, lineHeight: 21 }}>
              直接问语法、词的用法，或者「某个场合用日语怎么说」。回答里的日语句子会带注音，可以接着追问。
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {SAMPLES.map((s) => (
                <Pressable key={s} onPress={() => setInput(s)} style={[styles.sample, { borderColor: c.line }]}>
                  <Text style={{ color: c.ink2, fontSize: 13 }}>{s}</Text>
                </Pressable>
              ))}
            </View>
            {history.length ? <SectionLabel>以前的提问</SectionLabel> : null}
            {history.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => { setThread(h.data); setRecordId(h.id); }}
                onLongPress={() => remove(h)}
                style={[styles.history, { borderColor: c.line }]}
              >
                <Clock3 size={15} color={c.muted} />
                <Text numberOfLines={1} style={{ color: c.ink, flex: 1 }}>{h.title}</Text>
                {h.data.turns.length > 1 ? <Text style={{ color: c.muted, fontSize: 12 }}>{h.data.turns.length} 问</Text> : null}
                <Pressable onPress={() => remove(h)} hitSlop={8}><Trash2 size={14} color={c.muted} /></Pressable>
              </Pressable>
            ))}
          </View>
        )}
        {error ? <ErrorNote message={error} /> : null}
      </ScrollView>
      <View style={[styles.bar, { borderColor: c.line, backgroundColor: c.bg }]}>
        <TextInput
          value={input}
          onChangeText={setInput}
          placeholder={thread.turns.length ? '接着问…' : '问点什么'}
          placeholderTextColor={c.muted}
          multiline
          style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
        />
        <Button label="问" small onPress={() => submit()} loading={loading} disabled={!input.trim()} icon={<Send size={17} color={c.accentInk} />} />
      </View>
    </View>
  );
}

function Turn({ turn, ruby }: { turn: AskTurn; ruby: boolean }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      <View style={[styles.question, { backgroundColor: c.accentSoft }]}>
        <Text selectable style={{ color: c.ink, fontSize: 15, lineHeight: 22 }}>{turn.question}</Text>
      </View>
      {turn.blocks.map((b, i) => (b.type === 'text' ? (
        <Text key={i} selectable style={{ color: c.ink, fontSize: 15, lineHeight: 23.5 }}>{b.text}</Text>
      ) : (
        <View key={i} style={[styles.ja, { backgroundColor: c.surface2 }]}>
          <RubyText segments={b.japanese} size={17} showRuby={ruby} zh={b.chinese} />
          {b.chinese ? <Text style={{ color: c.ink2, fontSize: 13.5 }}>{b.chinese}</Text> : null}
          {b.note ? <Text selectable style={{ color: c.muted, fontSize: 12.5, lineHeight: 18 }}>{b.note}</Text> : null}
        </View>
      )))}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 24 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999, alignItems: 'center' },
  sample: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  history: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
  bar: { flexDirection: 'row', gap: 8, alignItems: 'flex-end', paddingHorizontal: 14, paddingVertical: 10, borderTopWidth: StyleSheet.hairlineWidth },
  input: { flex: 1, minHeight: 42, maxHeight: 120, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, paddingVertical: 9, fontSize: 15 },
  question: { alignSelf: 'flex-end', maxWidth: '88%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md },
  ja: { padding: 12, borderRadius: radius.md, gap: 4 },
});
