// 语法：按水平排好的课程（单元 → 语法点 → 课文 + 测验）+ 一句一练
import { BookCheck, Check, ChevronLeft, ChevronRight, CircleDot, GraduationCap, RefreshCw, Search, Sparkles } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { award } from '../lib/game';
import { ActivityIndicator, Alert, BackHandler, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { RubyText } from '../components/Ruby';
import { Button, Card, EmptyState, ErrorNote, ScreenHeader, Segmented, SectionLabel, Tag } from '../components/Ui';
import {
  ATTRIBUTION, cleanTitle, designCourse, getPoint, GRAMMAR_LEVELS, loadCourse, loadLesson, loadZhMeanings, pointsOf, progressMap, setStatus,
  toGrammarLevel, translateMeanings,
  type GrammarLevel, type Lesson, type Progress, type Unit,
} from '../lib/grammar';
import { loadLlmSettings, saveLevel } from '../lib/settings';
import { radius, useColors } from '../theme';
import { AskScreen } from './AskScreen';
import { PracticeScreen } from './PracticeScreen';

type Route = { kind: 'course' } | { kind: 'unit'; index: number } | { kind: 'lesson'; id: string; unit?: number };

export function GrammarScreen() {
  const c = useColors();
  const [tab, setTab] = useState<'course' | 'practice' | 'ask'>('course');
  const [level, setLevel] = useState<GrammarLevel>('N4');
  const [course, setCourse] = useState<Unit[] | null | undefined>(undefined);
  const [progress, setProgress] = useState<Record<string, Progress>>({});
  const [route, setRoute] = useState<Route>({ kind: 'course' });
  const [zh, setZh] = useState<Record<string, string>>({});

  useEffect(() => { loadLlmSettings().then((s) => setLevel(toGrammarLevel(s.level))); }, []);
  const reload = useCallback(async () => {
    setCourse(await loadCourse(level));
    setProgress(await progressMap());
    setZh(await loadZhMeanings(level));
  }, [level]);
  useEffect(() => { setCourse(undefined); void reload(); }, [reload]);

  // 课程已经排好但还没有中文简述（比如之前版本排的课），在后台补上
  const translating = useRef('');
  useEffect(() => {
    if (!course || Object.keys(zh).length || translating.current === level) return;
    translating.current = level;
    translateMeanings(level).then(setZh).catch(() => { translating.current = ''; });
  }, [course, zh, level]);

  useEffect(() => {
    if (route.kind === 'course') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setRoute(route.kind === 'lesson' && route.unit !== undefined ? { kind: 'unit', index: route.unit } : { kind: 'course' });
      void reload();
      return true;
    });
    return () => sub.remove();
  }, [route, reload]);

  if (route.kind === 'lesson') {
    return (
      <LessonView
        id={route.id}
        onBack={() => { setRoute(route.unit !== undefined ? { kind: 'unit', index: route.unit } : { kind: 'course' }); void reload(); }}
      />
    );
  }
  if (route.kind === 'unit' && course) {
    return (
      <UnitView
        unit={course[route.index]}
        index={route.index}
        progress={progress}
        zh={zh}
        onBack={() => setRoute({ kind: 'course' })}
        onOpen={(id) => setRoute({ kind: 'lesson', id, unit: route.index })}
      />
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.top}>
        <ScreenHeader kicker="语法" title={tab === 'course' ? '语法课程' : tab === 'practice' ? '一句一练' : '问 AI'} />
        <Segmented options={[{ value: 'course', label: '课程' }, { value: 'practice', label: '练习' }, { value: 'ask', label: '问 AI' }]} value={tab} onChange={setTab} />
      </View>
      {tab === 'practice' ? <PracticeScreen embedded /> : tab === 'ask' ? <AskScreen /> : (
        <Course
          level={level}
          setLevel={(lv) => { setLevel(lv); void saveLevel(lv); }}
          course={course}
          progress={progress}
          zh={zh}
          onDesigned={setCourse}
          onUnit={(index) => setRoute({ kind: 'unit', index })}
          onLesson={(id) => setRoute({ kind: 'lesson', id })}
        />
      )}
    </View>
  );
}

