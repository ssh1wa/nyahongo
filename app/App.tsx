import { StatusBar } from 'expo-status-bar';
import { BookMarked, Languages, Library, PencilLine, Settings } from 'lucide-react-native';
import React, { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { LibraryScreen } from './src/screens/LibraryScreen';
import { PlayerScreen } from './src/screens/PlayerScreen';
import { PracticeScreen } from './src/screens/PracticeScreen';
import { SettingsScreen } from './src/screens/SettingsScreen';
import { TranslateScreen } from './src/screens/TranslateScreen';
import { WordbookScreen } from './src/screens/WordbookScreen';
import { useColors } from './src/theme';

type Tab = 'library' | 'words' | 'translate' | 'practice' | 'settings';

const TABS: Array<{ id: Tab; label: string; Icon: typeof Library }> = [
  { id: 'library', label: '学习库', Icon: Library },
  { id: 'words', label: '生词本', Icon: BookMarked },
  { id: 'translate', label: '翻译', Icon: Languages },
  { id: 'practice', label: '练习', Icon: PencilLine },
  { id: 'settings', label: '设置', Icon: Settings },
];

function Main() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const [tab, setTab] = useState<Tab>('library');
  const [playing, setPlaying] = useState<string | null>(null);
  const [reviewRequest, setReviewRequest] = useState(false);
  const closePlayer = useCallback(() => setPlaying(null), []);
  const goSettings = useCallback(() => setTab('settings'), []);

  if (playing) {
    return (
      <>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
        <PlayerScreen id={playing} onClose={closePlayer} />
      </>
    );
  }

  return (
    <View style={[styles.root, { backgroundColor: c.bg, paddingTop: insets.top }]}>
      <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      <View style={{ flex: 1 }}>
        {tab === 'library' ? (
          <LibraryScreen onOpen={setPlaying} onGoSettings={goSettings} onGoReview={() => { setReviewRequest(true); setTab('words'); }} />
        ) : null}
        {tab === 'words' ? <WordbookScreen startReview={reviewRequest} onReviewStarted={() => setReviewRequest(false)} /> : null}
        {tab === 'translate' ? <TranslateScreen onNeedSettings={goSettings} /> : null}
        {tab === 'practice' ? <PracticeScreen onNeedSettings={goSettings} /> : null}
        {tab === 'settings' ? <SettingsScreen /> : null}
      </View>
      <View style={[styles.tabs, { borderColor: c.line, backgroundColor: c.surface, paddingBottom: insets.bottom + 4 }]}>
        {TABS.map(({ id, label, Icon }) => {
          const on = tab === id;
          return (
            <Pressable key={id} onPress={() => setTab(id)} style={styles.tab}>
              <Icon size={21} color={on ? c.accent : c.muted} />
              <Text style={{ fontSize: 11, color: on ? c.accent : c.muted, fontWeight: on ? '700' : '500' }}>{label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  tabs: { flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6 },
  tab: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 2 },
});
