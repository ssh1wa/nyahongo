// 点词弹出的词条面板：JMdict 释义、加入生词本、就这一句问 AI
import { BookmarkCheck, BookmarkPlus, MessageCircleQuestion, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { award } from '../lib/game';
import { requestJson } from '../lib/llm';
import { followUpPrompt, shapeFollowUp, type FollowUp } from '../lib/prompts';
import { loadLlmSettings } from '../lib/settings';
import type { DictEntry, Sentence } from '../lib/types';
import { addFromToken, isSaved } from '../lib/wordbook';
import { radius, useColors } from '../theme';
import { RubyText } from './Ruby';
import { Button, ErrorNote, Tag } from './Ui';

export function EntryView({ entry }: { entry: DictEntry }) {
  const c = useColors();
  return (
    <View style={{ gap: 10 }}>
      {entry.senses.map((s, i) => (
        <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
          <Text style={{ color: c.muted, width: 16, fontSize: 13, paddingTop: 2 }}>{i + 1}.</Text>
          <View style={{ flex: 1, gap: 3 }}>
            {s.pos.length || s.tags.length ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
                {[...s.pos, ...s.tags].map((t) => <Tag key={t} label={t} />)}
              </View>
            ) : null}
            <Text style={{ color: c.ink, fontSize: 15.5, lineHeight: 22 }}>{s.zh || s.en.join('; ')}</Text>
            {s.zh ? <Text style={{ color: c.muted, fontSize: 12 }}>{s.en.join('; ')}</Text> : null}
          </View>
        </View>
      ))}
    </View>
  );
}

export function WordSheet({ sentence, tokenIndex, dictionary, packageId, onClose }: {
  sentence: Sentence; tokenIndex: number; dictionary: Record<string, DictEntry>; packageId: string; onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const token = sentence.tokens[tokenIndex];
  const entry = token.dict != null ? dictionary[String(token.dict)] ?? null : null;
  const [saved, setSaved] = useState(false);
  const [asking, setAsking] = useState(false);
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<FollowUp[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { isSaved(entry?.id).then(setSaved); }, [entry?.id]);

  const head = entry ? entry.kanji[0] || entry.readings[0] : token.base;
  const save = async () => {
    const added = await addFromToken(token, entry, sentence, packageId);
    setSaved(true);
    if (!added) setError('');
  };
  const ask = async () => {
    const q = question.trim() || `「${token.surface}」在这句话里是什么意思、什么用法？`;
    setLoading(true);
    setError('');
    try {
      const settings = await loadLlmSettings();
      const reply = await requestJson(settings, [
        { role: 'system', content: followUpPrompt('sentence') },
        {
          role: 'user',
          content: JSON.stringify({
            sentence: sentence.text,
            translation: sentence.zh ?? '',
            selectedWord: token.surface,
            dictionaryEntry: entry ? { word: head, readings: entry.readings, senses: entry.senses.map((s) => s.zh || s.en.join('; ')) } : null,
            previous: answers.slice(-4).map((a) => ({ question: a.question, answer: a.answer })),
            question: q,
          }),
        },
      ], (raw) => shapeFollowUp(raw, q), { temperature: 0.25 });
      award('ask');
      setAnswers((a) => [...a, reply]);
      setQuestion('');
    } catch (e) {
      setError(e instanceof Error ? e.message : '提问失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.headRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <Text style={{ color: c.ink, fontSize: 28, fontWeight: '800' }}>{head}</Text>
              <Text style={{ color: c.ruby, fontSize: 16 }}>{entry ? entry.readings.slice(0, 3).join('、') : token.reading ?? ''}</Text>
              {entry?.common ? <Tag label="常用词" tone="ok" /> : null}
            </View>
            {token.surface !== head ? <Text style={{ color: c.muted, fontSize: 12.5 }}>原文中的形式：{token.surface}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={c.muted} /></Pressable>
        </View>

        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 14 }} keyboardShouldPersistTaps="handled">
          {entry ? <EntryView entry={entry} /> : <Text style={{ color: c.muted }}>词典里没有这个词（人名、地名或数字通常查不到）</Text>}

          {answers.map((a, i) => (
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

        {asking ? (
          <View style={styles.askRow}>
            <TextInput
              value={question}
              onChangeText={setQuestion}
              placeholder={`例如：「${token.surface}」为什么用这个形式？`}
              placeholderTextColor={c.muted}
              style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
            />
            <Button label="提问" onPress={ask} loading={loading} small />
          </View>
        ) : null}

        <View style={styles.actions}>
          <Button
            label={saved ? '已在生词本' : '加入生词本'}
            kind={saved ? 'secondary' : 'primary'}
            disabled={saved}
            onPress={save}
            icon={saved ? <BookmarkCheck size={18} color={c.ok} /> : <BookmarkPlus size={18} color={c.accentInk} />}
            style={{ flex: 1 }}
          />
          <Button
            label="问 AI"
            kind="secondary"
            onPress={() => (asking ? ask() : setAsking(true))}
            loading={loading && !asking}
            icon={<MessageCircleQuestion size={18} color={c.ink} />}
            style={{ flex: 1 }}
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  answer: { padding: 12, borderRadius: radius.md, gap: 6 },
  askRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  input: { flex: 1, height: 40, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 10, fontSize: 14 },
  actions: { flexDirection: 'row', gap: 10 },
});
