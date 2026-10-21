// 学习库：手机上已下载的学习包 + 电脑上可同步的学习包
import { Download, Film, Headphones, Laptop, RefreshCw, Trash2 } from 'lucide-react-native';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Button, Card, ErrorNote, SectionLabel, Tag, Title } from '../components/Ui';
import {
  deleteLocal, downloadPackage, getPcUrl, listLocal, listRemote, thumbUri,
  type DownloadHandle, type LocalPackage,
} from '../lib/packages';
import type { PackageMeta } from '../lib/types';
import { countDue } from '../lib/wordbook';
import { radius, useColors } from '../theme';

const fmtDuration = (sec: number) => (sec < 60 ? `${Math.max(1, Math.round(sec))} 秒` : `${Math.round(sec / 60)} 分钟`);

export function LibraryScreen({ onOpen, onGoSettings, onGoReview }: {
  onOpen: (id: string) => void; onGoSettings: () => void; onGoReview: () => void;
}) {
  const c = useColors();
  const [local, setLocal] = useState<LocalPackage[]>([]);
  const [remote, setRemote] = useState<PackageMeta[] | null>(null);
  const [pcUrl, setPcUrl] = useState('');
  const [remoteError, setRemoteError] = useState('');
  const [loading, setLoading] = useState(false);
  const [due, setDue] = useState(0);
  const [progress, setProgress] = useState<Record<string, number>>({});
  const handles = useRef<Record<string, DownloadHandle>>({});

  const refresh = useCallback(async () => {
    setLoading(true);
    setRemoteError('');
    try {
      const [l, url, d] = await Promise.all([listLocal(), getPcUrl(), countDue()]);
      setLocal(l);
      setPcUrl(url);
      setDue(d);
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

  useEffect(() => { void refresh(); }, [refresh]);
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

  const localIds = new Map(local.map((p) => [p.id, p]));
  // 电脑上新的、或者电脑端重新处理过（created_at 变了）的学习包
  const available = (remote ?? []).filter((m) => localIds.get(m.id)?.created_at !== m.created_at);

  return (
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} colors={[c.accent]} />}
    >
      <Title kicker="ことば精听" title="学习库" />

      {due > 0 ? (
        <Pressable onPress={onGoReview}>
          <Card style={[styles.dueCard, { backgroundColor: c.accentSoft, borderColor: c.accentSoft }]}>
            <Text style={{ color: c.accent, fontSize: 15, fontWeight: '700' }}>今天有 {due} 个生词要复习</Text>
            <Text style={{ color: c.accent }}>去复习 ›</Text>
          </Card>
        </Pressable>
      ) : null}

      <SectionLabel>手机上的学习包</SectionLabel>
      {local.length ? local.map((p) => {
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
                  {p.refined_by ? <Tag label="AI 校对" tone="ok" /> : null}
                  {p.last_sentence > 0 ? <Tag label={`学到 ${pct}%`} tone="accent" /> : null}
                </View>
              </View>
              <Pressable onPress={() => remove(p)} hitSlop={10}><Trash2 size={18} color={c.muted} /></Pressable>
            </Card>
          </Pressable>
        );
      }) : (
        <Card><Text style={{ color: c.muted, lineHeight: 21 }}>还没有学习包。先在电脑上处理视频，再从下面的「电脑上的学习包」下载到手机。</Text></Card>
      )}

      <View style={styles.remoteHead}>
        <SectionLabel>电脑上的学习包</SectionLabel>
        {pcUrl ? <Pressable onPress={refresh} hitSlop={10}><RefreshCw size={16} color={c.muted} /></Pressable> : null}
      </View>
      {!pcUrl ? (
        <Card style={{ gap: 12 }}>
          <View style={{ flexDirection: 'row', gap: 10, alignItems: 'center' }}>
            <Laptop size={22} color={c.accent} />
            <Text style={{ color: c.ink, flex: 1, lineHeight: 20 }}>还没有连接电脑。在电脑上双击「启动.bat」，把网页右上角显示的手机同步地址填到设置里。</Text>
          </View>
          <Button label="去设置" kind="secondary" onPress={onGoSettings} />
        </Card>
      ) : remoteError ? (
        <ErrorNote message={`${remoteError}\n电脑地址：${pcUrl}`} />
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
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 12, paddingBottom: 40 },
  dueCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 14 },
  pkg: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 },
  thumb: { width: 96, height: 54, borderRadius: radius.sm, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  remoteHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 },
  bar: { height: 4, borderRadius: 2, overflow: 'hidden' },
});
