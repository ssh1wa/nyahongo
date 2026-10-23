// 学习伙伴（小游戏）：学习时间掉宝箱，学习行为换小判（开箱、买箱用），开箱收集猫和装扮。两种来源分开：
// - 宝箱：有效学习时间每满 40 分钟掉一个（App 在前台，且 3 分钟内有操作或精听正在播放），也可以花 BUY_COST 小判买
// - 小判：只来自学习行为，每种每天有上限；复习不看对错，免得为了小判乱按评分。读完文章按篇幅、听完学习包按真正听了多久给
// - 一天超过 SOFT_CAP 之后小判减半，鼓励每天学一点而不是一次刷很多；开一个宝箱花 OPEN_COST 小判
// - 抽卡：普通 70 / 稀有 24 / 史诗 5 / 传说 1，10 抽必出稀有以上、50 抽必出史诗以上；重复转成毛玉，攒够换指定的
import { ITEMS, ITEM_BY_ID, RARITY, RARITY_ORDER, STARTER_CAT, STARTER_SCENE, type Item, type Rarity } from './catalog';
import { deviceId, kvGet, kvSet } from './db';
import { maxLedger, type GameSync } from './syncMerge';

export type Action = 'review' | 'word' | 'article' | 'listen' | 'grammar' | 'practice' | 'translate' | 'ask' | 'routine' | 'download' | 'firstOfDay';

// 按大概花的时间给分：一张卡几秒钟给 1，翻译、做题要想一会儿给 5，读完一篇 / 听完一集 / 学完一课给得多。
// 大致平衡（2026-10 调过两次）：学 40 分钟掉 1 个宝箱，这 40 分钟里不管精听、阅读、语法还是翻译，
// 行为分大约 50~70 小判，开完这个宝箱（40）还有富余。宝箱多出来没用，小判多出来能买宝箱（80），所以宁可小判略多。
// range：按分量给的（读完文章按句数、听完学习包按真正听了几分钟），界面上显示成「8~40」
export const ACTIONS: Record<Action, { label: string; points: number; dailyCap: number; range?: [number, number] }> = {
  review: { label: '复习一张卡', points: 1, dailyCap: 100 },
  word: { label: '加一个生词', points: 2, dailyCap: 30 },
  translate: { label: '翻译一句', points: 5, dailyCap: 20 },
  practice: { label: '答一道练习题', points: 5, dailyCap: 20 },
  ask: { label: '追问 AI 一次', points: 3, dailyCap: 15 },
  article: { label: '读完一篇精读（按篇幅）', points: 8, dailyCap: 6, range: [8, 40] },
  listen: { label: '听完一个学习包（按听了多久）', points: 5, dailyCap: 6, range: [5, 50] },
  grammar: { label: '学完一课语法', points: 20, dailyCap: 6 },
  routine: { label: '常读的今日一篇', points: 5, dailyCap: 3 },
  download: { label: '下载一个学习包', points: 2, dailyCap: 10 },
  firstOfDay: { label: '今天第一次学习', points: 15, dailyCap: 1 },
};

export const CHEST_SECONDS = 40 * 60;
// 宝箱和小判的平衡：学 40 分钟掉 1 个宝箱，同时行为分大约 50~70 小判，开箱价 40，宝箱随掉随开、不会越攒越多；
// 富余的小判可以买宝箱（买 + 开一共是开箱价的三倍），又不至于便宜到让学习时间变得没意义。
export const OPEN_COST = 40;
export const BUY_COST = 80;

/** 读完一篇文章给多少：每 1.5 句 1 小判，8~40 */
export const articlePoints = (sentences: number) => Math.min(40, Math.max(8, Math.round(sentences / 1.5)));
/** 听完一个学习包给多少：真正听过的每分钟 1.5 小判，5~50（拖进度条跳过去的不算） */
export const listenPoints = (heardSeconds: number) => Math.min(50, Math.max(5, Math.round((heardSeconds / 60) * 1.5)));
/** 真正听过全长的这么多才算听完；直接拖到结尾不算 */
export const LISTEN_MIN_RATIO = 0.5;

