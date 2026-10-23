// 阅读 →「发现」：不知道读什么的时候，按分类直接给几篇能读的日语读物（都是免费、不用登录就能读的来源）。
// - 简单日语：MATCHA やさしい日本語 的 RSS（写给日语学习者的旅游、生活文章，RSS 里就有全文）
// - 新闻：NHK 新闻 RSS 的标题和摘要（文章页要登录才能看全文，所以只读摘要）
// - 童话 / 名作：青空文库（公版作品，下面的地址都核对过标题和全文长度）
// - 日本文化 / 随便看看：日语维基百科
import type { ArticleSource } from './reading';
import { fetchHtml } from './reading';
import { wikipediaText } from './search';

export type DiscoverCategory = { id: string; label: string; note: string };

export const DISCOVER_CATEGORIES: DiscoverCategory[] = [
  { id: 'easy', label: '简单日语', note: 'MATCHA やさしい日本語：写给日语学习者的文章，介绍日本的旅游、生活和文化' },
  { id: 'news', label: '新闻', note: 'NHK 今天的新闻：标题加一两句摘要，适合每天读一点' },
  { id: 'mukashi', label: '童话・民间故事', note: '青空文库：桃太郎、ごん狐 这类日本人从小读的故事' },
  { id: 'meisaku', label: '名作短篇', note: '青空文库：芥川龙之介、宫泽贤治、太宰治的短篇，稍难一些' },
  { id: 'culture', label: '日本文化', note: '日语维基百科：和食、祭り、神社……条目的开头部分' },
  { id: 'random', label: '随便看看', note: '日语维基百科随机条目，碰碰运气' },
];

export type DiscoverItem = {
  key: string;
  title: string;
  sub: string; // 来源、作者、长度
  snippet: string;
  kind: 'matcha' | 'nhk' | 'aozora' | 'wiki';
  url: string;
  text?: string; // 列表里已经拿到全文的（MATCHA、NHK）
};

export type DiscoverText = { title: string; text: string; url: string; source: ArticleSource };

const PAGE = 6;

const shuffle = <T>(list: T[]): T[] => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

async function getText(url: string, timeoutMs = 20000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    throw new Error(e instanceof Error && e.name === 'AbortError' ? '网络超时，换一个分类试试' : `读取失败：${e instanceof Error ? e.message : String(e)}`);
  } finally {
    clearTimeout(timer);
  }
}

const decode = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&');

