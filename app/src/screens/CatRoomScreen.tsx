// 猫の部屋：房间（猫自由活动）、开宝箱、图鉴（64 件，都有日语名和例句）、今天的学习、规则；「布置房间」进入编辑模式
import * as Haptics from 'expo-haptics';
import { BarChart3, Check, ChevronLeft, CircleHelp, Coins, Gift, Paintbrush, Sparkles, X } from 'lucide-react-native';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, Animated, BackHandler, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '../components/Companion';
import { RubyText } from '../components/Ruby';
import { Button, Card, Segmented, SectionLabel, Tag } from '../components/Ui';
import { RoomView } from '../game/Room';
import { CatPortrait, ChestAnimation, ItemIcon, SceneThumb } from '../game/Sprites';
import { ITEMS, ITEM_BY_ID, KIND_LABEL, parseRubyLine, RARITY, type Item, type ItemKind } from '../lib/catalog';
import {
  ACTIONS, CHEST_SECONDS, dayTotals, DRAW_COST, draw, exchange, MINUTE_POINTS, moveFurniture, ROOM_MAX_CATS, ROOM_MAX_FURNITURE, setCatHat, setMainCat,
  localDate, setScene, SOFT_CAP, toggleFurniture, toggleRoomCat, type Action, type DrawResult, type GameState,
} from '../lib/game';
import { CONTENT_MAX, radius, useColors } from '../theme';

const nameSegments = (i: Item) => (/[一-鿿]/.test(i.ja) ? [{ text: i.ja, reading: i.kana }] : [{ text: i.ja }]);
const coins = (n: number) => Math.floor(n);
const fail = (e: unknown) => Alert.alert('不行', e instanceof Error ? e.message : String(e));

export function CatRoomScreen({ onBack }: { onBack: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const game = useGame();
  const [tab, setTab] = useState<ItemKind>('cat');
  const [info, setInfo] = useState<'today' | 'rules' | null>(null);
  const [result, setResult] = useState<DrawResult | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [opening, setOpening] = useState(false);
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (editing) setEditing(false);
      else onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack, editing]);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      setResult(await draw());
    } catch (e) {
      fail(e);
    } finally {
      setOpening(false);
    }
  };

  if (!game) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const canDraw = game.chests > 0 || game.coins >= DRAW_COST;
  const nextChestMin = Math.ceil((CHEST_SECONDS - game.chestSeconds) / 60);
  const roomWidth = Math.min(width, CONTENT_MAX) - 32;

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={styles.head}>
        <Pressable onPress={() => (editing ? setEditing(false) : onBack())} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: '800' }}>{editing ? '布置房间' : '猫の部屋'}</Text>
        <Text style={{ color: c.muted, fontSize: 13, marginLeft: 6, flex: 1 }}>{editing ? '' : 'ねこのへや'}</Text>
        {editing ? null : (
          <>
            <Pressable onPress={() => setInfo('today')} hitSlop={6} style={styles.headIcon} accessibilityLabel="今天的学习"><BarChart3 size={21} color={c.ink2} /></Pressable>
            <Pressable onPress={() => setInfo('rules')} hitSlop={6} style={styles.headIcon} accessibilityLabel="规则"><CircleHelp size={21} color={c.ink2} /></Pressable>
          </>
        )}
        {editing
          ? <Button label="完成" small onPress={() => setEditing(false)} icon={<Check size={15} color={c.accentInk} />} />
          : <Button label="布置" kind="secondary" small onPress={() => setEditing(true)} icon={<Paintbrush size={15} color={c.ink} />} />}
      </View>
      {editing ? <Editor game={game} width={roomWidth} /> : (
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
          <View style={[styles.roomFrame, { borderColor: c.line }]}>
            <RoomView room={game.room} width={roomWidth - 2} />
          </View>

          <View style={styles.statRow}>
            <Stat icon={<Coins size={18} color="#D29A1E" />} value={coins(game.coins)} label="小判" />
            <Stat icon={<Gift size={18} color={c.accent} />} value={game.chests} label="宝箱" />
            <Stat icon={<Text style={{ fontSize: 15 }}>🧶</Text>} value={game.shards} label="毛玉" />
          </View>

          <Card style={{ gap: 10 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: c.ink2, fontSize: 13 }}>下一个宝箱</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>再学 {nextChestMin} 分钟</Text>
            </View>
            <View style={[styles.bar, { backgroundColor: c.surface2 }]}>
              <View style={{ width: `${(game.chestSeconds / CHEST_SECONDS) * 100}%`, height: '100%', backgroundColor: c.accent }} />
            </View>
            <Button
              label={game.chests > 0 ? `开宝箱（还有 ${game.chests} 个）` : `用 ${DRAW_COST} 小判开一个`}
              onPress={open}
              loading={opening}
              disabled={!canDraw}
              icon={<Gift size={18} color={c.accentInk} />}
            />
            {!canDraw ? <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>小判还差 {Math.ceil(DRAW_COST - game.coins)}，去学一会儿吧</Text> : null}
          </Card>

          <Segmented
            options={(['cat', 'hat', 'scene', 'furniture'] as ItemKind[]).map((k) => {
              const list = ITEMS.filter((i) => i.kind === k);
              return { value: k, label: `${KIND_LABEL[k]} ${list.filter((i) => game.owned[i.id]).length}/${list.length}` };
            })}
            value={tab}
            onChange={setTab}
          />
          <Book game={game} kind={tab} onPick={setDetail} />
        </ScrollView>
      )}

      {result ? (
        <RevealModal
          key={`${game.draws}`}
          result={result}
          game={game}
          canAgain={game.chests > 0 || game.coins >= DRAW_COST}
          onAgain={() => { setResult(null); void open(); }}
          onClose={() => setResult(null)}
        />
      ) : null}
      {detail ? <ItemSheet item={detail} game={game} onClose={() => setDetail(null)} /> : null}
      {info ? <InfoSheet title={info === 'today' ? '今天的学习' : '小判和宝箱的规则'} onClose={() => setInfo(null)}>
        {info === 'today' ? <Today game={game} /> : <Rules />}
      </InfoSheet> : null}
    </View>
  );
}

