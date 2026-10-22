// 多设备同步的合并规则（纯函数，不碰数据库，方便单独测试）。数据怎么导出、写回见 sync.ts。
//
// 原则：每条数据有跨设备不变的 key 和修改时间，两边都有就取较新的；删除留墓碑，墓碑比数据新才删。
// - 生词：复习进度（card、due、已掌握）按 card_at 取新，AI 讲解按 updated_at 取新、只有一边有就用那一边
// - 复习记录：两边取并集；生词删掉了，它的复习记录也一起删
// - 小游戏：每台设备的账本只增不减，逐项取最大值（见 game.ts 的 Ledger）
import type { Ledger, Room } from './game';

export type WordSync = {
  uid: string; entry_id: number | null; headword: string; reading: string | null; entry: string | null;
  context: string | null; context_zh: string | null; package_id: string | null; clip_start: number | null; clip_end: number | null;
  card: string; due: number; added_at: number; mastered: number; detail: string | null; updated_at: number; card_at: number;
};
export type ReviewSync = { w: string; r: number; t: number };
export type RecordSync = { uid: string; kind: string; title: string; data: string; created_at: number; updated_at: number };
export type GrammarSync = { id: string; status: string; lesson: string | null; quiz_correct: number | null; quiz_total: number | null; updated_at: number };
export type RoutineSync = {
  id: string; name: string; prompt: string; length: string; web: boolean; createdAt: number;
  history: Array<{ date: string; title: string; subject?: string; urls: string[]; articleId: number; articleUid?: string }>;
};
export type UsageSync = { day: string; kind: string; model: string; calls: number; input: number; output: number };
export type GameSync = { ledger: Record<string, Ledger>; room: Room; roomAt: number };

export type SyncDoc = {
  format: 1;
  words: WordSync[];
  reviews: ReviewSync[];
  records: RecordSync[];
  grammar: GrammarSync[];
  progress: Record<string, { last_sentence: number; at: number }>; // 精听学到第几句
  kv: Record<string, { v: unknown; at: number }>; // 语法课程安排、词条中文释义缓存等
  routines: RoutineSync[];
  tombstones: Record<string, number>; // "kind|key" → 删除时间
  game: GameSync | null;
  usage: Record<string, UsageSync[]>; // 设备 → 这台设备的 API 用量
};

export const emptyDoc = (): SyncDoc => ({
  format: 1, words: [], reviews: [], records: [], grammar: [], progress: {}, kv: {}, routines: [], tombstones: {}, game: null, usage: {},
});

const byKey = <T,>(list: T[], key: (x: T) => string) => new Map(list.map((x) => [key(x), x]));

/** 两边按 key 合并，同一个 key 用 pick 决定留哪个 */
function mergeBy<T>(a: T[], b: T[], key: (x: T) => string, pick: (x: T, y: T) => T): T[] {
  const out = byKey(a, key);
  for (const y of b) {
    const k = key(y);
    const x = out.get(k);
    out.set(k, x ? pick(x, y) : y);
  }
  return [...out.values()];
}

const newer = <T extends { updated_at: number }>(x: T, y: T) => (y.updated_at > x.updated_at ? y : x);

export function mergeWord(x: WordSync, y: WordSync): WordSync {
  const base = newer(x, y);
  const card = y.card_at > x.card_at ? y : x;
  const other = base === x ? y : x;
  return {
    ...base,
    card: card.card, due: card.due, mastered: card.mastered, card_at: card.card_at,
    detail: base.detail ?? other.detail,
    added_at: Math.min(x.added_at, y.added_at),
    updated_at: Math.max(x.updated_at, y.updated_at),
  };
}

