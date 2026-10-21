// 收藏品图鉴：每件都有日语名、读音、中文和一句简单的日语介绍，图鉴本身就是一本小词汇书。
// 美术现在是占位的像素图（components/PixelCat 按颜色和花纹画出来），以后换成正式素材时只改 sprite 字段。
// line 里的「漢字(かな)」会被解析成注音。

export type Rarity = 'common' | 'rare' | 'epic' | 'legendary';
export type ItemKind = 'cat' | 'hat';

/** 猫的花纹：占位图按这个给毛色分区上色 */
export type CatPattern = 'plain' | 'stripes' | 'calico' | 'hachiware' | 'socks' | 'points' | 'tortie' | 'chashiro' | 'maneki' | 'nekomata';
/** 装扮的形状：占位图按这个在猫头上画 */
export type HatShape = 'band' | 'bow' | 'straw' | 'glasses' | 'collar' | 'beret' | 'mask' | 'flower' | 'horns' | 'cap' | 'crown' | 'wreath' | 'halo' | 'ears';

export type CatLook = { pattern: CatPattern; fur: string; belly: string; patch: string; patch2?: string; eye?: string };
export type HatLook = { shape: HatShape; main: string; accent: string };

type Base = { id: string; rarity: Rarity; ja: string; kana: string; zh: string; line: string };
export type CatItem = Base & { kind: 'cat'; look: CatLook };
export type HatItem = Base & { kind: 'hat'; look: HatLook };
export type Item = CatItem | HatItem;

export const RARITY: Record<Rarity, { label: string; ja: string; color: string; weight: number; shards: number; cost: number }> = {
  common: { label: '普通', ja: 'ふつう', color: '#8C8478', weight: 70, shards: 5, cost: 40 },
  rare: { label: '稀有', ja: 'レア', color: '#3F7DB8', weight: 24, shards: 15, cost: 120 },
  epic: { label: '史诗', ja: 'とくべつ', color: '#9A55C8', weight: 5, shards: 40, cost: 400 },
  legendary: { label: '传说', ja: 'でんせつ', color: '#D29A1E', weight: 1, shards: 100, cost: 1000 },
};

export const RARITY_ORDER: Rarity[] = ['common', 'rare', 'epic', 'legendary'];

const cat = (id: string, rarity: Rarity, ja: string, kana: string, zh: string, line: string, look: CatLook): CatItem =>
  ({ id, kind: 'cat', rarity, ja, kana, zh, line, look });
const hat = (id: string, rarity: Rarity, ja: string, kana: string, zh: string, line: string, look: HatLook): HatItem =>
  ({ id, kind: 'hat', rarity, ja, kana, zh, line, look });

