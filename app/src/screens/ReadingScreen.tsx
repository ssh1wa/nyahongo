// 阅读：新建读物（粘贴 / 图片 / AI 写 / 网上找）+ 历史 + 精读器
import * as ImagePicker from 'expo-image-picker';
import { BookOpenText, Camera, ChevronLeft, ClipboardPaste, Globe, ImagePlus, Search, Sparkles, Trash2, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, BackHandler, Image, KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { Reader } from '../components/Reader';
import { Button, Card, EmptyState, ErrorNote, ScreenHeader, Segmented, SectionLabel, Tag } from '../components/Ui';
import { deleteRecord } from '../lib/records';
import {
  countSentences, fetchPage, fetchWikipedia, generateArticle, listArticles, ocrImages, rewriteToLevel, saveArticle,
  searchWikipedia, splitArticle, SOURCE_LABEL, type Article, type ArticleLength, type ArticleSource,
} from '../lib/reading';
import type { RecordRow } from '../lib/records';
import { loadLlmSettings } from '../lib/settings';
import { useNav } from '../nav';
import { radius, useColors } from '../theme';

type Mode = 'paste' | 'photo' | 'ai' | 'web';
type View_ = { kind: 'home' } | { kind: 'create'; mode: Mode } | { kind: 'reader'; id: number; article: Article };

const ENTRIES: Array<{ mode: Mode; title: string; text: string; Icon: typeof Camera }> = [
  { mode: 'paste', title: '粘贴文章', text: '新闻、小说、博客等任意日文', Icon: ClipboardPaste },
  { mode: 'photo', title: '拍照 / 图片', text: '书页、漫画、截图，可以一次多张', Icon: Camera },
  { mode: 'ai', title: 'AI 写读物', text: '按你的要求和水平写一篇', Icon: Sparkles },
  { mode: 'web', title: '网上找读物', text: '维基百科、青空文库、任意网址', Icon: Globe },
];

export function ReadingScreen() {
  const [view, setView] = useState<View_>({ kind: 'home' });
  const [history, setHistory] = useState<Array<RecordRow<Article>>>([]);
  const refresh = useCallback(() => listArticles().then(setHistory), []);
  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    if (view.kind === 'home') return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { setView({ kind: 'home' }); void refresh(); return true; });
    return () => sub.remove();
  }, [view.kind, refresh]);

  const open = async (article: Article) => {
    const id = await saveArticle(article);
    setView({ kind: 'reader', id, article });
    void refresh();
  };
  const goHome = () => { setView({ kind: 'home' }); void refresh(); };

  if (view.kind === 'reader') return <Reader id={view.id} initial={view.article} onBack={goHome} />;
  if (view.kind === 'create') return <Create mode={view.mode} onBack={goHome} onStart={open} />;
  return <Home history={history} onCreate={(mode) => setView({ kind: 'create', mode })} onOpen={(r) => setView({ kind: 'reader', id: r.id, article: r.data })} onChanged={refresh} />;
}

function Home({ history, onCreate, onOpen, onChanged }: {
  history: Array<RecordRow<Article>>; onCreate: (m: Mode) => void; onOpen: (r: RecordRow<Article>) => void; onChanged: () => void;
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
            <View style={[styles.entryIcon, { backgroundColor: c.accentSoft }]}><Icon size={22} color={c.accent} /></View>
            <Text style={{ color: c.ink, fontSize: 15, fontWeight: '700' }}>{title}</Text>
            <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>{text}</Text>
          </Pressable>
        ))}
      </View>

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

// ---------- 新建 ----------

function Create({ mode, onBack, onStart }: { mode: Mode; onBack: () => void; onStart: (a: Article) => void }) {
  const c = useColors();
  const titles: Record<Mode, string> = { paste: '粘贴文章', photo: '拍照 / 图片', ai: 'AI 写读物', web: '网上找读物' };
  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <View style={styles.subHead}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}><ChevronLeft size={24} color={c.ink} /></Pressable>
        <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800' }}>{titles[mode]}</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingTop: 4 }]} keyboardShouldPersistTaps="handled">
        {mode === 'paste' ? <PasteForm onStart={onStart} /> : null}
        {mode === 'photo' ? <PhotoForm onStart={onStart} /> : null}
        {mode === 'ai' ? <AiForm onStart={onStart} /> : null}
        {mode === 'web' ? <WebForm onStart={onStart} /> : null}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

async function makeArticle(text: string, title: string, source: ArticleSource, sourceUrl?: string): Promise<Article> {
  const { level } = await loadLlmSettings();
  const paragraphs = splitArticle(text);
  const firstLine = paragraphs[0]?.[0]?.text ?? '';
  return { title: title.trim() || firstLine.slice(0, 24) || '未命名', source, sourceUrl, level, paragraphs };
}