export const maxLedger = (a: Ledger | undefined, b: Ledger): Ledger => {
  if (!a) return b;
  const keys = (x: object, y: object) => [...new Set([...Object.keys(x), ...Object.keys(y)])];
  const owned = Object.fromEntries(keys(a.owned, b.owned).map((id) => [id, Math.max(a.owned[id] ?? 0, b.owned[id] ?? 0)]));
  const days = Object.fromEntries(keys(a.days, b.days).map((d) => {
    const x = a.days[d] ?? { seconds: 0, points: 0 };
    const y = b.days[d] ?? { seconds: 0, points: 0 };
    return [d, { seconds: Math.max(x.seconds, y.seconds), points: Math.max(x.points, y.points) }];
  }));
  return {
    coinsIn: Math.max(a.coinsIn, b.coinsIn), coinsOut: Math.max(a.coinsOut, b.coinsOut),
    chestsIn: Math.max(a.chestsIn, b.chestsIn), chestsOut: Math.max(a.chestsOut, b.chestsOut),
    shardsIn: Math.max(a.shardsIn, b.shardsIn), shardsOut: Math.max(a.shardsOut, b.shardsOut),
    draws: Math.max(a.draws, b.draws), owned, days,
  };
};

function mergeGame(a: GameSync | null, b: GameSync | null): GameSync | null {
  if (!a || !b) return a ?? b;
  const ledger: Record<string, Ledger> = { ...a.ledger };
  for (const [dev, l] of Object.entries(b.ledger)) ledger[dev] = maxLedger(ledger[dev], l);
  const room = b.roomAt > a.roomAt ? b : a;
  return { ledger, room: room.room, roomAt: room.roomAt };
}

function mergeRoutines(a: RoutineSync[], b: RoutineSync[]): RoutineSync[] {
  return mergeBy(a, b, (r) => r.id, (x, y) => {
    // 两台设备各写过不同日子的「今日一篇」：按日期合并，同一天优先留能找到文章的那条
    const history = mergeBy(x.history, y.history, (h) => h.date, (h1, h2) => (h1.articleUid ? h1 : h2))
      .sort((h1, h2) => (h1.date < h2.date ? 1 : -1))
      .slice(0, 60);
    return { ...x, history };
  });
}

function mergeUsage(a: Record<string, UsageSync[]>, b: Record<string, UsageSync[]>): Record<string, UsageSync[]> {
  const out = { ...a };
  for (const [dev, rows] of Object.entries(b)) {
    // 每台设备的用量只增不减，同一天同一模型取较大的
    out[dev] = mergeBy(out[dev] ?? [], rows, (r) => `${r.day}|${r.kind}|${r.model}`, (x, y) => (y.calls > x.calls ? y : x));
  }
  return out;
}

const dead = (tomb: Record<string, number>, kind: string, key: string, at: number) => (tomb[`${kind}|${key}`] ?? -1) >= at;

/** 合并两份同步数据。结果里已经去掉了被墓碑删掉的数据（墓碑本身保留，继续告诉其他设备） */
export function mergeDocs(a: SyncDoc, b: SyncDoc): SyncDoc {
  const tombstones = { ...a.tombstones };
  for (const [k, at] of Object.entries(b.tombstones)) tombstones[k] = Math.max(tombstones[k] ?? 0, at);

  const kv = { ...a.kv };
  for (const [k, e] of Object.entries(b.kv)) if (!kv[k] || e.at > kv[k].at) kv[k] = e;

  const progress = { ...a.progress };
  for (const [k, p] of Object.entries(b.progress)) if (!progress[k] || p.at > progress[k].at) progress[k] = p;

  const words = mergeBy(a.words, b.words, (w) => w.uid, mergeWord).filter((w) => !dead(tombstones, 'word', w.uid, w.updated_at));
  const alive = new Set(words.map((w) => w.uid));
  return {
    format: 1,
    words,
    reviews: mergeBy(a.reviews, b.reviews, (r) => `${r.w}|${r.t}`, (x) => x).filter((r) => alive.has(r.w) || !(`word|${r.w}` in tombstones)),
    records: mergeBy(a.records, b.records, (r) => r.uid, newer).filter((r) => !dead(tombstones, 'record', r.uid, r.updated_at)),
    grammar: mergeBy(a.grammar, b.grammar, (g) => g.id, newer),
    progress,
    kv,
    routines: mergeRoutines(a.routines, b.routines).filter((r) => !dead(tombstones, 'routine', r.id, r.createdAt)),
    tombstones,
    game: mergeGame(a.game, b.game),
    usage: mergeUsage(a.usage, b.usage),
  };
}
