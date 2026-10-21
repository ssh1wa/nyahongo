// 逐句精听播放器：当前句大字注音、点词查词典、单句循环、读完自动暂停、整句译文
import { useEvent } from 'expo';
import { useVideoPlayer, VideoView } from 'expo-video';
import { ChevronLeft, Pause, Play, Repeat, RotateCcw, SkipBack, SkipForward, StopCircle } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { TokenText } from '../components/Ruby';
import { WordSheet } from '../components/WordSheet';
import { kvGet, kvSet } from '../lib/db';
import { award, setMediaPlaying } from '../lib/game';
import { loadPackage, mediaUri, saveProgress } from '../lib/packages';
import type { PackageData, Sentence } from '../lib/types';
import { radius, useColors, useTheme } from '../theme';

type ZhMode = 'show' | 'tap' | 'hidden';
const RATES = [0.75, 0.9, 1, 1.25];
const PREROLL = 0.08; // 跳到句首时稍微提前一点，Whisper 的起始时间常常偏晚

function fmt(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function indexAt(sentences: Sentence[], t: number) {
  let lo = 0, hi = sentences.length - 1, ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (sentences[mid].start <= t + 0.05) { ans = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return ans;
}

export function PlayerScreen({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<PackageData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    loadPackage(id).then(setData).catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [id]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onClose(); return true; });
    return () => sub.remove();
  }, [onClose]);

  const c = useColors();
  if (error) return <View style={[styles.center, { backgroundColor: c.bg }]}><Text style={{ color: c.err }}>打不开学习包：{error}</Text></View>;
  if (!data) return <View style={[styles.center, { backgroundColor: c.bg }]}><ActivityIndicator color={c.accent} /></View>;
  return <Player data={data} onClose={onClose} />;
}

