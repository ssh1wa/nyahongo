// 长按选词，像词典 App 一样：长按日文自动选中一个词，拖两端的把手调整范围，上方菜单「复制 / 查词 / 全选」。
// 带注音的日文是一格一格拼出来的（React Native 没有 <ruby>），系统自带的文字选择用不了，所以自己画选区。
// 普通文字（中文讲解、AI 回答）用系统自带的选择，菜单里的「查词」由安卓的 PROCESS_TEXT 提供（plugins/withProcessText.js），
// 点了以后通过 nyahongo://lookup?text=… 回到这里。
import * as Clipboard from 'expo-clipboard';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  Linking, Modal, PanResponder, Pressable, StyleSheet, Text, ToastAndroid, useWindowDimensions, View,
  type GestureResponderEvent,
} from 'react-native';
import { findEntry, longestWord } from '../lib/deinflect';
import { useColors } from '../theme';
import { LookupSheet, type LookupWord } from './LookupSheet';

type Rect = { x: number; y: number; w: number; h: number };
type Selection = { units: string[]; rects: Rect[]; start: number; end: number; zh?: string };
type Lookup = { word: LookupWord; context?: string; contextZh?: string };

const SelectContext = createContext<(s: Selection) => void>(() => {});

export function SelectionProvider({ children }: { children: React.ReactNode }) {
  const [sel, setSel] = useState<Selection | null>(null);
  const [lookup, setLookup] = useState<Lookup | null>(null);

  const openLookup = useCallback(async (text: string, context?: string, contextZh?: string) => {
    const found = await findEntry(text);
    setLookup({ word: { surface: text, base: found?.base ?? text }, context, contextZh });
  }, []);

  // 系统菜单「查词」（App 内外选中的文字都会走到这里）
  useEffect(() => {
    const handle = (url: string | null) => {
      const m = url?.match(/^nyahongo:\/\/lookup\?text=(.*)$/);
      if (m) void openLookup(decodeURIComponent(m[1]).trim());
    };
    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', ({ url }) => handle(url));
    return () => sub.remove();
  }, [openLookup]);

  return (
    <SelectContext.Provider value={setSel}>
      {children}
      {sel ? (
        <SelectionOverlay
          sel={sel}
          onChange={setSel}
          onClose={() => setSel(null)}
          onLookup={(text) => {
            const context = sel.units.join('');
            setSel(null);
            void openLookup(text, context, sel.zh);
          }}
        />
      ) : null}
      {lookup ? <LookupSheet word={lookup.word} context={lookup.context} contextZh={lookup.contextZh} onClose={() => setLookup(null)} /> : null}
    </SelectContext.Provider>
  );
}

/** 找离手指最近的一格。行优先：先看纵向距离 */
function nearest(rects: Rect[], x: number, y: number): number {
  let best = -1;
  let bestD = Infinity;
  rects.forEach((r, i) => {
    const dx = x < r.x ? r.x - x : x > r.x + r.w ? x - r.x - r.w : 0;
    const dy = y < r.y ? r.y - y : y > r.y + r.h ? y - r.y - r.h : 0;
    const d = dy * 4 + dx;
    if (d < bestD) { bestD = d; best = i; }
  });
  return best;
}

const LONG_PRESS_MS = 400;

/**
 * 给一段分格渲染的日文加上长按选词。units 是每一格的文字，返回：
 * - cellRef(i)：挂到第 i 格的 View 上，用来量位置
 * - touch：挂到整段文字最外层的 View 上（只监听触摸，不抢点按，外层的 Pressable 照常工作）
 * 外层如果是 Pressable，要给它设 onLongPress（空函数也行），不然长按松手时会被当成一次点按。
 */
export function useSelectable(units: string[], zh?: string) {
  const begin = useContext(SelectContext);
  const refs = useRef<Array<View | null>>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const origin = useRef({ x: 0, y: 0 });

  const cancel = () => { if (timer.current) { clearTimeout(timer.current); timer.current = null; } };
  useEffect(() => cancel, []);

  const fire = useCallback(async () => {
    timer.current = null;
    const rects = await Promise.all(units.map((_, i) => new Promise<Rect>((resolve) => {
      const v = refs.current[i];
      if (!v) resolve({ x: -9999, y: -9999, w: 0, h: 0 });
      else v.measureInWindow((x, y, w, h) => resolve({ x, y, w, h }));
    })));
    const i = nearest(rects, origin.current.x, origin.current.y);
    if (i < 0) return;
    const [start, end] = await longestWord(units, i);
    begin({ units, rects, start, end, zh });
  }, [units, zh, begin]);

  const touch = useMemo(() => ({
    onTouchStart: (e: GestureResponderEvent) => {
      cancel();
      origin.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
      timer.current = setTimeout(() => void fire(), LONG_PRESS_MS);
    },
    onTouchMove: (e: GestureResponderEvent) => {
      if (Math.abs(e.nativeEvent.pageX - origin.current.x) > 10 || Math.abs(e.nativeEvent.pageY - origin.current.y) > 10) cancel();
    },
    onTouchEnd: cancel,
    onTouchCancel: cancel,
  }), [fire]);

  const cellRef = useCallback((i: number) => (v: View | null) => { refs.current[i] = v; }, []);
  return { cellRef, touch };
}