/** 现在能不能开宝箱：有宝箱，小判也够开箱价 */
export const canOpen = (s: Pick<GameState, 'chests' | 'coins'>) => s.chests > 0 && s.coins >= OPEN_COST;
export const SOFT_CAP = 200;
export const IDLE_MS = 180_000; // 这么久没操作就不算在学（精听播放时除外）
const FAST_REVIEW_MS = 1500;
export const PITY_RARE = 10;
export const PITY_EPIC = 50;

type Day = { date: string; seconds: number; points: number; counts: Partial<Record<Action, number>>; keys: string[] };

/** 房间：一个场景、最多 3 只猫（第一只是右上角陪你学习的那只）、最多 4 件自由摆放的家具（x、y 是底边中点的房间坐标） */
export type Room = {
  scene: string;
  cats: Array<{ id: string; hat: string | null }>;
  furniture: Array<{ id: string; x: number; y: number }>;
};

export const ROOM_MAX_CATS = 3;
export const ROOM_MAX_FURNITURE = 4;

/**
 * 多设备同步用的账本：每台设备只记自己赚了多少、花了多少（只增不减），合并时每台设备取最大值再加起来。
 * 这样两台设备各自赚的小判都不会丢，也不会重复算。余额 = 初始值 + 所有设备（赚 - 花）。
 */
export type Ledger = {
  coinsIn: number; coinsOut: number;
  chestsIn: number; chestsOut: number;
  shardsIn: number; shardsOut: number;
  draws: number;
  owned: Record<string, number>;
  days: Record<string, { seconds: number; points: number }>; // 每天的学习时间和小判（最近 60 天）
};

export type GameState = {
  version: 2;
  device: string;
  ledger: Record<string, Ledger>;
  roomAt: number; // 房间布置的修改时间：同步时以最新的为准
  coins: number; // 小数部分是减半后的零头，显示时取整
  chests: number;
  chestSeconds: number; // 距离下一个宝箱已经学了多少秒
  shards: number; // 毛玉
  owned: Record<string, number>;
  room: Room;
  testReset1022?: boolean; // 2026-10-22 撤回过真机测试时加的宝箱和开出来的东西
  pity: { rare: number; epic: number };
  draws: number;
  today: Day;
  history: Array<{ date: string; seconds: number; points: number }>; // 最近 60 天，不含今天
};

export const localDate = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const newDay = (): Day => ({ date: localDate(), seconds: 0, points: 0, counts: {}, keys: [] });

// 新装 App 时就有的（不记在任何设备的账本里）
const BASE = { coins: 0, chests: 1, shards: 0, owned: { [STARTER_CAT]: 1, [STARTER_SCENE]: 1 } as Record<string, number> };

const emptyLedger = (): Ledger => ({ coinsIn: 0, coinsOut: 0, chestsIn: 0, chestsOut: 0, shardsIn: 0, shardsOut: 0, draws: 0, owned: {}, days: {} });

const initial = (): GameState => ({
  version: 2, device: '', ledger: {}, roomAt: 0, coins: BASE.coins, chests: BASE.chests, chestSeconds: 0, shards: BASE.shards,
  owned: { ...BASE.owned },
  room: { scene: STARTER_SCENE, cats: [{ id: STARTER_CAT, hat: null }], furniture: [] },
  pity: { rare: 0, epic: 0 }, draws: 0, today: newDay(), history: [], testReset1022: true,
});