export const ITEMS: Item[] = [
  // ---------- 猫 ----------
  cat('shiro', 'common', '白猫', 'しろねこ', '白猫', '雪(ゆき)のように白(しろ)い猫(ねこ)です。', { pattern: 'plain', fur: '#F4EFE6', belly: '#FFFFFF', patch: '#F4EFE6' }),
  cat('kuro', 'common', '黒猫', 'くろねこ', '黑猫', '夜(よる)が大好(だいす)きな黒(くろ)い猫(ねこ)です。', { pattern: 'plain', fur: '#3A3634', belly: '#4A4542', patch: '#3A3634', eye: '#E8C547' }),
  cat('chatora', 'common', '茶トラ', 'ちゃとら', '橘色虎斑猫', 'よく食(た)べて、よく寝(ね)ます。', { pattern: 'stripes', fur: '#E9A55B', belly: '#F7DDB8', patch: '#C9772E' }),
  cat('kijitora', 'common', 'キジトラ', 'きじとら', '狸花猫', '日本(にほん)でいちばん多(おお)い柄(がら)です。', { pattern: 'stripes', fur: '#9C8466', belly: '#D9C8AE', patch: '#5E4D3A' }),
  cat('sabatora', 'common', 'サバトラ', 'さばとら', '银虎斑猫', '魚(さかな)のサバに似(に)た色(いろ)です。', { pattern: 'stripes', fur: '#A9AEB2', belly: '#E4E6E8', patch: '#5F666C' }),
  cat('hachiware', 'common', 'ハチワレ', 'はちわれ', '八字脸猫', '顔(かお)の柄(がら)が「八(はち)」の字(じ)です。', { pattern: 'hachiware', fur: '#3F3B39', belly: '#FFFFFF', patch: '#3F3B39' }),
  cat('mike', 'rare', '三毛猫', 'みけねこ', '三花猫', '三(みっ)つの色(いろ)がある猫(ねこ)です。', { pattern: 'calico', fur: '#FBF6EE', belly: '#FFFFFF', patch: '#E39A4C', patch2: '#3D3836' }),
  cat('kutsushita', 'rare', '靴下猫', 'くつしたねこ', '白手套猫', '足(あし)だけ白(しろ)い靴下(くつした)をはいています。', { pattern: 'socks', fur: '#55504C', belly: '#FFFFFF', patch: '#FFFFFF' }),
  cat('shamu', 'rare', 'シャム猫', 'しゃむねこ', '暹罗猫', '青(あお)い目(め)がきれいです。', { pattern: 'points', fur: '#F1E4CC', belly: '#F8F0E0', patch: '#5B4335', eye: '#4A8FD6' }),
  cat('sabi', 'rare', '錆猫', 'さびねこ', '玳瑁猫', '黒(くろ)と茶色(ちゃいろ)がまざっています。', { pattern: 'tortie', fur: '#3B302B', belly: '#5A4334', patch: '#B8692F', patch2: '#7A4A27' }),
  cat('chashiro', 'rare', '茶白', 'ちゃしろ', '橘白猫', 'おなかがまっ白(しろ)でふわふわです。', { pattern: 'chashiro', fur: '#E39A4C', belly: '#FFFFFF', patch: '#FFFFFF' }),
  cat('maneki', 'epic', '招き猫', 'まねきねこ', '招财猫', '手(て)をあげて、お客(きゃく)さんを呼(よ)びます。', { pattern: 'maneki', fur: '#FFFFFF', belly: '#FFFFFF', patch: '#E39A4C', patch2: '#C8352B' }),
  cat('sakura', 'epic', '桜猫', 'さくらねこ', '樱花猫', '春(はる)になると、毛(け)が桜色(さくらいろ)になります。', { pattern: 'plain', fur: '#F6C4D2', belly: '#FDE8EE', patch: '#F6C4D2' }),
  cat('yukimi', 'epic', '雪見猫', 'ゆきみねこ', '赏雪猫', '窓(まど)から雪(ゆき)を見(み)るのが好(す)きです。', { pattern: 'points', fur: '#E7F0F8', belly: '#FFFFFF', patch: '#8FB3D9', eye: '#5DA2E0' }),
  cat('kinmaneki', 'legendary', '金の招き猫', 'きんのまねきねこ', '金招财猫', 'ぴかぴか光(ひか)る、幸運(こううん)の猫(ねこ)です。', { pattern: 'maneki', fur: '#F2C94C', belly: '#FBE6A0', patch: '#D29A1E', patch2: '#C8352B' }),
  cat('nekomata', 'legendary', '猫又', 'ねこまた', '猫又', '長(なが)く生(い)きた猫(ねこ)は、しっぽが二本(にほん)になるそうです。', { pattern: 'nekomata', fur: '#7B6AA6', belly: '#B9AEDA', patch: '#4E4078', eye: '#F3D35C' }),

  // ---------- 装扮 ----------
  hat('hachimaki', 'common', '鉢巻', 'はちまき', '头巾', 'がんばる時(とき)に頭(あたま)にまきます。', { shape: 'band', main: '#FFFFFF', accent: '#D8443A' }),
  hat('ribon', 'common', 'リボン', 'りぼん', '蝴蝶结', 'かわいい赤(あか)いリボンです。', { shape: 'bow', main: '#D8443A', accent: '#A82D25' }),
  hat('mugiwara', 'common', '麦わら帽子', 'むぎわらぼうし', '草帽', '夏(なつ)の日(ひ)にかぶります。', { shape: 'straw', main: '#E9C46A', accent: '#C8352B' }),
  hat('megane', 'common', '眼鏡', 'めがね', '眼镜', '本(ほん)を読(よ)む時(とき)にかけます。', { shape: 'glasses', main: '#3A3634', accent: '#9ED0F0' }),
  hat('suzu', 'common', '鈴', 'すず', '铃铛', '歩(ある)くと、ちりんと鳴(な)ります。', { shape: 'collar', main: '#D8443A', accent: '#F2C94C' }),
  hat('bere', 'common', 'ベレー帽', 'べれーぼう', '贝雷帽', '絵(え)をかく人(ひと)がよくかぶります。', { shape: 'beret', main: '#6B8E5A', accent: '#4E6B40' }),
  hat('kitsunemen', 'rare', '狐の面', 'きつねのめん', '狐狸面具', 'お祭(まつ)りで買(か)ったお面(めん)です。', { shape: 'mask', main: '#FFFFFF', accent: '#D8443A' }),
  hat('kamikazari', 'rare', '桜の髪飾り', 'さくらのかみかざり', '樱花发饰', '春(はる)らしい髪飾(かみかざ)りです。', { shape: 'flower', main: '#F4A6BD', accent: '#F2C94C' }),
  hat('oninotsuno', 'rare', '鬼の角', 'おにのつの', '鬼角', '節分(せつぶん)の日(ひ)は、鬼(おに)になります。', { shape: 'horns', main: '#D8443A', accent: '#F2C94C' }),
  hat('tenugui', 'rare', '手ぬぐい', 'てぬぐい', '手巾', '昔(むかし)から使(つか)われている布(ぬの)です。', { shape: 'band', main: '#3F6FA8', accent: '#FFFFFF' }),
  hat('gakubou', 'rare', '学帽', 'がくぼう', '学生帽', 'まじめな学生(がくせい)の帽子(ぼうし)です。', { shape: 'cap', main: '#2F2D3A', accent: '#F2C94C' }),
  hat('oukan', 'epic', '王冠', 'おうかん', '王冠', '王様(おうさま)がかぶる冠(かんむり)です。', { shape: 'crown', main: '#F2C94C', accent: '#D8443A' }),
  hat('hanakanmuri', 'epic', '花冠', 'はなかんむり', '花冠', '野原(のはら)の花(はな)で作(つく)りました。', { shape: 'wreath', main: '#7FB069', accent: '#F4A6BD' }),
  hat('tenshinowa', 'epic', '天使の輪', 'てんしのわ', '天使光环', '頭(あたま)の上(うえ)で光(ひか)っています。', { shape: 'halo', main: '#F7DC6F', accent: '#FFF6C8' }),
  hat('inari', 'legendary', '稲荷の狐耳', 'いなりのきつねみみ', '稻荷狐耳', '神社(じんじゃ)の狐(きつね)の力(ちから)をもらいました。', { shape: 'ears', main: '#F2C94C', accent: '#FFFFFF' }),
  hat('ryuunotsuno', 'legendary', '竜の角', 'りゅうのつの', '龙角', '空(そら)を飛(と)ぶ竜(りゅう)の角(つの)です。', { shape: 'horns', main: '#3FA796', accent: '#B8F0E0' }),
];

export const ITEM_BY_ID: Record<string, Item> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export const STARTER_CAT = 'shiro';

/** 「白(しろ)い猫(ねこ)」→ 注音分段 */
export function parseRubyLine(line: string): Array<{ text: string; reading?: string }> {
  const out: Array<{ text: string; reading?: string }> = [];
  const re = /([一-鿿々]+)\(([ぁ-ゟ゠-ヿ]+)\)/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push({ text: line.slice(last, m.index) });
    out.push({ text: m[1], reading: m[2] });
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out;
}
