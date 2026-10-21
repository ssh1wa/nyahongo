import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { BookMarked, BookOpenText, GraduationCap, Headphones, Languages } from 'lucide-react-native';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { NavContext, type Nav, type TabId } from './src/nav';
import { GrammarScreen } from './src/screens/GrammarScreen';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { ReadingScreen } from './src/screens/ReadingScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TranslateScreen } from './src/screens/TranslateScreen';
import { WordbookScreen } from './src/screens/WordbookScreen';
import { ThemeProvider, useColors } from './src/theme';

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
  const [tab, setTab] = useState<TabId>('translate');
  const [playing, setPlaying] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // 切过的标签保持挂载，切回来时页面状态还在（比如读到一半的文章）
  const [mounted, setMounted] = useState<Set<TabId>>(new Set(['translate']));

  useEffect(() => { void SystemUI.setBackgroundColorAsync(c.bg); }, [c.bg]);

  const goTab = useCallback((t: TabId) => {
    setTab(t);
    setMounted((m) => (m.has(t) ? m : new Set(m).add(t)));
  }, []);
  const nav: Nav = useMemo(() => ({
    openSettings: () => setSettingsOpen(true),
    openPlayer: (id: string) => setPlaying(id),
    goTab,
  }), [goTab]);

  const closePlayer = useCallback(() => setPlaying(null), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  return (
    <NavContext.Provider value={nav}>
      <StatusBar style={c.dark ? 'light' : 'dark'} />
      <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
        <View style={{ flex: 1 }}>
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
        <View style={[styles.tabs, { borderColor: c.line, backgroundColor: c.surface, paddingBottom: insets.bottom + 6 }]}>
          {TABS.map(({ id, label, Icon }) => {
            const on = tab === id;
            return (
              <Pressable key={id} onPress={() => goTab(id)} style={styles.tab} accessibilityRole="tab" accessibilityState={{ selected: on }}>
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
      {settingsOpen ? <View style={StyleSheet.absoluteFill}><SettingsScreen onBack={closeSettings} /></View> : null}
    </NavContext.Provider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Main />
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 8 },
  tab: { flex: 1, alignItems: 'center', gap: 3 },
  pill: { width: 56, height: 30, borderRadius: 15, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
});
