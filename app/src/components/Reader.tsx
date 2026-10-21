// 精读器：打开后逐批解析（注音、译文、重点词、语法），边解析边读；点句子看详情、查词、追问
import { ChevronLeft, Languages, MessageCircleQuestion, RefreshCw, Type, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { award } from '../lib/game';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { requestJson } from '../lib/llm';
import { followUpPrompt, shapeFollowUp, type FollowUp } from '../lib/prompts';
import { annotateArticle, countSentences, resetFailed, SOURCE_LABEL, updateArticle, type Article, type ReadingSentence } from '../lib/reading';
import { loadLlmSettings } from '../lib/settings';
import { radius, useColors, useScale, useTheme } from '../theme';
import { LookupSheet, type LookupWord } from './LookupSheet';
import { References } from './References';
import { RubyText } from './Ruby';
import { Button, ErrorNote, IconButton, SectionLabel, Tag } from './Ui';

export function Reader({ id, initial, onBack }: { id: number; initial: Article; onBack: () => void }) {
  const c = useColors();
  const scale = useScale();
  const { prefs } = useTheme();
  const [article, setArticle] = useState(initial);
  const [running, setRunning] = useState(false);
  const [showRuby, setShowRuby] = useState(prefs.showRuby);
  const [showZh, setShowZh] = useState(prefs.zhMode === 'show');
  const [selected, setSelected] = useState<{ p: number; i: number } | null>(null);
  const stopped = useRef(false);

  const total = countSentences(article);
  const done = article.paragraphs.flat().filter((s) => s.segments).length;
  const failed = article.paragraphs.flat().filter((s) => s.failed).length;

  const run = async (a: Article) => {
    if (running) return;
    setRunning(true);
    stopped.current = false;
    try {
      await annotateArticle(a, (next) => {
        setArticle(next);
        void updateArticle(id, next);
      }, () => stopped.current);
    } finally {
      setRunning(false);
    }
  };

  useEffect(() => {
    if (article.paragraphs.flat().some((s) => !s.segments && !s.failed)) void run(article);
    return () => { stopped.current = true; };
    // 只在打开时自动开始一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sel = selected ? article.paragraphs[selected.p]?.[selected.i] : null;

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}><ChevronLeft size={24} color={c.ink} /></Pressable>
        <View style={{ flex: 1 }}>
          <Text numberOfLines={1} style={{ color: c.ink, fontSize: 16, fontWeight: '800' }}>{article.title}</Text>
          <Text style={{ color: c.muted, fontSize: 11.5 }}>
            {SOURCE_LABEL[article.source]} · {article.level} · {running ? `解析中 ${done}/${total}` : done < total ? `已解析 ${done}/${total}` : `${total} 句`}
          </Text>
        </View>
        <IconButton label="注音" active={showRuby} onPress={() => setShowRuby((v) => !v)}><Type size={20} color={showRuby ? c.accent : c.ink2} /></IconButton>
        <IconButton label="译文" active={showZh} onPress={() => setShowZh((v) => !v)}><Languages size={20} color={showZh ? c.accent : c.ink2} /></IconButton>
      </View>
      {running ? (
        <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
          <View style={{ width: `${Math.round((done / Math.max(1, total)) * 100)}%`, height: '100%', backgroundColor: c.accent }} />
        </View>
      ) : null}

      <ScrollView
        contentContainerStyle={styles.page}
        scrollEventThrottle={400}
        onScroll={({ nativeEvent: e }) => {
          // 全部解析完、并且滑到了文末，算读完一篇
          if (done === total && total > 0 && e.contentOffset.y + e.layoutMeasurement.height >= e.contentSize.height - 80) award('article', String(id));
        }}
      >
        {article.paragraphs.map((para, p) => (
          <View key={p} style={styles.paragraph}>
            {para.map((s, i) => {
              const on = selected?.p === p && selected.i === i;
              return (
                <Pressable
                  key={i}
                  onPress={() => s.segments && setSelected({ p, i })}
                  style={[styles.sentence, on && { backgroundColor: c.accentSoft }]}
                >
                  {s.segments
                    ? <RubyText segments={s.segments} size={19} showRuby={showRuby} />
                    : <Text style={{ color: s.failed ? c.muted : c.ink2, fontSize: 19 * scale, lineHeight: 30 * scale }}>{s.text}</Text>}
                  {showZh && s.zh ? <Text style={{ color: c.muted, fontSize: 13.5, lineHeight: 20, marginTop: 2 }}>{s.zh}</Text> : null}
                </Pressable>
              );
            })}
          </View>
        ))}
        {failed && !running ? (
          <View style={{ gap: 8 }}>
            <ErrorNote message={`有 ${failed} 句解析失败（网络或模型出错）`} />
            <Button label="重试失败的句子" kind="secondary" onPress={() => { const a = resetFailed(article); setArticle(a); void run(a); }} icon={<RefreshCw size={16} color={c.ink} />} />
          </View>
        ) : null}
        {!running && done < total && !failed ? (
          <Button label="继续解析" onPress={() => run(article)} />
        ) : null}
        <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center', marginTop: 6 }}>点任意一句：看译文、重点词和语法，或者追问 AI</Text>
        {article.references?.length ? <References items={article.references} /> : null}
      </ScrollView>

      {sel && sel.segments ? (
        <SentenceSheet sentence={sel} level={article.level} onClose={() => setSelected(null)} />
      ) : null}
    </View>
  );
}

function SentenceSheet({ sentence, level, onClose }: { sentence: ReadingSentence; level: string; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [word, setWord] = useState<LookupWord | null>(null);
  const [asks, setAsks] = useState<FollowUp[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const ask = async () => {
    const question = q.trim() || '这句话的语法结构是怎样的？请逐个成分讲解。';
    setLoading(true); setError('');
    try {
      const settings = await loadLlmSettings();
      const reply = await requestJson(settings, [
        { role: 'system', content: followUpPrompt('sentence') },
        { role: 'user', content: JSON.stringify({ sentence: sentence.text, translation: sentence.zh, learnerLevel: level, previous: asks.slice(-4).map((a) => ({ question: a.question, answer: a.answer })), question }) },
      ], (raw) => shapeFollowUp(raw, question), { temperature: 0.25 });
      award('ask');
      setAsks((a) => [...a, reply]);
      setQ('');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 14 }]}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
          <View style={{ flex: 1 }}><RubyText segments={sentence.segments!} size={21} /></View>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={c.muted} /></Pressable>
        </View>
        <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          {sentence.zh ? <Text style={{ color: c.ink2, fontSize: 15, lineHeight: 22 }}>{sentence.zh}</Text> : null}
          {sentence.words?.length ? (
            <View style={{ gap: 8 }}>
              <SectionLabel>重点词（点开查词典）</SectionLabel>
              <View style={styles.words}>
                {sentence.words.map((w, i) => (
                  <Pressable key={i} onPress={() => setWord(w)} style={({ pressed }) => [styles.word, { backgroundColor: pressed ? c.accentSoft : c.surface2 }]}>
                    <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>{w.base || w.surface}</Text>
                    <Text style={{ color: c.ruby, fontSize: 12 }}>{w.reading}</Text>
                    <Text numberOfLines={1} style={{ color: c.ink2, fontSize: 12.5, maxWidth: 140 }}>{w.meaning}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ) : null}
          {sentence.grammar?.length ? (
            <View style={{ gap: 8 }}>
              <SectionLabel>语法</SectionLabel>
              {sentence.grammar.map((g, i) => (
                <View key={i} style={[styles.grammar, { borderColor: c.line }]}>
                  <Tag label={g.pattern} tone="accent" />
                  <Text style={{ color: c.ink2, fontSize: 14, lineHeight: 21 }}>{g.explanation}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {asks.map((a, i) => (
            <View key={i} style={[styles.answer, { backgroundColor: c.surface2 }]}>
              <Text style={{ color: c.muted, fontSize: 12.5 }}>问：{a.question}</Text>
              <Text style={{ color: c.ink, fontSize: 14.5, lineHeight: 22 }}>{a.answer}</Text>
              {a.examples.map((ex, j) => (
                <View key={j} style={{ gap: 2 }}>
                  <RubyText segments={ex.japanese} size={16} />
                  <Text style={{ color: c.muted, fontSize: 12.5 }}>{ex.chinese}</Text>
                </View>
              ))}
            </View>
          ))}
          {error ? <ErrorNote message={error} /> : null}
        </ScrollView>
        <View style={styles.askRow}>
          <TextInput
            value={q}
            onChangeText={setQ}
            placeholder="追问，比如：这里为什么用て形？"
            placeholderTextColor={c.muted}
            style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
          />
          <Button label="问 AI" small onPress={ask} loading={loading} icon={loading ? undefined : <MessageCircleQuestion size={16} color={c.accentInk} />} />
        </View>
      </View>
      {word ? <LookupSheet word={word} context={sentence.text} contextZh={sentence.zh} onClose={() => setWord(null)} /> : null}
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingHorizontal: 8, height: 58 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  bar: { height: 3, overflow: 'hidden' },
  page: { padding: 18, paddingBottom: 48, gap: 18 },
  paragraph: { gap: 4 },
  sentence: { paddingVertical: 6, paddingHorizontal: 8, borderRadius: 10, marginHorizontal: -8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 14 },
  words: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  word: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: radius.md, gap: 1 },
  grammar: { gap: 6, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, alignItems: 'flex-start' },
  answer: { padding: 12, borderRadius: radius.md, gap: 6 },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 42, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, fontSize: 14 },
});
