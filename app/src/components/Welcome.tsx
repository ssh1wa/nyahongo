// 第一次打开 App 的引导：选日语水平、说明要填 AI 的 Key、精听需要 PC 端。只出现一次
import { Headphones, KeyRound, Sparkles } from 'lucide-react-native';
import React, { useEffect, useState } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { kvGet, kvSet } from '../lib/db';
import { loadLlmSettings, saveLevel, type Level } from '../lib/settings';
import { useNav } from '../nav';
import { radius, useColors } from '../theme';
import { Button, Segmented } from './Ui';

const LEVELS: Level[] = ['入门', 'N5', 'N4', 'N3', 'N2', 'N1'];

export function Welcome() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const nav = useNav();
  const [show, setShow] = useState(false);
  const [level, setLevel] = useState<Level>('N4');

  useEffect(() => {
    // 已经填过 Key 的老用户不用看
    void Promise.all([kvGet<boolean>('welcomed', false), loadLlmSettings()]).then(([done, s]) => {
      if (!done && !s.apiKey) { setLevel(s.level); setShow(true); }
    });
  }, []);

  const finish = async (goSettings: boolean) => {
    await saveLevel(level);
    await kvSet('welcomed', true);
    setShow(false);
    if (goSettings) nav.openSettings();
  };

  if (!show) return null;
  return (
    <Modal visible animationType="fade" onRequestClose={() => finish(false)} statusBarTranslucent>
      <ScrollView style={{ backgroundColor: c.bg }} contentContainerStyle={[styles.content, { paddingTop: insets.top + 32, paddingBottom: insets.bottom + 24 }]}>
        <Text style={{ color: c.accent, fontSize: 14, fontWeight: '700' }}>ようこそ</Text>
        <Text style={{ color: c.ink, fontSize: 28, fontWeight: '800' }}>欢迎使用にゃほんご</Text>
        <Text style={{ color: c.ink2, fontSize: 15, lineHeight: 23 }}>
          用 AI 帮你学日语：翻译并拆解句子、读适合你水平的文章、逐句精听视频和播客、背单词。
        </Text>

        <View style={[styles.block, { backgroundColor: c.surface, borderColor: c.line }]}>
          <View style={styles.row}><Sparkles size={18} color={c.accent} /><Text style={[styles.h, { color: c.ink }]}>你的日语水平</Text></View>
          <Text style={[styles.p, { color: c.muted }]}>AI 写文章、出练习题、安排语法课都会按这个难度来，以后可以在设置里改。</Text>
          <Segmented options={LEVELS.map((l) => ({ value: l, label: l }))} value={level} onChange={setLevel} />
        </View>

        <View style={[styles.block, { backgroundColor: c.surface, borderColor: c.line }]}>
          <View style={styles.row}><KeyRound size={18} color={c.accent} /><Text style={[styles.h, { color: c.ink }]}>填一个 AI 服务的 Key</Text></View>
          <Text style={[styles.p, { color: c.muted }]}>
            翻译、讲解、出题、拍照识字都要用 AI。推荐 DeepSeek 官方：到 platform.deepseek.com 注册，创建一个 API Key 填到设置里，一个 Key 全部功能都能用。按用量付费，日常学习花得很少。设置里有申请教程。
          </Text>
        </View>

        <View style={[styles.block, { backgroundColor: c.surface, borderColor: c.line }]}>
          <View style={styles.row}><Headphones size={18} color={c.accent} /><Text style={[styles.h, { color: c.ink }]}>精听要配合 PC 端（可选）</Text></View>
          <Text style={[styles.p, { color: c.muted }]}>
            想看视频、听播客逐句学，需要在电脑上装 PC 端，把视频做成带字幕的学习包。教程在「精听」页右上角的问号里。不装也能用翻译、阅读、语法和生词本。
          </Text>
        </View>

        <Button label="去填 AI Key" onPress={() => finish(true)} icon={<KeyRound size={17} color={c.accentInk} />} />
        <Button label="先随便看看" kind="ghost" onPress={() => finish(false)} />
      </ScrollView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: 22, gap: 16, maxWidth: 640, width: '100%', alignSelf: 'center' },
  block: { padding: 16, borderRadius: radius.lg, borderWidth: 1, gap: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  h: { fontSize: 16, fontWeight: '700' },
  p: { fontSize: 13.5, lineHeight: 20 },
});
