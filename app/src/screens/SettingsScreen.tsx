// 设置：电脑同步地址、AI 接口、日语水平
import React, { useEffect, useState } from 'react';
import { KeyboardAvoidingView, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Button, Card, ErrorNote, Segmented, SectionLabel, Title } from '../components/Ui';
import { getPcUrl, pingPc, setPcUrl } from '../lib/packages';
import { DEFAULT_LLM, loadLlmSettings, saveLlmSettings, type LlmSettings } from '../lib/settings';
import { radius, useColors } from '../theme';

const LEVELS: LlmSettings['level'][] = ['入门', 'N5', 'N4', 'N3', 'N2', 'N1'];

export function SettingsScreen() {
  const c = useColors();
  const [pc, setPc] = useState('');
  const [pcStatus, setPcStatus] = useState<{ ok: boolean; text: string } | null>(null);
  const [testing, setTesting] = useState(false);
  const [llm, setLlm] = useState<LlmSettings>(DEFAULT_LLM);
  const [saved, setSaved] = useState('');

  useEffect(() => {
    getPcUrl().then(setPc);
    loadLlmSettings().then(setLlm);
  }, []);

  const testPc = async () => {
    setTesting(true);
    setPcStatus(null);
    try {
      const url = await setPcUrl(pc);
      setPc(url);
      const ok = await pingPc(url);
      setPcStatus(ok ? { ok: true, text: '已连接电脑，回到学习库就能下载学习包' } : { ok: false, text: '这个地址不是电脑端的学习库' });
    } catch (e) {
      setPcStatus({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setTesting(false);
    }
  };

  const saveLlm = async () => {
    await saveLlmSettings(llm);
    setSaved('已保存');
    setTimeout(() => setSaved(''), 2000);
  };

  const field = (label: string, value: string, onChange: (v: string) => void, opts: { secure?: boolean; placeholder?: string; url?: boolean } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: c.ink2, fontSize: 13 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        secureTextEntry={opts.secure}
        placeholder={opts.placeholder}
        placeholderTextColor={c.muted}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={opts.url ? 'url' : 'default'}
        style={[styles.input, { color: c.ink, borderColor: c.line, backgroundColor: c.bg }]}
      />
    </View>
  );

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior="height">
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Title title="设置" />

        <SectionLabel>连接电脑</SectionLabel>
        <Card style={{ gap: 12 }}>
          <Text style={{ color: c.ink2, lineHeight: 20 }}>在电脑上双击「启动.bat」，网页右上角会显示「手机同步」地址。手机和电脑要连同一个 Wi-Fi。</Text>
          {field('电脑地址', pc, setPc, { placeholder: '例如 192.168.1.5:8765', url: true })}
          <Button label="测试连接并保存" onPress={testPc} loading={testing} disabled={!pc.trim()} />
          {pcStatus ? (pcStatus.ok ? <Text style={{ color: c.ok }}>{pcStatus.text}</Text> : <ErrorNote message={pcStatus.text} />) : null}
        </Card>

        <SectionLabel>AI 接口（翻译、练习、追问）</SectionLabel>
        <Card style={{ gap: 12 }}>
          {field('接口地址（OpenAI 兼容）', llm.baseUrl, (v) => setLlm({ ...llm, baseUrl: v }), { url: true })}
          {field('模型', llm.model, (v) => setLlm({ ...llm, model: v }))}
          {field('API Key', llm.apiKey, (v) => setLlm({ ...llm, apiKey: v }), { secure: true, placeholder: '保存在手机的加密存储里' })}
          <View style={{ gap: 6 }}>
            <Text style={{ color: c.ink2, fontSize: 13 }}>我的日语水平（练习出题难度）</Text>
            <Segmented options={LEVELS.map((l) => ({ value: l, label: l }))} value={llm.level} onChange={(level) => setLlm({ ...llm, level })} />
          </View>
          <Button label={saved || '保存'} onPress={saveLlm} />
        </Card>

        <SectionLabel>关于</SectionLabel>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
          词典数据：JMdict © Electronic Dictionary Research and Development Group，CC BY-SA 4.0（JSON 版本来自 jmdict-simplified）。{'\n'}
          复习算法：FSRS（ts-fsrs）。
        </Text>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  content: { padding: 18, gap: 12, paddingBottom: 40 },
  input: { height: 44, borderWidth: 1, borderRadius: radius.sm, paddingHorizontal: 12, fontSize: 15 },
});
