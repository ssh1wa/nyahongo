// 猫の部屋：开宝箱、图鉴（每件都有日语名和例句）、今日学习、规则
import { ChevronLeft, Coins, Gift, Sparkles, X } from 'lucide-react-native';
import React, { useEffect, useRef, useState } from 'react';
import { Alert, Animated, BackHandler, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useGame } from '../components/Companion';
import { PixelCat } from '../components/PixelCat';
import { RubyText } from '../components/Ruby';
import { Button, Card, Segmented, SectionLabel, Tag } from '../components/Ui';
import { ITEMS, ITEM_BY_ID, parseRubyLine, RARITY, type Item } from '../lib/catalog';
import {
  ACTIONS, CHEST_SECONDS, DRAW_COST, draw, equip, exchange, MINUTE_POINTS, SOFT_CAP, type Action, type DrawResult, type GameState,
} from '../lib/game';
import { radius, useColors } from '../theme';

const nameSegments = (i: Item) => (/[一-鿿]/.test(i.ja) ? [{ text: i.ja, reading: i.kana }] : [{ text: i.ja }]);
const coins = (n: number) => Math.floor(n);

export function CatRoomScreen({ onBack }: { onBack: () => void }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const game = useGame();
  const [tab, setTab] = useState<'book' | 'today' | 'rules'>('book');
  const [result, setResult] = useState<DrawResult | null>(null);
  const [detail, setDetail] = useState<Item | null>(null);
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => { onBack(); return true; });
    return () => sub.remove();
  }, [onBack]);

  const open = async () => {
    if (opening) return;
    setOpening(true);
    try {
      const r = await draw();
      setResult(r);
    } catch (e) {
      Alert.alert('开不了', e instanceof Error ? e.message : String(e));
    } finally {
      setOpening(false);
    }
  };

  if (!game) return <View style={{ flex: 1, backgroundColor: c.bg }} />;
  const cat = ITEM_BY_ID[game.equipped.cat];
  const hat = game.equipped.hat ? ITEM_BY_ID[game.equipped.hat] : null;
  const canDraw = game.chests > 0 || game.coins >= DRAW_COST;
  const nextChestMin = Math.ceil((CHEST_SECONDS - game.chestSeconds) / 60);

  return (
    <View style={{ flex: 1, backgroundColor: c.bg, paddingTop: insets.top }}>
      <View style={styles.head}>
        <Pressable onPress={onBack} hitSlop={10} style={styles.back}><ChevronLeft size={26} color={c.ink} /></Pressable>
        <Text style={{ color: c.ink, fontSize: 20, fontWeight: '800' }}>猫の部屋</Text>
        <Text style={{ color: c.muted, fontSize: 13, marginLeft: 6 }}>ねこのへや</Text>
      </View>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + 40 }]}>
        {/* 房间 */}
        <View style={[styles.room, { backgroundColor: c.dark ? '#2A2520' : '#EFE3CC', borderColor: c.line }]}>
          <View style={[styles.wall, { backgroundColor: c.dark ? '#332C25' : '#F7EEDC' }]} />
          <View style={[styles.floor, { backgroundColor: c.dark ? '#3B3426' : '#D9C79A' }]}>
            {Array.from({ length: 6 }, (_, i) => <View key={i} style={[styles.tatamiLine, { left: `${(i + 1) * 14}%`, backgroundColor: c.dark ? '#2E281E' : '#C7B383' }]} />)}
          </View>
          <View style={{ alignItems: 'center', marginTop: 18 }}>
            <PixelCat cat={game.equipped.cat} hat={game.equipped.hat} size={144} />
          </View>
          <View style={styles.roomName}>
            {cat ? <RubyText segments={nameSegments(cat)} size={16} /> : null}
            {hat ? <Text style={{ color: c.ink2, fontSize: 12 }}>× {hat.ja}</Text> : null}
          </View>
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

        <Segmented options={[{ value: 'book', label: '图鉴' }, { value: 'today', label: '今天' }, { value: 'rules', label: '规则' }]} value={tab} onChange={setTab} />
        {tab === 'book' ? <Book game={game} onPick={setDetail} /> : null}
        {tab === 'today' ? <Today game={game} /> : null}
        {tab === 'rules' ? <Rules /> : null}
      </ScrollView>

      {result ? (
        <RevealModal
          result={result}
          game={game}
          canAgain={game.chests > 0 || game.coins >= DRAW_COST}
          onAgain={() => { setResult(null); void open(); }}
          onClose={() => setResult(null)}
        />
      ) : null}
      {detail ? <ItemSheet item={detail} game={game} onClose={() => setDetail(null)} /> : null}
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

// ---------- 图鉴 ----------

