// 占位像素猫：16×18 的格子，按花纹给毛色分区上色，装扮按形状画在头上。
// 以后换成正式的像素素材时，这个组件改成显示图片即可，调用方不用动。
import React, { memo, useMemo } from 'react';
import Svg, { Rect } from 'react-native-svg';
import { ITEM_BY_ID, type CatLook, type HatLook } from '../lib/catalog';

const W = 16;
const H = 18;
const TOP = 2; // 猫往下挪两行，给帽子、光环留位置

// O 描边 F 毛 W 肚子/嘴边 E 眼睛 N 鼻子 T 尾巴
const CAT = [
  '................',
  '..OO......OO....',
  '..OFO....OFO....',
  '..OFFOOOOFFO....',
  '.OFFFFFFFFFFO...',
  '.OFFFFFFFFFFO...',
  '.OFEFFFFFFEFO...',
  '.OFFFFNNFFFFO...',
  '.OFFWWWWWWFFO...',
  '..OFFFFFFFFO....',
  '..OFFFFFFFFO.OO.',
  '.OFFFWWWWFFFOTO.',
  '.OFFFWWWWFFFFO..',
  '.OFFFWWWWFFFO...',
  '.OFWWOFFOWWFO...',
  '..OOOOOOOOOO....',
];

const OUTLINE = '#3A2E2A';

type Grid = Array<Array<string | null>>;

function furColor(look: CatLook, x: number, y: number): string {
  const { pattern, fur, patch } = look;
  const p2 = look.patch2 ?? patch;
  switch (pattern) {
    case 'stripes':
      return (y >= 3 && y <= 5 && (x === 5 || x === 7)) || ((y === 10 || y === 12 || y === 13) && x % 2 === 1) || (y === 9 && x === 3) ? patch : fur;
    case 'calico':
      return x < 6 && y < 8 ? patch : x > 8 && y >= 9 ? p2 : x >= 9 && y <= 4 ? p2 : fur;
    case 'hachiware':
      return y <= 5 || (y <= 7 && (x <= 3 || x >= 10)) || y >= 9 ? fur : look.belly;
    case 'socks':
      return y >= 13 ? patch : fur;
    case 'points':
      return y <= 3 || (y === 7 && x >= 4 && x <= 9) || y >= 14 ? patch : fur;
    case 'tortie':
      return (x * 3 + y * 5) % 7 === 0 ? patch : (x + y * 2) % 5 === 0 ? p2 : fur;
    case 'chashiro':
      return y >= 11 && x >= 4 && x <= 9 ? look.belly : fur;
    case 'maneki':
      return (x <= 3 && y <= 5) || (x >= 10 && y >= 10 && y <= 12) ? patch : fur;
    case 'nekomata':
      return y <= 3 ? patch : fur;
    default:
      return fur;
  }
}

function drawCat(g: Grid, look: CatLook) {
  CAT.forEach((row, y) => {
    for (let x = 0; x < W; x++) {
      const ch = row[x];
      const gy = y + TOP;
      if (ch === '.') continue;
      g[gy][x] = ch === 'O' ? OUTLINE
        : ch === 'E' ? look.eye ?? OUTLINE
          : ch === 'N' ? '#E58A9A'
            : ch === 'W' ? look.belly
              : ch === 'T' ? furColor(look, x, y)
                : furColor(look, x, y);
    }
  });
  // 招き猫：红项圈和金铃铛
  if (look.pattern === 'maneki') {
    for (let x = 3; x <= 10; x++) g[TOP + 9][x] = look.patch2 ?? '#C8352B';
    g[TOP + 10][6] = '#F2C94C'; g[TOP + 10][7] = '#F2C94C';
  }
  // 猫又：第二条尾巴
  if (look.pattern === 'nekomata') {
    const t: Array<[number, number, string]> = [[13, 7, OUTLINE], [14, 7, OUTLINE], [13, 8, OUTLINE], [14, 8, look.fur], [15, 8, OUTLINE], [14, 9, OUTLINE]];
    t.forEach(([x, y, col]) => { g[TOP + y][x] = col; });
  }
}

type Px = [number, number, 'm' | 'a' | 'o'];
const box = (x0: number, y0: number, x1: number, y1: number, c: 'm' | 'a' | 'o'): Px[] => {
  const out: Px[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) out.push([x, y, c]);
  return out;
};

