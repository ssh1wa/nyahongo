// 与 PC 端学习包格式对应（pc/src/nihongo_pc/package.py）

export type FuriganaSegment = { text: string; reading?: string | null };

export type Token = {
  surface: string;
  base: string;
  norm?: string;
  reading: string | null;
  pos: string;
  furigana: FuriganaSegment[];
  dict?: number; // JMdict 词条 id
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
};

export type PackageData = {
  meta: PackageMeta;
  sentences: Sentence[];
  dictionary: Record<string, DictEntry>;
};
