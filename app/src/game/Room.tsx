// 猫の部屋：场景 + 家具 + 最多 3 只自由活动的猫。一张 Skia 画布，按纵向位置排先后（下面的挡住上面的）。
// 猫的行为是个小状态机：坐着（呼吸、随机眨眼）→ 理毛 / 起身走到别处 / 趴下打盹 / 扑着玩 / 伸懒腰……状态之间都有过渡动作。
// 编辑模式下猫停下来，猫和家具都能拖动；拖到房间外面就收起。
import { Canvas, Group, Rect, rect as skRect } from '@shopify/react-native-skia';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, Text, View } from 'react-native';
import { ITEM_BY_ID } from '../lib/catalog';
import { onGame, type Room as RoomState } from '../lib/game';
import { META, Sub, pixelScale, useImages } from './Sprites';

export const ROOM_W = 160;
export const ROOM_H = 96;
const FLOOR_Y0 = 68; // 猫脚底能走到的最上（最远）一行
const FLOOR_Y1 = 93;
const X0 = 18;
const X1 = 142;
const ANCHOR_X = 23; // 动画帧里猫脚底中点
const ANCHOR_Y = 39;

const A = META.anims as unknown as Record<string, number[]>;
const HEAD = META.head as unknown as Record<string, number[][]>;
const CATS = META.cats as unknown as Record<string, { index: number; body: string }>;
const HATS = META.hats as readonly string[];
const FURN = META.furniture as readonly string[];
const FOOT = META.furnitureFoot as unknown as Record<string, number[]>;

type State = 'sit' | 'groom' | 'lieDown' | 'sleep' | 'wake' | 'standUp' | 'walk' | 'stand' | 'stretch' | 'sitDown' | 'play' | 'happy' | 'held' | 'land';

// 每个状态的帧序列（动画里的第几帧，重复几次就是停留几格，每格 100ms）
const rep = (frames: number[], n: number) => frames.flatMap((f) => Array(n).fill(f));
const SEQ: Record<State, number[]> = {
  sit: rep(A.idle, 3),
  groom: [0, 0, 1, 1, 2, 2, 1, 1, 2, 2, 3, 3, 3, 4, 4, 5].map((i) => A.groom[i]),
  lieDown: rep(A.lie, 2),
  sleep: rep(A.sleep, 4),
  wake: rep([...A.lie].reverse(), 2),
  standUp: rep(A.sit_stand, 2),
  walk: A.walk,
  stand: rep(A.stand, 4),
  stretch: [0, 1, 2, 2, 3, 3, 3, 3, 2, 4, 5].map((i) => A.stretch[i]),
  sitDown: rep([...A.sit_stand].reverse(), 2),
  play: [1, 1, 2, 1, 2, 1, 3, 4, 4, 5].map((i) => A.play[i]),
  happy: [1, 1, 2, 3, 3, 4, 5, 5].map((i) => A.happy[i]),
  held: [A.happy[3]], // 被拎起来：举着爪子
  land: [A.happy[4], A.happy[4], A.happy[5]], // 放下：落地压扁一下
};
const LOOP: Partial<Record<State, true>> = { sit: true, groom: true, sleep: true, walk: true, stand: true, held: true };

// 点猫时它说的话（都是简单的平假名，顺便认字）
const TALK = ['にゃー', 'にゃ？', 'ごろごろ…', 'なでて！', 'あそぼう！', 'がんばって！', 'べんきょう、えらい！', 'すき！', 'おなかすいた', 'いっしょにがんばろう'];

// 5×4 的像素爱心
const HEART = ['.#.#.', '#####', '.###.', '..#..'];
type Fx = { x: number; y: number; t: number };
const BLINK = [A.blink[0], A.blink[1], A.blink[1], A.blink[0]];

type Agent = {
  id: string; x: number; y: number; face: 1 | -1;
  state: State; t: number; until: number; // 进入这个状态后过了几格、循环状态持续到第几格
  tx: number; ty: number; blinkAt: number; after?: State;
};

const rnd = (a: number, b: number) => a + Math.random() * (b - a);