function Book({ game, onPick }: { game: GameState; onPick: (i: Item) => void }) {
  const c = useColors();
  const section = (kind: 'cat' | 'hat', title: string) => {
    const list = ITEMS.filter((i) => i.kind === kind);
    const owned = list.filter((i) => game.owned[i.id]).length;
    return (
      <View style={{ gap: 8 }}>
        <SectionLabel>{`${title} ${owned} / ${list.length}`}</SectionLabel>
        <View style={styles.grid}>
          {list.map((i) => {
            const has = !!game.owned[i.id];
            const on = game.equipped.cat === i.id || game.equipped.hat === i.id;
            return (
              <Pressable key={i.id} onPress={() => onPick(i)} style={[styles.tile, { backgroundColor: c.surface, borderColor: on ? c.accent : c.line }]}>
                <View style={[styles.rarityDot, { backgroundColor: RARITY[i.rarity].color }]} />
                <PixelCat cat={kind === 'cat' ? i.id : null} hat={kind === 'hat' ? i.id : null} size={52} silhouette={!has} ghostColor={c.line} />
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
      {section('cat', '猫')}
      {section('hat', '装扮')}
      <Text style={{ color: c.muted, fontSize: 12, lineHeight: 18 }}>点开看日语名字和例句。没收集到的可以用毛玉换：普通 {RARITY.common.cost}、稀有 {RARITY.rare.cost}、史诗 {RARITY.epic.cost}、传说 {RARITY.legendary.cost}。</Text>
    </View>
  );
}

function ItemBody({ item, size = 120, cat }: { item: Item; size?: number; cat?: string }) {
  const c = useColors();
  const r = RARITY[item.rarity];
  return (
    <View style={{ alignItems: 'center', gap: 10 }}>
      <PixelCat cat={item.kind === 'cat' ? item.id : cat} hat={item.kind === 'hat' ? item.id : null} size={size} />
      <View style={[styles.rarity, { backgroundColor: r.color }]}><Text style={{ color: '#fff', fontSize: 12, fontWeight: '800' }}>{r.label} · {r.ja}</Text></View>
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
  const on = game.equipped.cat === item.id || game.equipped.hat === item.id;
  const cost = RARITY[item.rarity].cost;
  const act = async (fn: () => Promise<unknown>) => {
    try { await fn(); } catch (e) { Alert.alert('不行', e instanceof Error ? e.message : String(e)); }
  };
  return (
    <Modal transparent animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.sheet, { backgroundColor: c.surface, paddingBottom: insets.bottom + 16 }]}>
        <Pressable onPress={onClose} hitSlop={10} style={{ alignSelf: 'flex-end' }}><X size={22} color={c.muted} /></Pressable>
        {has ? <ItemBody item={item} cat={game.equipped.cat} /> : (
          <View style={{ alignItems: 'center', gap: 10 }}>
            <PixelCat cat={item.kind === 'cat' ? item.id : null} hat={item.kind === 'hat' ? item.id : null} size={120} silhouette ghostColor={c.line} />
            <Tag label={RARITY[item.rarity].label} />
            <Text style={{ color: c.muted, fontSize: 15 }}>还没有收集到</Text>
          </View>
        )}
        {has ? (
          <Text style={{ color: c.muted, fontSize: 12, textAlign: 'center' }}>拥有 {game.owned[item.id]} 个</Text>
        ) : null}
        {has ? (
          item.kind === 'cat'
            ? <Button label={on ? '正在陪你学习' : '让它陪我学习'} disabled={on} onPress={() => act(() => equip(item.id, 'cat'))} />
            : <Button label={on ? '取下' : '戴上'} kind={on ? 'secondary' : 'primary'} onPress={() => act(() => equip(on ? null : item.id, 'hat'))} />
        ) : (
          <Button
            label={`用 ${cost} 毛玉换（现有 ${game.shards}）`}
            disabled={game.shards < cost}
            onPress={() => act(() => exchange(item.id))}
          />
        )}
      </View>
    </Modal>
  );
}

// ---------- 开箱 ----------

function RevealModal({ result, game, canAgain, onAgain, onClose }: {
  result: DrawResult; game: GameState; canAgain: boolean; onAgain: () => void; onClose: () => void;
}) {
  const c = useColors();
  const [shown, setShown] = useState(false);
  const shake = useRef(new Animated.Value(0)).current;
  const pop = useRef(new Animated.Value(0)).current;
  const r = RARITY[result.item.rarity];
  const rare = result.item.rarity !== 'common';

  useEffect(() => {
    // 宝箱晃几下再打开；稀有以上多晃一会儿
    const n = rare ? 5 : 3;
    Animated.sequence([
      ...Array.from({ length: n }, () => Animated.sequence([
        Animated.timing(shake, { toValue: 1, duration: 70, useNativeDriver: true }),
        Animated.timing(shake, { toValue: -1, duration: 70, useNativeDriver: true }),
      ])),
      Animated.timing(shake, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start(() => {
      setShown(true);
      Animated.timing(pop, { toValue: 1, duration: 320, easing: Easing.out(Easing.back(1.6)), useNativeDriver: true }).start();
    });
  }, [rare, shake, pop]);

  const equipped = game.equipped.cat === result.item.id || game.equipped.hat === result.item.id;
  return (
    <Modal transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.revealBg}>
        {!shown ? (
          <Animated.View style={{ transform: [{ rotate: shake.interpolate({ inputRange: [-1, 1], outputRange: ['-8deg', '8deg'] }) }] }}>
            <View style={[styles.chest, { borderColor: rare ? r.color : '#7A5230' }]}>
              <Gift size={64} color={rare ? r.color : '#F2C94C'} />
            </View>
          </Animated.View>
        ) : (
          <Animated.View style={[styles.revealCard, { backgroundColor: c.surface, borderColor: r.color, transform: [{ scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }], opacity: pop }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'center' }}>
              <Sparkles size={16} color={r.color} />
              <Text style={{ color: r.color, fontWeight: '800' }}>{result.isNew ? '新收藏！' : '重复了'}</Text>
            </View>
            <ItemBody item={result.item} size={128} cat={game.equipped.cat} />
            {!result.isNew ? <Text style={{ color: c.muted, textAlign: 'center', fontSize: 13 }}>换成毛玉 🧶 +{result.shards}</Text> : null}
            <View style={{ gap: 8 }}>
              {result.isNew && !equipped ? (
                <Button
                  label={result.item.kind === 'cat' ? '让它陪我学习' : '戴上'}
                  onPress={() => { void equip(result.item.id, result.item.kind); onClose(); }}
                />
              ) : null}
              <View style={{ flexDirection: 'row', gap: 8 }}>
                <Button label="好" kind="secondary" onPress={onClose} style={{ flex: 1 }} />
                {canAgain ? <Button label="再开一个" kind="secondary" onPress={onAgain} style={{ flex: 1 }} /> : null}
              </View>
            </View>
          </Animated.View>
        )}
      </View>
    </Modal>
  );
}

// ---------- 今天 / 规则 ----------

function Today({ game }: { game: GameState }) {
  const c = useColors();
  const days = [{ date: game.today.date, seconds: game.today.seconds, points: game.today.points }, ...game.history].slice(0, 14).reverse();
  const max = Math.max(60, ...days.map((d) => d.seconds));
  const counts = Object.entries(game.today.counts).filter(([k, v]) => v && k !== 'firstOfDay') as Array<[Action, number]>;
  return (
    <Card style={{ gap: 12 }}>
      <View style={{ flexDirection: 'row', gap: 10 }}>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>今天有效学习</Text>
          <Text style={{ color: c.ink, fontSize: 24, fontWeight: '800' }}>{Math.floor(game.today.seconds / 60)} 分钟</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: c.muted, fontSize: 12 }}>今天得到</Text>
          <Text style={{ color: c.ink, fontSize: 24, fontWeight: '800' }}>{coins(game.today.points)} 小判</Text>
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
        开箱概率：普通 {RARITY.common.weight}%、稀有 {RARITY.rare.weight}%、史诗 {RARITY.epic.weight}%、传说 {RARITY.legendary.weight}%。连续 10 次没出稀有，下一次必出；50 次必出史诗以上。重复的会变成毛玉。
      </Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, height: 56 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  content: { padding: 16, gap: 14 },
  room: { height: 250, borderRadius: radius.lg, borderWidth: 1, overflow: 'hidden', justifyContent: 'center' },
  wall: { position: 'absolute', left: 0, right: 0, top: 0, bottom: '38%' },
  floor: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '38%' },
  tatamiLine: { position: 'absolute', top: 0, bottom: 0, width: 2 },
  roomName: { position: 'absolute', left: 14, bottom: 10, flexDirection: 'row', alignItems: 'flex-end', gap: 6 },
  statRow: { flexDirection: 'row', gap: 10 },
  stat: { flex: 1, alignItems: 'center', gap: 2, paddingVertical: 10, borderRadius: radius.md, borderWidth: 1 },
  bar: { height: 8, borderRadius: 4, overflow: 'hidden' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tile: { width: '23%', flexGrow: 1, maxWidth: '24%', alignItems: 'center', paddingVertical: 8, paddingHorizontal: 4, borderRadius: radius.md, borderWidth: 1.5, gap: 2 },
  rarityDot: { position: 'absolute', top: 6, right: 6, width: 7, height: 7, borderRadius: 4 },
  rarity: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 999 },
  line: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: radius.md, alignSelf: 'stretch', alignItems: 'center' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 18, gap: 14 },
  revealBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  chest: { width: 140, height: 140, borderRadius: 24, borderWidth: 4, backgroundColor: '#5B3A20', alignItems: 'center', justifyContent: 'center' },
  revealCard: { alignSelf: 'stretch', borderRadius: 22, borderWidth: 3, padding: 20, gap: 14 },
  chart: { flexDirection: 'row', height: 56, alignItems: 'flex-end' },
});
