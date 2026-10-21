// 中日互译 + 词汇语法拆解 + 追问（迁移自「ことば日和」）
import { Clock3, Send } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FollowUpPanel } from '../components/FollowUpPanel';
import { RubyText } from '../components/Ruby';
import { LookupSheet, type LookupWord } from '../components/LookupSheet';
import { Button, Card, ErrorNote, ScreenHeader, SectionLabel } from '../components/Ui';
import { useNav } from '../nav';
import { requestJson } from '../lib/llm';
import { followUpPrompt, shapeFollowUp, shapeTranslation, TRANSLATION_PROMPT, type FollowUp, type TranslationResult } from '../lib/prompts';
import { addRecord, listRecords, updateRecord, type RecordRow } from '../lib/records';
import { loadLlmSettings } from '../lib/settings';
import { radius, useColors } from '../theme';

type Saved = { query: string; result: TranslationResult; followUps: FollowUp[] };

export function TranslateScreen() {
  const c = useColors();
  const nav = useNav();
  const onNeedSettings = nav.openSettings;
  const [lookup, setLookup] = useState<LookupWord | null>(null);
  const [input, setInput] = useState('');
  // 已提交的查询：追问和记录都用它，不用输入框里可能已经改过的内容（旧 App 的 bug）
  const [current, setCurrent] = useState<Saved | null>(null);
  const [recordId, setRecordId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const [askLoading, setAskLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<Array<RecordRow<Saved>>>([]);

  const loadHistory = useCallback(() => listRecords<Saved>('translation', 20).then(setHistory), []);
  useEffect(() => { void loadHistory(); }, [loadHistory]);

  const translate = async () => {
    const query = input.trim();
    if (!query || loading) return;
    const settings = await loadLlmSettings();
    if (!settings.apiKey) { onNeedSettings(); return; }
    setLoading(true);
    setError('');
    try {
      const result = await requestJson(settings, [
        { role: 'system', content: TRANSLATION_PROMPT },
        { role: 'user', content: query },
      ], (raw) => shapeTranslation(raw, query), { temperature: 0.25 });
      const saved = { query, result, followUps: [] };
      setCurrent(saved);
      setRecordId(await addRecord('translation', query, saved));
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : '翻译失败，请重试');
    } finally {
      setLoading(false);
    }
  };

  const ask = async (question: string) => {
    if (!current) return false;
    setAskLoading(true);
    setError('');
    try {
      const settings = await loadLlmSettings();
      const reply = await requestJson(settings, [
        { role: 'system', content: followUpPrompt('translation') },
        {
          role: 'user',
          content: JSON.stringify({
            source: current.query,
            translationResult: current.result,
            previousFollowUps: current.followUps.slice(-6).map((t) => ({ question: t.question, answer: t.answer })),
            question,
          }),
        },
      ], (raw) => shapeFollowUp(raw, question), { temperature: 0.25 });
      const next = { ...current, followUps: [...current.followUps, reply] };
      setCurrent(next);
      if (recordId) await updateRecord(recordId, next);
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '追问失败，请重试');
      return false;
    } finally {
      setAskLoading(false);
    }
  };

  const r = current?.result;
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <ScreenHeader kicker="中文 ⇄ 日本語" title="翻译" />
        <Card style={{ gap: 12 }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="输入中文或日文句子"
            placeholderTextColor={c.muted}
            multiline
            textAlignVertical="top"
            style={[styles.input, { color: c.ink }]}
          />
          <Button label="翻译并拆解" onPress={translate} loading={loading} disabled={!input.trim()} icon={<Send size={17} color={c.accentInk} />} />
        </Card>

        {error ? <ErrorNote message={error} /> : null}

        {r && current ? (
          <View style={{ gap: 18 }}>
            <View style={[styles.result, { borderColor: c.ink }]}>
              <Text style={{ color: c.muted, fontSize: 12 }}>{r.direction === 'zh-ja' ? '日语译文' : '中文译文'} · 原文：{current.query}</Text>
              {r.direction === 'zh-ja' ? <RubyText segments={r.translationJapanese} size={22} serif /> : <Text selectable style={{ color: c.ink, fontSize: 19, lineHeight: 28 }}>{r.translationChinese}</Text>}
              {r.naturalNote ? <Text selectable style={{ color: c.ink2, fontSize: 13.5, lineHeight: 20 }}>{r.naturalNote}</Text> : null}
            </View>

            {r.words.length ? (
              <View style={{ gap: 6 }}>
                <SectionLabel>词汇（点开查词典）</SectionLabel>
                {r.words.map((w, i) => (
                  <Pressable
                    key={i}
                    onPress={() => setLookup({ surface: w.surface, base: w.surface, reading: w.reading, meaning: w.meaning })}
                    style={({ pressed }) => [styles.word, { borderColor: c.line, opacity: pressed ? 0.6 : 1 }]}
                  >
                    <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
                      <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>{w.surface}</Text>
                      {w.reading ? <Text style={{ color: c.ruby, fontSize: 12 }}>{w.reading}</Text> : null}
                    </View>
                    <View style={{ flex: 1.2, alignItems: 'flex-end' }}>
                      <Text style={{ color: c.ink2, fontSize: 13, textAlign: 'right' }}>{w.meaning}</Text>
                      <Text style={{ color: c.muted, fontSize: 11 }}>{w.partOfSpeech}</Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {r.grammar.length ? (
              <View style={{ gap: 10 }}>
                <SectionLabel>语法</SectionLabel>
                {r.grammar.map((g, i) => (
                  <Card key={i} style={{ gap: 6 }}>
                    <Text style={{ color: c.ink, fontSize: 16, fontWeight: '800' }}>{g.pattern}</Text>
                    {g.meaning ? <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>{g.meaning}</Text> : null}
                    <Text style={{ color: c.ink2, fontSize: 14, lineHeight: 21 }}>{g.explanation}</Text>
                    {g.example.length ? (
                      <View style={[styles.example, { backgroundColor: c.surface2 }]}>
                        <RubyText segments={g.example} size={16} />
                        {g.exampleMeaning ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{g.exampleMeaning}</Text> : null}
                      </View>
                    ) : null}
                  </Card>
                ))}
              </View>
            ) : null}

            <FollowUpPanel turns={current.followUps} loading={askLoading} onAsk={ask} />
          </View>
        ) : (
          <View style={{ gap: 6 }}>
            {history.length ? <SectionLabel>最近查询</SectionLabel> : null}
            {history.map((h) => (
              <Pressable
                key={h.id}
                onPress={() => { setCurrent(h.data); setRecordId(h.id); setInput(h.data.query); }}
                style={[styles.history, { borderColor: c.line }]}
              >
                <Clock3 size={15} color={c.muted} />
                <Text numberOfLines={1} style={{ color: c.ink, flex: 1 }}>{h.title}</Text>
              </Pressable>
            ))}
          </View>
        )}
      </ScrollView>
      {lookup && current ? (
        <LookupSheet
          word={lookup}
          context={current.result.direction === 'ja-zh' ? current.query : current.result.translationJapanese.map((s) => s.text).join('')}
          contextZh={current.result.direction === 'ja-zh' ? current.result.translationChinese : current.query}
          onClose={() => setLookup(null)}
        />
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 40 },
  input: { minHeight: 96, fontSize: 17, lineHeight: 25, padding: 0 },
  result: { borderTopWidth: 2, borderBottomWidth: 1, paddingVertical: 16, gap: 10 },
  word: { flexDirection: 'row', gap: 12, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  example: { padding: 10, borderRadius: radius.sm, gap: 4 },
  history: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 11, borderBottomWidth: StyleSheet.hairlineWidth },
});