function spot(furn: RoomState['furniture'], others: Agent[]): { x: number; y: number } {
  for (let k = 0; k < 12; k++) {
    const x = rnd(X0, X1), y = rnd(FLOOR_Y0 + 4, FLOOR_Y1 - 2);
    const hitF = furn.some((f) => Math.abs(f.x - x) < 18 && Math.abs(f.y - y) < 8);
    const hitC = others.some((o) => Math.abs(o.x - x) < 16 && Math.abs(o.y - y) < 6);
    if (!hitF && !hitC) return { x, y };
  }
  return { x: rnd(X0, X1), y: rnd(FLOOR_Y0 + 4, FLOOR_Y1 - 2) };
}

function enter(a: Agent, state: State, ticks = 0) {
  a.state = state;
  a.t = 0;
  a.until = ticks;
}

/** 循环状态结束后选下一件事 */
function decide(a: Agent, furn: RoomState['furniture'], all: Agent[]) {
  if (a.state === 'sit') {
    const r = Math.random();
    if (r < 0.38) {
      const p = spot(furn, all.filter((o) => o !== a));
      a.tx = p.x; a.ty = p.y;
      enter(a, 'standUp');
    } else if (r < 0.58) enter(a, 'groom', Math.round(rnd(30, 60)));
    else if (r < 0.72) enter(a, 'lieDown');
    else if (r < 0.82) enter(a, 'play');
    else enter(a, 'sit', Math.round(rnd(40, 80)));
  } else if (a.state === 'groom') enter(a, 'sit', Math.round(rnd(30, 70)));
  else if (a.state === 'sleep') enter(a, 'wake');
  else if (a.state === 'stand') {
    if (Math.random() < 0.3) {
      const p = spot(furn, all.filter((o) => o !== a));
      a.tx = p.x; a.ty = p.y;
      enter(a, 'walk');
    } else enter(a, 'sitDown');
  }
}

function step(a: Agent, furn: RoomState['furniture'], all: Agent[]) {
  a.t += 1;
  const seq = SEQ[a.state];
  if (a.state === 'walk') {
    const dx = a.tx - a.x, dy = a.ty - a.y;
    const d = Math.hypot(dx, dy);
    if (d < 1.2) {
      enter(a, Math.random() < 0.3 ? 'stretch' : 'stand', Math.round(rnd(10, 25)));
      return;
    }
    const v = 1.1;
    a.x += (dx / d) * v;
    a.y += (dy / d) * v * 0.6;
    if (Math.abs(dx) > 0.5) a.face = dx > 0 ? 1 : -1;
    return;
  }
  if (a.state === 'held') return; // 被拎着的时候什么都不做
  if (LOOP[a.state]) {
    if (a.t >= a.until) decide(a, furn, all);
    return;
  }
  if (a.t >= seq.length) {
    // 单次动作播完之后接的状态
    const next: Partial<Record<State, State>> = { lieDown: 'sleep', wake: 'sit', standUp: 'walk', stretch: 'stand', sitDown: 'sit', play: 'sit', happy: a.after ?? 'sit', land: 'sit' };
    const n = next[a.state] ?? 'sit';
    const dur = n === 'sleep' ? rnd(120, 260) : n === 'sit' ? rnd(40, 90) : n === 'stand' ? rnd(10, 25) : 0;
    enter(a, n, Math.round(dur));
  }
}

function frameOf(a: Agent): number {
  const seq = SEQ[a.state];
  if (a.state === 'sit') {
    const k = a.t - a.blinkAt;
    if (k >= 0 && k < BLINK.length) return BLINK[k];
    if (k >= BLINK.length) a.blinkAt = a.t + Math.round(rnd(25, 60));
  }
  return LOOP[a.state] ? seq[a.t % seq.length] : seq[Math.min(a.t, seq.length - 1)];
}

type Drag = { kind: 'cat' | 'furniture'; id: string; ox: number; oy: number; moved: boolean };
type Hit = { kind: 'cat' | 'furniture'; id: string; x: number; y: number };

