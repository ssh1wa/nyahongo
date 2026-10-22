// 电脑端教程（精听页右上角的问号）：从安装电脑端、导入视频，到手机连上电脑、下载学习包。
// 内容要和电脑端（pc/）的界面文字、安装包（pc/installer）、config.example.toml 保持一致。
import * as Clipboard from 'expo-clipboard';
import { ChevronLeft, Copy } from 'lucide-react-native';
import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, ToastAndroid, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { radius, useColors } from '../theme';
import { Segmented } from './Ui';

type Tab = 'install' | 'import' | 'connect' | 'study';

export function PcGuide({ onClose }: { onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<Tab>('install');
  return (
    <Modal visible animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
        <View style={styles.head}>
          <Pressable onPress={onClose} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
          <Text style={{ color: c.ink, fontSize: 20, fontWeight: '800' }}>电脑端教程</Text>
        </View>
        <View style={{ paddingHorizontal: 16, paddingBottom: 6 }}>
          <Segmented
            options={[{ value: 'install', label: '安装' }, { value: 'import', label: '导入视频' }, { value: 'connect', label: '连接手机' }, { value: 'study', label: '下载学习' }]}
            value={tab}
            onChange={setTab}
          />
        </View>
        <ScrollView key={tab} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          {tab === 'install' ? <Install /> : tab === 'import' ? <Import /> : tab === 'connect' ? <Connect /> : <Study />}
        </ScrollView>
      </View>
    </Modal>
  );
}

function P({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return <Text selectable style={{ color: c.ink2, fontSize: 14.5, lineHeight: 23 }}>{children}</Text>;
}

function Note({ children }: { children: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={[styles.note, { backgroundColor: c.surface2 }]}>
      <Text selectable style={{ color: c.ink2, fontSize: 13, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

/** 一步：序号 + 标题 + 内容 */
function Step({ n, title, children }: { n: number; title: string; children?: React.ReactNode }) {
  const c = useColors();
  return (
    <View style={{ flexDirection: 'row', gap: 12 }}>
      <View style={[styles.num, { backgroundColor: c.accentSoft }]}><Text style={{ color: c.accent, fontWeight: '800' }}>{n}</Text></View>
      <View style={{ flex: 1, gap: 8 }}>
        <Text style={{ color: c.ink, fontSize: 16, fontWeight: '700', lineHeight: 22 }}>{title}</Text>
        {children}
      </View>
    </View>
  );
}

/** 要在电脑上输入的命令：点一下复制 */
function Cmd({ children }: { children: string }) {
  const c = useColors();
  return (
    <Pressable
      onPress={async () => { await Clipboard.setStringAsync(children); ToastAndroid.show('已复制', ToastAndroid.SHORT); }}
      style={[styles.cmd, { backgroundColor: c.surface, borderColor: c.line }]}
    >
      <Text selectable style={{ flex: 1, color: c.ink, fontFamily: 'monospace', fontSize: 12.5, lineHeight: 19 }}>{children}</Text>
      <Copy size={15} color={c.muted} />
    </Pressable>
  );
}

function Install() {
  return (
    <>
      <P>电脑端负责把视频、播客变成「学习包」：下载、语音转文字、AI 校对和翻译、标注音、查词典。手机只负责学习。需要一台 Windows 10 / 11 电脑，有 NVIDIA 显卡转写会快很多，没有显卡也能用，只是慢一些。</P>
      <Step n={1} title="下载安装包">
        <P>在电脑浏览器打开下面的网址，下载 nyahongo-pc-setup.exe（约 16 MB），双击安装。不需要管理员权限。</P>
        <Cmd>https://github.com/ssh1wa/nyahongo/releases</Cmd>
        <Note>国内网络可以勾选安装时的「国内网络」，语音识别模型会从国内镜像下载。</Note>
      </Step>
      <Step n={2} title="第一次打开">
        <P>从开始菜单打开「にゃほんご 电脑端」。第一次会自动下载 Python 和需要的组件（约 2.5 GB），电脑上没有 ffmpeg 的话也会自动装，网速慢要等十几分钟，只有这一次。完成后浏览器会打开电脑端网页。</P>
        <P>打开后有一个黑色窗口，不要关，关掉电脑端就停了。</P>
      </Step>
      <Step n={3} title="填写 AI 的 API Key">
        <P>开始菜单里点「填写 AI Key 和设置（config.toml）」，在 [llm] 下面填上 base_url、api_key 和 model（和手机 App 里用同一家就行），保存后重新打开电脑端。</P>
        <Note>AI 用来校对字幕、加上中文翻译。不填也能用，只是字幕没有中文翻译，识别错的字也不会被纠正。</Note>
      </Step>
      <Note>想自己改代码，也可以下载源码运行：步骤见 GitHub 页面的 README。</Note>
    </>
  );
}

function Import() {
  return (
    <>
      <Step n={1} title="打开电脑端网页">
        <P>打开电脑端后会自动打开；也可以在电脑浏览器里输入：</P>
        <Cmd>http://127.0.0.1:8765</Cmd>
      </Step>
      <Step n={2} title="粘贴链接，或者拖入文件">
        <P>在「今天想看点什么？」下面粘贴 B 站、YouTube 或 niconico 的视频链接，点「开始处理」。一次可以粘贴多行，每行一个。</P>
        <P>电脑里已有的视频、音频文件，直接拖进网页窗口，或者点「选择本地文件」。</P>
      </Step>
      <Step n={3} title="按需勾选">
        <P>· 只保留音频（播客）：不需要画面时勾上，文件小很多{'\n'}· 展开整个合集：B 站多 P、YouTube 播放列表会拆成每集一个{'\n'}· 英语（测试版）：英语视频做成中英双语字幕，手机上要在设置里打开「测试版功能」才能看到</P>
      </Step>
      <Step n={4} title="等它处理完">
        <P>处理队列会显示进度：下载 → 语音转文字 → AI 校对 → 分词查词。视频自带日语字幕时直接用字幕，快很多。一集 20 多分钟的动画，有显卡大约几分钟。</P>
      </Step>
      <Note>YouTube、niconico 在国内需要代理：在 config.toml 的 [download] 里把 proxy 填成你的代理地址，例如 http://127.0.0.1:7890。需要登录才能看的视频，把 cookies_from_browser 填成你登录用的浏览器（edge 或 chrome）。</Note>
    </>
  );
}

function Connect() {
  return (
    <>
      <Step n={1} title="手机和电脑连同一个 Wi-Fi">
        <P>电脑用网线也可以，只要和手机在同一个路由器下。</P>
      </Step>
      <Step n={2} title="找到电脑地址">
        <P>电脑端网页右上角会显示「📱 手机同步：192.168.x.x:8765」这样的地址。</P>
      </Step>
      <Step n={3} title="在 App 里填上">
        <P>App 右上角的设置 → 「同步与词典」→ 电脑地址，填进去，点「测试连接并保存」。显示「已连接电脑」就好了。</P>
      </Step>
      <Note>连不上时检查：{'\n'}· 第一次启动电脑端时，Windows 会弹窗问是否允许网络访问，要选「允许」（专用网络）。点错了可以在「Windows 安全中心 → 防火墙 → 允许应用通过防火墙」里把 Python 勾上{'\n'}· 电脑端的黑色窗口还开着{'\n'}· 手机没有连到别的 Wi-Fi 或者用着流量</Note>
      <Step n={4} title="同一台电脑可以连多台设备">
        <P>手机、平板都填同一个电脑地址，生词本、复习进度、阅读记录、精听进度和猫に小判的进度会通过电脑自动合并同步（设置 → 同步与词典 → 多设备同步）。</P>
      </Step>
    </>
  );
}

function Study() {
  return (
    <>
      <Step n={1} title="下载学习包">
        <P>回到 App 的「精听」页，下拉刷新。「电脑上的学习包」里点「下载」。下载完就存在手机上，出门没有电脑也能学。</P>
      </Step>
      <Step n={2} title="顺便下载离线词典">
        <P>设置 → 同步与词典 → 离线词典，点下载（约 70 MB）。查词会更准、更快，也省 AI 费用。</P>
      </Step>
      <Step n={3} title="逐句精听">
        <P>点开学习包：上面是视频和当前这一句，下面是整篇字幕，点任意一句跳过去。</P>
        <P>· 点句子里的单词：查词典、加入生词本、问 AI 这个词在这里的意思{'\n'}· 长按句子：自由选中任意几个字来复制、查词{'\n'}· 播放键两边是上一句 / 下一句，后面依次是重听这一句、单句循环、每句读完自动暂停{'\n'}· 下面的按钮可以调速度、开关注音、切换译文的显示方式</P>
      </Step>
      <Step n={4} title="复习">
        <P>加进生词本的词会按记忆规律安排复习，在「生词本」页每天复习一下。</P>
      </Step>
    </>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 56 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 18, gap: 20 },
  num: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: -2 },
  note: { padding: 12, borderRadius: radius.md },
  cmd: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10, borderRadius: radius.sm, borderWidth: 1 },
});
