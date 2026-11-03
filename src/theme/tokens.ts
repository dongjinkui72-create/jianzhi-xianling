import { Platform } from 'react-native';

/**
 * 主题体系（2.0.6 起）：
 *  - crystal：水晶白玻璃（默认，iPhone 控制中心那种通透玻璃质感）
 *  - dark   ：黑夜玻璃（深色半透玻璃 + 亮色文字）
 * 切换入口在「设置 → 外观」，选择会持久化到本机设置表。
 * palette 是可变对象：applyTheme 就地替换色值，组件在下次渲染读到新值。
 */

export type ThemeName = 'crystal' | 'dark';

type Palette = Record<string, string>;

const CRYSTAL: Palette = {
  bgTop: '#F8FBFF',
  bgBottom: '#E7EEF8',
  bgDeep: '#DCE6F4',
  ink: '#0D1B2A',
  inkSoft: '#4C5F77',
  inkFaint: '#8698AE',
  glass: 'rgba(255,255,255,0.62)',
  glassStrong: 'rgba(255,255,255,0.84)',
  glassSoft: 'rgba(255,255,255,0.38)',
  edge: 'rgba(255,255,255,0.96)',
  hairline: 'rgba(122,144,178,0.22)',
  hairlineSoft: 'rgba(122,144,178,0.12)',
  accent: '#2E7BFF',
  accentDeep: '#1E5FE0',
  accentSoft: 'rgba(46,123,255,0.12)',
  ok: '#0FA968',
  okSoft: 'rgba(15,169,104,0.14)',
  warn: '#E8890C',
  warnSoft: 'rgba(232,137,12,0.15)',
  danger: '#E5484D',
  dangerSoft: 'rgba(229,72,77,0.13)',
  disabledFill: 'rgba(146,160,180,0.22)',
  disabledInk: '#9AA9BC',
  glow: 'rgba(255,255,255,0.55)',
  barTop: 'rgba(255,255,255,0.96)',
  barBottom: 'rgba(255,255,255,0.80)',
  sheetBg: 'rgba(250,252,255,0.98)',
  inputBg: 'rgba(255,255,255,0.78)',
  chipBg: 'rgba(255,255,255,0.85)',
  blurTint: 'light',
};

const DARK: Palette = {
  bgTop: '#0B1220',
  bgBottom: '#0D1524',
  bgDeep: '#060A12',
  ink: '#EAF2FF',
  inkSoft: '#A9B8CE',
  inkFaint: '#6E7F96',
  glass: 'rgba(24,32,50,0.60)',
  glassStrong: 'rgba(16,22,36,0.86)',
  glassSoft: 'rgba(24,32,50,0.36)',
  edge: 'rgba(255,255,255,0.14)',
  hairline: 'rgba(148,170,200,0.24)',
  hairlineSoft: 'rgba(148,170,200,0.12)',
  accent: '#4D9AFF',
  accentDeep: '#2E7BFF',
  accentSoft: 'rgba(77,154,255,0.18)',
  ok: '#34D399',
  okSoft: 'rgba(52,211,153,0.16)',
  warn: '#FBBF24',
  warnSoft: 'rgba(251,191,36,0.16)',
  danger: '#F87171',
  dangerSoft: 'rgba(248,113,113,0.16)',
  disabledFill: 'rgba(120,135,160,0.22)',
  disabledInk: '#64748B',
  glow: 'rgba(77,154,255,0.10)',
  barTop: 'rgba(18,24,38,0.92)',
  barBottom: 'rgba(12,17,28,0.86)',
  sheetBg: 'rgba(15,20,32,0.98)',
  inputBg: 'rgba(255,255,255,0.07)',
  chipBg: 'rgba(255,255,255,0.09)',
  blurTint: 'dark',
};

export const THEME_PALETTES: Record<ThemeName, Palette> = { crystal: CRYSTAL, dark: DARK };

export const palette: Palette = { ...CRYSTAL };

let activeTheme: ThemeName = 'crystal';

export function currentThemeName(): ThemeName {
  return activeTheme;
}

export function applyTheme(name: ThemeName) {
  activeTheme = THEME_PALETTES[name] ? name : 'crystal';
  Object.assign(palette, THEME_PALETTES[activeTheme]);
}

/** 玻璃渐变三色：按当前主题取 */
export function glassTones(): [string, string, string] {
  if (activeTheme === 'dark') {
    return ['rgba(34,44,66,0.88)', 'rgba(18,26,42,0.62)', 'rgba(26,34,54,0.80)'];
  }
  return ['rgba(255,255,255,0.90)', 'rgba(255,255,255,0.62)', 'rgba(255,255,255,0.80)'];
}

export function glassTonesSoft(): [string, string, string] {
  if (activeTheme === 'dark') {
    return ['rgba(30,38,58,0.70)', 'rgba(16,22,36,0.46)', 'rgba(22,30,46,0.60)'];
  }
  return ['rgba(255,255,255,0.62)', 'rgba(255,255,255,0.40)', 'rgba(255,255,255,0.55)'];
}

export function glassTonesStrong(): [string, string, string] {
  if (activeTheme === 'dark') {
    return ['rgba(40,50,74,0.96)', 'rgba(22,30,46,0.88)', 'rgba(30,38,58,0.94)'];
  }
  return ['rgba(255,255,255,0.98)', 'rgba(255,255,255,0.86)', 'rgba(255,255,255,0.94)'];
}

export const radius = {
  xs: 10,
  sm: 14,
  md: 20,
  lg: 26,
  xl: 32,
  pill: 999,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 22,
  xxl: 30,
} as const;

/** 底部导航基准高度（不含安全区） */
export const TAB_BAR_BASE_HEIGHT = 74;

/** 悬浮启动按钮直径 */
export const FAB_BASE_SIZE = 54;

export const shadow = {
  card: Platform.select({
    ios: { shadowColor: '#0A1424', shadowOpacity: 0.18, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    default: { elevation: 5, shadowColor: '#0A1424', shadowOpacity: 0.16, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  }),
  fab: Platform.select({
    ios: { shadowColor: '#2E7BFF', shadowOpacity: 0.42, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
    default: { elevation: 12, shadowColor: '#2E7BFF', shadowOpacity: 0.36, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  }),
  soft: Platform.select({
    ios: { shadowColor: '#0A1424', shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    default: { elevation: 2, shadowColor: '#0A1424', shadowOpacity: 0.09, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  }),
} as const;

export const font = {
  regular: Platform.select({ ios: 'System', android: 'sans-serif' }) as string,
  medium: Platform.select({ ios: 'System', android: 'sans-serif-medium' }) as string,
};