/** 读物正文预览 + 「改写成我的水平」+ 开始精读。各种来源最后都走这里。 */
function TextReview({ text, setText, title, setTitle, source, sourceUrl, onStart, allowRewrite = true }: {
  text: string; setText: (t: string) => void; title: string; setTitle: (t: string) => void;
  source: ArticleSource; sourceUrl?: string; onStart: (a: Article) => void; allowRewrite?: boolean;
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
    try { onStart(await makeArticle(text, title, source, sourceUrl)); } finally { setBusy(''); }
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

function PhotoForm({ onStart }: { onStart: (a: Article) => void }) {
  const c = useColors();
  const [images, setImages] = useState<Picked[]>([]);
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState('');

  const pick = async () => {
    const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, selectionLimit: 20, quality: 1, orderedSelection: true });
    if (!r.canceled) setImages((cur) => [...cur, ...r.assets.map((a) => ({ uri: a.uri, width: a.width }))].slice(0, 20));
  };
  const shoot = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) { Alert.alert('需要相机权限', '在系统设置里允许「ことば精听」使用相机后再试。'); return; }
    const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 });
    if (!r.canceled) setImages((cur) => [...cur, ...r.assets.map((a) => ({ uri: a.uri, width: a.width }))].slice(0, 20));
  };
  const recognize = async () => {
    setError('');
    setProgress({ done: 0, total: images.length });
    try {
      setText(await ocrImages(images, (done, total) => setProgress({ done, total })));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };

  if (text) {
    return <TextReview text={text} setText={setText} title={title} setTitle={setTitle} source="photo" onStart={onStart} />;
  }
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

const AI_TOPICS = ['日常生活', '校园', '旅行见闻', '美食', '工作职场', '季节和节日', '日本文化', '小故事', '新闻风格', '书信'];

function AiForm({ onStart }: { onStart: (a: Article) => void }) {
  const c = useColors();
  const [prompt, setPrompt] = useState('');
  const [length, setLength] = useState<ArticleLength>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ title: string; text: string } | null>(null);
  const [level, setLevel] = useState('');
  useEffect(() => { loadLlmSettings().then((s) => setLevel(s.level)); }, []);

  const generate = async () => {
    setBusy(true); setError('');
    try { setResult(await generateArticle(prompt, length)); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };

  if (result) {
    return (
      <TextReview
        text={result.text}
        setText={(t) => setResult({ ...result, text: t })}
        title={result.title}
        setTitle={(t) => setResult({ ...result, title: t })}
        source="ai"
        onStart={onStart}
        allowRewrite={false}
      />
    );
  }
  return (
    <View style={{ gap: 12 }}>
      <Text style={{ color: c.ink2, lineHeight: 21 }}>写下想读什么，越具体越好。AI 会按你的水平（{level}，在设置里改）来写。</Text>
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
      {error ? <ErrorNote message={error} /> : null}
      <Button label="生成读物" onPress={generate} loading={busy} icon={<Sparkles size={17} color={c.accentInk} />} />
    </View>
  );
}

function WebForm({ onStart }: { onStart: (a: Article) => void }) {
  const c = useColors();
  const [tab, setTab] = useState<'wiki' | 'url'>('wiki');
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Array<{ title: string; snippet: string }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [page, setPage] = useState<{ title: string; text: string; url: string; source: ArticleSource } | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setError('');
    try { await fn(); } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(/Network request failed/i.test(msg) ? '连不上这个网站。维基百科在国内可能需要代理；也可以换成网址导入其他网站。' : msg);
    } finally { setBusy(false); }
  };

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
      <Segmented options={[{ value: 'wiki', label: '日语维基百科' }, { value: 'url', label: '网址导入' }]} value={tab} onChange={(t) => { setTab(t); setError(''); }} />
      {tab === 'wiki' ? (
        <>
          <View style={styles.searchRow}>
            <TextInput
              value={query}
              onChangeText={setQuery}
              onSubmitEditing={() => run(async () => setResults(await searchWikipedia(query)))}
              placeholder="搜索主题，例如 富士山、ラーメン、宮崎駿"
              placeholderTextColor={c.muted}
              returnKeyType="search"
              style={[styles.searchInput, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
            />
            <Button label="搜索" small onPress={() => run(async () => setResults(await searchWikipedia(query)))} disabled={!query.trim()} loading={busy && !results} icon={<Search size={16} color={c.accentInk} />} />
          </View>
          <Text style={{ color: c.muted, fontSize: 12 }}>维基百科偏书面语，读起来吃力可以在下一步点「改写成我的水平」。</Text>
          {results?.map((r) => (
            <Pressable key={r.title} onPress={() => run(async () => { const p = await fetchWikipedia(r.title); setPage({ ...p, source: 'wiki' }); })}>
              <Card style={{ gap: 4, padding: 12 }}>
                <Text style={{ color: c.ink, fontWeight: '700', fontSize: 15 }}>{r.title}</Text>
                <Text numberOfLines={2} style={{ color: c.muted, fontSize: 12.5 }}>{r.snippet}</Text>
              </Card>
            </Pressable>
          ))}
          {results && !results.length ? <Text style={{ color: c.muted }}>没有找到</Text> : null}
        </>
      ) : (
        <>
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="https://… 网页地址"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            keyboardType="url"
            style={[styles.searchInput, { color: c.ink, borderColor: c.line, backgroundColor: c.surface }]}
          />
          <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>适合青空文库作品页（版权已过期的文学作品）、NHK やさしいことばニュース、博客文章等。需要登录或动态加载的页面取不到正文。</Text>
          <Button label="读取网页" onPress={() => run(async () => { const p = await fetchPage(query.trim()); setPage({ title: p.title, text: p.text.slice(0, 4000), url: query.trim(), source: 'url' }); })} loading={busy} disabled={!/^https?:\/\//i.test(query.trim())} />
        </>
      )}
      {busy && results ? <ActivityIndicator color={c.accent} /> : null}
      {error ? <ErrorNote message={error} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 14, paddingBottom: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  entry: { width: '48.5%', flexGrow: 1, borderWidth: 1, borderRadius: radius.lg, padding: 14, gap: 6 },
  entryIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginBottom: 2 },
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
  searchInput: { flex: 1, height: 44, borderWidth: 1, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 15 },
});
