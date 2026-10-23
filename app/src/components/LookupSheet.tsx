// 通用查词面板：先查离线 JMdict；词条没中文释义就让 AI 只翻译英文义项；词典查不到时让 AI 结合原句给释义，标明「AI 释义」。
// 词典词条可以再点「AI 详解」：语感、用法、搭配、带注音的例句、近义词辨析（按词条缓存，生词本里也直接用）
import { BookmarkCheck, BookmarkPlus, Sparkles, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AI_ENTRY_ID, aiGloss, ensureDict, lookup, translateEntry } from '../lib/dict';
import type { DictEntry } from '../lib/types';
import { cachedDetail, entryDetail } from '../lib/wordDetail';
import { addWord, isSaved, type WordDetail } from '../lib/wordbook';
import { useColors } from '../theme';
import { Button, Tag } from './Ui';
import { DetailView } from './WordDetailView';
import { EntryView } from './WordSheet';

export type LookupWord = { surface: string; base: string; reading?: string; meaning?: string };

export function LookupSheet({ word, entry: preset, context, contextZh, onClose }: {
  /** preset：调用方已经查到的词条（比如输入即查的结果），不用再查一遍 */
  word: LookupWord; entry?: DictEntry; context?: string; contextZh?: string; onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { height } = useWindowDimensions();
  const [entry, setEntry] = useState<DictEntry | null>(preset ?? null);
  const [detail, setDetail] = useState<WordDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [hasDict, setHasDict] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [saved, setSaved] = useState(false);
  const [aiError, setAiError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const ready = await ensureDict().then(() => true, () => false);
      if (cancelled) return;
      setHasDict(ready);
      let e = preset ?? (ready ? await lookup(word.base || word.surface, word.reading) : null);
      if (!e && ready && word.surface !== word.base) e = await lookup(word.surface, word.reading);
      if (cancelled) return;
      // 词典查不到、调用方也没给释义：让 AI 结合原句解释
      if (!e && !word.meaning) {
        try {
          e = await aiGloss(word.surface || word.base, context, contextZh);
        } catch (err) {
          if (!cancelled) setAiError(err instanceof Error ? err.message : String(err));
        }
        if (cancelled) return;
      }
      setEntry(e);
      setLoading(false);
      if (e && e.id !== AI_ENTRY_ID) {
        setSaved(await isSaved(e.id));
        const d = await cachedDetail(e);
        if (!cancelled && d) setDetail(d);
        if (!e.senses.every((s) => s.zh)) {
          setTranslating(true);
          try {
            const t = await translateEntry(e);
            if (!cancelled) setEntry(t);
          } catch {
            // 翻译失败就显示英文释义
          } finally {
            if (!cancelled) setTranslating(false);
          }
        }
      }
    })();
    return () => { cancelled = true; };
  }, [word.base, word.surface, word.reading]); // eslint-disable-line react-hooks/exhaustive-deps

  const head = entry ? entry.kanji.find((k) => k === word.base) || entry.kanji[0] || entry.readings[0] : word.base || word.surface;
  const explain = async () => {
    if (!entry) return;
    setDetailLoading(true);
    setDetailError('');
    try {
      setDetail(await entryDetail({ headword: head, reading: entry.readings[0] ?? null, entry, context, contextZh }));
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : String(e));
    } finally {
      setDetailLoading(false);
    }
  };
  const save = async () => {
    await addWord({
      entry,
      headword: head,
      reading: entry?.readings[0] ?? word.reading ?? null,
      context,
      contextZh,
    });
    setSaved(true);
  };

  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 }]}>
        <View style={styles.headRow}>
          <View style={{ flex: 1, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <Text style={{ color: c.ink, fontSize: 28, fontWeight: '800' }}>{head}</Text>
              <Text style={{ color: c.ruby, fontSize: 16 }}>{entry ? entry.readings.slice(0, 3).join('、') : word.reading ?? ''}</Text>
              {entry?.common ? <Tag label="常用词" tone="ok" /> : null}
            </View>
            {word.surface && word.surface !== head ? <Text style={{ color: c.muted, fontSize: 12.5 }}>原文中的形式：{word.surface}</Text> : null}
          </View>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={c.muted} /></Pressable>
        </View>

        <ScrollView style={{ maxHeight: detail ? height * 0.62 : 420 }} contentContainerStyle={{ gap: 12 }}>
          {loading ? (
            <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
              <ActivityIndicator color={c.accent} />
              <Text style={{ color: c.muted }}>查词典…（查不到会让 AI 结合原句解释）</Text>
            </View>
          ) : entry ? (
            <>
              <EntryView entry={entry} />
              {translating ? <Text style={{ color: c.muted, fontSize: 12 }}>正在把英文释义翻译成中文…</Text> : null}
              <Text style={{ color: c.muted, fontSize: 11 }}>
                {entry.id === AI_ENTRY_ID ? '离线词典里没有这个词，以上是 AI 根据原句给的释义，仅供参考' : '释义来自 JMdict 词典'}
              </Text>
              {entry.id !== AI_ENTRY_ID ? (
                detail ? (
                  <View style={[styles.detail, { borderColor: c.line }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Sparkles size={15} color={c.accent} />
                      <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>AI 详解</Text>
                    </View>
                    <DetailView detail={detail} />
                  </View>
                ) : (
                  <View style={{ gap: 6 }}>
                    <Button
                      label={detailLoading ? 'AI 正在写讲解…' : 'AI 详解：例句、用法、近义词'}
                      kind="secondary"
                      small
                      loading={detailLoading}
                      disabled={detailLoading}
                      onPress={explain}
                      icon={<Sparkles size={15} color={c.ink} />}
                    />
                    {detailError ? <Text style={{ color: c.err, fontSize: 12.5 }}>{detailError}</Text> : null}
                  </View>
                )
              ) : null}
            </>
          ) : (
            <View style={{ gap: 8 }}>
              {word.meaning ? <Text style={{ color: c.ink, fontSize: 16, lineHeight: 23 }}>{word.meaning}</Text> : null}
              <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 19 }}>
                {!word.meaning
                  ? `离线词典里没有找到这个词，AI 释义也没拿到：${aiError || '请重试'}`
                  : hasDict ? '词典里没有找到这个词，上面是 AI 根据上下文给的释义。' : '离线词典还没准备好，上面是 AI 根据上下文给的释义。'}
              </Text>
            </View>
          )}
          {context ? (
            <View style={[styles.context, { backgroundColor: c.surface2 }]}>
              <Text style={{ color: c.ink2, fontSize: 14, lineHeight: 21 }}>{context}</Text>
              {contextZh ? <Text style={{ color: c.muted, fontSize: 12.5 }}>{contextZh}</Text> : null}
            </View>
          ) : null}
        </ScrollView>

        <Button
          label={saved ? '已在生词本' : '加入生词本'}
          kind={saved ? 'secondary' : 'primary'}
          disabled={saved || loading || (!entry && !word.meaning)}
          onPress={save}
          icon={saved ? <BookmarkCheck size={18} color={c.ok} /> : <BookmarkPlus size={18} color={c.accentInk} />}
        />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, gap: 14 },
  headRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  context: { padding: 12, borderRadius: 12, gap: 4 },
  detail: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 10 },
});
