import React from 'react';
import { Pressable, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { palette, radius, shadow } from '../theme/tokens';
import { useScale } from '../theme/useScale';

/**
 * 水晶玻璃卡片。
 * 结构：柔和投影 -> 半透明白渐变玻璃体 -> 顶部高光 -> 发丝描边。
 * 配色固定为水晶白，产品红线：不提供换肤。
 */
export interface GlassProps {
  children?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
  onLongPress?: () => void;
  pad?: number;
  rounded?: number;
  /** 玻璃浓度：soft 更透，strong 更实 */
  tone?: 'soft' | 'default' | 'strong';
  elevated?: boolean;
  selected?: boolean;
  danger?: boolean;
}

import { glassTones, glassTonesSoft, glassTonesStrong } from '../theme/tokens';

const TONE_FN: Record<string, () => [string, string, string]> = {
  soft: glassTonesSoft,
  default: glassTones,
  strong: glassTonesStrong,
};

export function Glass({
  children,
  style,
  onPress,
  onLongPress,
  pad,
  rounded,
  tone = 'default',
  elevated = true,
  selected = false,
  danger = false,
}: GlassProps) {
  const sc = useScale();
  const r = rounded ?? radius.lg;
  const padding = pad ?? sc.pad;
  const border = danger ? palette.danger : selected ? palette.accent : palette.hairline;

  const body = (
    <>
      <LinearGradient
        colors={(TONE_FN[tone] ?? TONE_FN.default)()}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: r * 0.5, right: r * 0.5, height: 1, backgroundColor: palette.edge, opacity: 0.95 }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: -sc.s(40), right: -sc.s(30), width: sc.s(120), height: sc.s(120), borderRadius: sc.s(60), backgroundColor: palette.glow }} />
      <View style={{ padding }}>{children}</View>
    </>
  );

  const containerStyle: ViewStyle = {
    borderRadius: r,
    borderWidth: selected ? 1.6 : 1,
    borderColor: border,
    overflow: 'hidden',
    backgroundColor: palette.glassSoft,
    ...(elevated ? (shadow.card as any) : null),
  };

  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        style={({ pressed }) => [containerStyle, { opacity: pressed ? 0.9 : 1, transform: [{ scale: pressed ? 0.988 : 1 }] }, style]}
      >
        {body}
      </Pressable>
    );
  }
  return <View style={[containerStyle, style]}>{body}</View>;
}

/** 更轻的玻璃片（列表行、小面板） */
export function GlassStrip({ children, style, pad }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; pad?: number }) {
  const sc = useScale();
  return (
    <View style={[{ borderRadius: radius.md, overflow: 'hidden', backgroundColor: palette.glassSoft, borderWidth: 1, borderColor: palette.hairlineSoft }, style]}>
      <View style={{ padding: pad ?? sc.s(12) }}>{children}</View>
    </View>
  );
}