function Player({ data, onClose }: { data: PackageData; onClose: () => void }) {
  const c = useColors();
  const { prefs } = useTheme();
  const insets = useSafeAreaInsets();
  const { meta, sentences, dictionary } = data;
  const isVideo = meta.media_type === 'video';
  const hasZh = useMemo(() => sentences.some((s) => s.zh), [sentences]);

  const player = useVideoPlayer(mediaUri(meta), (p) => {
    p.timeUpdateEventInterval = 0.1;
  });
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  // 播放中算有效学习时间（不用一直点屏幕）
  useEffect(() => { setMediaPlaying(isPlaying); }, [isPlaying]);
  useEffect(() => () => setMediaPlaying(false), []);

  const [idx, setIdx] = useState(-1);
  const [loop, setLoop] = useState(false);
  const [autoPause, setAutoPause] = useState(false);
  const [rate, setRate] = useState(1);
  const [showRuby, setShowRuby] = useState(true);
  const [zhMode, setZhMode] = useState<ZhMode>('tap');
  const [zhRevealed, setZhRevealed] = useState(false);
  const [word, setWord] = useState<{ sentence: number; token: number } | null>(null);

  // 用 ref 保存播放逻辑需要的最新状态，timeUpdate 回调里读
  const st = useRef({ idx: -1, loop: false, autoPause: false, pauseAt: null as number | null });
  st.current.loop = loop;
  st.current.autoPause = autoPause;

  useEffect(() => {
    // 播放器里改过的开关会记住；没改过就用设置里的默认值
    Promise.all([kvGet('player.loop', false), kvGet('player.autoPause', false), kvGet('player.rate', 1), kvGet('player.ruby', prefs.showRuby), kvGet<ZhMode>('player.zh', prefs.zhMode)])
      .then(([l, a, r, ruby, zh]) => { setLoop(l); setAutoPause(a); setRate(r); setShowRuby(ruby); setZhMode(zh); player.playbackRate = r; });
  }, [player]);

  const listRef = useRef<FlatList<Sentence>>(null);
  const userScrolledAt = useRef(0);

  const setCurrent = useCallback((i: number) => {
    if (i === st.current.idx) return;
    st.current.idx = i;
    setIdx(i);
    setZhRevealed(false);
    if (i >= 0) {
      void saveProgress(meta.id, i);
      if (i === sentences.length - 1) award('listen', meta.id);
      if (Date.now() - userScrolledAt.current > 3000) {
        listRef.current?.scrollToIndex({ index: i, viewPosition: 0.3, animated: true });
      }
    }
  }, [meta.id, sentences.length]);

  useEffect(() => {
    const sub = player.addListener('timeUpdate', ({ currentTime: t }) => {
      const s = st.current;
      const cur = sentences[s.idx];
      if (s.loop && cur && t >= cur.end + 0.12) {
        player.currentTime = Math.max(0, cur.start - PREROLL);
        return;
      }
      if (s.pauseAt !== null && t >= s.pauseAt + 0.12) {
        s.pauseAt = null;
        player.pause();
        return;
      }
      if (!s.loop) {
        const i = indexAt(sentences, t);
        if (i !== s.idx) {
          setCurrent(i);
          if (s.autoPause && player.playing && sentences[i]) s.pauseAt = sentences[i].end;
        }
      }
    });
    return () => sub.remove();
  }, [player, sentences, setCurrent]);

  // 从上次学到的句子继续
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { getDb } = await import('../lib/db');
      const db = await getDb();
      const row = await db.getFirstAsync<{ last_sentence: number }>('SELECT last_sentence FROM packages WHERE id = ?', meta.id);
      const i = row?.last_sentence ?? 0;
      if (!cancelled && i > 0 && sentences[i]) {
        player.currentTime = Math.max(0, sentences[i].start - PREROLL);
        setCurrent(i);
      }
    })();
    return () => { cancelled = true; };
  }, [meta.id, player, sentences, setCurrent]);

  const playSentence = useCallback((i: number) => {
    const j = Math.max(0, Math.min(sentences.length - 1, i));
    const s = sentences[j];
    player.currentTime = Math.max(0, s.start - PREROLL);
    st.current.idx = -1;
    setCurrent(j);
    st.current.pauseAt = st.current.autoPause ? s.end : null;
    player.play();
  }, [player, sentences, setCurrent]);

  const togglePlay = () => {
    if (player.playing) { player.pause(); return; }
    const cur = sentences[st.current.idx];
    if (autoPause && cur && player.currentTime >= cur.end) { playSentence(st.current.idx + 1); return; }
    st.current.pauseAt = autoPause && cur ? cur.end : null;
    player.play();
  };
  const prev = () => {
    const cur = sentences[st.current.idx];
    playSentence(cur && player.currentTime - cur.start > 1.2 ? st.current.idx : st.current.idx - 1);
  };

  const toggle = (key: string, value: boolean, set: (v: boolean) => void) => { set(value); void kvSet(key, value); };
  const cycleRate = () => {
    const r = RATES[(RATES.indexOf(rate) + 1) % RATES.length];
    setRate(r); player.playbackRate = r; void kvSet('player.rate', r);
  };
  const cycleZh = () => {
    const modes: ZhMode[] = ['tap', 'show', 'hidden'];
    const m = modes[(modes.indexOf(zhMode) + 1) % modes.length];
    setZhMode(m); void kvSet('player.zh', m);
  };

  const cur = sentences[idx];
  const zhLabel = { show: '译文 显示', tap: '译文 点开', hidden: '译文 隐藏' }[zhMode];

  const renderLine = useCallback(({ item, index }: { item: Sentence; index: number }) => (
    <Pressable onPress={() => playSentence(index)} style={[styles.line, index === idx && { backgroundColor: c.accentSoft }]}>
      <Text style={[styles.lineTime, { color: index === idx ? c.accent : c.muted }]}>{fmt(item.start)}</Text>
      <View style={{ flex: 1, gap: 2 }}>
        <TokenText tokens={item.tokens} size={16} showRuby={showRuby} />
        {item.zh && zhMode === 'show' ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{item.zh}</Text> : null}
      </View>
    </Pressable>
  ), [idx, c, showRuby, zhMode, playSentence]);

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <View style={styles.head}>
        <Pressable onPress={onClose} hitSlop={10} style={styles.iconBtn}><ChevronLeft size={24} color={c.ink} /></Pressable>
        <Text numberOfLines={1} style={[styles.title, { color: c.ink }]}>{meta.title}</Text>
      </View>

      {isVideo ? (
        <Pressable onPress={togglePlay} style={styles.video}>
          <VideoView player={player} style={StyleSheet.absoluteFill} nativeControls={false} contentFit="contain" />
        </Pressable>
      ) : null}

      {/* 手指一碰当前句就先暂停：不然播放中句子切换、卡片变形，点词会点空 */}
      <View
        style={[styles.now, { backgroundColor: c.surface, borderColor: c.line }]}
        onTouchStart={() => { if (player.playing) { st.current.pauseAt = null; player.pause(); } }}
      >
        {cur ? (
          <>
            <TokenText
              tokens={cur.tokens}
              size={22}
              serif
              showRuby={showRuby}
              highlight={word?.sentence === idx ? word.token : null}
              onPressToken={(t) => { player.pause(); setWord({ sentence: idx, token: t }); }}
            />
            {cur.zh && zhMode !== 'hidden' ? (
              <Pressable onPress={() => setZhRevealed((v) => !v)} disabled={zhMode === 'show'}>
                {zhMode === 'show' || zhRevealed
                  ? <Text style={[styles.zh, { color: c.ink2 }]}>{cur.zh}</Text>
                  : <Text style={[styles.zh, { color: c.muted }]}>点击显示译文</Text>}
              </Pressable>
            ) : null}
            <Text style={[styles.meta, { color: c.muted }]}>第 {idx + 1} / {sentences.length} 句 · {fmt(cur.start)} · 点单词查词典</Text>
          </>
        ) : (
          <Text style={{ color: c.muted }}>点播放开始，或者点下面任意一句</Text>
        )}
      </View>

      <View style={[styles.controls, { borderColor: c.line }]}>
        <Ctl onPress={prev}><SkipBack size={22} color={c.ink} /></Ctl>
        <Pressable onPress={togglePlay} style={[styles.play, { backgroundColor: c.accent }]}>
          {isPlaying ? <Pause size={24} color={c.accentInk} /> : <Play size={24} color={c.accentInk} />}
        </Pressable>
        <Ctl onPress={() => playSentence(st.current.idx + 1)}><SkipForward size={22} color={c.ink} /></Ctl>
        <Ctl onPress={() => playSentence(Math.max(idx, 0))}><RotateCcw size={20} color={c.ink} /></Ctl>
        <Ctl active={loop} onPress={() => toggle('player.loop', !loop, setLoop)}><Repeat size={20} color={loop ? c.accent : c.ink} /></Ctl>
        <Ctl active={autoPause} onPress={() => {
          const v = !autoPause;
          st.current.pauseAt = v && player.playing && cur ? cur.end : null;
          toggle('player.autoPause', v, setAutoPause);
        }}>
          <StopCircle size={20} color={autoPause ? c.accent : c.ink} />
        </Ctl>
      </View>
      <View style={styles.chips}>
        <Chip label={`${rate}×`} onPress={cycleRate} />
        <Chip label={showRuby ? '注音 开' : '注音 关'} onPress={() => toggle('player.ruby', !showRuby, setShowRuby)} />
        {hasZh ? <Chip label={zhLabel} onPress={cycleZh} /> : null}
        <Text style={{ color: c.muted, fontSize: 11.5 }}>{loop ? '单句循环中' : autoPause ? '每句读完暂停' : ''}</Text>
      </View>

      <FlatList
        ref={listRef}
        data={sentences}
        keyExtractor={(s) => String(s.id)}
        renderItem={renderLine}
        extraData={[idx, showRuby, zhMode]}
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 10, paddingBottom: insets.bottom + 24 }}
        onScrollBeginDrag={() => { userScrolledAt.current = Date.now(); }}
        onScrollToIndexFailed={({ index }) => {
          setTimeout(() => listRef.current?.scrollToIndex({ index, viewPosition: 0.3, animated: false }), 100);
        }}
        initialNumToRender={20}
        windowSize={11}
      />

      {word ? (
        <WordSheet
          sentence={sentences[word.sentence]}
          tokenIndex={word.token}
          dictionary={dictionary}
          packageId={meta.id}
          onClose={() => setWord(null)}
        />
      ) : null}
    </View>
  );
}

function Ctl({ children, onPress, active }: { children: React.ReactNode; onPress: () => void; active?: boolean }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} hitSlop={6} style={({ pressed }) => [styles.ctl, (active || pressed) && { backgroundColor: c.accentSoft }]}>
      {children}
    </Pressable>
  );
}

function Chip({ label, onPress }: { label: string; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: c.surface2 }]}>
      <Text style={{ color: c.ink2, fontSize: 12.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 48 },
  iconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 15, fontWeight: '700' },
  video: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000' },
  now: { marginHorizontal: 12, marginTop: 10, padding: 14, borderWidth: 1, borderRadius: radius.lg, minHeight: 96, gap: 6, justifyContent: 'center' },
  zh: { fontSize: 14.5, lineHeight: 21 },
  meta: { fontSize: 11.5 },
  controls: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10 },
  ctl: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  play: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center' },
  chips: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 16, paddingVertical: 10 },
  chip: { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 999 },
  line: { flexDirection: 'row', gap: 10, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 10 },
  lineTime: { width: 38, fontSize: 11.5, paddingTop: 10, fontVariant: ['tabular-nums'] },
});