function Course({ level, setLevel, course, progress, zh, onDesigned, onUnit, onLesson }: {
  level: GrammarLevel; setLevel: (l: GrammarLevel) => void; course: Unit[] | null | undefined; progress: Record<string, Progress>; zh: Record<string, string>;
  onDesigned: (u: Unit[]) => void; onUnit: (i: number) => void; onLesson: (id: string) => void;
}) {
  const c = useColors();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const points = pointsOf(level);
  const learned = points.filter((p) => progress[p.id]?.status === 'learned').length;

  const design = async () => {
    setBusy(true); setError('');
    try { onDesigned(await designCourse(level)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const redesign = () => Alert.alert('重新设计课程', '会重新排列单元，已学的进度保留。', [
    { text: '取消', style: 'cancel' }, { text: '重新设计', onPress: design },
  ]);

  const q = query.trim().toLowerCase();
  const found = useMemo(() => (q
    ? GRAMMAR_LEVELS.flatMap((lv) => pointsOf(lv).filter((p) => p.title.toLowerCase().includes(q) || p.short.toLowerCase().includes(q))).slice(0, 30)
    : []), [q]);

  return (
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <View style={styles.levelRow}>
        {GRAMMAR_LEVELS.map((lv) => (
          <Pressable key={lv} onPress={() => setLevel(lv)} style={[styles.level, { backgroundColor: lv === level ? c.accent : c.surface2 }]}>
            <Text style={{ color: lv === level ? c.accentInk : c.ink2, fontWeight: '800' }}>{lv}</Text>
          </Pressable>
        ))}
      </View>

      <View style={[styles.search, { borderColor: c.line, backgroundColor: c.surface }]}>
        <Search size={17} color={c.muted} />
        <TextInput value={query} onChangeText={setQuery} placeholder="搜索语法，例如 ために、ようだ" placeholderTextColor={c.muted} style={{ flex: 1, color: c.ink, fontSize: 15 }} />
      </View>
      {q ? (
        <View style={{ gap: 8 }}>
          {found.map((p) => <PointRow key={p.id} id={p.id} status={progress[p.id]?.status} meaning={zh[p.id]} onPress={() => onLesson(p.id)} showLevel />)}
          {!found.length ? <Text style={{ color: c.muted }}>没有找到</Text> : null}
        </View>
      ) : course === undefined ? <ActivityIndicator color={c.accent} /> : !course ? (
        <EmptyState icon={<GraduationCap size={26} color={c.accent} />} title={`${level} 共 ${points.length} 个语法点`} text="AI 会把它们排成循序渐进的单元：先易后难、相关的放一起对比。每课有中文讲解、例句和小测验。">
          {error ? <ErrorNote message={error} /> : null}
          <Button label={`为 ${level} 设计课程`} onPress={design} loading={busy} icon={<Sparkles size={17} color={c.accentInk} />} style={{ alignSelf: 'stretch' }} />
          {busy ? <Text style={{ color: c.muted, fontSize: 12 }}>大约需要半分钟</Text> : null}
        </EmptyState>
      ) : (
        <>
          <Card style={{ gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <Text style={{ color: c.ink, fontSize: 16, fontWeight: '800' }}>{level} 进度</Text>
              <Text style={{ color: c.muted }}>{learned} / {points.length}</Text>
            </View>
            <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
              <View style={{ width: `${(learned / points.length) * 100}%`, height: '100%', backgroundColor: c.accent, borderRadius: 3 }} />
            </View>
          </Card>
          {course.map((u, i) => {
            const n = u.ids.filter((id) => progress[id]?.status === 'learned').length;
            const complete = n === u.ids.length;
            return (
              <Pressable key={i} onPress={() => onUnit(i)}>
                <Card style={styles.unit}>
                  <View style={[styles.unitNo, { backgroundColor: complete ? c.okSoft : c.accentSoft }]}>
                    {complete ? <Check size={18} color={c.ok} /> : <Text style={{ color: c.accent, fontWeight: '800' }}>{i + 1}</Text>}
                  </View>
                  <View style={{ flex: 1, gap: 3 }}>
                    <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>{u.title}</Text>
                    <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12.5 }}>{u.theme}</Text>
                  </View>
                  <Text style={{ color: c.muted, fontSize: 12 }}>{n}/{u.ids.length}</Text>
                  <ChevronRight size={18} color={c.muted} />
                </Card>
              </Pressable>
            );
          })}
          <Button label="重新设计课程" kind="ghost" small onPress={redesign} icon={<RefreshCw size={14} color={c.ink2} />} />
        </>
      )}
      <Text style={{ color: c.muted, fontSize: 11, textAlign: 'center' }}>{ATTRIBUTION}</Text>
    </ScrollView>
  );
}

function PointRow({ id, status, onPress, showLevel, meaning }: { id: string; status?: string; onPress: () => void; showLevel?: boolean; meaning?: string }) {
  const c = useColors();
  const p = getPoint(id);
  if (!p) return null;
  return (
    <Pressable onPress={onPress}>
      <Card style={styles.point}>
        {status === 'learned' ? <BookCheck size={20} color={c.ok} /> : status === 'review' ? <CircleDot size={20} color={c.warn} /> : <CircleDot size={20} color={c.line} />}
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700' }}>{cleanTitle(p.title)}</Text>
          <Text numberOfLines={1} style={{ color: c.muted, fontSize: 12.5 }}>{meaning || p.short}</Text>
        </View>
        {showLevel ? <Tag label={id.slice(0, 2)} /> : null}
        <ChevronRight size={18} color={c.muted} />
      </Card>
    </Pressable>
  );
}

function UnitView({ unit, index, progress, zh, onBack, onOpen }: {
  unit: Unit; index: number; progress: Record<string, Progress>; zh: Record<string, string>; onBack: () => void; onOpen: (id: string) => void;
}) {
  const c = useColors();
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backRow} hitSlop={8}><ChevronLeft size={22} color={c.ink} /><Text style={{ color: c.ink2 }}>课程</Text></Pressable>
      <View style={{ gap: 4 }}>
        <Text style={{ color: c.accent, fontSize: 12, fontWeight: '700' }}>第 {index + 1} 单元</Text>
        <Text style={{ color: c.ink, fontSize: 24, fontWeight: '800' }}>{unit.title}</Text>
        <Text selectable style={{ color: c.ink2, lineHeight: 20 }}>{unit.theme}</Text>
      </View>
      {unit.ids.map((id) => <PointRow key={id} id={id} status={progress[id]?.status} meaning={zh[id]} onPress={() => onOpen(id)} />)}
    </ScrollView>
  );
}

function LessonView({ id, onBack }: { id: string; onBack: () => void }) {
  const c = useColors();
  const p = getPoint(id)!;
  const [lesson, setLesson] = useState<Lesson | null>(null);
  const [error, setError] = useState('');
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [saved, setSaved] = useState(false);

  const load = useCallback(async (regenerate = false) => {
    setLesson(null); setError(''); setAnswers({}); setSaved(false);
    try { setLesson(await loadLesson(id, regenerate)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, [id]);
  useEffect(() => { void load(); }, [load]);

  const answered = lesson ? Object.keys(answers).length : 0;
  const correct = lesson ? lesson.quiz.filter((q, i) => answers[i] === q.answer).length : 0;
  const finished = !!lesson && lesson.quiz.length > 0 && answered === lesson.quiz.length;

  useEffect(() => {
    if (!finished || saved || !lesson) return;
    setSaved(true);
    // 答对三分之二以上算学会，否则标记为需要复习（练习会优先出这类语法）
    void setStatus(id, correct * 3 >= lesson.quiz.length * 2 ? 'learned' : 'review', { correct, total: lesson.quiz.length });
    award('grammar', id);
  }, [finished, saved, lesson, correct, id]);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Pressable onPress={onBack} style={styles.backRow} hitSlop={8}><ChevronLeft size={22} color={c.ink} /><Text style={{ color: c.ink2 }}>返回</Text></Pressable>
      <View style={{ gap: 6 }}>
        <View style={{ flexDirection: 'row', gap: 6 }}><Tag label={id.slice(0, 2)} tone="accent" /></View>
        <Text style={{ color: c.ink, fontSize: 28, fontWeight: '800' }}>{cleanTitle(p.title)}</Text>
        {lesson ? <Text selectable style={{ color: c.ink, fontSize: 17, lineHeight: 25 }}>{lesson.meaning}</Text> : <Text style={{ color: c.muted }}>{p.short}</Text>}
      </View>

      {error ? (
        <View style={{ gap: 8 }}><ErrorNote message={error} /><Button label="重试" onPress={() => load()} /></View>
      ) : !lesson ? (
        <View style={{ alignItems: 'center', gap: 8, paddingVertical: 30 }}>
          <ActivityIndicator color={c.accent} />
          <Text style={{ color: c.muted }}>第一次打开，AI 正在写这一课（之后会缓存）</Text>
        </View>
      ) : (
        <>
          <Card style={{ gap: 6 }}>
            <SectionLabel>接续</SectionLabel>
            <Text selectable style={{ color: c.ink, fontSize: 15.5, lineHeight: 23 }}>{lesson.formation}</Text>
          </Card>
          <View style={{ gap: 6 }}>
            <SectionLabel>讲解</SectionLabel>
            <Text selectable style={{ color: c.ink2, fontSize: 15, lineHeight: 24 }}>{lesson.explanation}</Text>
          </View>
          {lesson.nuance ? (
            <View style={[styles.callout, { backgroundColor: c.accentSoft }]}>
              <Text style={{ color: c.accent, fontWeight: '700', fontSize: 13 }}>语感与区别</Text>
              <Text selectable style={{ color: c.ink, fontSize: 14.5, lineHeight: 22 }}>{lesson.nuance}</Text>
            </View>
          ) : null}
          <View style={{ gap: 10 }}>
            <SectionLabel>例句</SectionLabel>
            {lesson.examples.map((e, i) => (
              <View key={i} style={[styles.example, { borderColor: c.line }]}>
                <RubyText segments={e.japanese} size={18} zh={e.chinese} />
                <Text style={{ color: c.muted, fontSize: 13.5 }}>{e.chinese}</Text>
              </View>
            ))}
          </View>
          {lesson.mistakes.length ? (
            <View style={[styles.callout, { backgroundColor: c.warnSoft }]}>
              <Text style={{ color: c.warn, fontWeight: '700', fontSize: 13 }}>常见错误</Text>
              {lesson.mistakes.map((m, i) => <Text key={i} style={{ color: c.ink, fontSize: 14, lineHeight: 21 }}>· {m}</Text>)}
            </View>
          ) : null}

          {lesson.quiz.length ? (
            <View style={{ gap: 12 }}>
              <SectionLabel>小测验</SectionLabel>
              {lesson.quiz.map((q, i) => {
                const picked = answers[i];
                return (
                  <Card key={i} style={{ gap: 10 }}>
                    <Text style={{ color: c.muted, fontSize: 12.5 }}>{i + 1}. {q.prompt}</Text>
                    <RubyText segments={q.question} size={17} />
                    <View style={{ gap: 8 }}>
                      {q.options.map((o, j) => {
                        const isAnswer = j === q.answer;
                        const show = picked !== undefined;
                        const bg = show && isAnswer ? c.okSoft : show && j === picked ? c.errSoft : c.surface2;
                        const fg = show && isAnswer ? c.ok : show && j === picked ? c.err : c.ink;
                        return (
                          <Pressable key={j} disabled={show} onPress={() => setAnswers((a) => ({ ...a, [i]: j }))} style={[styles.option, { backgroundColor: bg }]}>
                            <Text style={{ color: fg, fontSize: 15.5 }}>{o}</Text>
                          </Pressable>
                        );
                      })}
                    </View>
                    {picked !== undefined && q.explanation ? <Text selectable style={{ color: c.ink2, fontSize: 13.5, lineHeight: 20 }}>{q.explanation}</Text> : null}
                  </Card>
                );
              })}
              {finished ? (
                <Card style={{ alignItems: 'center', gap: 6, backgroundColor: correct * 3 >= lesson.quiz.length * 2 ? c.okSoft : c.warnSoft }}>
                  <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800' }}>答对 {correct} / {lesson.quiz.length}</Text>
                  <Text style={{ color: c.ink2 }}>{correct * 3 >= lesson.quiz.length * 2 ? '这一课学会了 ✓' : '已标记为需要复习，「练习」里会多出这类题'}</Text>
                </Card>
              ) : null}
            </View>
          ) : null}

          <View style={{ gap: 6 }}>
            <SectionLabel>原始资料（Hanabira）</SectionLabel>
            <Text selectable style={{ color: c.muted, fontSize: 12.5, lineHeight: 19 }}>{p.long}</Text>
          </View>
          <Button label="重新生成这一课" kind="ghost" small onPress={() => load(true)} icon={<RefreshCw size={14} color={c.ink2} />} />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  top: { paddingHorizontal: 18, paddingTop: 18, gap: 12 },
  content: { padding: 18, gap: 14, paddingBottom: 48 },
  levelRow: { flexDirection: 'row', gap: 8 },
  level: { flex: 1, height: 40, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  search: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, height: 44 },
  bar: { height: 6, borderRadius: 3, overflow: 'hidden' },
  unit: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  unitNo: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  point: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  backRow: { flexDirection: 'row', alignItems: 'center', gap: 2, marginLeft: -6 },
  callout: { padding: 14, borderRadius: radius.md, gap: 6 },
  example: { gap: 4, paddingBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth },
  option: { paddingHorizontal: 14, paddingVertical: 12, borderRadius: radius.md },
});
