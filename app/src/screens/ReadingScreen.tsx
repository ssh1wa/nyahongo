// 阅读：常读（每天一篇）+ 新建读物（导入 / AI 写 / 搜索）+ 历史 + 精读器
import * as ImagePicker from 'expo-image-picker';
import {
  BookOpenText, Camera, Check, ChevronLeft, ClipboardPaste, Globe, ImagePlus, Link, MoreHorizontal, Repeat, Search, Sparkles, Trash2, X,
} from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, ToastAndroid, View,
} from 'react-native';
import { Reader } from '../components/Reader';
import { References } from '../components/References';
import { Button, Card, EmptyState, ErrorNote, ScreenHeader, Segmented, SectionLabel, Tag } from '../components/Ui';
import { deleteRecord } from '../lib/records';
import {
  countSentences, fetchPage, generateArticle, listArticles, ocrImages, researchAndWrite, rewriteToLevel, saveArticle,
  splitArticle, SOURCE_LABEL, type Article, type ArticleLength, type ArticleSource, type ResearchStage,
} from '../lib/reading';
import { addRoutine, deleteRoutine, listRoutines, localDate, todaysArticle, writeToday, type Routine } from '../lib/routines';
import { deepseekSearch, searchMode, wikipediaSearch, wikipediaText, type SearchHit, type SearchMode } from '../lib/search';
import type { RecordRow } from '../lib/records';
import { loadLlmSettings, visionReady } from '../lib/settings';
import { useNav } from '../nav';
import { radius, useColors } from '../theme';

type Mode = 'import' | 'ai' | 'search';
type View_ = { kind: 'home' } | { kind: 'create'; mode: Mode } | { kind: 'reader'; id: number; article: Article };

const ENTRIES: Array<{ mode: Mode; title: string; text: string; Icon: typeof Camera }> = [
  { mode: 'import', title: '导入', text: '粘贴 · 图片 · 网址', Icon: ClipboardPaste },
  { mode: 'ai', title: 'AI 写', text: '按要求和水平写', Icon: Sparkles },
  { mode: 'search', title: '搜索', text: '全网 · 维基百科', Icon: Globe },
];

const TITLES: Record<Mode, string> = { import: '导入文章', ai: 'AI 写读物', search: '搜索读物' };

const STAGE_LABEL: Record<ResearchStage, string> = { keywords: '整理搜索关键词', searching: '联网查资料', writing: 'AI 写作中' };

/** 常读正在生成的状态放在最外层：生成要几十秒，期间切去别的页面再回来也不会丢。 */
type Writing = { id: string; stage: ResearchStage; detail?: string } | null;

export function ReadingScreen() {
  const [view, setView] = useState<View_>({ kind: 'home' });
  const [history, setHistory] = useState<Array<RecordRow<Article>>>([]);
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [writing, setWriting] = useState<Writing>(null);
  const [routineError, setRoutineError] = useState<{ id: string; message: string } | null>(null);
  const refresh = useCallback(() => {
    void listArticles().then(setHistory);
    void listRoutines().then(setRoutines);
  }, []);
  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    if (view.kind === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setView({ kind: 'home' }); refresh(); return true; });
    return () => sub.remove();
  }, [view.kind, refresh]);

  const open = async (article: Article) => {
    const id = await saveArticle(article);
    setView({ kind: 'reader', id, article });
    refresh();
  };
  const goHome = () => { setView({ kind: 'home' }); refresh(); };

  /** 今天写过就直接打开；again=true 时不管写没写过都再写一篇。 */
  const runRoutine = async (r: Routine, again = false) => {
    if (writing) return;
    setRoutineError(null);
    if (!again) {
      const done = await todaysArticle(r);
      if (done) { setView({ kind: 'reader', ...done }); return; }
    }
    setWriting({ id: r.id, stage: 'keywords' });
    try {
      const made = await writeToday(r, (stage, detail) => setWriting({ id: r.id, stage, detail }));
      setView({ kind: 'reader', ...made });
    } catch (e) {
      setRoutineError({ id: r.id, message: e instanceof Error ? e.message : String(e) });
    } finally {
      setWriting(null);
      refresh();
    }
  };

  if (view.kind === 'reader') return <Reader id={view.id} initial={view.article} onBack={goHome} />;
  if (view.kind === 'create') return <Create mode={view.mode} onBack={goHome} onStart={open} onRoutineSaved={goHome} />;
  return (
    <Home
      history={history}
      routines={routines}
      writing={writing}
      routineError={routineError}
      onRoutine={runRoutine}
      onCreate={(mode) => setView({ kind: 'create', mode })}
      onOpen={(r) => setView({ kind: 'reader', id: r.id, article: r.data })}
      onChanged={refresh}
    />
  );
}

