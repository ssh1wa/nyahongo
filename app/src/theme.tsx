// 主题：深浅色 + 主题色 + 日文字号。设置保存在本地数据库，改了立刻生效。
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useColorScheme } from 'react-native';
import { kvGet, kvSet } from './lib/db';

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentId = 'shu' | 'ai' | 'wakatake' | 'sakura' | 'sumi';

export const ACCENTS: Record<AccentId, { name: string; light: string; dark: string; lightSoft: string; darkSoft: string }> = {
  shu: { name: '朱', light: '#C8553D', dark: '#E07A5F', lightSoft: '#F6E3DC', darkSoft: '#3A2621' },
  ai: { name: '藍', light: '#2F5D8A', dark: '#7FA8D4', lightSoft: '#DFE8F2', darkSoft: '#1F2B38' },
  wakatake: { name: '若竹', light: '#3F7D58', dark: '#86C29B', lightSoft: '#DDEDE2', darkSoft: '#1E2E24' },
  sakura: { name: '桜', light: '#B95A7A', dark: '#E29AB3', lightSoft: '#F5E1E8', darkSoft: '#3A2430' },
  sumi: { name: '墨', light: '#3D3A36', dark: '#D8D2C8', lightSoft: '#E8E4DC', darkSoft: '#2E2B27' },
};

export const TEXT_SCALES = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.15, label: '大' },
  { value: 1.3, label: '特大' },
];

export type Prefs = {
  themeMode: ThemeMode;
  accent: AccentId;
  textScale: number;
  showRuby: boolean; // 默认显示注音
  zhMode: 'show' | 'tap' | 'hidden'; // 默认整句译文显示方式
  companion: boolean; // 学习伙伴（小游戏）；关掉就是纯净模式，学习时长照常记录
};

export const DEFAULT_PREFS: Prefs = { themeMode: 'system', accent: 'shu', textScale: 1, showRuby: true, zhMode: 'tap', companion: true };

const base = {
  light: {
    bg: '#F5F1E8', surface: '#FFFDF8', surface2: '#F0EBE0', ink: '#26221D', ink2: '#5B544B', muted: '#8C8478', line: '#E3DCCD',
    ok: '#4F7A5A', okSoft: '#E1EDE3', warn: '#B7791F', warnSoft: '#F7EBD6', err: '#B3402F', errSoft: '#F7E0DC', ruby: '#A0583F',
    accentInk: '#FFFFFF', shadow: 'rgba(60,45,30,0.10)',
  },
  dark: {
    bg: '#161412', surface: '#1F1C19', surface2: '#29251F', ink: '#EDE7DD', ink2: '#C4BCB0', muted: '#8F877B', line: '#353029',
    ok: '#8FBF98', okSoft: '#22302A', warn: '#E0B160', warnSoft: '#3A2F1C', err: '#F0897A', errSoft: '#3B2320', ruby: '#E3A487',
    accentInk: '#1A1512', shadow: 'rgba(0,0,0,0.4)',
  },
};

export type Colors = typeof base.light & { accent: string; accentSoft: string; dark: boolean };

function makeColors(dark: boolean, accent: AccentId): Colors {
  const a = ACCENTS[accent];
  return {
    ...(dark ? base.dark : base.light),
    accent: dark ? a.dark : a.light,
    accentSoft: dark ? a.darkSoft : a.lightSoft,
    // 墨色主题在深色模式下主色是浅色，按钮上的字要用深色
    accentInk: dark ? '#16130F' : '#FFFFFF',
    ruby: accent === 'shu' ? (dark ? base.dark.ruby : base.light.ruby) : dark ? a.dark : a.light,
    dark,
  };
}

type ThemeValue = { colors: Colors; prefs: Prefs; setPrefs: (patch: Partial<Prefs>) => void; scale: number };

const ThemeContext = createContext<ThemeValue>({
  colors: makeColors(false, 'shu'),
  prefs: DEFAULT_PREFS,
  setPrefs: () => {},
  scale: 1,
});

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const [prefs, setPrefsState] = useState<Prefs>(DEFAULT_PREFS);
  useEffect(() => {
    kvGet<Partial<Prefs>>('prefs', {}).then((p) => setPrefsState({ ...DEFAULT_PREFS, ...p }));
  }, []);
  const setPrefs = useCallback((patch: Partial<Prefs>) => {
    setPrefsState((cur) => {
      const next = { ...cur, ...patch };
      void kvSet('prefs', next);
      return next;
    });
  }, []);
  const dark = prefs.themeMode === 'system' ? system === 'dark' : prefs.themeMode === 'dark';
  const value = useMemo(
    () => ({ colors: makeColors(dark, prefs.accent), prefs, setPrefs, scale: prefs.textScale }),
    [dark, prefs, setPrefs],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
export const useColors = () => useContext(ThemeContext).colors;
export const useScale = () => useContext(ThemeContext).scale;

export const radius = { sm: 8, md: 12, lg: 16, xl: 22 };

// 不用 'serif'：有的安卓系统自带的衬线中文字体缺字（实测小米上「貞」显示不出来）
export const fonts = { jaSerif: undefined as string | undefined };
