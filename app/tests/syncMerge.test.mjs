// 多设备同步合并规则的测试：node --test tests/syncMerge.test.mjs（Node 22 能直接加载 .ts）
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { emptyDoc, mergeDocs } from '../src/lib/syncMerge.ts';

const word = (uid, o = {}) => ({
  uid, entry_id: null, headword: uid, reading: null, entry: null, context: null, context_zh: null, package_id: null,
  clip_start: null, clip_end: null, card: '{}', due: 0, added_at: 100, mastered: 0, detail: null, updated_at: 100, card_at: 100, ...o,
});
const doc = (o) => ({ ...emptyDoc(), ...o });
const ledger = (o = {}) => ({
  coinsIn: 0, coinsOut: 0, chestsIn: 0, chestsOut: 0, shardsIn: 0, shardsOut: 0, draws: 0, owned: {}, days: {}, ...o,
});
const room = (scene) => ({ scene, cats: [{ id: 'shiro', hat: null }], furniture: [] });

test('words only on one side are kept from both', () => {
  const m = mergeDocs(doc({ words: [word('e1')] }), doc({ words: [word('e2')] }));
  assert.deepEqual(m.words.map((w) => w.uid).sort(), ['e1', 'e2']);
});

test('review progress and AI detail merge separately', () => {
  // 手机上复习过（card_at 新），平板上生成了讲解（updated_at 新）：两样都要留下
  const phone = word('e1', { card: 'reviewed', due: 999, card_at: 300, updated_at: 300 });
  const tablet = word('e1', { detail: 'detail', updated_at: 400 });
  const m = mergeDocs(doc({ words: [phone] }), doc({ words: [tablet] })).words[0];
  assert.equal(m.card, 'reviewed');
  assert.equal(m.due, 999);
  assert.equal(m.detail, 'detail');
  assert.equal(m.updated_at, 400);
});

test('detail is kept when the newer side has none', () => {
  const a = word('e1', { detail: 'old detail', updated_at: 200 });
  const b = word('e1', { updated_at: 300, card_at: 300 });
  assert.equal(mergeDocs(doc({ words: [a] }), doc({ words: [b] })).words[0].detail, 'old detail');
});

test('a deletion removes the word unless it was changed afterwards', () => {
  const tomb = { 'word|e1': 500 };
  assert.equal(mergeDocs(doc({ words: [word('e1', { updated_at: 400 })] }), doc({ tombstones: tomb })).words.length, 0);
  // 删了以后又在另一台设备上重新加回来（更新），要保留
  assert.equal(mergeDocs(doc({ words: [word('e1', { updated_at: 600 })] }), doc({ tombstones: tomb })).words.length, 1);
});

test('reviews are a union without duplicates', () => {
  const a = doc({ reviews: [{ w: 'e1', r: 3, t: 1 }, { w: 'e1', r: 3, t: 2 }] });
  const b = doc({ reviews: [{ w: 'e1', r: 3, t: 2 }, { w: 'e2', r: 1, t: 5 }] });
  assert.equal(mergeDocs(a, b).reviews.length, 3);
});

test('records: newer edit wins, deleted ones go away', () => {
  const rec = (uid, updated_at, data) => ({ uid, kind: 'ask', title: uid, data, created_at: 1, updated_at });
  const m = mergeDocs(
    doc({ records: [rec('a', 10, 'old'), rec('b', 10, 'x')] }),
    doc({ records: [rec('a', 20, 'new')], tombstones: { 'record|b': 15 } }),
  );
  assert.deepEqual(m.records.map((r) => [r.uid, r.data]), [['a', 'new']]);
});

test('coins earned on both devices add up instead of overwriting', () => {
  // 手机赚了 50 花了 0，平板赚了 30：合并后两台设备的账都在
  const a = doc({ game: { ledger: { phone: ledger({ coinsIn: 50 }) }, room: room('washitsu'), roomAt: 1 } });
  const b = doc({ game: { ledger: { tablet: ledger({ coinsIn: 30 }) }, room: room('cafe'), roomAt: 2 } });
  const g = mergeDocs(a, b).game;
  const total = Object.values(g.ledger).reduce((n, l) => n + l.coinsIn - l.coinsOut, 0);
  assert.equal(total, 80);
  assert.equal(g.room.scene, 'cafe'); // 房间布置以较新的为准
});

test('an older copy of a device ledger never lowers it', () => {
  const newer = ledger({ coinsIn: 120, coinsOut: 100, owned: { tora: 1 } });
  const stale = ledger({ coinsIn: 80, owned: {} });
  const g = mergeDocs(
    doc({ game: { ledger: { phone: newer }, room: room('a'), roomAt: 1 } }),
    doc({ game: { ledger: { phone: stale }, room: room('a'), roomAt: 1 } }),
  ).game;
  assert.equal(g.ledger.phone.coinsIn, 120);
  assert.equal(g.ledger.phone.coinsOut, 100);
  assert.equal(g.ledger.phone.owned.tora, 1);
});

test('listening progress takes the most recent position', () => {
  const m = mergeDocs(doc({ progress: { p1: { last_sentence: 10, at: 5 } } }), doc({ progress: { p1: { last_sentence: 3, at: 9 }, p2: { last_sentence: 1, at: 1 } } }));
  assert.deepEqual(m.progress, { p1: { last_sentence: 3, at: 9 }, p2: { last_sentence: 1, at: 1 } });
});

test('routine history from both devices is combined by date', () => {
  const r = (history) => ({ id: 'r1', name: 'n', prompt: 'p', length: 'short', web: false, createdAt: 1, history });
  const h = (date, articleUid) => ({ date, title: date, urls: [], articleId: -1, articleUid });
  const m = mergeDocs(doc({ routines: [r([h('2026-10-20', 'a')])] }), doc({ routines: [r([h('2026-10-21', 'b')])] }));
  assert.deepEqual(m.routines[0].history.map((x) => x.date), ['2026-10-21', '2026-10-20']);
  assert.equal(mergeDocs(doc({ routines: [r([])] }), doc({ tombstones: { 'routine|r1': 5 } })).routines.length, 0);
});

test('API usage keeps every device separately', () => {
  const u = (calls) => [{ day: 'd', kind: 'text', model: 'm', calls, input: 0, output: 0 }];
  const m = mergeDocs(doc({ usage: { phone: u(5) } }), doc({ usage: { phone: u(3), tablet: u(2) } }));
  assert.equal(m.usage.phone[0].calls, 5);
  assert.equal(m.usage.tablet[0].calls, 2);
});

test('reviews of a deleted word are dropped with it', () => {
  const m = mergeDocs(
    doc({ words: [word('e1')], reviews: [{ w: 'e1', r: 3, t: 1 }, { w: 'h:gone', r: 3, t: 2 }] }),
    doc({ tombstones: { 'word|h:gone': 10 } }),
  );
  assert.deepEqual(m.reviews.map((r) => r.w), ['e1']);
});
