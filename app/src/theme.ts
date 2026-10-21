// 配色与 PC 端网页一致：和纸 + 墨 + 朱
import { useColorScheme } from 'react-native';

const light = {
  bg: '#F5F1E8',
  surface: '#FFFDF8',
  surface2: '#F0EBE0',
  ink: '#26221D',
  ink2: '#5B544B',
  muted: '#8C8478',
  line: '#E3DCCD',
  accent: '#C8553D',
  accentInk: '#FFFFFF',
  accentSoft: '#F6E3DC',
  ok: '#4F7A5A',
  okSoft: '#E1EDE3',
  warn: '#B7791F',
  warnSoft: '#F7EBD6',
  err: '#B3402F',
  errSoft: '#F7E0DC',
  ruby: '#A0583F',
};

const dark: typeof light = {
  bg: '#161412',
  surface: '#1F1C19',
  surface2: '#29251F',
  ink: '#EDE7DD',
  ink2: '#C4BCB0',
  muted: '#8F877B',
  line: '#353029',
  accent: '#E07A5F',
  accentInk: '#1A1512',
  accentSoft: '#3A2621',
  ok: '#8FBF98',
  okSoft: '#22302A',
  warn: '#E0B160',
  warnSoft: '#3A2F1C',
  err: '#F0897A',
  errSoft: '#3B2320',
  ruby: '#E3A487',
};

export type Colors = typeof light;

export function useColors(): Colors {
  return useColorScheme() === 'dark' ? dark : light;
}

export const radius = { sm: 8, md: 12, lg: 16 };

// 不用 'serif'：有的安卓系统自带的衬线中文字体缺字（实测小米上「貞」显示不出来），
// 系统默认无衬线字体对日文汉字覆盖最全
export const fonts = { jaSerif: undefined as string | undefined };