function Stat({ icon, value, label }: { icon: React.ReactNode; value: number; label: string }) {
  const c = useColors();
  return (
    <View style={[styles.stat, { backgroundColor: c.surface, borderColor: c.line }]}>
      {icon}
      <Text style={{ color: c.ink, fontSize: 18, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: c.muted, fontSize: 11.5 }}>{label}</Text>
    </View>
  );
}

// ---------- 房间里的状态和快捷操作 ----------

const inRoom = (g: GameState, i: Item) =>
  i.kind === 'cat' ? g.room.cats.some((x) => x.id === i.id)
    : i.kind === 'furniture' ? g.room.furniture.some((x) => x.id === i.id)
      : i.kind === 'scene' ? g.room.scene === i.id
        : g.room.cats.some((x) => x.hat === i.id);

function freeSpot(g: GameState): number {
  for (const x of [32, 128, 56, 104, 80]) if (!g.room.furniture.some((f) => Math.abs(f.x - x) < 20)) return x;
  return 80;
}

/** 收藏品放进房间 / 用上（场景换上、饰品给陪伴猫戴上） */
function applyItem(g: GameState, i: Item): Promise<unknown> {
  if (i.kind === 'cat') return toggleRoomCat(i.id);
  if (i.kind === 'furniture') return toggleFurniture(i.id, freeSpot(g), 86);
  if (i.kind === 'scene') return setScene(i.id);
  const main = g.room.cats[0];
  return setCatHat(main.id, main.hat === i.id ? null : i.id);
}

function actionLabel(g: GameState, i: Item): { label: string; disabled?: boolean } {
  const here = inRoom(g, i);
  if (i.kind === 'cat') {
    if (here) return { label: g.room.cats.length <= 1 ? '正在陪你学习' : '从房间收起', disabled: g.room.cats.length <= 1 };
    // 房间满了就别给一个点了才报错的按钮
    return g.room.cats.length >= ROOM_MAX_CATS ? { label: `房间里已经有 ${ROOM_MAX_CATS} 只猫`, disabled: true } : { label: '放进房间' };
  }
  if (i.kind === 'furniture') {
    if (here) return { label: '从房间收起' };
    return g.room.furniture.length >= ROOM_MAX_FURNITURE ? { label: `已经摆了 ${ROOM_MAX_FURNITURE} 件家具`, disabled: true } : { label: '摆进房间' };
  }
  if (i.kind === 'scene') return here ? { label: '正在用这个场景', disabled: true } : { label: '换成这个场景' };
  const main = g.room.cats[0];
  return { label: main.hat === i.id ? '取下' : `给${ITEM_BY_ID[main.id]?.ja ?? '猫'}戴上` };
}