/** HTML 片段 → 纯文字：去掉注音（App 自己会标）、图片；段落换行；去掉日语词之间的空格（やさしい日本語的分かち書き） */
function plain(html: string): string {
  return decode(
    decode(html) // RSS 里的标题是转义过两次的
      .replace(/<rt[\s\S]*?<\/rt>|<rp[\s\S]*?<\/rp>/gi, '')
      .replace(/<(figure|script|style)[\s\S]*?<\/\1>/gi, '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|h\d|li|div)>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  )
    .replace(/\(※\d*\)/g, '') // 注释的标记
    .replace(/　/g, '') // 分かち書き用的全角空格（英文单词之间是半角空格，不动）
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
}

const cdata = (block: string, tag: string) =>
  block.match(new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${tag}>`))?.slice(1).find((x) => x !== undefined) ?? '';

// ---------- MATCHA やさしい日本語 ----------

let matchaCache: DiscoverItem[] | null = null;

async function matcha(): Promise<DiscoverItem[]> {
  if (!matchaCache) {
    const xml = await getText('https://matcha-jp.com/easy/feed', 30000);
    matchaCache = xml.split('<item>').slice(1).map((b, i) => {
      const text = plain(cdata(b, 'content:encoded'));
      return {
        key: `matcha-${i}`,
        title: plain(cdata(b, 'title')),
        sub: `MATCHA やさしい日本語 · 约 ${Math.round(text.length / 100) * 100} 字`,
        snippet: plain(cdata(b, 'description')).replace(/\([^)]*\)/g, ''),
        kind: 'matcha' as const,
        url: cdata(b, 'link').trim(),
        text,
      };
    }).filter((x) => x.title && x.text.length > 50);
  }
  return shuffle(matchaCache).slice(0, PAGE);
}

// ---------- NHK 新闻 ----------

const NHK_FEEDS = [
  ['0', '主要'], ['2', '暮らし'], ['3', '科学・文化'], ['7', 'スポーツ'], ['1', '社会'],
] as const;

async function nhk(): Promise<DiscoverItem[]> {
  const lists = await Promise.all(NHK_FEEDS.map(async ([cat, name]) => {
    try {
      const xml = await getText(`https://news.web.nhk/n-data/conf/na/rss/cat${cat}.xml`);
      return xml.split('<item>').slice(1, 15).map((b, i) => {
        const title = plain(cdata(b, 'title'));
        const desc = plain(cdata(b, 'description'));
        const date = cdata(b, 'pubDate').match(/\d+ \w+ \d{4} \d+:\d+/)?.[0] ?? '';
        return { key: `nhk-${cat}-${i}`, title, sub: `NHK 新闻 · ${name}${date ? ` · ${date}` : ''}`, snippet: desc, kind: 'nhk' as const, url: cdata(b, 'link').trim(), text: `${title}\n${desc}` };
      }).filter((x) => x.title && x.snippet);
    } catch {
      return [];
    }
  }));
  const all = lists.flat();
  if (!all.length) throw new Error('读取 NHK 新闻失败，检查一下网络');
  const seen = new Set<string>();
  return shuffle(all).filter((x) => !seen.has(x.title) && seen.add(x.title)).slice(0, PAGE);
}

// ---------- 青空文库（地址核对过：标题对得上，全文能读出来） ----------

type Work = [title: string, author: string, chars: number, path: string, line: string];
const AOZORA = 'https://www.aozora.gr.jp/cards/';
const MUKASHI: Work[] = [
  ['ごん狐', '新美南吉', 4900, '000121/files/628_14895.html', '小狐狸ごん和兵十的故事，日本小学课本里的名篇'],
  ['手袋を買いに', '新美南吉', 3500, '000121/files/637_13341.html', '小狐狸第一次去镇上买手套'],
  ['桃太郎', '楠山正雄', 5500, '000329/files/18376_12100.html', '从桃子里出生的桃太郎去打鬼'],
  ['浦島太郎', '楠山正雄', 5600, '000329/files/3390_33153.html', '救了乌龟、去了龙宫的浦岛太郎'],
  ['かちかち山', '楠山正雄', 4300, '000329/files/18377_11982.html', '兔子替老爷爷惩罚狸猫'],
  ['猿かに合戦', '楠山正雄', 3400, '000329/files/18334_11947.html', '螃蟹和猴子的故事'],
  ['野ばら', '小川未明', 2300, '001475/files/51034_47932.html', '两个国家的老兵和年轻士兵'],
  ['注文の多い料理店', '宮沢賢治', 5600, '000081/files/43754_17659.html', '两个绅士走进一家要求很多的餐厅'],
  ['よだかの星', '宮沢賢治', 5200, '000081/files/473_42318.html', '被大家讨厌的夜鹰飞向星空'],
  ['やまなし', '宮沢賢治', 2700, '000081/files/46605_31178.html', '小螃蟹兄弟眼里的溪底世界'],
];
const MEISAKU: Work[] = [
  ['蜘蛛の糸', '芥川龍之介', 2900, '000879/files/92_14545.html', '释迦从极乐垂下一根蜘蛛丝'],
  ['羅生門', '芥川龍之介', 5700, '000879/files/127_15260.html', '荒废的罗生门下，一个家仆的选择'],
  ['鼻', '芥川龍之介', 5800, '000879/files/42_15228.html', '为长鼻子苦恼的和尚'],
  ['杜子春', '芥川龍之介', 9200, '000879/files/170_15144.html', '想当仙人的年轻人杜子春'],
  ['走れメロス', '太宰治', 9900, '000035/files/1567_14913.html', '为了朋友拼命奔跑的梅洛斯'],
  ['檸檬', '梶井基次郎', 5000, '000074/files/424_19826.html', '一个柠檬带来的奇妙心情'],
  ['雨ニモマケズ', '宮沢賢治', 400, '000081/files/45630_23908.html', '「不畏风雨」，很短的一首诗'],
];

