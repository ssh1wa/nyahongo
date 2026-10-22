// 像素素材的绘制：全部用 Skia 画、最近邻采样，放大后边缘保持清晰（安卓的普通 Image 会做平滑，像素图一放大就糊）。
// 素材在 App 启动时统一加载一次（SpriteProvider），各处共用。
import {
  BlendColor, Canvas, FilterMode, Group, Image as SkImage, MipmapMode, Paint, rect, useImage, type SkImage as SkImageT,
} from '@shopify/react-native-skia';
import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { PixelRatio } from 'react-native';
import { ITEM_BY_ID, type Item, type Rarity } from '../lib/catalog';
import { CAT_SHEETS, CHEST_SHEETS, FURNITURE, HAT_SHEETS, PORTRAITS, SCENE_IMAGES, SPRITE_META, STORE_IMAGES } from './spriteData';

export const SAMPLING = { filter: FilterMode.Nearest, mipmap: MipmapMode.None } as const;
export const META = SPRITE_META;
export const FRAME_W = META.frame.w;
export const FRAME_H = META.frame.h;

type Images = {
  cats: Record<string, SkImageT | null>;
  hats: Record<string, SkImageT | null>;
  scenes: Record<string, SkImageT | null>;
  chests: Record<string, SkImageT | null>;
  portraits: SkImageT | null;
  furniture: SkImageT | null;
  store: { bg: SkImageT | null; chest: SkImageT | null; chestBig: SkImageT | null; koban: SkImageT | null; yarn: SkImageT | null };
};

const ImagesContext = createContext<Images | null>(null);

const CAT_KEYS = Object.keys(CAT_SHEETS);
const HAT_KEYS = Object.keys(HAT_SHEETS);
const SCENE_KEYS = Object.keys(SCENE_IMAGES);
const CHEST_KEYS = Object.keys(CHEST_SHEETS);

export function SpriteProvider({ children }: { children: React.ReactNode }) {
  // 每个 key 固定调用一次 useImage（数组长度不变，hook 顺序稳定）
  const cats = Object.fromEntries(CAT_KEYS.map((k) => [k, useImage(CAT_SHEETS[k])]));
  const hats = Object.fromEntries(HAT_KEYS.map((k) => [k, useImage(HAT_SHEETS[k])]));
  const scenes = Object.fromEntries(SCENE_KEYS.map((k) => [k, useImage(SCENE_IMAGES[k])]));
  const chests = Object.fromEntries(CHEST_KEYS.map((k) => [k, useImage(CHEST_SHEETS[k])]));
  const portraits = useImage(PORTRAITS);
  const furniture = useImage(FURNITURE);
  const store = {
    bg: useImage(STORE_IMAGES.storeroom_bg),
    chest: useImage(STORE_IMAGES.store_chest),
    chestBig: useImage(STORE_IMAGES.store_chest_big),
    koban: useImage(STORE_IMAGES.store_koban),
    yarn: useImage(STORE_IMAGES.store_yarn),
  };
  const value = { cats, hats, scenes, chests, portraits, furniture, store };
  return <ImagesContext.Provider value={value}>{children}</ImagesContext.Provider>;
}

export const useImages = () => useContext(ImagesContext);

/** 屏幕上一个素材像素对应几 dp：取整到物理像素，每个像素一样大 */
export function pixelScale(widthDp: number, logicalWidth: number): number {
  const ratio = PixelRatio.get();
  return Math.max(1, Math.floor((widthDp * ratio) / logicalWidth)) / ratio;
}

/** 画图集里的一块：src 是素材像素坐标，(x, y) 和 scale 是画布坐标；flip 时以这块的中线为轴镜像 */
export function Sub({ image, sx, sy, sw, sh, x, y, scale, flipAround }: {
  image: SkImageT | null; sx: number; sy: number; sw: number; sh: number; x: number; y: number; scale: number; flipAround?: number;
}) {
  if (!image) return null;
  const body = (
    <Group clip={rect(x, y, sw * scale, sh * scale)}>
      <SkImage image={image} x={x - sx * scale} y={y - sy * scale} width={image.width() * scale} height={image.height() * scale} sampling={SAMPLING} />
    </Group>
  );
  if (flipAround === undefined) return body;
  return <Group transform={[{ translateX: 2 * flipAround }, { scaleX: -1 }]}>{body}</Group>;
}

const catIndex = (id: string) => (META.cats as Record<string, { index: number; body: string }>)[id];

/** 立绘（32×32）+ 饰品图层（32×40，上方多 8 行）。size 是宽度 dp */
export function CatPortrait({ id, hat, size, ghost }: { id: string; hat?: string | null; size: number; ghost?: string }) {
  const img = useImages();
  const s = size / 32;
  const info = catIndex(id);
  if (!img || !info) return null;
  const hatIdx = hat ? (META.hats as readonly string[]).indexOf(hat) : -1;
  const top = META.hatTop;
  const content = (
    <>
      <Sub image={img.portraits} sx={info.index * 32} sy={0} sw={32} sh={32} x={0} y={top * s} scale={s} />
      {hatIdx >= 0 ? <Sub image={img.hats[info.body]} sx={hatIdx * 32} sy={0} sw={32} sh={40} x={0} y={0} scale={s} /> : null}
    </>
  );
  return (
    <Canvas style={{ width: size, height: size * (40 / 32) }}>
      {ghost ? <Group layer={<Paint><BlendColor color={ghost} mode="srcIn" /></Paint>}>{content}</Group> : content}
    </Canvas>
  );
}