/** 旧版存档（只有 equipped 一只猫一件饰品）→ 房间 */
function migrate(raw: any, device: string): GameState {
  const s = { ...initial(), ...raw } as GameState & { equipped?: { cat: string; hat: string | null } };
  if (!raw.room) {
    const eq = raw.equipped ?? { cat: STARTER_CAT, hat: null };
    s.room = { scene: STARTER_SCENE, cats: [{ id: ITEM_BY_ID[eq.cat] ? eq.cat : STARTER_CAT, hat: eq.hat && ITEM_BY_ID[eq.hat] ? eq.hat : null }], furniture: [] };
    s.owned = { ...s.owned, [STARTER_SCENE]: s.owned[STARTER_SCENE] ?? 1 };
  }
  delete s.equipped;
  s.version = 2;
  // 一次性：2026-10-22 真机测试时加了 20 个宝箱并开了一部分，恢复到测试前（白猫戴鬼角、和室，宝箱清零），学习攒的小判保留
  if (raw.room && !raw.testReset1022) { // 看原始存档：s 里铺过 initial()，那里的标记是 true
    s.owned = { [STARTER_CAT]: 1, oninotsuno: 1, [STARTER_SCENE]: 1 };
    s.room = { scene: STARTER_SCENE, cats: [{ id: STARTER_CAT, hat: 'oninotsuno' }], furniture: [] };
    s.chests = 0;
    s.shards = 0;
    s.draws = 1;
    s.pity = { rare: 0, epic: 0 };
  }
  s.testReset1022 = true;
  s.device = device;
  // 加同步之前的存档：现有的小判、宝箱、藏品都记到这台设备的账上
  if (!raw.ledger) {
    const l = emptyLedger();
    track(l, { coins: BASE.coins, chests: BASE.chests, shards: BASE.shards, draws: 0, owned: BASE.owned }, totalsOf(s));
    s.ledger = { [device]: l };
  }
  recordDays(s);
  return s;
}

type Totals = { coins: number; chests: number; shards: number; draws: number; owned: Record<string, number> };
const totalsOf = (s: GameState): Totals => ({ coins: s.coins, chests: s.chests, shards: s.shards, draws: s.draws, owned: { ...s.owned } });

/** 把一次修改前后的差额记到这台设备的账上 */
function track(l: Ledger, before: Totals, after: Totals) {
  const dc = after.coins - before.coins;
  if (dc > 0) l.coinsIn += dc; else l.coinsOut -= dc;
  const dch = after.chests - before.chests;
  if (dch > 0) l.chestsIn += dch; else l.chestsOut -= dch;
  const ds = after.shards - before.shards;
  if (ds > 0) l.shardsIn += ds; else l.shardsOut -= ds;
  l.draws += Math.max(0, after.draws - before.draws);
  for (const [id, n] of Object.entries(after.owned)) {
    const gained = n - (before.owned[id] ?? 0);
    if (gained > 0) l.owned = { ...l.owned, [id]: (l.owned[id] ?? 0) + gained };
  }
}

/** 这台设备每天的学习时间记进账本（同步给别的设备画图、算今天学了多久） */
function recordDays(s: GameState) {
  const l = (s.ledger[s.device] ??= emptyLedger());
  const days = { ...l.days };
  for (const d of [...s.history, s.today]) if (d.seconds || d.points) days[d.date] = { seconds: d.seconds, points: d.points };
  l.days = Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? 1 : -1)).slice(0, 60));
}

/** 按账本重新算余额和藏品（合并了别的设备的账本之后用） */
function recompute(s: GameState) {
  const all = Object.values(s.ledger);
  const sum = (f: (l: Ledger) => number) => all.reduce((n, l) => n + f(l), 0);
  s.coins = BASE.coins + sum((l) => l.coinsIn - l.coinsOut);
  s.chests = Math.max(0, BASE.chests + sum((l) => l.chestsIn - l.chestsOut));
  s.shards = BASE.shards + sum((l) => l.shardsIn - l.shardsOut);
  s.draws = sum((l) => l.draws);
  const owned: Record<string, number> = { ...BASE.owned };
  for (const l of all) for (const [id, n] of Object.entries(l.owned)) owned[id] = (owned[id] ?? 0) + n;
  s.owned = owned;
}

/** 所有设备合起来每天的学习时间和小判（猫屋的统计图用） */
export function dayTotals(s: GameState): Map<string, { seconds: number; points: number }> {
  const out = new Map<string, { seconds: number; points: number }>();
  for (const l of Object.values(s.ledger)) {
    for (const [date, d] of Object.entries(l.days)) {
      const cur = out.get(date) ?? { seconds: 0, points: 0 };
      out.set(date, { seconds: cur.seconds + d.seconds, points: cur.points + d.points });
    }
  }
  return out;
}

