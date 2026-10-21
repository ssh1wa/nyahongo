// 学习伙伴（小游戏）：有效学习时间和学习行为换小判，每学满 30 分钟掉一个宝箱，开箱收集猫和装扮。
// 规则：
// - 有效时间：App 在前台，且 60 秒内有操作（或精听正在播放），每分钟 1 小判
// - 行为加分：做什么都有一点，每种每天有上限；复习不看对错，免得为了小判乱按评分
// - 一天超过 SOFT_CAP 之后收益减半，鼓励每天学一点而不是一次刷很多
// - 抽卡：普通 70 / 稀有 24 / 史诗 5 / 传说 1，10 抽必出稀有以上、50 抽必出史诗以上；重复转成毛玉，攒够换指定的
import { ITEMS, ITEM_BY_ID, RARITY, RARITY_ORDER, STARTER_CAT, STARTER_SCENE, type Item, type Rarity } from './catalog';
import { kvGet, kvSet } from './db';

export type Action = 'review' | 'word' | 'article' | 'listen' | 'grammar' | 'practice' | 'ask' | 'routine' | 'download' | 'firstOfDay';

export const ACTIONS: Record<Action, { label: string; points: number; dailyCap: number }> = {
  review: { label: '复习一张卡', points: 1, dailyCap: 150 },
  word: { label: '加一个生词', points: 1, dailyCap: 30 },
  article: { label: '读完一篇精读', points: 5, dailyCap: 6 },
  listen: { label: '听完一个学习包', points: 10, dailyCap: 6 },
  grammar: { label: '学完一课语法', points: 8, dailyCap: 6 },
  practice: { label: '答一道练习题', points: 1, dailyCap: 40 },
  ask: { label: '翻译或追问一次', points: 1, dailyCap: 15 },
  routine: { label: '常读的今日一篇', points: 3, dailyCap: 3 },
  download: { label: '下载一个学习包', points: 2, dailyCap: 10 },
  firstOfDay: { label: '今天第一次学习', points: 10, dailyCap: 1 },
};

export const MINUTE_POINTS = 1;
export const CHEST_SECONDS = 30 * 60;
export const DRAW_COST = 100;
export const SOFT_CAP = 120;
const IDLE_MS = 60_000;
const FAST_REVIEW_MS = 1500;
const PITY_RARE = 10;
const PITY_EPIC = 50;

type Day = { date: string; seconds: number; points: number; counts: Partial<Record<Action, number>>; keys: string[] };

/** 房间：一个场景、最多 3 只猫（第一只是右上角陪你学习的那只）、最多 4 件自由摆放的家具（x、y 是底边中点的房间坐标） */
export type Room = {
  scene: string;
  cats: Array<{ id: string; hat: string | null }>;
  furniture: Array<{ id: string; x: number; y: number }>;
};

export const ROOM_MAX_CATS = 3;
export const ROOM_MAX_FURNITURE = 4;

export type GameState = {
  version: 2;
  coins: number; // 小数部分是减半后的零头，显示时取整
  chests: number;
  chestSeconds: number; // 距离下一个宝箱已经学了多少秒
  shards: number; // 毛玉
  owned: Record<string, number>;
  room: Room;
  pity: { rare: number; epic: number };
  draws: number;
  today: Day;
  history: Array<{ date: string; seconds: number; points: number }>; // 最近 60 天，不含今天
};

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const newDay = (): Day => ({ date: localDate(), seconds: 0, points: 0, counts: {}, keys: [] });

const initial = (): GameState => ({
  version: 2, coins: 0, chests: 1, chestSeconds: 0, shards: 0,
  owned: { [STARTER_CAT]: 1, [STARTER_SCENE]: 1 },
  room: { scene: STARTER_SCENE, cats: [{ id: STARTER_CAT, hat: null }], furniture: [] },
  pity: { rare: 0, epic: 0 }, draws: 0, today: newDay(), history: [],
});

/** 旧版存档（只有 equipped 一只猫一件饰品）→ 房间 */
function migrate(raw: any): GameState {
  const s = { ...initial(), ...raw } as GameState & { equipped?: { cat: string; hat: string | null } };
  if (!raw.room) {
    const eq = raw.equipped ?? { cat: STARTER_CAT, hat: null };
    s.room = { scene: STARTER_SCENE, cats: [{ id: ITEM_BY_ID[eq.cat] ? eq.cat : STARTER_CAT, hat: eq.hat && ITEM_BY_ID[eq.hat] ? eq.hat : null }], furniture: [] };
    s.owned = { ...s.owned, [STARTER_SCENE]: s.owned[STARTER_SCENE] ?? 1 };
  }
  delete s.equipped;
  s.version = 2;
  return s;
}

// ---------- 状态读写：内存里一份，所有修改排队执行，避免并发覆盖 ----------

let cache: GameState | null = null;
let queue: Promise<unknown> = Promise.resolve();
const KEY = 'game';

async function load(): Promise<GameState> {
  if (!cache) cache = migrate(await kvGet<Record<string, unknown>>(KEY, {}));
  rollDay(cache);
  return cache;
}

