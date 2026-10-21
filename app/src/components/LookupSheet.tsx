// 通用查词面板：先查离线 JMdict；词条没中文释义就让 AI 只翻译英文义项；没有离线词典时显示 AI 给的简短释义
import { BookmarkCheck, BookmarkPlus, Download, X } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { localDictInfo, lookup, translateEntry } from '../lib/dict';
import type { DictEntry } from '../lib/types';
import { addWord, isSaved } from '../lib/wordbook';
import { useNav } from '../nav';
import { useColors } from '../theme';
import { Button, Tag } from './Ui';
import { EntryView } from './WordSheet';

export type LookupWord = { surface: string; base: string; reading?: string; meaning?: string };

export function LookupSheet({ word, context, contextZh, onClose }: {
  word: LookupWord; context?: string; contextZh?: string; onClose: () => void;
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const [entry, setEntry] = useState<DictEntry | null>(null);
  const [hasDict, setHasDict] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [translating, setTranslating] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const info = await localDictInfo();
      if (cancelled) return;
      setHasDict(!!info);
      let e = info ? await lookup(word.base || word.surface, word.reading) : null;
      if (!e && info && word.surface !== word.base) e = await lookup(word.surface, word.reading);
      if (cancelled) return;
      setEntry(e);
      setLoading(false);
      if (e) {
        setSaved(await isSaved(e.id));
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
  }, [word.base, word.surface, word.reading]);

  const head = entry ? entry.kanji.find((k) => k === word.base) || entry.kanji[0] || entry.readings[0] : word.base || word.surface;
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

        <ScrollView style={{ maxHeight: 420 }} contentContainerStyle={{ gap: 12 }}>
          {loading ? <ActivityIndicator color={c.accent} /> : entry ? (
            <>
              <EntryView entry={entry} />
              {translating ? <Text style={{ color: c.muted, fontSize: 12 }}>正在把英文释义翻译成中文…</Text> : null}
              <Text style={{ color: c.muted, fontSize: 11 }}>释义来自 JMdict 词典</Text>
            </>
          ) : (
            <View style={{ gap: 8 }}>
              {word.meaning ? <Text style={{ color: c.ink, fontSize: 16, lineHeight: 23 }}>{word.meaning}</Text> : null}
              <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 19 }}>
                {hasDict ? '词典里没有找到这个词，上面是 AI 根据上下文给的释义。' : '还没有下载离线词典，上面是 AI 根据上下文给的释义。下载词典后可以看到准确的词条。'}
              </Text>
              {hasDict === false ? (
                <Button label="去下载离线词典" kind="secondary" small onPress={() => { onClose(); nav.openSettings(); }} icon={<Download size={16} color={c.ink} />} />
              ) : null}
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
          disabled={saved || loading}
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
});
