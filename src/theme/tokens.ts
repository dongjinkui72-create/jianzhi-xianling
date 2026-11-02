import { Platform } from 'react-native';

/**
 * 水晶玻璃主题（Crystal Glass）。
 * 产品红线：界面默认配色为「水晶白」，且不可更改。
 * 因此这里导出的是常量，App 内不提供任何换肤入口。
 */
export const palette = {
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
} as const;

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

/** 底部导航基准高度（不含安全区）—— 按迭代要求「底部 UI 变高一点」。 */
export const TAB_BAR_BASE_HEIGHT = 74;

/**
 * 圆形启动按钮直径。
 * 迭代要求：「FAB 启动按钮面积变大为原来的两倍」。
 * 标准 FAB 直径 56，面积翻倍 => 56 * √2 ≈ 79.2，取 80。
 */
export const FAB_BASE_SIZE = 80;

export const shadow = {
  card: Platform.select({
    ios: { shadowColor: '#4A6C9B', shadowOpacity: 0.16, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
    default: { elevation: 5, shadowColor: '#4A6C9B', shadowOpacity: 0.14, shadowRadius: 14, shadowOffset: { width: 0, height: 6 } },
  }),
  fab: Platform.select({
    ios: { shadowColor: '#2E7BFF', shadowOpacity: 0.42, shadowRadius: 22, shadowOffset: { width: 0, height: 10 } },
    default: { elevation: 12, shadowColor: '#2E7BFF', shadowOpacity: 0.36, shadowRadius: 18, shadowOffset: { width: 0, height: 8 } },
  }),
  soft: Platform.select({
    ios: { shadowColor: '#4A6C9B', shadowOpacity: 0.09, shadowRadius: 10, shadowOffset: { width: 0, height: 4 } },
    default: { elevation: 2, shadowColor: '#4A6C9B', shadowOpacity: 0.08, shadowRadius: 8, shadowOffset: { width: 0, height: 3 } },
  }),
} as const;

export const font = {
  regular: Platform.select({ ios: 'System', android: 'sans-serif' }) as string,
  medium: Platform.select({ ios: 'System', android: 'sans-serif-medium' }) as string,
};