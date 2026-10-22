// 猫屋的仓库（蔵）：小判（三方上）和毛玉（竹篮里）靠墙放在右上角，前面的地板上随手堆着宝箱，近大远小。
// 点宝箱开箱，点空地板添一个宝箱，点小判、毛玉看说明。素材和摆放位置见 art/tools/storeroom.py
import { Canvas } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { META, pixelScale, Sub, useImages } from './Sprites';

const STORE = META.store;
const SIZE = { S: STORE.chest, L: STORE.big } as const;
const MAX_SHOWN = STORE.spots.length;

/** 小判、毛玉多少决定画哪一帧（空 / 一点 / 很多） */
const kobanLevel = (n: number) => (n < 10 ? 0 : n < 100 ? 1 : 2);
const yarnLevel = (n: number) => (n <= 0 ? 0 : n < 40 ? 1 : 2);

export type StoreTarget = 'chest' | 'floor' | 'koban' | 'yarn';

export function Storeroom({ width, coins, chests, shards, onPress }: {
  width: number; coins: number; chests: number; shards: number; onPress: (t: StoreTarget) => void;
}) {
  const img = useImages();
  const s = pixelScale(width, STORE.w);
  const w = STORE.w * s;
  const h = STORE.h * s;

  // 摆出来的宝箱（按出现顺序先摆前排），画的时候后面的先画
  const shown = useMemo(() => STORE.spots
    .slice(0, Math.min(chests, MAX_SHOWN))
    .map(([x, y, size], i) => ({ i, x, y, size: size as keyof typeof SIZE }))
    .sort((a, b) => a.y - b.y), [chests]);

  // 时不时有一个宝箱闪一下或者跳一下
  const [anim, setAnim] = useState<{ i: number; frame: number } | null>(null);
  useEffect(() => {
    if (!chests) return;
    let off: ReturnType<typeof setTimeout> | undefined;
    const t = setInterval(() => {
      setAnim({ i: Math.floor(Math.random() * Math.min(chests, MAX_SHOWN)), frame: Math.random() < 0.6 ? 1 : 2 });
      off = setTimeout(() => setAnim(null), 260);
    }, 2400);
    return () => { clearInterval(t); clearTimeout(off); };
  }, [chests]);

  const [kx, ky, kw, kh] = STORE.koban;
  const [yx, yy, yw, yh] = STORE.yarn;
  const frameOf = (i: number) => (anim?.i === i ? anim.frame : 0);

  return (
    <View style={{ width, height: h, alignItems: 'center' }}>
      <View style={{ width: w, height: h }}>
        <Canvas style={{ width: w, height: h }}>
          <Sub image={img?.store.bg ?? null} sx={0} sy={0} sw={STORE.w} sh={STORE.h} x={0} y={0} scale={s} />
          <Sub image={img?.store.koban ?? null} sx={kobanLevel(coins) * kw} sy={0} sw={kw} sh={kh} x={kx * s} y={ky * s} scale={s} />
          <Sub image={img?.store.yarn ?? null} sx={yarnLevel(shards) * yw} sy={0} sw={yw} sh={yh} x={yx * s} y={yy * s} scale={s} />
          {shown.map((c) => {
            const [cw, ch] = SIZE[c.size];
            return (
              <Sub
                key={c.i}
                image={(c.size === 'L' ? img?.store.chestBig : img?.store.chest) ?? null}
                sx={frameOf(c.i) * cw} sy={0} sw={cw} sh={ch} x={c.x * s} y={c.y * s} scale={s}
              />
            );
          })}
        </Canvas>

        {/* 点的区域：先铺满地板（添宝箱），上面再放小判、毛玉、每个宝箱 */}
        <Pressable onPress={() => onPress('floor')} style={[styles.hit, { left: 0, top: STORE.floor * s, width: w, height: h - STORE.floor * s }]} accessibilityLabel="添一个宝箱" />
        <Pressable onPress={() => onPress('koban')} style={[styles.hit, { left: kx * s, top: ky * s, width: kw * s, height: kh * s }]} accessibilityLabel="小判" />
        <Pressable onPress={() => onPress('yarn')} style={[styles.hit, { left: yx * s, top: yy * s, width: yw * s, height: yh * s }]} accessibilityLabel="毛玉" />
        {shown.map((c) => {
          const [cw, ch] = SIZE[c.size];
          return (
            <Pressable
              key={c.i}
              onPress={() => onPress('chest')}
              style={[styles.hit, { left: c.x * s, top: c.y * s, width: cw * s, height: ch * s }]}
              accessibilityLabel="开宝箱"
            />
          );
        })}

        {/* 数量：小判、毛玉在它们上方，宝箱数在左边墙上 */}
        <Badge text={`小判 ${Math.floor(coins)}`} cx={(kx + kw / 2) * s} top={(ky + 6) * s - 22} />
        <Badge text={`毛玉 ${shards}`} cx={(yx + yw / 2) * s} top={(yy + 6) * s - 22} />
        {chests > 0 ? <Badge text={`宝箱 ${chests}`} cx={36 * s} top={12 * s} /> : null}
      </View>
    </View>
  );
}

function Badge({ text, cx, top }: { text: string; cx: number; top: number }) {
  return (
    <View pointerEvents="none" style={[styles.badge, { top, left: cx - 45, width: 90 }]}>
      <Text style={styles.badgeText}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  hit: { position: 'absolute' },
  badge: { position: 'absolute', alignItems: 'center' },
  badgeText: {
    color: '#FFF8E8', fontSize: 12, fontWeight: '800', backgroundColor: 'rgba(43,32,22,0.72)',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999, overflow: 'hidden',
  },
});
