import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { BookMarked, BookOpenText, GraduationCap, Headphones, Languages } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, AppState, Linking, Pressable, StyleSheet, Text, ToastAndroid, useWindowDimensions, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { markActive, setForeground, tick } from './src/lib/game';
import { autoSync, onSynced } from './src/lib/sync';
import { autoCheckUpdate, plainNotes, skipUpdate } from './src/lib/updates';
import { NavContext, type Nav, type TabId } from './src/nav';
import { SpriteProvider } from './src/game/Sprites';
import { SelectionProvider } from './src/components/Selection';
import { Welcome } from './src/components/Welcome';
import { CatRoomScreen } from './src/screens/CatRoomScreen';
import { GrammarScreen } from './src/screens/GrammarScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { ReadingScreen } from './src/screens/ReadingScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TranslateScreen } from './src/screens/TranslateScreen';
import { WordbookScreen } from './src/screens/WordbookScreen';
import { CONTENT_MAX, ThemeProvider, useColors } from './src/theme';

const TABS: Array<{ id: TabId; label: string; Icon: typeof Languages }> = [
  { id: 'translate', label: '翻译', Icon: Languages },
  { id: 'reading', label: '阅读', Icon: BookOpenText },
  { id: 'listen', label: '精听', Icon: Headphones },
  { id: 'grammar', label: '语法', Icon: GraduationCap },
  { id: 'words', label: '生词本', Icon: BookMarked },
];

function Main() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const win = useWindowDimensions();
  // 横屏：标签栏放到左边竖着排，把高度留给内容
  const rail = win.width > win.height;
  const [tab, setTab] = useState<TabId>('translate');
  const [playing, setPlaying] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [catRoomOpen, setCatRoomOpen] = useState(false);
  // 切过的标签保持挂载，切回来时页面状态还在（比如读到一半的文章）
  const [mounted, setMounted] = useState<Set<TabId>>(new Set(['translate']));

  useEffect(() => { void SystemUI.setBackgroundColorAsync(c.bg); }, [c.bg]);

  // 有效学习计时：前台 + 最近有操作。纯净模式下也照常记（只是不显示）
  useEffect(() => {
    markActive();
    // 多设备同步：打开时、切回来时拉取别的设备的进度，退到后台时把这台的推上去
    void autoSync();
    const sub = AppState.addEventListener('change', (s) => {
      setForeground(s === 'active');
      if (s === 'active') markActive();
      if (s === 'active' || s === 'background') void autoSync();
    });
    const off = onSynced((r) => { if (r.ok && r.changes) ToastAndroid.show(`已从其他设备同步 ${r.changes} 项`, ToastAndroid.SHORT); });
    const timer = setInterval(() => tick(15), 15000);
    return () => { sub.remove(); off(); clearInterval(timer); };
  }, []);

  // 检查更新：打开几秒后查一次（一天最多一次），有新版本弹窗问一下
  useEffect(() => {
    const t = setTimeout(async () => {
      const u = await autoCheckUpdate();
      if (!u) return;
      const notes = plainNotes(u.notes);
      Alert.alert(`发现新版本 v${u.latest}`, `${notes.length > 400 ? `${notes.slice(0, 400)}…` : notes}\n\n现在是 v${u.current}。下载后直接安装，学习记录会保留。`, [
        { text: '以后再说', style: 'cancel', onPress: () => void skipUpdate(u.latest) },
        { text: '下载', onPress: () => void Linking.openURL(u.apk ?? u.url) },
      ]);
    }, 4000);
    return () => clearTimeout(t);
  }, []);

  const goTab = useCallback((t: TabId) => {
    setTab(t);
    setMounted((m) => (m.has(t) ? m : new Set(m).add(t)));
  }, []);
  const nav: Nav = useMemo(() => ({
    openSettings: () => setSettingsOpen(true),
    openPlayer: (id: string) => setPlaying(id),
    openCatRoom: () => setCatRoomOpen(true),
    goTab,
  }), [goTab]);

  const closePlayer = useCallback(() => setPlaying(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const closeCatRoom = useCallback(() => setCatRoomOpen(false), []);

  return (
    <NavContext.Provider value={nav}>
      <SelectionProvider>
      {/* 只观察触摸、不拦截：用来判断用户是不是在操作 */}
      <View style={{ flex: 1 }} onStartShouldSetResponderCapture={() => { markActive(); return false; }}>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top, flexDirection: rail ? 'row-reverse' : 'column' }]}>
        <View style={{ flex: 1, paddingRight: rail ? insets.right : 0 }}>
          <View style={styles.page}>
            {TABS.map(({ id }) => (mounted.has(id) ? (
              <View key={id} style={[StyleSheet.absoluteFill, { display: tab === id ? 'flex' : 'none' }]}>
                {id === 'translate' ? <TranslateScreen /> : null}
                {id === 'reading' ? <ReadingScreen /> : null}
                {id === 'listen' ? <LibraryScreen active={tab === 'listen'} /> : null}
                {id === 'grammar' ? <GrammarScreen /> : null}
                {id === 'words' ? <WordbookScreen active={tab === 'words'} /> : null}
              </View>
            ) : null))}
          </View>
        </View>
        <View style={[rail ? styles.rail : styles.tabs, { borderColor: c.line, backgroundColor: c.surface }, rail ? { paddingLeft: insets.left + 4 } : { paddingBottom: insets.bottom + 6 }]}>
          {TABS.map(({ id, label, Icon }) => {
            const on = tab === id;
            return (
              <Pressable key={id} onPress={() => goTab(id)} style={rail ? styles.railTab : styles.tab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
                {/* 背景色始终要设（未选中时透明）：安卓上中途才加背景色时圆角会失效，变成直角方块 */}
                <View style={[styles.pill, { backgroundColor: on ? c.accentSoft : 'transparent' }]}>
                  <Icon size={21} color={on ? c.accent : c.muted} strokeWidth={on ? 2.3 : 1.9} />
                </View>
                <Text style={{ fontSize: 11, color: on ? c.accent : c.muted, fontWeight: on ? '700' : '500' }}>{label}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
      {playing ? <View style={StyleSheet.absoluteFill}><PlayerScreen id={playing} onClose={closePlayer} /></View> : null}
      {settingsOpen ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}><View style={styles.page}><SettingsScreen onBack={closeSettings} /></View></View> : null}
      {catRoomOpen ? <View style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}><View style={styles.page}><CatRoomScreen onBack={closeCatRoom} /></View></View> : null}
      </View>
      <Welcome />
      </SelectionProvider>
    </NavContext.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <SpriteProvider>
          <Main />
        </SpriteProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, width: '100%', maxWidth: CONTENT_MAX, alignSelf: 'center' },
  root: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  rail: { borderRightWidth: StyleSheet.hairlineWidth, paddingHorizontal: 6, justifyContent: 'center', gap: 10 },
  railTab: { alignItems: 'center', gap: 3, paddingVertical: 4 },
  pill: { width: 56, height: 30, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