const aozoraItems = (works: Work[], cat: string): DiscoverItem[] => shuffle(works).slice(0, PAGE).map(([title, author, chars, path, line]) => ({
  key: `${cat}-${path}`, title, sub: `青空文库 · ${author} · 约 ${chars} 字`, snippet: line, kind: 'aozora', url: AOZORA + path,
}));

// ---------- 维基百科 ----------

const CULTURE = [
  '和食', '寿司', 'ラーメン', '抹茶', 'おにぎり', '弁当', '駄菓子', '花見', '七夕', '盆踊り', '正月', '紅葉狩り', '浴衣', '着物',
  '祭り', '神社', '寺院', '温泉', '銭湯', '富士山', '新幹線', '招き猫', '落語', '歌舞伎', '相撲', '将棋', '折り紙', '書道', '茶道',
  'こたつ', '鯉のぼり', '風鈴', '日本の漫画', '日本のアニメ', '桜', '富士山', '侍', '忍者', '盆栽',
];

const cultureItems = (): DiscoverItem[] => shuffle([...new Set(CULTURE)]).slice(0, PAGE).map((t) => ({
  key: `wiki-${t}`, title: t, sub: '日语维基百科 · 条目开头约 1500 字', snippet: `日本人怎么介绍「${t}」`, kind: 'wiki',
  url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(t)}`,
}));

async function randomWiki(): Promise<DiscoverItem[]> {
  // 一次请求拿几篇随机条目和摘要（一篇篇请求会被维基百科限流）
  const url = 'https://ja.wikipedia.org/w/api.php?action=query&format=json&generator=random&grnnamespace=0&grnlimit=12'
    + '&prop=extracts&exintro=1&explaintext=1&exchars=160';
  const data = JSON.parse(await getText(url));
  const ok = Object.values<any>(data?.query?.pages ?? {})
    .map((p) => ({ title: String(p?.title ?? ''), extract: String(p?.extract ?? '') }))
    .filter((p) => p.title && p.extract.length > 40);
  if (!ok.length) throw new Error('读取维基百科失败，检查一下网络');
  return ok.slice(0, PAGE).map((p) => ({
    key: `rand-${p.title}`, title: p.title, sub: '日语维基百科 · 随机条目', snippet: p.extract, kind: 'wiki',
    url: `https://ja.wikipedia.org/wiki/${encodeURIComponent(p.title)}`,
  }));
}

/** 一个分类换一批读物 */
export async function discover(category: string): Promise<DiscoverItem[]> {
  switch (category) {
    case 'easy': return matcha();
    case 'news': return nhk();
    case 'mukashi': return aozoraItems(MUKASHI, 'mukashi');
    case 'meisaku': return aozoraItems(MEISAKU, 'meisaku');
    case 'culture': return cultureItems();
    default: return randomWiki();
  }
}

/** 打开一篇：取全文（青空文库下载网页、维基百科取条目开头） */
export async function loadDiscover(item: DiscoverItem): Promise<DiscoverText> {
  if (item.text) return { title: item.title, text: item.text, url: item.url, source: 'url' };
  if (item.kind === 'aozora') {
    const page = await fetchHtml(item.url);
    return { title: item.title, text: page.text, url: item.url, source: 'url' };
  }
  const text = await wikipediaText(item.title, 1500);
  if (!text.trim()) throw new Error('这个条目没有读到正文，换一篇试试');
  return { title: item.title, text, url: item.url, source: 'wiki' };
}
