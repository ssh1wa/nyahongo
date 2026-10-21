// 一句一练（迁移自「ことば日和」）：出题会避开最近做过的句子，并优先用生词本里正在复习的词
import { Eye, Lightbulb, RefreshCw, Send, Target } from 'lucide-react-native';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { FollowUpPanel } from '../components/FollowUpPanel';
import { RubyText } from '../components/Ruby';
import { Button, Card, ErrorNote, Segmented, SectionLabel, Title } from '../components/Ui';
import { requestJson } from '../lib/llm';
import {
  followUpPrompt, practiceGradePrompt, practiceQuestionPrompt, shapeFollowUp, shapeGrade, shapeQuestion,
  type FollowUp, type PracticeDirection, type PracticeGrade, type PracticeQuestion,
} from '../lib/prompts';
import { addRecord, listRecords, updateRecord } from '../lib/records';
import { loadLlmSettings } from '../lib/settings';
import { dueWords } from '../lib/wordbook';
import { radius, useColors } from '../theme';

type Saved = { question: PracticeQuestion; answer: string; grade: PracticeGrade | null; revealed: boolean; followUps: FollowUp[] };

export function PracticeScreen({ onNeedSettings }: { onNeedSettings: () => void }) {
  const c = useColors();
  const [direction, setDirection] = useState<PracticeDirection>('zh-ja');
  const [question, setQuestion] = useState<PracticeQuestion | null>(null);
  const [answer, setAnswer] = useState('');
  const [grade, setGrade] = useState<PracticeGrade | null>(null);
  const [revealed, setRevealed] = useState(false);
  const [showHint, setShowHint] = useState(false);
  const [followUps, setFollowUps] = useState<FollowUp[]>([]);
  const [recordId, setRecordId] = useState<number | null>(null);
  const [loading, setLoading] = useState<'question' | 'grade' | 'ask' | null>(null);
  const [error, setError] = useState('');
  const [level, setLevel] = useState('N4');

  const newQuestion = async () => {
    const settings = await loadLlmSettings();
    if (!settings.apiKey) { onNeedSettings(); return; }
    setLevel(settings.level);
    setLoading('question');
    setError('');
    try {
      const [recent, due] = await Promise.all([listRecords<Saved>('practice', 30), dueWords(20)]);
      const avoid = recent.map((r) => r.data.question.sourceText).filter(Boolean);
      const focusWords = due.map((w) => w.headword).slice(0, 8);
      let q = await requestJson(settings, [
        { role: 'system', content: practiceQuestionPrompt(direction, settings.level, avoid, focusWords) },
        { role: 'user', content: 'Create one new exercise now. Return JSON.' },
      ], (raw) => shapeQuestion(raw, direction), { temperature: 0.85 });
      if (avoid.includes(q.sourceText)) {
        q = await requestJson(settings, [
          { role: 'system', content: practiceQuestionPrompt(direction, settings.level, avoid, focusWords) },
          { role: 'user', content: `The first draft repeated a recent sentence: ${q.sourceText}. Create a genuinely different exercise now. Return JSON.` },
        ], (raw) => shapeQuestion(raw, direction), { temperature: 0.9 });
      }
      if (!q.sourceText) throw new Error('出题失败：模型没有给出题目，请重试');
      setQuestion(q);
      setAnswer('');
      setGrade(null);
      setRevealed(false);
      setShowHint(false);
      setFollowUps([]);
      setRecordId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : '出题失败，请重试');
    } finally {
      setLoading(null);
    }
  };

  const submit = async () => {
    if (!question || !answer.trim()) return;
    setLoading('grade');
    setError('');
    try {
      const settings = await loadLlmSettings();
      const g = await requestJson(settings, [
        { role: 'system', content: practiceGradePrompt(question.direction) },
        { role: 'user', content: JSON.stringify({ question, learnerAnswer: answer.trim() }) },
      ], shapeGrade, { temperature: 0.2 });
      setGrade(g);
      setRecordId(await addRecord<Saved>('practice', question.sourceText, { question, answer: answer.trim(), grade: g, revealed: false, followUps: [] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '评分失败，请重试');
    } finally {
      setLoading(null);
    }
  };

  const reveal = async () => {
    if (!question) return;
    setRevealed(true);
    setRecordId(await addRecord<Saved>('practice', question.sourceText, { question, answer: answer.trim(), grade: null, revealed: true, followUps: [] }));
  };

  const ask = async (q: string) => {
    if (!question) return false;
    setLoading('ask');
    setError('');
    try {
      const settings = await loadLlmSettings();
      const reply = await requestJson(settings, [
        { role: 'system', content: followUpPrompt('practice') },
        {
          role: 'user',
          content: JSON.stringify({
            exercise: question, learnerAnswer: answer.trim(), grade, answerWasRevealed: revealed,
            previousFollowUps: followUps.slice(-6).map((t) => ({ question: t.question, answer: t.answer })), question: q,
          }),
        },
      ], (raw) => shapeFollowUp(raw, q), { temperature: 0.25 });
      const next = [...followUps, reply];
      setFollowUps(next);
      if (recordId) await updateRecord<Saved>(recordId, { question, answer: answer.trim(), grade, revealed, followUps: next });
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : '追问失败，请重试');
      return false;
    } finally {
      setLoading(null);
    }
  };

  const done = !!grade || revealed;
  const reference = question
    ? question.direction === 'zh-ja'
      ? (grade?.correctJapanese.length ? grade.correctJapanese : question.referenceJapanese)
      : null
    : null;
  const scoreColor = grade ? (grade.score >= 90 ? c.ok : grade.score >= 70 ? c.warn : c.accent) : c.ink;

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title kicker="一句一练" title="先自己想，再看答案" />
        <Segmented
          options={[{ value: 'zh-ja', label: '中 → 日' }, { value: 'ja-zh', label: '日 → 中' }]}
          value={direction}
          onChange={(d) => { setDirection(d); setQuestion(null); }}
        />

        {!question ? (
          <Card style={{ gap: 12, alignItems: 'center', paddingVertical: 28 }}>
            <Target size={30} color={c.accent} />
            <Text style={{ color: c.ink2, textAlign: 'center', lineHeight: 21 }}>每题聚焦一个日常语法点。生词本里正在复习的词会优先出现在题目里。</Text>
            <Button label="出一道题" onPress={newQuestion} loading={loading === 'question'} icon={<RefreshCw size={17} color={c.accentInk} />} style={{ alignSelf: 'stretch' }} />
          </Card>
        ) : (
          <View style={{ gap: 16 }}>
            <View style={[styles.question, { borderColor: c.ink }]}>
              <Text style={{ color: c.accent, fontSize: 11, fontWeight: '800' }}>QUESTION · {level}</Text>
              {question.direction === 'ja-zh' && question.sourceJapanese.length
                ? <RubyText segments={question.sourceJapanese} size={22} serif />
                : <Text selectable style={{ color: c.ink, fontSize: 21, lineHeight: 30, fontWeight: '600' }}>{question.sourceText}</Text>}
              {question.focus ? <Text style={{ color: c.muted, fontSize: 12.5 }}>考点：{question.focus}</Text> : null}
            </View>

            {!done ? (
              <View style={{ gap: 10 }}>
                <TextInput
                  value={answer}
                  onChangeText={setAnswer}
                  placeholder={question.direction === 'zh-ja' ? '输入你的日文翻译' : '输入你的中文翻译'}
                  placeholderTextColor={c.muted}
                  multiline
                  textAlignVertical="top"
                  style={[styles.answer, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
                />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                  <Pressable onPress={() => setShowHint((v) => !v)} style={styles.tool}>
                    <Lightbulb size={16} color={c.warn} />
                    <Text style={{ color: c.warn, fontWeight: '700' }}>{showHint ? '收起提示' : '给点提示'}</Text>
                  </Pressable>
                  <Pressable onPress={reveal} style={styles.tool}>
                    <Eye size={16} color={c.ink2} />
                    <Text style={{ color: c.ink2, fontWeight: '700' }}>直接看答案</Text>
                  </Pressable>
                </View>
                {showHint && question.hint ? <Text style={[styles.hint, { backgroundColor: c.warnSoft, color: c.ink }]}>{question.hint}</Text> : null}
                <Button label="提交评分" onPress={submit} loading={loading === 'grade'} disabled={!answer.trim()} icon={<Send size={17} color={c.accentInk} />} />
              </View>
            ) : (
              <View style={{ gap: 14 }}>
                {answer.trim() ? (
                  <Card style={{ gap: 4 }}>
                    <Text style={{ color: c.muted, fontSize: 11.5 }}>你的翻译</Text>
                    <Text selectable style={{ color: c.ink, fontSize: 16, lineHeight: 24 }}>{answer.trim()}</Text>
                  </Card>
                ) : null}
                {grade ? (
                  <View style={styles.scoreRow}>
                    <Text style={{ color: scoreColor, fontSize: 52, fontWeight: '800' }}>{grade.score}</Text>
                    <View style={{ flex: 1, gap: 4 }}>
                      <Text style={{ color: c.ink, fontSize: 17, fontWeight: '800' }}>{{ excellent: '表达很自然', good: '基本正确', retry: '再调整一下' }[grade.verdict]}</Text>
                      <Text style={{ color: c.ink2, fontSize: 13, lineHeight: 19 }}>{grade.feedback}</Text>
                    </View>
                  </View>
                ) : null}
                {grade?.strengths.length ? (
                  <View style={{ gap: 4 }}>
                    <SectionLabel>做对了</SectionLabel>
                    {grade.strengths.map((s, i) => <Text key={i} style={{ color: c.ink2, lineHeight: 21 }}>· {s}</Text>)}
                  </View>
                ) : null}
                {grade?.corrections.length ? (
                  <View style={{ gap: 4 }}>
                    <SectionLabel>可以改进</SectionLabel>
                    {grade.corrections.map((s, i) => <Text key={i} style={{ color: c.ink2, lineHeight: 21 }}>· {s}</Text>)}
                  </View>
                ) : null}
                <View style={[styles.reference, { backgroundColor: c.okSoft }]}>
                  <Text style={{ color: c.ok, fontSize: 11.5, fontWeight: '800' }}>参考答案</Text>
                  {reference?.length
                    ? <RubyText segments={reference} size={19} />
                    : <Text selectable style={{ color: c.ink, fontSize: 17, lineHeight: 25 }}>{grade?.correctChinese || question.referenceChinese}</Text>}
                </View>
                {grade?.grammarTip || question.answerNote ? (
                  <Text style={{ color: c.ink2, lineHeight: 21 }}>💡 {grade?.grammarTip || question.answerNote}</Text>
                ) : null}
                <FollowUpPanel turns={followUps} loading={loading === 'ask'} onAsk={ask} />
                <Button label="下一题" onPress={newQuestion} loading={loading === 'question'} icon={<RefreshCw size={17} color={c.accentInk} />} />
              </View>
            )}
          </View>
        )}
        {error ? <ErrorNote message={error} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 16, paddingBottom: 40 },
  question: { borderTopWidth: 2, borderBottomWidth: 1, paddingVertical: 16, gap: 10 },
  answer: { minHeight: 110, borderWidth: 1, borderRadius: radius.md, padding: 12, fontSize: 16, lineHeight: 24 },
  tool: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 8 },
  hint: { padding: 12, borderRadius: radius.sm, lineHeight: 20 },
  scoreRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  reference: { padding: 14, borderRadius: radius.md, gap: 8 },
});