// ---------- 编辑模式 ----------

function Editor({ game, width }: { game: GameState; width: number }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [tab, setTab] = useState<'cat' | 'furniture' | 'hat'>('cat');
  const [sel, setSel] = useState<{ kind: 'cat' | 'furniture'; id: string } | null>(null);
  const owned = (kind: ItemKind) => ITEMS.filter((i) => i.kind === kind && game.owned[i.id]);
  const target = sel?.kind === 'cat' && game.room.cats.some((x) => x.id === sel.id) ? sel.id : game.room.cats[0].id;
  const targetCat = game.room.cats.find((x) => x.id === target)!;

  const onSelect = useCallback((kind: 'cat' | 'furniture', id: string) => {
    setSel({ kind, id });
    if (kind === 'cat') setTab('hat');
  }, []);
  const onRemove = useCallback((kind: 'cat' | 'furniture', id: string) => {
    (kind === 'cat' ? toggleRoomCat(id) : toggleFurniture(id)).catch(fail);
    setSel(null);
  }, []);
  const onMove = useCallback((id: string, x: number, y: number) => { void moveFurniture(id, x, y); }, []);

  return (
    <View style={{ flex: 1 }}>
      <View style={{ paddingHorizontal: 16, gap: 8 }}>
        <View style={[styles.roomFrame, { borderColor: c.accent }]}>
          <RoomView room={game.room} width={width - 2} editing selected={sel?.id ?? null} onSelect={onSelect} onMoveFurniture={onMove} onRemove={onRemove} />
        </View>
        <Text style={{ color: c.muted, fontSize: 12, lineHeight: 17 }}>在房间里拖动猫和家具换位置；往下拖出房间就收起。点房间里的猫可以给它戴饰品。</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
          {owned('scene').map((i) => {
            const on = game.room.scene === i.id;
            return (
              <Pressable key={i.id} onPress={() => setScene(i.id).catch(fail)} style={[styles.sceneThumb, { borderColor: on ? c.accent : c.line }]}>
                <SceneThumb id={i.id} width={88} />
                <Text numberOfLines={1} style={{ color: on ? c.accent : c.ink2, fontSize: 11, textAlign: 'center', paddingVertical: 2 }}>{i.ja}</Text>
              </Pressable>
            );
          })}
        </ScrollView>
        <Segmented
          options={[
            { value: 'cat', label: `猫 ${game.room.cats.length}/${ROOM_MAX_CATS}` },
            { value: 'furniture', label: `家具 ${game.room.furniture.length}/${ROOM_MAX_FURNITURE}` },
            { value: 'hat', label: '饰品' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </View>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 30, gap: 10 }}>
        {tab === 'hat' ? (
          <>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <CatPortrait id={target} hat={targetCat.hat} size={40} />
              <Text style={{ color: c.ink, fontWeight: '700', flex: 1 }}>给{ITEM_BY_ID[target]?.ja}戴</Text>
              {game.room.cats[0].id !== target
                ? <Button label="让它陪我学习" kind="secondary" small onPress={() => setMainCat(target).catch(fail)} />
                : <Tag label="陪你学习中" tone="accent" />}
            </View>
            <View style={styles.grid}>
              <Tile on={!targetCat.hat} onPress={() => setCatHat(target, null).catch(fail)}>
                <Text style={{ color: c.muted, fontSize: 12, height: 50, textAlignVertical: 'center' }}>不戴</Text>
              </Tile>
              {owned('hat').map((i) => (
                <Tile key={i.id} on={targetCat.hat === i.id} onPress={() => setCatHat(target, targetCat.hat === i.id ? null : i.id).catch(fail)} label={i.ja}>
                  <ItemIcon item={i} size={44} />
                </Tile>
              ))}
            </View>
          </>
        ) : (
          <View style={styles.grid}>
            {owned(tab).map((i) => (
              <Tile key={i.id} on={inRoom(game, i)} onPress={() => (tab === 'cat' ? toggleRoomCat(i.id) : toggleFurniture(i.id, freeSpot(game), 86)).catch(fail)} label={i.ja}>
                <ItemIcon item={i} size={44} />
              </Tile>
            ))}
          </View>
        )}
        <Text style={{ color: c.muted, fontSize: 12 }}>
          {tab === 'cat' ? '点一下放进房间或收起，最多 3 只。第一只会在右上角陪你学习。' : tab === 'furniture' ? '点一下摆进房间或收起，最多 4 件。' : '一件饰品只能戴在一只猫身上。'}
        </Text>
      </ScrollView>
    </View>
  );
}

function Tile({ on, onPress, label, children }: { on: boolean; onPress: () => void; label?: string; children: React.ReactNode }) {
  const c = useColors();
  return (
    <Pressable onPress={onPress} style={[styles.tile, { backgroundColor: on ? c.accentSoft : c.surface, borderColor: on ? c.accent : c.line }]}>
      {on ? <View style={[styles.check, { backgroundColor: c.accent }]}><Check size={10} color={c.accentInk} /></View> : null}
      {children}
      {label ? <Text numberOfLines={1} style={{ color: c.ink, fontSize: 11 }}>{label}</Text> : null}
    </Pressable>
  );
}

// ---------- 图鉴 ----------

function Book({ game, kind, onPick }: { game: GameState; kind: ItemKind; onPick: (i: Item) => void }) {
  const c = useColors();
  const section = (kind: ItemKind) => {
    const list = ITEMS.filter((i) => i.kind === kind);
    return (
      <View key={kind} style={{ gap: 8 }}>
        <View style={styles.grid}>
          {list.map((i) => {
            const has = !!game.owned[i.id];
            const on = has && inRoom(game, i);
            return (
              <Pressable key={i.id} onPress={() => onPick(i)} style={[styles.tile, { backgroundColor: c.surface, borderColor: on ? c.accent : c.line }]}>
                <View style={[styles.rarityDot, { backgroundColor: RARITY[i.rarity].color }]} />
                <ItemIcon item={i} size={48} ghost={has ? undefined : c.line} />
                <Text numberOfLines={1} style={{ color: has ? c.ink : c.muted, fontSize: 11.5, fontWeight: has ? '700' : '400' }}>{has ? i.ja : '？？？'}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };
  return (
    <View style={{ gap: 16 }}>
      {section(kind)}
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>点开看日语名字和例句。没收集到的可以用毛玉换：普通 {RARITY.common.cost}、稀有 {RARITY.rare.cost}、史诗 {RARITY.epic.cost}、传说 {RARITY.legendary.cost}。</Text>
    </View>
  );
}

function ItemBody({ item, size = 120 }: { item: Item; size?: number }) {
  const c = useColors();
  const r = RARITY[item.rarity];
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      {item.kind === 'scene' ? <View style={{ borderRadius: 8, overflow: 'hidden' }}><SceneThumb id={item.id} width={size * 2} /></View> : <ItemIcon item={item} size={size} />}
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <View style={[styles.rarity, { backgroundColor: r.color }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{r.label} · {r.ja}</Text></View>
        <Tag label={KIND_LABEL[item.kind]} />
      </View>
      <RubyText segments={nameSegments(item)} size={26} />
      <Text style={{ color: c.ink2, fontSize: 14 }}>{item.zh}</Text>
      <View style={[styles.line, { backgroundColor: c.surface2 }]}>
        <RubyText segments={parseRubyLine(item.line)} size={16} />
      </View>
    </View>
  );
}

function ItemSheet({ item, game, onClose }: { item: Item; game: GameState; onClose: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const has = !!game.owned[item.id];
  const cost = RARITY[item.rarity].cost;
  const act = actionLabel(game, item);
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={onClose} hitSlop={10} style={{ alignSelf: 'flex-end' }}><X size={22} color={c.muted} /></Pressable>
        {has ? <ItemBody item={item} /> : (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <ItemIcon item={item} size={120} ghost={c.line} />
            <Tag label={`${RARITY[item.rarity].label} · ${KIND_LABEL[item.kind]}`} />
            <Text style={{ color: c.muted, fontSize: 15 }}>还没有收集到</Text>
          </View>
        )}
        {has ? <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>拥有 {game.owned[item.id]} 个</Text> : null}
        {has
          ? <Button label={act.label} disabled={act.disabled} onPress={() => applyItem(game, item).then(onClose, fail)} />
          : <Button label={`用 ${cost} 毛玉换（现有 ${game.shards}）`} disabled={game.shards < cost} onPress={() => exchange(item.id).catch(fail)} />}
      </View>
    </Modal>
  );
}

// ---------- 开箱 ----------

const HAPTIC = {
  common: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  rare: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
  epic: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy),
  legendary: () => Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success),
};

function RevealModal({ result, game, canAgain, onAgain, onClose }: {
  result: DrawResult; game: GameState; canAgain: boolean; onAgain: () => void; onClose: () => void;
}) {
  const c = useColors();
  const { width } = useWindowDimensions();
  const [shown, setShown] = useState(false);
  const pop = React.useRef(new Animated.Value(0)).current;
  const item = result.item;
  const r = RARITY[item.rarity];
  const onOpen = useCallback(() => {
    void HAPTIC[item.rarity]().catch(() => {});
    setShown(true);
    Animated.timing(pop, { toValue: 1, duration: 360, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
  }, [item.rarity, pop]);
  const act = actionLabel(game, item);
  const chestSize = Math.min(width - 48, 300);
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.revealBg}>
        {/* 结果卡只压住宝箱下面的空白，箱子和光芒都要露出来 */}
        <View style={{ alignItems: 'center', marginBottom: shown ? -chestSize * 0.12 : 0 }}>
          <ChestAnimation rarity={item.rarity} size={chestSize} onOpen={onOpen} />
        </View>
        {shown ? (
          <Animated.View style={[styles.revealCard, { backgroundColor: c.surface, borderColor: r.color, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }], opacity: pop }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
              <Sparkles size={16} color={r.color} />
              <Text style={{ color: r.color, fontWeight: '800' }}>{result.isNew ? '新收藏！' : '重复了'}</Text>
            </View>
            <ItemBody item={item} size={104} />
            {!result.isNew ? <Text style={{ color: c.muted, textAlign: 'center', fontSize: 13 }}>换成毛玉 🧶 +{result.shards}</Text> : null}
            <View style={{ gap: 8 }}>
              {result.isNew && !inRoom(game, item) ? (
                <Button label={act.label} disabled={act.disabled} onPress={() => { applyItem(game, item).catch(fail); onClose(); }} />
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="好" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
                {canAgain ? <Button label="再开一个" kind="secondary" onPress={onAgain} style={{ flex: 1 }} /> : null}
              </View>
            </View>
          </Animated.View>
        ) : null}
      </View>
    </Modal>
  );
}

// ---------- 今天 / 规则（右上角两个图标打开） ----------

function InfoSheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.bg, paddingBottom: insets.bottom + 16, maxHeight: '82%' }]}>
        <View style={{ flexDirection: 'row', alignItems: 'center' }}>
          <Text style={{ flex: 1, color: c.ink, fontSize: 17, fontWeight: '800' }}>{title}</Text>
          <Pressable onPress={onClose} hitSlop={10}><X size={22} color={c.muted} /></Pressable>
        </View>
        <ScrollView contentContainerStyle={{ gap: 12 }}>{children}</ScrollView>
      </View>
    </Modal>
  );
}

function Today({ game }: { game: GameState }) {
  const c = useColors();
  // 固定 14 个日历日（没学习的那天是空柱），不然只有两天记录时两根柱子会被拉得很宽
  // 所有设备加起来（同步过来的别的设备也算）
  const totals = dayTotals(game);
  const today = totals.get(game.today.date) ?? { seconds: game.today.seconds, points: game.today.points };
  const days = Array.from({ length: 14 }, (_, i) => {
    const date = localDate(new Date(Date.now() - (13 - i) * 86400000));
    return { date, seconds: totals.get(date)?.seconds ?? 0 };
  });
  const max = Math.max(60, ...days.map((d) => d.seconds));
  const counts = Object.entries(game.today.counts).filter(([k, v]) => v && k !== 'firstOfDay') as Array<[Action, number]>;
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>今天有效学习</Text>
          <Text style={{ color: c.ink, fontSize: 24, fontWeight: '800' }}>{Math.floor(today.seconds / 60)} 分钟</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>今天得到</Text>
          <Text style={{ color: c.ink, fontSize: 24, fontWeight: '800' }}>{coins(today.points)} 小判</Text>
        </View>
      </View>
      {counts.length ? (
        <View style={{ gap: 4 }}>
          {counts.map(([k, v]) => (
            <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ color: c.ink2, fontSize: 13 }}>{ACTIONS[k].label}</Text>
              <Text style={{ color: c.muted, fontSize: 13 }}>{v} 次</Text>
            </View>
          ))}
        </View>
      ) : <Text style={{ color: c.muted, fontSize: 13 }}>今天还没有复习、阅读、精听这些记录</Text>}
      <View style={{ gap: 6 }}>
        <Text style={{ color: c.ink2, fontSize: 12.5 }}>最近 14 天（分钟）</Text>
        <View style={styles.chart}>
          {days.map((d) => (
            <View key={d.date} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end', height: '100%' }}>
              <View style={{ width: '70%', height: `${Math.max(d.seconds ? 6 : 2, (d.seconds / max) * 100)}%`, borderRadius: 3, backgroundColor: d.seconds ? c.accent : c.surface2 }} />
            </View>
          ))}
        </View>
      </View>
      <Text style={{ color: c.muted, fontSize: 12 }}>累计开箱 {game.draws} 次</Text>
    </Card>
  );
}