export function RoomView({ room, width, editing = false, selected, onSelect, onMoveFurniture, onRemove }: {
  room: RoomState;
  width: number;
  editing?: boolean;
  selected?: string | null;
  onSelect?: (kind: 'cat' | 'furniture', id: string) => void;
  onMoveFurniture?: (id: string, x: number, y: number) => void;
  onRemove?: (kind: 'cat' | 'furniture', id: string) => void;
}) {
  const img = useImages();
  const s = pixelScale(width, ROOM_W);
  const agents = useRef<Agent[]>([]);
  const fx = useRef<Fx[]>([]);
  const [bubble, setBubble] = useState<{ id: string; text: string } | null>(null);
  const bubbleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [, setTick] = useState(0);
  const [dragPos, setDragPos] = useState<{ id: string; x: number; y: number } | null>(null);

  // 房间里的猫变了：留下原来的位置，新来的找个空地坐下
  useEffect(() => {
    const prev = new Map(agents.current.map((a) => [a.id, a]));
    const next: Agent[] = [];
    for (const c of room.cats) {
      const old = prev.get(c.id);
      if (old) { next.push(old); continue; }
      const p = spot(room.furniture, next);
      next.push({ id: c.id, x: p.x, y: p.y, face: Math.random() < 0.5 ? 1 : -1, state: 'sit', t: 0, until: Math.round(rnd(20, 60)), tx: p.x, ty: p.y, blinkAt: Math.round(rnd(10, 40)) });
    }
    agents.current = next;
    setTick((v) => v + 1);
  }, [room.cats, room.furniture]);

  // 动起来（编辑时停下，全部坐好）
  useEffect(() => {
    if (editing) {
      for (const a of agents.current) enter(a, 'sit', 999);
      setTick((v) => v + 1);
      return;
    }
    const timer = setInterval(() => {
      for (const a of agents.current) step(a, room.furniture, agents.current);
      fx.current = fx.current.filter((h) => ++h.t < 14);
      setTick((v) => v + 1);
    }, 100);
    return () => clearInterval(timer);
  }, [editing, room.furniture]);
  useEffect(() => () => clearTimeout(bubbleTimer.current), []);

  // 得到小判：主猫开心跳一下
  useEffect(() => onGame((e) => {
    if (e.type !== 'gain' && e.type !== 'chest') return;
    const a = agents.current[0];
    if (a && ['sit', 'groom', 'stand'].includes(a.state)) {
      a.after = a.state === 'stand' ? 'sitDown' : 'sit';
      enter(a, 'happy');
    }
  }), []);

  /** 点了一下猫：跳一下、冒爱心、说句话；睡着的会被叫醒 */
  const poke = (a: Agent) => {
    let text: string;
    if (a.state === 'sleep' || a.state === 'lieDown') {
      enter(a, 'wake');
      text = 'ん…？';
    } else {
      a.after = ['stand', 'walk', 'stretch', 'standUp'].includes(a.state) ? 'sitDown' : 'sit';
      enter(a, 'happy');
      text = TALK[Math.floor(Math.random() * TALK.length)];
      for (let k = 0; k < 3; k++) fx.current.push({ x: a.x - 6 + k * 6 + rnd(-1, 1), y: a.y - 30 - k * 2, t: -k * 2 });
    }
    clearTimeout(bubbleTimer.current);
    setBubble({ id: a.id, text });
    bubbleTimer.current = setTimeout(() => setBubble(null), 1800);
  };

  const furniture = room.furniture.map((f) => (dragPos?.id === f.id ? { ...f, x: dragPos.x, y: dragPos.y } : f));
  const drawList = [
    ...furniture.map((f) => ({ kind: 'furniture' as const, id: f.id, x: f.x, y: f.y })),
    ...agents.current.map((a) => ({ kind: 'cat' as const, id: a.id, x: dragPos?.id === a.id ? dragPos.x : a.x, y: dragPos?.id === a.id ? dragPos.y : a.y, a })),
  ].sort((p, q) => p.y - q.y);

  // ---- 触摸：点猫、拎猫；编辑时还能拖家具
  const drag = useRef<Drag | null>(null);
  const latest = useRef({ furniture, onSelect, onMoveFurniture, onRemove, s, editing, poke });
  latest.current = { furniture, onSelect, onMoveFurniture, onRemove, s, editing, poke };

  const hitTest = (lx: number, ly: number): Hit | null => {
    const { s: sc, furniture: fs, editing: ed } = latest.current;
    const px = lx / sc, py = ly / sc;
    const hits = [
      ...agents.current.map((a) => ({ kind: 'cat' as const, id: a.id, x: a.x, y: a.y, w: 13, h: 32 })),
      ...(ed ? fs.map((f) => ({ kind: 'furniture' as const, id: f.id, x: f.x, y: f.y, w: 15, h: 31 })) : []),
    ].sort((p, q) => q.y - p.y); // 前面的（y 大）优先
    return hits.find((h) => Math.abs(px - h.x) <= h.w && py <= h.y + 3 && py >= h.y - h.h) ?? null;
  };

  const responder = useMemo(() => PanResponder.create({
    // 只有按在猫（或编辑时的家具）身上才接管，别的地方照常让外面的列表滚动
    onStartShouldSetPanResponder: (e) => !!hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY),
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (e) => {
      const hit = hitTest(e.nativeEvent.locationX, e.nativeEvent.locationY);
      drag.current = hit ? { kind: hit.kind, id: hit.id, ox: hit.x, oy: hit.y, moved: false } : null;
    },
    onPanResponderMove: (_e, g) => {
      const d = drag.current;
      if (!d) return;
      const sc = latest.current.s;
      if (!d.moved && Math.abs(g.dx) + Math.abs(g.dy) > 5) {
        d.moved = true;
        const a = agents.current.find((o) => o.id === d.id);
        if (a && d.kind === 'cat' && !latest.current.editing) enter(a, 'held');
      }
      if (!d.moved) return;
      const x = Math.min(X1 + 6, Math.max(X0 - 6, d.ox + g.dx / sc));
      const y = d.oy + g.dy / sc;
      // 普通模式拎着猫：猫跟着手指，但不会被拖出房间
      setDragPos({ id: d.id, x, y: latest.current.editing ? y : Math.min(FLOOR_Y1 + 2, Math.max(24, y)) });
    },
    onPanResponderRelease: (_e, g) => {
      const d = drag.current;
      drag.current = null;
      setDragPos(null);
      if (!d) return;
      const { s: sc, onSelect: sel, onMoveFurniture: mv, onRemove: rm, editing: ed } = latest.current;
      const a = d.kind === 'cat' ? agents.current.find((o) => o.id === d.id) : undefined;
      if (!d.moved) {
        if (ed) sel?.(d.kind, d.id);
        else if (a) latest.current.poke(a);
        return;
      }
      const y = d.oy + g.dy / sc;
      if (ed && y > ROOM_H + 6) { rm?.(d.kind, d.id); return; } // 编辑时往下拖出房间就收起
      const x = Math.min(X1, Math.max(X0, d.ox + g.dx / sc));
      const yy = Math.min(FLOOR_Y1, Math.max(FLOOR_Y0, y));
      if (d.kind === 'furniture') mv?.(d.id, x, yy);
      else if (a) {
        a.x = x; a.y = yy; a.tx = x; a.ty = yy;
        if (!ed) enter(a, 'land');
      }
      if (ed) sel?.(d.kind, d.id);
    },
    onPanResponderTerminate: () => {
      const d = drag.current;
      drag.current = null;
      setDragPos(null);
      const a = d && agents.current.find((o) => o.id === d.id);
      if (a && a.state === 'held') enter(a, 'land');
    },
    // hitTest 和回调都从 latest 里读最新值，所以只建一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), []);

  if (!img) return <View style={{ width, height: ROOM_H * s }} />;
  const hatOf = new Map(room.cats.map((c) => [c.id, c.hat]));
  const bubbleCat = bubble ? agents.current.find((a) => a.id === bubble.id) : undefined;
  return (
    <View style={{ width: ROOM_W * s, height: ROOM_H * s, alignSelf: 'center' }} {...responder.panHandlers}>
      <Canvas style={{ width: ROOM_W * s, height: ROOM_H * s }}>
        <Sub image={img.scenes[room.scene] ?? img.scenes.washitsu} sx={0} sy={0} sw={160} sh={96} x={0} y={0} scale={s} />
        {drawList.map((d) => {
          if (d.kind === 'furniture') {
            const idx = FURN.indexOf(d.id);
            return (
              <Group key={`f-${d.id}`}>
                {editing && selected === d.id ? <Rect rect={skRect((d.x - 17) * s, (d.y - 33) * s, 34 * s, 35 * s)} color="rgba(255,255,255,0.35)" /> : null}
                <Sub image={img.furniture} sx={idx * 32} sy={0} sw={32} sh={32} x={(Math.round(d.x) - 16) * s} y={(Math.round(d.y) - 31) * s} scale={s} />
              </Group>
            );
          }
          const a = d.a!;
          const info = CATS[a.id];
          if (!info) return null;
          const f = editing && dragPos?.id !== a.id ? A.idle[0] : frameOf(a);
          const x = Math.round(d.x) - ANCHOR_X, y = Math.round(d.y) - ANCHOR_Y;
          const hat = hatOf.get(a.id);
          const hi = hat ? HATS.indexOf(hat) : -1;
          const [hx, hy] = HEAD[info.body][f];
          const flip = a.face < 0 ? (Math.round(d.x) + 0.5) * s : undefined;
          const lifted = a.state === 'held';
          return (
            <Group key={`c-${a.id}`} transform={flip !== undefined ? [{ translateX: 2 * flip }, { scaleX: -1 }] : undefined}>
              {/* 地面上的影子；拎起来时影子留在地上、变淡 */}
              <Rect rect={skRect((Math.round(d.x) - 9) * s, (lifted ? Math.min(FLOOR_Y1, Math.max(FLOOR_Y0, a.y)) : Math.round(d.y) - 0.5) * s, 18 * s, 1.5 * s)}
                color={lifted ? 'rgba(40,30,20,0.08)' : 'rgba(40,30,20,0.18)'} />
              {editing && selected === a.id ? <Rect rect={skRect((Math.round(d.x) - 15) * s, (Math.round(d.y) - 36) * s, 30 * s, 38 * s)} color="rgba(255,255,255,0.35)" /> : null}
              <Sub image={img.cats[a.id]} sx={(f % META.frame.cols) * META.frame.w} sy={Math.floor(f / META.frame.cols) * META.frame.h}
                sw={META.frame.w} sh={META.frame.h} x={x * s} y={y * s} scale={s} />
              {hi >= 0 ? (
                <Sub image={img.hats[info.body]} sx={hi * 32} sy={0} sw={32} sh={40}
                  x={(x + META.frame.ox + hx) * s} y={(y + META.frame.oy + hy - META.hatTop) * s} scale={s} />
              ) : null}
            </Group>
          );
        })}
        {/* 爱心：往上飘、慢慢变淡 */}
        {fx.current.filter((h) => h.t >= 0).map((h, i) => (
          <Group key={`h-${i}`} opacity={Math.max(0, 1 - h.t / 14)}>
            {HEART.flatMap((row, dy) => [...row].map((ch, dx) => (ch === '#'
              ? <Rect key={`${dx}-${dy}`} rect={skRect((Math.round(h.x) + dx) * s, (Math.round(h.y - h.t * 0.6) + dy) * s, s, s)} color="#E8607A" />
              : null)))}
          </Group>
        ))}
      </Canvas>
      {bubble && bubbleCat ? (
        <View pointerEvents="none" style={[styles.bubble, { left: Math.max(4, Math.min(ROOM_W * s - 120, (bubbleCat.x - 2) * s - 40)), top: Math.max(2, (bubbleCat.y - 46) * s) }]}>
          <Text style={styles.bubbleText}>{bubble.text}</Text>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bubble: { position: 'absolute', backgroundColor: '#FFFDF8', borderColor: '#3A2E2A', borderWidth: 2, borderRadius: 10, paddingHorizontal: 9, paddingVertical: 3 },
  bubbleText: { color: '#3A2E2A', fontSize: 14, fontWeight: '700' },
});

export const furnitureName = (id: string) => ITEM_BY_ID[id]?.ja ?? id;
export const FOOTPRINT = FOOT;
