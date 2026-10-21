// 右上角的学习伙伴：显示当前的猫，学习时冒出「+N」，有宝箱时带个小红点。点它进「猫の部屋」。
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { getGame, onGame, type GameState } from '../lib/game';
import { useNav } from '../nav';
import { useColors, useTheme } from '../theme';
import { PixelCat } from './PixelCat';

/** 订阅游戏状态 */
export function useGame(): GameState | null {
  const [state, setState] = useState<GameState | null>(null);
  useEffect(() => {
    let alive = true;
    void getGame().then((s) => alive && setState({ ...s }));
    const off = onGame((e) => { if (e.type === 'state') setState({ ...e.state }); });
    return () => { alive = false; off(); };
  }, []);
  return state;
}

export function Companion() {
  const c = useColors();
  const nav = useNav();
  const { prefs } = useTheme();
  const game = useGame();
  const [bubble, setBubble] = useState<{ text: string; n: number } | null>(null);
  const anim = useRef(new Animated.Value(0)).current;
  const hop = useRef(new Animated.Value(0)).current;

  useEffect(() => onGame((e) => {
    if (e.type === 'state') return;
    const text = e.type === 'chest' ? '宝箱 +1' : `+${Math.round(e.points * 10) / 10}`;
    setBubble((b) => ({ text, n: (b?.n ?? 0) + 1 }));
    anim.setValue(0);
    Animated.timing(anim, { toValue: 1, duration: 1400, useNativeDriver: true }).start();
    Animated.sequence([
      Animated.timing(hop, { toValue: -4, duration: 110, useNativeDriver: true }),
      Animated.timing(hop, { toValue: 0, duration: 140, useNativeDriver: true }),
    ]).start();
  }), [anim, hop]);

  if (!prefs.companion || !game) return null;
  return (
    <Pressable onPress={nav.openCatRoom} hitSlop={6} style={styles.wrap} accessibilityLabel="猫の部屋">
      <Animated.View style={{ transform: [{ translateY: hop }] }}>
        <PixelCat cat={game.equipped.cat} hat={game.equipped.hat} size={34} />
      </Animated.View>
      {game.chests > 0 ? <View style={[styles.dot, { backgroundColor: c.accent, borderColor: c.bg }]} /> : null}
      {bubble ? (
        <Animated.View
          key={bubble.n}
          pointerEvents="none"
          style={[styles.bubble, {
            backgroundColor: c.accent,
            opacity: anim.interpolate({ inputRange: [0, 0.15, 0.75, 1], outputRange: [0, 1, 1, 0] }),
            transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [6, -14] }) }],
          }]}
        >
          <Text style={{ color: c.accentInk, fontSize: 11, fontWeight: '800' }}>{bubble.text}</Text>
        </Animated.View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  dot: { position: 'absolute', right: 2, top: 4, width: 10, height: 10, borderRadius: 5, borderWidth: 2 },
  bubble: { position: 'absolute', top: -8, paddingHorizontal: 6, paddingVertical: 1, borderRadius: 8 },
});