// ---------- 状态读写：内存里一份，所有修改排队执行，避免并发覆盖 ----------

let cache: GameState | null = null;
let queue: Promise<unknown> = Promise.resolve();
const KEY = 'game';

async function load(): Promise<GameState> {
  if (!cache) cache = migrate(await kvGet<Record<string, unknown>>(KEY, {}), await deviceId());
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

function mutate<T>(fn: (s: GameState) => T, tracked = true): Promise<T> {
  const run = queue.then(async () => {
    const s = await load();
    const before = totalsOf(s);
    const room = JSON.stringify(s.room);
    const out = fn(s);
    if (tracked) {
      track((s.ledger[s.device] ??= emptyLedger()), before, totalsOf(s));
      if (JSON.stringify(s.room) !== room) s.roomAt = Date.now();
    }
    recordDays(s);
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
 * points：按分量给的行为（读完文章）传这次给多少，会限制在 range 里。
 * 不会抛错：小游戏出问题不能影响学习功能。
 */
export function award(action: Exclude<Action, 'firstOfDay'>, key?: string, points?: number): void {
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
    const pts = points !== undefined && def.range ? Math.min(def.range[1], Math.max(def.range[0], points)) : def.points;
    const gained = addPoints(s, pts) + firstOfDay(s);
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

/** 每 tick 秒调用一次；攒满一分钟写一次库，累计到下一个宝箱（学习时间不给小判，小判只来自学习行为）。 */
export function tick(seconds: number): void {
  if (!foreground) return;
  if (!mediaPlaying && Date.now() - lastActive > IDLE_MS) return;
  pendingSeconds += seconds;
  if (pendingSeconds < 60) return;
  const sec = pendingSeconds;
  pendingSeconds = 0;
  void mutate((s) => {
    addSeconds(s, sec);
    const gained = firstOfDay(s);
    if (gained) emit({ type: 'gain', points: gained, label: ACTIONS.firstOfDay.label });
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

/** 花 BUY_COST 小判买一个宝箱 */
export function buyChest(): Promise<void> {
  return mutate((s) => {
    if (s.coins < BUY_COST) throw new Error(`小判不够，还差 ${Math.ceil(BUY_COST - s.coins)}`);
    s.coins -= BUY_COST;
    s.chests += 1;
  });
}

/** 开一个宝箱：用掉一个宝箱，花 OPEN_COST 小判。 */
export function draw(): Promise<DrawResult> {
  return mutate((s) => {
    if (s.chests < 1) throw new Error('还没有宝箱');
    if (s.coins < OPEN_COST) throw new Error(`小判不够，还差 ${Math.ceil(OPEN_COST - s.coins)}`);
    s.chests -= 1;
    s.coins -= OPEN_COST;
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

// ---------- 多设备同步 ----------


export const gameSyncData = (): Promise<GameSync> =>
  getGame().then((s) => ({ ledger: s.ledger, room: s.room, roomAt: s.roomAt }));

/** 合并别的设备的账本和房间布置。每台设备的账只增不减，取最大值就是最新的 */
export function mergeGameSync(remote: GameSync): Promise<void> {
  return mutate((s) => {
    for (const [dev, l] of Object.entries(remote.ledger ?? {})) {
      if (dev === s.device) continue; // 自己的账本以本机为准
      s.ledger[dev] = maxLedger(s.ledger[dev], { ...emptyLedger(), ...l });
    }
    recompute(s);
    if (remote.room && remote.roomAt > s.roomAt) {
      const ok = (id: string | null) => !id || !!s.owned[id];
      s.room = {
        scene: ok(remote.room.scene) ? remote.room.scene : s.room.scene,
        cats: remote.room.cats.filter((c) => ok(c.id)).map((c) => ({ id: c.id, hat: ok(c.hat) ? c.hat : null })),
        furniture: remote.room.furniture.filter((f) => ok(f.id)),
      };
      if (!s.room.cats.length) s.room.cats = [{ id: STARTER_CAT, hat: null }];
      s.roomAt = remote.roomAt;
    }
  }, false);
}
