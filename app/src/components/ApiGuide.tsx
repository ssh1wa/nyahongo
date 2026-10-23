// 申请 API Key 的教程（设置里「常用服务商」旁边的问号）。服务商列表和设置页的 PROVIDERS 对应。
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, Copy } from 'lucide-react-native';
import React, { useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useColors } from '../theme';
import { Tag } from './Ui';

type Guide = {
  id: string;
  name: string;
  tag?: string;
  site: string;
  format: string;
  url: string;
  steps: string[];
  note?: string;
};

export const GUIDES: Guide[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    tag: '推荐',
    site: 'https://platform.deepseek.com',
    format: 'OpenAI 兼容',
    url: 'https://api.deepseek.com',
    steps: [
      '打开 platform.deepseek.com，用手机号注册并登录',
      '在「充值」里充一点钱。按用量付费，日常学习花得很少',
      '左边点「API keys」→「创建 API key」，复制下来（只显示这一次，记得保存）',
      '回到这里点「DeepSeek」，接口地址和模型会自动填好，再把 Key 粘贴进去',
    ],
    note: '只用 DeepSeek 一家就够了：模型 deepseek-flash 能翻译讲解，也能看图（拍照识字），同一个 Key 还能用来联网搜索。中文好、价格便宜、国内直接能连。',
  },
  {
    id: 'bailian',
    name: '阿里云百炼',
    site: 'https://bailian.console.aliyun.com',
    format: 'OpenAI 兼容',
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    steps: [
      '打开 bailian.console.aliyun.com，用阿里云账号登录，按提示开通百炼',
      '在「API-KEY」页面创建一个 Key 并复制',
      '回到这里点「阿里云百炼」，粘贴 Key，在模型列表里选一个（通义千问 qwen 系列）',
    ],
    note: '拍照识字要选名字里带 vl 的模型（能看图的）。',
  },
  {
    id: 'siliconflow',
    name: '硅基流动',
    site: 'https://cloud.siliconflow.cn',
    format: 'OpenAI 兼容',
    url: 'https://api.siliconflow.cn/v1',
    steps: [
      '打开 cloud.siliconflow.cn 注册并登录',
      '在「API 密钥」页面新建一个密钥并复制',
      '回到这里点「硅基流动」，粘贴 Key，在模型列表里选一个（DeepSeek、Qwen 都有）',
    ],
    note: '拍照识字要选名字里带 VL 的模型。',
  },
  {
    id: 'deepinfra',
    name: 'DeepInfra',
    site: 'https://deepinfra.com',
    format: 'OpenAI 兼容',
    url: 'https://api.deepinfra.com/v1/openai',
    steps: [
      '打开 deepinfra.com 注册，在账单页绑定支付方式（一般要海外信用卡）',
      '在「API Keys」页面创建一个 Key 并复制',
      '回到这里点「DeepInfra」，粘贴 Key',
    ],
    note: '国内网络连接可能不稳定。',
  },
  {
    id: 'anthropic',
    name: 'Claude（Anthropic）',
    site: 'https://console.anthropic.com',
    format: 'Anthropic',
    url: 'https://api.anthropic.com',
    steps: [
      '打开 console.anthropic.com 注册，绑定支付方式',
      '在「API Keys」页面创建一个 Key 并复制',
      '回到这里点「Claude」，接口格式会切到 Anthropic，粘贴 Key，在模型列表里选一个',
    ],
    note: '国内网络一般连不上，需要代理。Claude 的模型都能看图。',
  },
  {
    id: 'gemini',
    name: 'Gemini（Google）',
    site: 'https://aistudio.google.com/apikey',
    format: 'Gemini',
    url: 'https://generativelanguage.googleapis.com/v1beta',
    steps: [
      '打开 aistudio.google.com，用 Google 账号登录',
      '点「Get API key」→「Create API key」，复制',
      '回到这里点「Gemini」，接口格式会切到 Gemini，粘贴 Key，在模型列表里选一个',
    ],
    note: '国内网络一般连不上，需要代理。Gemini 的模型都能看图。',
  },
];

export function ApiGuide({ onClose }: { onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState('deepseek');
  const copy = async (text: string) => {
    await Clipboard.setStringAsync(text);
    ToastAndroid.show('已复制', ToastAndroid.SHORT);
  };
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: '800' }}>怎么申请 API Key</Text>
        </View>
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          <Text style={{ color: c.ink2, fontSize: 14, lineHeight: 22 }}>
            API Key 相当于 AI 服务的「钥匙」：在服务商官网注册、创建一个，复制回来填进设置，App 就用你的账户调用 AI，按用量付费。Key 只保存在这台手机上。
          </Text>
          {GUIDES.map((g) => {
            const on = open === g.id;
            return (
              <View key={g.id} style={[styles.card, { backgroundColor: c.surface, borderColor: on ? c.accent : c.line }]}>
                <Pressable onPress={() => setOpen(on ? '' : g.id)} style={styles.cardHead}>
                  <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700', flex: 1 }}>{g.name}</Text>
                  {g.tag ? <Tag label={g.tag} tone="accent" /> : null}
                  <Text style={{ color: c.muted, fontSize: 12 }}>{g.format}</Text>
                </Pressable>
                {on ? (
                  <View style={{ gap: 10 }}>
                    {g.steps.map((s, i) => (
                      <View key={i} style={{ flexDirection: 'row', gap: 10 }}>
                        <View style={[styles.num, { backgroundColor: c.accentSoft }]}><Text style={{ color: c.accent, fontWeight: '800', fontSize: 12 }}>{i + 1}</Text></View>
                        <Text selectable style={{ flex: 1, color: c.ink2, fontSize: 14, lineHeight: 21 }}>{s}</Text>
                      </View>
                    ))}
                    {g.note ? <Text style={{ color: c.ink2, fontSize: 13, lineHeight: 20, backgroundColor: c.surface2, padding: 10, borderRadius: radius.sm }}>{g.note}</Text> : null}
                    <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                      <Pressable onPress={() => void Linking.openURL(g.site)} style={[styles.link, { borderColor: c.line }]}>
                        <Text style={{ color: c.accent, fontSize: 13, fontWeight: '700' }}>打开官网</Text>
                      </Pressable>
                      <Pressable onPress={() => void copy(g.url)} style={[styles.link, { borderColor: c.line }]}>
                        <Copy size={13} color={c.muted} />
                        <Text style={{ color: c.ink2, fontSize: 12.5 }}>接口地址 {g.url}</Text>
                      </Pressable>
                    </View>
                  </View>
                ) : null}
              </View>
            );
          })}
          <Text style={{ color: c.muted, fontSize: 12.5, lineHeight: 19 }}>
            其他服务商：大多数都提供「OpenAI 兼容」接口，在设置里接口格式选「OpenAI 兼容」，把它给的接口地址（一般以 /v1 结尾）和 Key 填进去就行。
          </Text>
        </ScrollView>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 56 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, gap: 12 },
  card: { borderWidth: 1, borderRadius: radius.md, padding: 14, gap: 12 },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  num: { width: 22, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  link: { flexDirection: 'row', alignItems: 'center', gap: 5, borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 6 },
});