function rollDay(s: GameState) {
  const today = localDate();
  if (s.today.date === today) return;
  if (s.today.seconds || s.today.points) {
    s.history = [{ date: s.today.date, seconds: s.today.seconds, points: s.today.points }, ...s.history].slice(0, 60);
  }
  s.today = newDay();
}

function mutate<T>(fn: (s: GameState) => T): Promise<T> {
  const run = queue.then(async () => {
    const s = await load();
    const out = fn(s);
    await kvSet(KEY, s);
    emit({ type: 'state', state: s });
    return out;
  });
  queue = run.catch(() => {});
  return run;
}

export const getGame = (): Promise<GameState> => queue.then(load);

// ---------- 事件（右上角的猫显示 +N、宝箱） ----------

export type GameEvent = { type: 'gain'; points: number; label: string } | { type: 'chest' } | { type: 'state'; state: GameState };
const listeners = new Set<(e: GameEvent) => void>();
export function onGame(fn: (e: GameEvent) => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
function emit(e: GameEvent) { listeners.forEach((fn) => fn(e)); }

// ---------- 加分 ----------

/** 超过软上限的部分减半 */
function addPoints(s: GameState, raw: number): number {
  const full = Math.max(0, Math.min(raw, SOFT_CAP - s.today.points));
  const gained = full + (raw - full) / 2;
  s.coins += gained;
  s.today.points += gained;
  return gained;
}

function addSeconds(s: GameState, sec: number) {
  s.today.seconds += sec;
  s.chestSeconds += sec;
  while (s.chestSeconds >= CHEST_SECONDS) {
    s.chestSeconds -= CHEST_SECONDS;
    s.chests += 1;
    emit({ type: 'chest' });
  }
}

function firstOfDay(s: GameState): number {
  if (s.today.counts.firstOfDay) return 0;
  s.today.counts.firstOfDay = 1;
  return addPoints(s, ACTIONS.firstOfDay.points);
}

let lastReviewAt = 0;

/**
 * 记一次学习行为。key 用来去重（比如同一个学习包只算一次下载、同一篇文章只算一次读完）。
 * 不会抛错：小游戏出问题不能影响学习功能。
 */
export function award(action: Exclude<Action, 'firstOfDay'>, key?: string): void {
  if (action === 'review') {
    const now = Date.now();
    const fast = now - lastReviewAt < FAST_REVIEW_MS;
    lastReviewAt = now;
    if (fast) return;
  }
  void mutate((s) => {
    const def = ACTIONS[action];
    const k = key ? `${action}:${key}` : '';
    if (k && s.today.keys.includes(k)) return;
    if ((s.today.counts[action] ?? 0) >= def.dailyCap) return;
    if (k) s.today.keys = [...s.today.keys, k].slice(-300);
    s.today.counts[action] = (s.today.counts[action] ?? 0) + 1;
    const gained = addPoints(s, def.points) + firstOfDay(s);
    emit({ type: 'gain', points: gained, label: def.label });
  }).catch(() => {});
}

// ---------- 有效学习时间 ----------

let lastActive = 0;
let mediaPlaying = false;
let foreground = true;
let pendingSeconds = 0;

/** 用户点了屏幕（App 根节点的触摸事件调用） */
export const markActive = () => { lastActive = Date.now(); };
/** 精听播放中也算在学（不用一直点屏幕） */
export const setMediaPlaying = (v: boolean) => { mediaPlaying = v; if (v) markActive(); };
export const setForeground = (v: boolean) => { foreground = v; };

/** 每 tick 秒调用一次；攒满一分钟写一次库，给一分钟的小判。 */
export function tick(seconds: number): void {
  if (!foreground) return;
  if (!mediaPlaying && Date.now() - lastActive > IDLE_MS) return;
  pendingSeconds += seconds;
  if (pendingSeconds < 60) return;
  const sec = pendingSeconds;
  pendingSeconds = 0;
  void mutate((s) => {
    addSeconds(s, sec);
    addPoints(s, (sec / 60) * MINUTE_POINTS);
    firstOfDay(s);
  }).catch(() => {});
}

// ---------- 抽卡 ----------

export type DrawResult = { item: Item; isNew: boolean; shards: number };

function pickRarity(s: GameState): Rarity {
  if (s.pity.epic + 1 >= PITY_EPIC) return Math.random() < 0.15 ? 'legendary' : 'epic';
  if (s.pity.rare + 1 >= PITY_RARE) {
    const r = Math.random() * 30;
    return r < 1 ? 'legendary' : r < 6 ? 'epic' : 'rare';
  }
  const total = RARITY_ORDER.reduce((n, r) => n + RARITY[r].weight, 0);
  let x = Math.random() * total;
  for (const r of RARITY_ORDER) {
    x -= RARITY[r].weight;
    if (x < 0) return r;
  }
  return 'common';
}

/** 开一个宝箱（有宝箱先用宝箱，没有就花 DRAW_COST 小判）。 */
export function draw(): Promise<DrawResult> {
  return mutate((s) => {
    if (s.chests > 0) s.chests -= 1;
    else if (s.coins >= DRAW_COST) s.coins -= DRAW_COST;
    else throw new Error(`小判不够，还差 ${Math.ceil(DRAW_COST - s.coins)}`);
    const rarity = pickRarity(s);
    const pool = ITEMS.filter((i) => i.rarity === rarity);
    // 同稀有度里优先给还没有的，重复太多会没意思
    const fresh = pool.filter((i) => !s.owned[i.id]);
    const from = fresh.length && Math.random() < 0.6 ? fresh : pool;
    const item = from[Math.floor(Math.random() * from.length)];
    const isNew = !s.owned[item.id];
    s.owned[item.id] = (s.owned[item.id] ?? 0) + 1;
    const shards = isNew ? 0 : RARITY[rarity].shards;
    s.shards += shards;
    s.draws += 1;
    s.pity.rare = rarity === 'common' ? s.pity.rare + 1 : 0;
    s.pity.epic = rarity === 'epic' || rarity === 'legendary' ? 0 : s.pity.epic + 1;
    return { item, isNew, shards };
  });
}

/** 用毛玉换一件还没有的 */
export function exchange(id: string): Promise<Item> {
  return mutate((s) => {
    const item = ITEM_BY_ID[id];
    if (!item) throw new Error('没有这件东西');
    if (s.owned[id]) throw new Error('已经有了');
    const cost = RARITY[item.rarity].cost;
    if (s.shards < cost) throw new Error(`毛玉不够，还差 ${cost - s.shards}`);
    s.shards -= cost;
    s.owned[id] = 1;
    return item;
  });
}

/** 测试用：直接加宝箱（设置 → 关于里长按版本号） */
export function grantTestChests(n: number): Promise<void> {
  return mutate((s) => { s.chests += n; });
}

// ---------- 房间布置 ----------

const owns = (s: GameState, id: string) => !!s.owned[id];

export function setScene(id: string): Promise<void> {
  return mutate((s) => {
    if (!owns(s, id) || ITEM_BY_ID[id]?.kind !== 'scene') throw new Error('还没有这个场景');
    s.room = { ...s.room, scene: id };
  });
}

/** 猫：在房间里就收起（至少留一只），不在就放进来（最多 3 只） */
export function toggleRoomCat(id: string): Promise<'added' | 'removed'> {
  return mutate((s) => {
    if (!owns(s, id)) throw new Error('还没有这只猫');
    const cats = s.room.cats;
    if (cats.some((c) => c.id === id)) {
      if (cats.length <= 1) throw new Error('房间里至少要有一只猫');
      s.room = { ...s.room, cats: cats.filter((c) => c.id !== id) };
      return 'removed';
    }
    if (cats.length >= ROOM_MAX_CATS) throw new Error(`房间里最多 ${ROOM_MAX_CATS} 只猫，先收起一只`);
    s.room = { ...s.room, cats: [...cats, { id, hat: null }] };
    return 'added';
  });
}

/** 让这只猫当「陪你学习」的那只（排到第一个，右上角显示它） */
export function setMainCat(id: string): Promise<void> {
  return mutate((s) => {
    if (!owns(s, id)) throw new Error('还没有这只猫');
    const rest = s.room.cats.filter((c) => c.id !== id);
    const me = s.room.cats.find((c) => c.id === id) ?? { id, hat: null };
    s.room = { ...s.room, cats: [me, ...rest].slice(0, ROOM_MAX_CATS) };
  });
}

/** 给房间里的一只猫戴饰品（一件饰品只能戴在一只猫身上），hat 为 null 是取下 */
export function setCatHat(catId: string, hat: string | null): Promise<void> {
  return mutate((s) => {
    if (hat && !owns(s, hat)) throw new Error('还没有这件饰品');
    s.room = { ...s.room, cats: s.room.cats.map((c) => (c.id === catId ? { ...c, hat } : c.hat === hat ? { ...c, hat: null } : c)) };
  });
}

export function toggleFurniture(id: string, x = 80, y = 84): Promise<'added' | 'removed'> {
  return mutate((s) => {
    if (!owns(s, id)) throw new Error('还没有这件家具');
    const list = s.room.furniture;
    if (list.some((f) => f.id === id)) {
      s.room = { ...s.room, furniture: list.filter((f) => f.id !== id) };
      return 'removed';
    }
    if (list.length >= ROOM_MAX_FURNITURE) throw new Error(`最多摆 ${ROOM_MAX_FURNITURE} 件家具，先收起一件`);
    s.room = { ...s.room, furniture: [...list, { id, x, y }] };
    return 'added';
  });
}

export function moveFurniture(id: string, x: number, y: number): Promise<void> {
  return mutate((s) => {
    s.room = { ...s.room, furniture: s.room.furniture.map((f) => (f.id === id ? { ...f, x: Math.round(x), y: Math.round(y) } : f)) };
  });
}
