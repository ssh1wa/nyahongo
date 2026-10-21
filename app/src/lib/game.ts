// 学习伙伴（小游戏）：有效学习时间和学习行为换小判，每学满 30 分钟掉一个宝箱，开箱收集猫和装扮。
// 规则：
// - 有效时间：App 在前台，且 60 秒内有操作（或精听正在播放），每分钟 1 小判
// - 行为加分：做什么都有一点，每种每天有上限；复习不看对错，免得为了小判乱按评分
// - 一天超过 SOFT_CAP 之后收益减半，鼓励每天学一点而不是一次刷很多
// - 抽卡：普通 70 / 稀有 24 / 史诗 5 / 传说 1，10 抽必出稀有以上、50 抽必出史诗以上；重复转成毛玉，攒够换指定的
import { ITEMS, ITEM_BY_ID, RARITY, RARITY_ORDER, STARTER_CAT, type Item, type Rarity } from './catalog';
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

export type GameState = {
  version: 1;
  coins: number; // 小数部分是减半后的零头，显示时取整
  chests: number;
  chestSeconds: number; // 距离下一个宝箱已经学了多少秒
  shards: number; // 毛玉
  owned: Record<string, number>;
  equipped: { cat: string; hat: string | null };
  pity: { rare: number; epic: number };
  draws: number;
  today: Day;
  history: Array<{ date: string; seconds: number; points: number }>; // 最近 60 天，不含今天
};

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const newDay = (): Day => ({ date: localDate(), seconds: 0, points: 0, counts: {}, keys: [] });

const initial = (): GameState => ({
  version: 1, coins: 0, chests: 1, chestSeconds: 0, shards: 0,
  owned: { [STARTER_CAT]: 1 }, equipped: { cat: STARTER_CAT, hat: null },
  pity: { rare: 0, epic: 0 }, draws: 0, today: newDay(), history: [],
});

// ---------- 状态读写：内存里一份，所有修改排队执行，避免并发覆盖 ----------

let cache: GameState | null = null;
let queue: Promise<unknown> = Promise.resolve();
const KEY = 'game';

async function load(): Promise<GameState> {
  if (!cache) cache = { ...initial(), ...(await kvGet<Partial<GameState>>(KEY, {})) } as GameState;
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

export function equip(id: string | null, kind: 'cat' | 'hat'): Promise<void> {
  return mutate((s) => {
    if (id && !s.owned[id]) throw new Error('还没有这件');
    if (kind === 'cat' && id) s.equipped.cat = id;
    if (kind === 'hat') s.equipped.hat = id;
  });
}