function Home({ history, routines, writing, routineError, onRoutine, onCreate, onOpen, onChanged }: {
  history: Array<RecordRow<Article>>; routines: Routine[]; writing: Writing; routineError: { id: string; message: string } | null;
  onRoutine: (r: Routine, again?: boolean) => void; onCreate: (m: Mode) => void; onOpen: (r: RecordRow<Article>) => void; onChanged: () => void;
}) {
  const c = useColors();
  const remove = (r: RecordRow<Article>) => Alert.alert('删除', `删除「${r.title}」？`, [
    { text: '取消', style: 'cancel' },
    { text: '删除', style: 'destructive', onPress: async () => { await deleteRecord(r.id); onChanged(); } },
  ]);
  return (
    <ScrollView contentContainerStyle={styles.content}>
      <ScreenHeader kicker="精读" title="阅读" />
      <View style={styles.grid}>
        {ENTRIES.map(({ mode, title, text, Icon }) => (
          <Pressable key={mode} onPress={() => onCreate(mode)} style={({ pressed }) => [styles.entry, { backgroundColor: c.surface, borderColor: c.line, opacity: pressed ? 0.85 : 1 }]}>
            <View style={[styles.entryIcon, { backgroundColor: c.accentSoft }]}><Icon size={21} color={c.accent} /></View>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>{title}</Text>
            <Text numberOfLines={1} style={{ color: c.muted, fontSize: 11.5 }}>{text}</Text>
          </Pressable>
        ))}
      </View>

      <SectionLabel>常读</SectionLabel>
      {routines.length ? routines.map((r) => (
        <RoutineCard
          key={r.id}
          routine={r}
          writing={writing?.id === r.id ? writing : null}
          blocked={!!writing && writing.id !== r.id}
          error={routineError?.id === r.id ? routineError.message : ''}
          onRun={(again) => onRoutine(r, again)}
          onChanged={onChanged}
        />
      )) : (
        <Pressable onPress={() => onCreate('ai')} style={[styles.routineHint, { borderColor: c.line }]}>
          <Repeat size={18} color={c.muted} />
          <Text style={{ flex: 1, color: c.muted, fontSize: 13, lineHeight: 19 }}>
            把常用的写作要求存下来，比如「每天一篇科普」「今天的日本新闻」，以后每天点一下就有一篇新的，不会重样。在「AI 写」里点「存为常读」。
          </Text>
        </Pressable>
      )}

      <SectionLabel>读过的文章</SectionLabel>
      {history.length ? history.map((r) => {
        const total = countSentences(r.data);
        const done = r.data.paragraphs.flat().filter((s) => s.segments).length;
        return (
          <Pressable key={r.id} onPress={() => onOpen(r)} onLongPress={() => remove(r)}>
            <Card style={styles.historyRow}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text numberOfLines={1} style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>{r.title}</Text>
                <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                  <Tag label={SOURCE_LABEL[r.data.source]} />
                  <Tag label={r.data.level} />
                  <Tag label={done < total ? `已解析 ${done}/${total} 句` : `${total} 句`} tone={done < total ? 'accent' : 'neutral'} />
                </View>
              </View>
              <Pressable onPress={() => remove(r)} hitSlop={10}><Trash2 size={17} color={c.muted} /></Pressable>
            </Card>
          </Pressable>
        );
      }) : (
        <EmptyState icon={<BookOpenText size={26} color={c.accent} />} title="还没有读过文章" text="从上面选一种方式开始。AI 会给每句话加注音、翻译，并挑出值得学的词和语法。" />
      )}
    </ScrollView>
  );
}

