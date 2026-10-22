// 与 PC 端学习包格式对应（pc/src/nihongo_pc/package.py）

export type FuriganaSegment = { text: string; reading?: string | null };

// 日语学习包的 token 有 base / reading / pos / furigana；英语学习包（测试版）只有 surface，
// 单词带 word: true，空格和标点也是 token（按顺序拼回原句）
export type Token = {
  surface: string;
  base?: string;
  norm?: string;
  reading?: string | null;
  pos?: string;
  furigana?: FuriganaSegment[];
  word?: boolean;
  dict?: number; // 词条 id：JMdict，英语是 ECDICT（加了 5000 万的偏移）
};

export type Sentence = {
  id: number;
  start: number;
  end: number;
  text: string;
  tokens: Token[];
  zh?: string;
  original?: string;
};

export type DictSense = { pos: string[]; tags: string[]; en: string[]; zh: string | null };

export type DictEntry = {
  id: number;
  kanji: string[];
  readings: string[];
  common: boolean;
  senses: DictSense[];
  phonetic?: string; // 英语词条的音标
};

export type PackageMeta = {
  id: string;
  title: string;
  source_url: string;
  media: string;
  media_type: 'video' | 'audio';
  duration: number;
  sentence_count: number;
  subtitle_source: 'whisper' | 'manual';
  refined_by?: string | null;
  has_dictionary?: boolean;
  created_at: string;
  size_mb?: number;
  has_thumb?: boolean;
  lang?: 'ja' | 'en'; // 没有就是日语；en 是英语模式（测试版）
};

export type PackageData = {
  meta: PackageMeta;
  sentences: Sentence[];
  dictionary: Record<string, DictEntry>;
};
