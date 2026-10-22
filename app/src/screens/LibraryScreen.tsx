// 学习库：手机上已下载的学习包 + 电脑上可同步的学习包
import { CircleHelp, Download, Film, Headphones, Laptop, RefreshCw, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { PcGuide } from '../components/PcGuide';
import { Button, Card, EmptyState, ErrorNote, IconButton, ScreenHeader, SectionLabel, Tag } from '../components/Ui';
import { useNav } from '../nav';
import {
  deleteLocal, downloadPackage, getPcUrl, listLocal, listRemote, thumbUri,
  type DownloadHandle, type LocalPackage,
} from '../lib/packages';
import { onSynced } from '../lib/sync';
import type { PackageMeta } from '../lib/types';
import { radius, useColors, useTheme } from '../theme';

const fmtDuration = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))} 秒` : `${Math.round(sec / 60)} 分钟`);

export function LibraryScreen({ active }: { active: boolean }) {
  const c = useColors();
  const { prefs } = useTheme();
  const nav = useNav();
  const onOpen = nav.openPlayer;
  const onGoSettings = nav.openSettings;
  const [local, setLocal] = useState<LocalPackage[]>([]);
  const [remote, setRemote] = useState<PackageMeta[] | null>(null);
  const [pcUrl, setPcUrl] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [guide, setGuide] = useState(false);
  const handles = useRef<Record<string, DownloadHandle>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setRemoteError('');
    try {
      const [l, url] = await Promise.all([listLocal(), getPcUrl()]);
      setLocal(l);
      setPcUrl(url);
      if (url) {
        try {
          setRemote(await listRemote(url));
        } catch (e) {
          setRemote(null);
          setRemoteError(e instanceof Error ? e.message : String(e));
        }
      }
    } finally {
      setLoading(false);
    }
  }, []);

  // 每次切到这个标签都刷新（可能刚从播放器回来，进度变了）
  useEffect(() => { if (active) void refresh(); }, [active, refresh]);
  useEffect(() => onSynced((r) => { if (r.changes) void refresh(); }), [refresh]); // 别的设备的精听进度
  useEffect(() => () => Object.values(handles.current).forEach((h) => h.cancel()), []);

  const download = (meta: PackageMeta) => {
    setProgress((p) => ({ ...p, [meta.id]: 0 }));
    const h = downloadPackage(pcUrl, meta, (f) => setProgress((p) => ({ ...p, [meta.id]: f })));
    handles.current[meta.id] = h;
    h.done
      .then(() => refresh())
      .catch((e) => {
        if (!(e instanceof Error && e.name === 'AbortError')) Alert.alert('下载失败', e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        delete handles.current[meta.id];
        setProgress((p) => { const n = { ...p }; delete n[meta.id]; return n; });
      });
  };

  const remove = (p: LocalPackage) => {
    Alert.alert('删除学习包', `从手机上删除「${p.title}」？\n电脑上的学习包不受影响，生词本也会保留。`, [
      { text: '取消', style: 'cancel' },
      { text: '删除', style: 'destructive', onPress: async () => { await deleteLocal(p.id); void refresh(); } },
    ]);
  };

  // 英语学习包是测试版功能：没开就不显示
  const visible = <T extends { lang?: string }>(list: T[]) => list.filter((p) => prefs.beta || p.lang !== 'en');
  const localIds = new Map(local.map((p) => [p.id, p]));
  // 电脑上新的、或者电脑端重新处理过（created_at 变了）的学习包
  const available = visible(remote ?? []).filter((m) => localIds.get(m.id)?.created_at !== m.created_at);

  return (
    <>
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[c.accent]} />}
    >
      <ScreenHeader
        kicker="视频 · 播客"
        title="精听"
        titleExtra={<IconButton label="电脑端教程" onPress={() => setGuide(true)}><CircleHelp size={20} color={c.muted} /></IconButton>}
      />

      <SectionLabel>手机上的学习包</SectionLabel>
      {visible(local).length ? visible(local).map((p) => {
        const thumb = thumbUri(p.id);
        const pct = p.sentence_count ? Math.round(((p.last_sentence + 1) / p.sentence_count) * 100) : 0;
        return (
          <Pressable key={p.id} onPress={() => onOpen(p.id)} onLongPress={() => remove(p)}>
            <Card style={styles.pkg}>
              <View style={[styles.thumb, { backgroundColor: c.surface2 }]}>
                {thumb ? <Image source={{ uri: thumb }} style={StyleSheet.absoluteFill} /> : p.media_type === 'audio' ? <Headphones size={26} color={c.accent} /> : <Film size={26} color={c.muted} />}
              </View>
              <View style={{ flex: 1, gap: 6 }}>
                <Text numberOfLines={2} style={{ color: c.ink, fontSize: 14.5, fontWeight: '700', lineHeight: 20 }}>{p.title}</Text>
                <View style={styles.tags}>
                  <Tag label={fmtDuration(p.duration)} />
                  <Tag label={`${p.sentence_count} 句`} />
                  {p.lang === 'en' ? <Tag label="英语" tone="accent" /> : null}
                  {p.refined_by ? <Tag label="AI 校对" tone="ok" /> : null}
                  {p.last_sentence > 0 ? <Tag label={`学到 ${pct}%`} tone="accent" /> : null}
                </View>
              </View>
              <Pressable onPress={() => remove(p)} hitSlop={10}><Trash2 size={18} color={c.muted} /></Pressable>
            </Card>
          </Pressable>
        );
      }) : (
        <EmptyState icon={<Headphones size={26} color={c.accent} />} title="还没有学习包" text="先在电脑上把视频或播客做成学习包，再从下面的「电脑上的学习包」下载到手机，就能逐句精听。不知道怎么做，点右上角的问号看教程。" />
      )}

      <View style={styles.remoteHead}>
        <SectionLabel>电脑上的学习包</SectionLabel>
        {pcUrl ? <Pressable onPress={refresh} hitSlop={10}><RefreshCw size={16} color={c.muted} /></Pressable> : null}
      </View>
      {!pcUrl ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Laptop size={22} color={c.accent} />
            <Text style={{ color: c.ink, flex: 1, lineHeight: 20 }}>学习包在电脑上制作：电脑端把视频变成逐句的日语字幕，手机连上电脑后下载。</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Button label="看教程" onPress={() => setGuide(true)} icon={<CircleHelp size={16} color={c.accentInk} />} style={{ flex: 1 }} />
            <Button label="填电脑地址" kind="secondary" onPress={onGoSettings} style={{ flex: 1 }} />
          </View>
        </Card>
      ) : remoteError ? (
        <View style={{ gap: 8 }}>
          <ErrorNote message={`连不上电脑（${pcUrl}）：${remoteError}\n确认电脑端开着，手机和电脑连的是同一个 Wi-Fi。`} />
          <Button label="看连接教程" kind="secondary" small onPress={() => setGuide(true)} icon={<CircleHelp size={14} color={c.ink} />} />
        </View>
      ) : remote && !available.length ? (
        <Text style={{ color: c.muted }}>电脑上的学习包都已经下载了</Text>
      ) : (
        available.map((m) => {
          const p = progress[m.id];
          const update = localIds.has(m.id);
          return (
            <Card key={m.id} style={styles.pkg}>
              <View style={{ flex: 1, gap: 6 }}>
                <Text numberOfLines={2} style={{ color: c.ink, fontSize: 14.5, fontWeight: '700' }}>{m.title}</Text>
                <View style={styles.tags}>
                  <Tag label={fmtDuration(m.duration)} />
                  <Tag label={`${m.size_mb ?? '?'} MB`} />
                  {m.lang === 'en' ? <Tag label="英语" tone="accent" /> : null}
                  {update ? <Tag label="电脑端已更新" tone="accent" /> : null}
                </View>
                {p !== undefined ? (
                  <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
                    <View style={{ width: `${Math.round(p * 100)}%`, height: '100%', backgroundColor: c.accent, borderRadius: 2 }} />
                  </View>
                ) : null}
              </View>
              {p !== undefined ? (
                <Button label="取消" kind="ghost" small onPress={() => handles.current[m.id]?.cancel()} />
              ) : (
                <Button label={update ? '更新' : '下载'} small onPress={() => download(m)} icon={<Download size={16} color={c.accentInk} />} />
              )}
            </Card>
          );
        })
      )}
    </ScrollView>
    {guide ? <PcGuide onClose={() => setGuide(false)} /> : null}
    </>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 12, paddingBottom: 40 },
  pkg: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  thumb: { width: 96, height: 54, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  remoteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