const LENGTH_LABEL: Record<ArticleLength, string> = { short: '短篇', medium: '中篇', long: '长篇' };

function RoutineCard({ routine, writing, blocked, error, onRun, onChanged }: {
  routine: Routine; writing: Writing; blocked: boolean; error: string; onRun: (again?: boolean) => void; onChanged: () => void;
}) {
  const c = useColors();
  const today = routine.history.find((h) => h.date === localDate());
  const more = () => Alert.alert(routine.name, `已经写过 ${routine.history.length} 篇`, [
    ...(today ? [{ text: '今天再写一篇', onPress: () => onRun(true) }] : []),
    { text: '删除这个常读', style: 'destructive' as const, onPress: async () => { await deleteRoutine(routine.id); onChanged(); } },
    { text: '取消', style: 'cancel' as const },
  ]);
  return (
    <Card style={{ gap: 10, padding: 14 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}>
        <View style={{ flex: 1, gap: 4 }}>
          <Text numberOfLines={2} style={{ color: c.ink, fontSize: 15, fontWeight: '700', lineHeight: 21 }}>{routine.name}</Text>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {routine.web ? '联网' : '不联网'} · {LENGTH_LABEL[routine.length]} · 已写 {routine.history.length} 篇
          </Text>
        </View>
        <Pressable onPress={more} hitSlop={10} disabled={!!writing}><MoreHorizontal size={20} color={c.muted} /></Pressable>
      </View>
      {today && !writing ? (
        <Text numberOfLines={1} style={{ color: c.ink2, fontSize: 13 }}>今天：{today.title}</Text>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      <Button
        label={writing ? `${STAGE_LABEL[writing.stage]}${writing.detail ? ` · ${writing.detail}` : ''}…` : today ? '继续读今天的' : '今日一篇'}
        kind={today && !writing ? 'secondary' : 'primary'}
        small
        loading={!!writing}
        disabled={blocked}
        onPress={() => onRun()}
        icon={writing ? undefined : today ? <BookOpenText size={16} color={c.ink} /> : <Sparkles size={16} color={c.accentInk} />}
      />
    </Card>
  );
}

// ---------- 新建 ----------

function Create({ mode, onBack, onStart, onRoutineSaved }: { mode: Mode; onBack: () => void; onStart: (a: Article) => void; onRoutineSaved: () => void }) {
  const c = useColors();
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <View style={styles.subHead}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}><ChevronLeft size={24} color={c.ink} /></Pressable>
        <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800' }}>{TITLES[mode]}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 4 }]} keyboardShouldPersistTaps="handled">
        {mode === 'import' ? <ImportForm onStart={onStart} /> : null}
        {mode === 'ai' ? <AiForm onStart={onStart} onRoutineSaved={onRoutineSaved} /> : null}
        {mode === 'search' ? <SearchForm onStart={onStart} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

/** 导入：粘贴文字、拍照/图片识别、网址三种，拿到正文后都进同一个预览页。 */
function ImportForm({ onStart }: { onStart: (a: Article) => void }) {
  const [tab, setTab] = useState<'paste' | 'photo' | 'url'>('paste');
  const [page, setPage] = useState<{ title: string; text: string; source: ArticleSource; url?: string } | null>(null);

  if (page) {
    return (
      <TextReview
        text={page.text}
        setText={(t) => setPage({ ...page, text: t })}
        title={page.title}
        setTitle={(t) => setPage({ ...page, title: t })}
        source={page.source}
        sourceUrl={page.url}
        onStart={onStart}
      />
    );
  }
  return (
    <View style={{ gap: 14 }}>
      <Segmented
        options={[{ value: 'paste', label: '粘贴文字' }, { value: 'photo', label: '拍照 / 图片' }, { value: 'url', label: '网址' }]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'paste' ? <PasteForm onStart={onStart} /> : null}
      {tab === 'photo' ? <PhotoForm onDone={(text) => setPage({ title: '', text, source: 'photo' })} /> : null}
      {tab === 'url' ? <UrlForm onDone={(p) => setPage({ ...p, source: 'url' })} /> : null}
    </View>
  );
}

type Ref = NonNullable<Article['references']>[number];

async function makeArticle(text: string, title: string, source: ArticleSource, sourceUrl?: string, references?: Ref[]): Promise<Article> {
  const { level } = await loadLlmSettings();
  const paragraphs = splitArticle(text);
  const firstLine = paragraphs[0]?.[0]?.text ?? '';
  return { title: title.trim() || firstLine.slice(0, 24) || '未命名', source, sourceUrl, level, paragraphs, references };
}

/** 读物正文预览 + 「改写成我的水平」+ 开始精读。各种来源最后都走这里。 */
function TextReview({ text, setText, title, setTitle, source, sourceUrl, references, onStart, allowRewrite = true }: {
  text: string; setText: (t: string) => void; title: string; setTitle: (t: string) => void;
  source: ArticleSource; sourceUrl?: string; references?: Ref[]; onStart: (a: Article) => void; allowRewrite?: boolean;
}) {
  const c = useColors();
  const [busy, setBusy] = useState<'' | 'rewrite' | 'start'>('');
  const [error, setError] = useState('');
  const n = splitArticle(text).reduce((k, p) => k + p.length, 0);
  const rewrite = async () => {
    setBusy('rewrite'); setError('');
    try { setText(await rewriteToLevel(text)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const start = async () => {
    setBusy('start');
    try { onStart(await makeArticle(text, title, source, sourceUrl, references)); } finally { setBusy(''); }
  };
  return (
    <View style={{ gap: 10 }}>
      <TextInput value={title} onChangeText={setTitle} placeholder="标题（可不填）" placeholderTextColor={c.muted} style={[styles.titleInput, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]} />
      <TextInput
        value={text}
        onChangeText={setText}
        multiline
        textAlignVertical="top"
        placeholder="日文正文"
        placeholderTextColor={c.muted}
        style={[styles.body, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
      />
      <Text style={{ color: c.muted, fontSize: 12 }}>{n} 句 · 可以先修改再开始。太长的文章建议只留想精读的部分</Text>
      {references?.length ? <References items={references} /> : null}
      {error ? <ErrorNote message={error} /> : null}
      <View style={{ flexDirection: 'row', gap: 10 }}>
        {allowRewrite ? <Button label="改写成我的水平" kind="secondary" onPress={rewrite} loading={busy === 'rewrite'} disabled={!text.trim() || !!busy} style={{ flex: 1 }} /> : null}
        <Button label="开始精读" onPress={start} loading={busy === 'start'} disabled={!n || !!busy} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

function PasteForm({ onStart }: { onStart: (a: Article) => void }) {
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  return <TextReview text={text} setText={setText} title={title} setTitle={setTitle} source="paste" onStart={onStart} />;
}

type Picked = { uri: string; width?: number };

function PhotoForm({ onDone }: { onDone: (text: string) => void }) {
  const c = useColors();
  const nav = useNav();
  const [images, setImages] = useState<Picked[]>([]);
  // 识图要能用 AI：没填 Key（或另选的识图接口没选模型）就直接去设置页填
  const needApi = async () => {
    if (visionReady(await loadLlmSettings())) return false;
    ToastAndroid.show('拍照识字要先填好 AI 服务的 API Key', ToastAndroid.LONG);
    nav.openSettings();
    return true;
  };
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  const pick = async () => {
    if (await needApi()) return;
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20, quality: 1, orderedSelection: true });
    if (!r.canceled) setImages((cur) => [...cur, ...r.assets.map((a) => ({ uri: a.uri, width: a.width }))].slice(0, 20));
  };
  const shoot = async () => {
    if (await needApi()) return;
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要相机权限', '在系统设置里允许「にゃほんご」使用相机后再试。'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!r.canceled) setImages((cur) => [...cur, ...r.assets.map((a) => ({ uri: a.uri, width: a.width }))].slice(0, 20));
  };
  const recognize = async () => {
    setError('');
    setProgress({ done: 0, total: images.length });
    try {
      const text = await ocrImages(images, (done, total) => setProgress({ done, total }));
      if (!text.trim()) throw new Error('图片里没有识别出日文');
      onDone(text);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.ink2, lineHeight: 21 }}>按顺序选好书页或漫画页（最多 20 张），AI 会按阅读顺序把文字转出来：竖排从右往左，漫画按格子和对话框顺序。</Text>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <Button label="拍照" kind="secondary" onPress={shoot} icon={<Camera size={18} color={c.ink} />} style={{ flex: 1 }} />
        <Button label="从相册选" kind="secondary" onPress={pick} icon={<ImagePlus size={18} color={c.ink} />} style={{ flex: 1 }} />
      </View>
      {images.length ? (
        <View style={styles.thumbs}>
          {images.map((img, i) => (
            <View key={`${img.uri}-${i}`} style={styles.thumbWrap}>
              <Image source={{ uri: img.uri }} style={[styles.thumb, { backgroundColor: c.surface2 }]} />
              <View style={[styles.thumbNo, { backgroundColor: c.accent }]}><Text style={{ color: c.accentInk, fontSize: 11, fontWeight: '700' }}>{i + 1}</Text></View>
              <Pressable onPress={() => setImages((cur) => cur.filter((_, j) => j !== i))} style={styles.thumbDel} hitSlop={6}><X size={14} color="#fff" /></Pressable>
            </View>
          ))}
        </View>
      ) : null}
      {error ? <ErrorNote message={error} /> : null}
      <Button
        label={progress ? `正在识别第 ${Math.min(progress.done + 1, progress.total)} / ${progress.total} 张` : `识别文字（${images.length} 张）`}
        onPress={recognize}
        loading={!!progress}
        disabled={!images.length}
      />
    </View>
  );
}

const friendlyError = (e: unknown) => {
  const msg = e instanceof Error ? e.message : String(e);
  return /Network request failed/i.test(msg) ? '连不上这个网站，检查一下网络，或者换一个网址试试。' : msg;
};

function UrlForm({ onDone }: { onDone: (p: { title: string; text: string; url: string }) => void }) {
  const c = useColors();
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<SearchMode>('wikipedia');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { searchMode().then(setMode); }, []);
  const read = async () => {
    setBusy(true); setError('');
    try {
      const p = await fetchPage(url.trim());
      onDone({ title: p.title, text: p.text.slice(0, 4000), url: url.trim() });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <View style={{ gap: 12 }}>
      <TextInput
        value={url}
        onChangeText={setUrl}
        placeholder="https://… 网页地址"
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        keyboardType="url"
        style={[styles.searchInput, { flex: 0, color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
      />
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
        适合青空文库作品页（版权已过期的文学作品）、NHK やさしいことばニュース、博客文章等。{mode === 'deepseek' ? '大多数网站都能读到正文。' : '需要登录才能看的网页读不到正文。'}
      </Text>
      {error ? <ErrorNote message={error} /> : null}
      <Button label="读取网页" onPress={read} loading={busy} disabled={!/^https?:\/\//i.test(url.trim())} icon={<Link size={16} color={c.accentInk} />} />
    </View>
  );
}

const AI_TOPICS = ['日常生活', '校园', '旅行见闻', '美食', '工作职场', '季节和节日', '日本文化', '小故事', '新闻风格', '书信'];

function AiForm({ onStart, onRoutineSaved }: { onStart: (a: Article) => void; onRoutineSaved: () => void }) {
  const c = useColors();
  const [prompt, setPrompt] = useState('');
  const [length, setLength] = useState<ArticleLength>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ title: string; text: string; references?: Ref[] } | null>(null);
  const [level, setLevel] = useState('');
  const [web, setWeb] = useState(true);
  const [mode, setMode] = useState<SearchMode>('wikipedia');
  const [stage, setStage] = useState<{ stage: ResearchStage; detail?: string } | null>(null);
  useEffect(() => {
    loadLlmSettings().then((s) => setLevel(s.level));
    searchMode().then(setMode);
  }, []);

  const generate = async () => {
    setBusy(true); setError('');
    try {
      setResult(web
        ? await researchAndWrite(prompt, length, (s, detail) => setStage({ stage: s, detail }))
        : await generateArticle(prompt, length));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setStage(null);
    }
  };

  const saveRoutine = async () => {
    await addRoutine({ name: prompt.trim().slice(0, 60), prompt: prompt.trim(), length, web });
    Alert.alert('已存为常读', '回到阅读页，在「常读」里点「今日一篇」。每天点一次，会避开以前写过的主题。', [{ text: '好', onPress: onRoutineSaved }]);
  };

  if (result) {
    return (
      <TextReview
        text={result.text}
        setText={(t) => setResult({ ...result, text: t })}
        title={result.title}
        setTitle={(t) => setResult({ ...result, title: t })}
        source="ai"
        references={result.references}
        onStart={onStart}
        allowRewrite={false}
      />
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.ink2, lineHeight: 21 }}>写下想读的内容，越具体越好，比如「日本的便利店为什么这么多」。AI 会按你的日语水平（{level}）来写，水平可以在设置里改。</Text>
      <TextInput
        value={prompt}
        onChangeText={setPrompt}
        multiline
        textAlignVertical="top"
        placeholder="例如：一个留学生第一次在日本便利店打工的故事，多用敬语"
        placeholderTextColor={c.muted}
        style={[styles.prompt, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
      />
      <View style={styles.chips}>
        {AI_TOPICS.map((t) => (
          <Pressable key={t} onPress={() => setPrompt((p) => (p ? `${p}，${t}` : t))} style={[styles.chip, { backgroundColor: c.surface2 }]}>
            <Text style={{ color: c.ink2, fontSize: 13 }}>{t}</Text>
          </Pressable>
        ))}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Text style={{ color: c.ink2 }}>长度</Text>
        <Segmented options={[{ value: 'short', label: '短' }, { value: 'medium', label: '中' }, { value: 'long', label: '长' }]} value={length} onChange={setLength} />
      </View>
      <Pressable onPress={() => setWeb((v) => !v)} style={[styles.webToggle, { borderColor: web ? c.accent : c.line, backgroundColor: web ? c.accentSoft : c.surface }]}>
        <Globe size={20} color={web ? c.accent : c.muted} />
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: c.ink, fontWeight: '700' }}>联网查资料再写{web ? '' : '（已关闭）'}</Text>
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>
            {mode === 'deepseek'
              ? '先上网查资料再写，文末列出参考来源。适合科普、时事这类要求事实准确的内容'
              : '现在只能查日语维基百科。在「设置 → AI 接口 → 联网搜索」打开后可以查全网'}
          </Text>
        </View>
        <View style={[styles.check, { borderColor: web ? c.accent : c.line, backgroundColor: web ? c.accent : 'transparent' }]}>
          {web ? <Check size={14} color={c.accentInk} /> : null}
        </View>
      </Pressable>
      {error ? <ErrorNote message={error} /> : null}
      <Button
        label={stage ? `${STAGE_LABEL[stage.stage]}${stage.detail ? ` · ${stage.detail}` : ''}…` : '生成读物'}
        onPress={generate}
        loading={busy}
        icon={<Sparkles size={17} color={c.accentInk} />}
      />
      <Button label="存为常读（每天一篇不重样）" kind="secondary" onPress={saveRoutine} disabled={!prompt.trim() || busy} icon={<Repeat size={16} color={c.ink} />} />
    </View>
  );
}

function SearchForm({ onStart }: { onStart: (a: Article) => void }) {
  const c = useColors();
  const nav = useNav();
  const [mode, setMode] = useState<SearchMode>('wikipedia');
  const [tab, setTab] = useState<'web' | 'wiki'>('web');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchHit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState<{ title: string; text: string; url: string; source: ArticleSource } | null>(null);
  useEffect(() => { searchMode().then(setMode); }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); }
  };
  const search = () => run(async () => {
    setResults(tab === 'web' ? await deepseekSearch(query, { count: 12 }) : await wikipediaSearch(query));
  });
  const open = (hit: SearchHit) => run(async () => {
    if (tab === 'wiki') {
      setPage({ title: hit.title, text: await wikipediaText(hit.title), url: hit.url, source: 'wiki' });
    } else {
      const p = await fetchPage(hit.url);
      setPage({ title: p.title || hit.title, text: p.text.slice(0, 4000), url: hit.url, source: 'url' });
    }
  });

  if (page) {
    return (
      <TextReview
        text={page.text}
        setText={(t) => setPage({ ...page, text: t })}
        title={page.title}
        setTitle={(t) => setPage({ ...page, title: t })}
        source={page.source}
        sourceUrl={page.url}
        onStart={onStart}
      />
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Segmented
        options={[{ value: 'web', label: '全网搜索' }, { value: 'wiki', label: '维基百科' }]}
        value={tab}
        onChange={(t) => { setTab(t); setError(''); setResults(null); }}
      />
      {tab === 'web' && mode !== 'deepseek' ? (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: c.ink2, lineHeight: 20 }}>搜全网要先在设置里打开「联网搜索」（填一个 DeepSeek 的 API Key，费用很低）。不打开的话，可以在旁边搜维基百科。</Text>
          <Button label="去设置" kind="secondary" small onPress={nav.openSettings} />
        </Card>
      ) : (
        <>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={search}
              placeholder={tab === 'web' ? '搜索任何主题，中文日文都行' : '搜索主题，例如 富士山、ラーメン'}
              placeholderTextColor={c.muted}
              returnKeyType="search"
              style={[styles.searchInput, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
            />
            <Button label="搜索" small onPress={search} disabled={!query.trim()} loading={busy && !results} icon={<Search size={16} color={c.accentInk} />} />
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>
            {tab === 'web' ? '想读日文文章，搜索词里加上「日本語」或直接用日文搜。读起来吃力可以在下一步点「改写成我的水平」。' : '维基百科偏书面语，读起来吃力可以在下一步点「改写成我的水平」。'}
          </Text>
          {results?.map((r) => (
            <Pressable key={r.url} onPress={() => open(r)}>
              <Card style={{ gap: 4, padding: 12 }}>
                <Text numberOfLines={2} style={{ color: c.ink, fontWeight: '700', fontSize: 15 }}>{r.title}</Text>
                <Text numberOfLines={1} style={{ color: c.accent, fontSize: 11.5 }}>{r.site || r.url.replace(/^https?:\/\//, '').split('/')[0]}{r.date ? ` · ${r.date.slice(0, 10)}` : ''}</Text>
                {r.snippet ? <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12.5 }}>{r.snippet}</Text> : null}
              </Card>
            </Pressable>
          ))}
          {results && !results.length ? <Text style={{ color: c.muted }}>没有找到</Text> : null}
        </>
      )}
      {busy && results ? <ActivityIndicator color={c.accent} /> : null}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  grid: { flexDirection: 'row', gap: 10 },
  entry: { flex: 1, borderWidth: 1, borderRadius: radius.lg, paddingVertical: 14, paddingHorizontal: 10, gap: 4, alignItems: 'center' },
  entryIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  routineHint: { flexDirection: 'row', gap: 10, alignItems: 'flex-start', padding: 14, borderWidth: 1, borderStyle: 'dashed', borderRadius: radius.md },
  historyRow: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 },
  subHead: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 52 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  titleInput: { height: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
  body: { minHeight: 240, borderWidth: 1, borderRadius: radius.md, padding: 12, fontSize: 16, lineHeight: 25 },
  prompt: { minHeight: 100, borderWidth: 1, borderRadius: radius.md, padding: 12, fontSize: 15, lineHeight: 22 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 999 },
  thumbs: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  thumbWrap: { width: 78, height: 104 },
  thumb: { width: 78, height: 104, borderRadius: radius.sm },
  thumbNo: { position: 'absolute', left: 4, top: 4, minWidth: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 5 },
  thumbDel: { position: 'absolute', right: 4, top: 4, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(0,0,0,0.55)', alignItems: 'center', justifyContent: 'center' },
  searchRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  webToggle: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1.5, borderRadius: radius.md },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  searchInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
});
