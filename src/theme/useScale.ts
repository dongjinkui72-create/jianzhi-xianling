import { useCallback } from 'react';
import { PixelRatio, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FAB_BASE_SIZE, TAB_BAR_BASE_HEIGHT } from './tokens';

/**
 * 大小屏适配。
 * 以 iPhone 14 的逻辑宽度 390 为基准做等比缩放，并夹在 [0.86, 1.30]，
 * 这样小屏手机（320~360）不会被挤爆，大屏 / 折叠屏（430+）也不会显得空。
 * 字号另外乘上系统字体缩放，但同样做上下限，避免用户开超大字体后布局塌陷。
 */
const BASE_WIDTH = 390;

export type Scale = ReturnType<typeof useScale>;

export function useScale() {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const raw = width / BASE_WIDTH;
  const scale = Math.min(Math.max(raw, 0.86), 1.3);

  const sysFont = PixelRatio.getFontScale() || 1;
  const fontScale = Math.min(Math.max(sysFont, 0.9), 1.3);

  /** 尺寸缩放（间距、圆角、图标） */
  const s = useCallback((n: number) => Math.round(n * scale * 10) / 10, [scale]);
  /** 字号缩放 */
  const fs = useCallback((n: number) => Math.round(n * scale * fontScale * 10) / 10, [scale, fontScale]);

  const isTiny = width < 340;
  const isSmall = width < 372;
  const isLarge = width >= 420;
  const isWide = width >= 600;
  const isShort = height < 680;

  const tabHeight = Math.round(TAB_BAR_BASE_HEIGHT * Math.min(Math.max(scale, 0.9), 1.18)) + insets.bottom;
  const fabSize = Math.round(FAB_BASE_SIZE * Math.min(Math.max(scale, 0.88), 1.2));

  return {
    width,
    height,
    insets,
    scale,
    fontScale,
    s,
    fs,
    isTiny,
    isSmall,
    isLarge,
    isWide,
    isShort,
    tabHeight,
    fabSize,
    /** 内容区左右留白 */
    gutter: s(isTiny ? 12 : isSmall ? 14 : isLarge ? 20 : 16),
    /** 卡片内边距 */
    pad: s(isTiny ? 12 : isSmall ? 13 : 16),
  };
}