/** 图鉴图标：猫是立绘，饰品戴在白猫身上，场景是缩略图，家具是原图 */
export function ItemIcon({ item, size, ghost }: { item: Item; size: number; ghost?: string }) {
  const img = useImages();
  if (!img) return null;
  if (item.kind === 'cat') return <CatPortrait id={item.id} size={size} ghost={ghost} />;
  if (item.kind === 'hat') {
    // 饰品戴在淡色的白猫上展示
    return (
      <Canvas style={{ width: size, height: size * (40 / 32) }}>
        {/* 底下的白猫只是衬托，始终淡淡的；收集到的饰品是彩色，没收集到的是灰色剪影 */}
        <Group opacity={0.35}>
          <Sub image={img.portraits} sx={catIndex('shiro').index * 32} sy={0} sw={32} sh={32} x={0} y={META.hatTop * (size / 32)} scale={size / 32} />
        </Group>
        {ghost
          ? <Group layer={<Paint><BlendColor color={ghost} mode="srcIn" /></Paint>}><HatLayer image={img.hats.manmaru} item={item} size={size} /></Group>
          : <HatLayer image={img.hats.manmaru} item={item} size={size} />}
      </Canvas>
    );
  }
  if (item.kind === 'furniture') {
    const idx = (META.furniture as readonly string[]).indexOf(item.id);
    const s = size / 32;
    const inner = <Sub image={img.furniture} sx={idx * 32} sy={0} sw={32} sh={32} x={0} y={8 * s} scale={s} />;
    return (
      <Canvas style={{ width: size, height: size * (40 / 32) }}>
        {ghost ? <Group layer={<Paint><BlendColor color={ghost} mode="srcIn" /></Paint>}>{inner}</Group> : inner}
      </Canvas>
    );
  }
  // 场景：按宽度缩放，没收集到时整体变暗
  const s = size / 160;
  const h = 96 * s;
  return (
    <Canvas style={{ width: size, height: size * (40 / 32) }}>
      <Group opacity={ghost ? 0.18 : 1}>
        <Sub image={img.scenes[item.id]} sx={0} sy={0} sw={160} sh={96} x={0} y={(size * (40 / 32) - h) / 2} scale={s} />
      </Group>
    </Canvas>
  );
}

// 注意：Skia 画布里面是另一套渲染树，拿不到 React context，所以图片要从外面传进来，不能在这里 useImages()
function HatLayer({ image, item, size }: { image: SkImageT | null; item: Item; size: number }) {
  const idx = (META.hats as readonly string[]).indexOf(item.id);
  return <Sub image={image} sx={idx * 32} sy={0} sw={32} sh={40} x={0} y={0} scale={size / 32} />;
}

/** 场景缩略图（编辑房间时挑场景用） */
export function SceneThumb({ id, width }: { id: string; width: number }) {
  const img = useImages();
  const s = width / 160;
  return (
    <Canvas style={{ width, height: 96 * s }}>
      <Sub image={img?.scenes[id] ?? null} sx={0} sy={0} sw={160} sh={96} x={0} y={0} scale={s} />
    </Canvas>
  );
}

// ---------- 开箱 ----------

// 每格约 110ms。越稀有晃得越久；第 7 帧打开，之后在 8~11 之间循环
const CHEST_SEQ: Record<Rarity, number[]> = {
  common: [0, 0, 1, 2, 3, 5, 6, 7],
  rare: [0, 1, 2, 3, 2, 3, 4, 5, 6, 6, 7],
  epic: [0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 6, 6, 7],
  legendary: [0, 1, 0, 1, 2, 3, 2, 3, 4, 5, 4, 5, 4, 5, 6, 6, 6, 7],
};

export function ChestAnimation({ rarity, size, onOpen }: { rarity: Rarity; size: number; onOpen: () => void }) {
  const img = useImages();
  const [tick, setTick] = useState(0);
  const opened = useRef(false);
  const seq = CHEST_SEQ[rarity];
  useEffect(() => {
    const t = setInterval(() => setTick((v) => v + 1), 110);
    return () => clearInterval(t);
  }, []);
  const frame = tick < seq.length ? seq[tick] : 8 + ((tick - seq.length) % 4);
  useEffect(() => {
    if (frame === 7 && !opened.current) {
      opened.current = true;
      onOpen();
    }
  }, [frame, onOpen]);
  const s = size / 64;
  return (
    <Canvas style={{ width: size, height: size }}>
      <Sub image={img?.chests[rarity] ?? null} sx={frame * 64} sy={0} sw={64} sh={64} x={0} y={0} scale={s} />
    </Canvas>
  );
}

export const itemOf = (id: string) => ITEM_BY_ID[id];