// 坐标是整个画布（含上方两行留白）
const HATS: Record<HatLook['shape'], Px[]> = {
  band: [...box(2, 7, 11, 7, 'm'), [12, 6, 'm'], [13, 6, 'a'], [12, 7, 'a'], [13, 8, 'm']],
  bow: [[10, 3, 'm'], [11, 3, 'm'], [13, 3, 'm'], [14, 3, 'm'], [10, 4, 'm'], [11, 4, 'a'], [12, 4, 'a'], [13, 4, 'a'], [14, 4, 'm'], [10, 5, 'm'], [11, 5, 'm'], [13, 5, 'm'], [14, 5, 'm']],
  straw: [...box(4, 2, 9, 3, 'm'), ...box(4, 4, 9, 4, 'a'), ...box(0, 5, 13, 5, 'm'), [0, 5, 'o'], [13, 5, 'o']],
  glasses: [[2, 7, 'm'], [3, 7, 'm'], [4, 7, 'm'], [2, 8, 'm'], [4, 8, 'm'], [2, 9, 'm'], [3, 9, 'm'], [4, 9, 'm'], [9, 7, 'm'], [10, 7, 'm'], [11, 7, 'm'], [9, 8, 'm'], [11, 8, 'm'], [9, 9, 'm'], [10, 9, 'm'], [11, 9, 'm'], [5, 8, 'm'], [6, 8, 'm'], [7, 8, 'm'], [8, 8, 'm']],
  collar: [...box(3, 11, 10, 11, 'm'), [6, 12, 'a'], [7, 12, 'a']],
  beret: [...box(3, 3, 10, 4, 'm'), ...box(2, 5, 11, 5, 'a'), [7, 2, 'm']],
  mask: [...box(10, 4, 13, 7, 'm'), [11, 5, 'a'], [13, 5, 'a'], [12, 7, 'a'], [10, 3, 'm'], [13, 3, 'm']],
  flower: [[3, 3, 'm'], [2, 4, 'm'], [3, 4, 'a'], [4, 4, 'm'], [3, 5, 'm'], [5, 3, 'm'], [5, 5, 'm']],
  horns: [[4, 2, 'a'], [4, 3, 'm'], [4, 4, 'm'], [5, 4, 'm'], [9, 2, 'a'], [9, 3, 'm'], [9, 4, 'm'], [8, 4, 'm']],
  cap: [...box(3, 3, 10, 5, 'm'), ...box(4, 4, 9, 4, 'a'), ...box(1, 5, 12, 5, 'm'), [1, 5, 'o'], [12, 5, 'o']],
  crown: [[3, 2, 'm'], [6, 2, 'm'], [7, 2, 'm'], [10, 2, 'm'], ...box(3, 3, 10, 3, 'm'), ...box(3, 4, 10, 4, 'm'), [6, 3, 'a'], [7, 3, 'a']],
  wreath: [[2, 5, 'm'], [3, 4, 'a'], [4, 4, 'm'], [5, 4, 'm'], [6, 4, 'a'], [7, 4, 'm'], [8, 4, 'm'], [9, 4, 'a'], [10, 4, 'm'], [11, 5, 'a']],
  halo: [...box(4, 0, 9, 0, 'm'), [3, 1, 'm'], [10, 1, 'm'], ...box(4, 1, 9, 1, 'a')],
  ears: [[1, 1, 'm'], [1, 2, 'm'], [2, 2, 'a'], [1, 3, 'm'], [2, 3, 'a'], [3, 3, 'm'], [12, 1, 'm'], [12, 2, 'm'], [11, 2, 'a'], [12, 3, 'm'], [11, 3, 'a'], [10, 3, 'm'], [0, 0, 'o'], [13, 0, 'o']],
};

function drawHat(g: Grid, look: HatLook) {
  for (const [x, y, k] of HATS[look.shape]) {
    if (x < 0 || x >= W || y < 0 || y >= H) continue;
    g[y][x] = k === 'm' ? look.main : k === 'a' ? look.accent : OUTLINE;
  }
}

/** 把同色的横向连续格子合成一个矩形，减少 SVG 元素数量 */
function runs(g: Grid): Array<{ x: number; y: number; w: number; color: string }> {
  const out: Array<{ x: number; y: number; w: number; color: string }> = [];
  g.forEach((row, y) => {
    let x = 0;
    while (x < W) {
      const color = row[x];
      if (!color) { x++; continue; }
      let w = 1;
      while (x + w < W && row[x + w] === color) w++;
      out.push({ x, y, w, color });
      x += w;
    }
  });
  return out;
}

/**
 * cat / hat 是图鉴里的 id。只传 hat 时画在一只淡色剪影猫上（装扮单独展示用）。
 * silhouette：还没收集到时画成一团灰影。
 */
export const PixelCat = memo(function PixelCat({ cat, hat, size = 64, silhouette, ghostColor }: {
  cat?: string | null; hat?: string | null; size?: number; silhouette?: boolean; ghostColor?: string;
}) {
  const rects = useMemo(() => {
    const g: Grid = Array.from({ length: H }, () => Array<string | null>(W).fill(null));
    const c = cat ? ITEM_BY_ID[cat] : null;
    const h = hat ? ITEM_BY_ID[hat] : null;
    const look: CatLook = c?.kind === 'cat' ? c.look : { pattern: 'plain', fur: '#E9E3D8', belly: '#F4F0E8', patch: '#E9E3D8' };
    drawCat(g, look);
    if (h?.kind === 'hat') drawHat(g, h.look);
    if (silhouette) {
      const col = ghostColor ?? '#9C958A';
      return runs(g.map((row) => row.map((v) => (v ? col : null))));
    }
    return runs(g);
  }, [cat, hat, silhouette, ghostColor]);

  return (
    <Svg width={size} height={(size * H) / W} viewBox={`0 0 ${W} ${H}`}>
      {/* 稍微多画一点点，避免抗锯齿在格子之间留下细缝 */}
      {rects.map((r, i) => <Rect key={i} x={r.x} y={r.y} width={r.w + 0.02} height={1.02} fill={r.color} />)}
    </Svg>
  );
});