// ---------- 选区：高亮、两个把手、菜单 ----------

const HANDLE = 26;

function SelectionOverlay({ sel, onChange, onClose, onLookup }: {
  sel: Selection; onChange: (s: Selection) => void; onClose: () => void; onLookup: (text: string) => void;
}) {
  const c = useColors();
  const win = useWindowDimensions();
  const { rects, start, end } = sel;
  const text = sel.units.slice(start, end + 1).join('');
  const latest = useRef(sel);
  latest.current = sel;

  // 把手在文字下方，手指按在把手上，所以换算回文字那一行时往上挪一点
  const handlePan = (which: 'start' | 'end') => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onPanResponderMove: (e) => {
      const s = latest.current;
      const r = s.rects[which === 'start' ? s.start : s.end];
      const i = nearest(s.rects, e.nativeEvent.pageX, e.nativeEvent.pageY - HANDLE / 2 - r.h / 2);
      if (i < 0) return;
      if (which === 'start' && i <= s.end && i !== s.start) onChange({ ...s, start: i });
      if (which === 'end' && i >= s.start && i !== s.end) onChange({ ...s, end: i });
    },
  });
  // 只建一次，拖动中读最新的选区
  const startPan = useMemo(() => handlePan('start'), []); // eslint-disable-line react-hooks/exhaustive-deps
  const endPan = useMemo(() => handlePan('end'), []); // eslint-disable-line react-hooks/exhaustive-deps

  const first = rects[start];
  const last = rects[end];
  const top = Math.min(...rects.slice(start, end + 1).map((r) => r.y));
  const menuW = 210;
  const menuX = Math.max(8, Math.min(win.width - menuW - 8, (first.x + last.x + last.w) / 2 - menuW / 2));
  const menuY = top > 70 ? top - 54 : last.y + last.h + HANDLE + 8;

  const copy = async () => {
    await Clipboard.setStringAsync(text);
    ToastAndroid.show('已复制', ToastAndroid.SHORT);
    onClose();
  };

  return (
    <Modal transparent visible statusBarTranslucent navigationBarTranslucent onRequestClose={onClose} animationType="none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
      {rects.slice(start, end + 1).map((r, k) => (
        <View key={k} pointerEvents="none" style={[styles.mark, { left: r.x, top: r.y, width: r.w, height: r.h, backgroundColor: c.accent }]} />
      ))}
      <View {...startPan.panHandlers} style={[styles.handle, { left: first.x - HANDLE, top: first.y + first.h, backgroundColor: c.accent, borderTopRightRadius: 0 }]} />
      <View {...endPan.panHandlers} style={[styles.handle, { left: last.x + last.w, top: last.y + last.h, backgroundColor: c.accent, borderTopLeftRadius: 0 }]} />
      <View style={[styles.menu, { left: menuX, top: menuY, width: menuW, backgroundColor: c.ink }]}>
        <MenuItem label="复制" color={c.bg} onPress={copy} />
        <MenuItem label="查词" color={c.bg} onPress={() => onLookup(text)} />
        <MenuItem label="全选" color={c.bg} onPress={() => onChange({ ...sel, start: 0, end: sel.units.length - 1 })} />
      </View>
    </Modal>
  );
}

function MenuItem({ label, color, onPress }: { label: string; color: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.item, pressed && { opacity: 0.6 }]}>
      <Text style={{ color, fontSize: 14.5, fontWeight: '600' }}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  mark: { position: 'absolute', opacity: 0.22, borderRadius: 2 },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, borderRadius: HANDLE / 2 },
  menu: { position: 'absolute', height: 42, borderRadius: 10, flexDirection: 'row', alignItems: 'center', elevation: 6 },
  item: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'center' },
});