function Rules() {
  const c = useColors();
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ color: c.ink, fontWeight: '700' }}>怎么得小判</Text>
      <Text style={{ color: c.ink2, fontSize: 13, lineHeight: 20 }}>
        有效学习每分钟 {MINUTE_POINTS} 小判（App 开着、并且 1 分钟内有操作；精听播放时不用点屏幕）。每学满 30 分钟掉一个宝箱。
      </Text>
      {(Object.keys(ACTIONS) as Action[]).map((k) => (
        <View key={k} style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
          <Text style={{ color: c.ink2, fontSize: 13 }}>{ACTIONS[k].label}</Text>
          <Text style={{ color: c.muted, fontSize: 13 }}>+{ACTIONS[k].points}（每天最多 {ACTIONS[k].dailyCap} 次）</Text>
        </View>
      ))}
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>
        复习不看对错，按真实情况评分就好。连续快速点过（每张不到 1.5 秒）不算。一天超过 {SOFT_CAP} 小判后，后面的减半——每天学一点比一次学很多更好。{'\n'}
        宝箱只有一种，开到什么在打开时就定了：普通 {RARITY.common.weight}%、稀有 {RARITY.rare.weight}%、史诗 {RARITY.epic.weight}%、传说 {RARITY.legendary.weight}%，猫、饰品、场景、家具都在里面。连续 10 次没出稀有，下一次必出；50 次必出史诗以上。重复的会变成毛玉。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingRight: 16, height: 56 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  headIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14 },
  roomFrame: { borderWidth: 1, borderRadius: radius.md, overflow: 'hidden', alignItems: 'center' },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '23%', flexGrow: 1, maxWidth: '24%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.md, borderWidth: 1.5, gap: 2 },
  check: { position: 'absolute', top: 4, right: 4, width: 16, height: 16, borderRadius: 8, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  sceneThumb: { width: 92, borderWidth: 2, borderRadius: radius.sm, overflow: 'hidden' },
  rarityDot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4 },
  rarity: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  line: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, alignSelf: 'stretch', alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 14 },
  revealBg: { flex: 1, backgroundColor: 'rgba(20,16,12,0.82)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  revealCard: { alignSelf: 'stretch', borderRadius: 22, borderWidth: 3, padding: 20, gap: 14 },
  chart: { flexDirection: 'row', height: 56, alignItems: 'flex-end' },
});
