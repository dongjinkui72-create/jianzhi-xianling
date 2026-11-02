import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import type { BottomTabBarProps } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { BlurView } from 'expo-blur';
import { palette, radius } from '../theme/tokens';
import { useScale } from '../theme/useScale';
import { useApp } from '../store/AppStore';
import { useLaunch } from '../launch/LaunchProvider';

/**
 * 底部导航（水晶玻璃）。
 * 迭代要求：雷达站 / 中转站 / 可用池 各占底部 UI 的三分之一；
 * 原来的大圆形启动按钮移除，改为界面上的小型悬浮启动按钮（见 FloatingLaunchButton）。
 */

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Radar: { on: 'radio', off: 'radio-outline' },
  Relay: { on: 'swap-horizontal', off: 'swap-horizontal-outline' },
  Pool: { on: 'shield-checkmark', off: 'shield-checkmark-outline' },
};

const LABELS: Record<string, string> = { Radar: '雷达站', Relay: '中转站', Pool: '可用池' };

/** 小型悬浮启动按钮：浮在界面右下角、底部导航之上 */
export function FloatingLaunchButton() {
  const sc = useScale();
  const { keys, selectedKeyId } = useApp();
  const { requestLaunch, launchEnabledReason } = useLaunch();
  const selected = keys.find((k) => k.id === selectedKeyId) ?? null;
  const enabled = !!selected && (selected.status === 'ok' || selected.status === 'unknown');
  const size = sc.s(54);

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', right: sc.gutter, bottom: sc.tabHeight + sc.s(116) }}>
      {!enabled && launchEnabledReason ? (
        <View pointerEvents="none" style={{ position: 'absolute', right: 0, bottom: size + sc.s(8), width: sc.s(168), alignItems: 'flex-end' }}>
          <View style={{ paddingHorizontal: sc.s(10), paddingVertical: sc.s(6), borderRadius: radius.md, backgroundColor: 'rgba(255,255,255,0.94)', borderWidth: 1, borderColor: palette.hairline }}>
            <Text style={{ fontSize: sc.fs(10.5), color: palette.inkSoft, fontWeight: '600', textAlign: 'right', lineHeight: sc.fs(15) }}>{launchEnabledReason}</Text>
          </View>
        </View>
      ) : null}
      <Pressable
        disabled={!enabled}
        onPress={() => requestLaunch()}
        accessibilityLabel="启动并自动导入"
        hitSlop={8}
        style={({ pressed }) => ({
          width: size,
          height: size,
          borderRadius: size / 2,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          opacity: pressed && enabled ? 0.85 : 1,
          transform: [{ scale: pressed && enabled ? 0.94 : 1 }],
          backgroundColor: enabled ? 'transparent' : 'rgba(255,255,255,0.72)',
          borderWidth: enabled ? 0 : 1.5,
          borderColor: enabled ? 'transparent' : 'rgba(146,160,180,0.4)',
          ...(enabled
            ? ({ shadowColor: '#2E7BFF', shadowOpacity: 0.4, shadowRadius: 16, shadowOffset: { width: 0, height: 7 }, elevation: 10 } as any)
            : ({ shadowColor: '#4A6C9B', shadowOpacity: 0.12, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 4 } as any)),
        })}
      >
        {enabled ? (
          <LinearGradient colors={[palette.accent, '#5FA0FF', palette.accentDeep]} start={{ x: 0.1, y: 0 }} end={{ x: 0.9, y: 1 }} style={StyleSheet.absoluteFill} />
        ) : null}
        <View pointerEvents="none" style={{ position: 'absolute', top: sc.s(5), left: sc.s(11), right: sc.s(11), height: sc.s(11), borderRadius: sc.s(8), backgroundColor: 'rgba(255,255,255,0.32)' }} />
        <Ionicons name="play" size={sc.s(23)} color={enabled ? '#FFFFFF' : palette.disabledInk} style={{ marginLeft: sc.s(2) }} />
      </Pressable>
    </View>
  );
}

export function CrystalTabBar({ state, navigation }: BottomTabBarProps) {
  const sc = useScale();
  const barContentHeight = sc.tabHeight - sc.insets.bottom;

  return (
    <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
      {/* 玻璃底板 */}
      <View
        style={{
          height: sc.tabHeight,
          borderTopLeftRadius: sc.s(28),
          borderTopRightRadius: sc.s(28),
          overflow: 'hidden',
          backgroundColor: Platform.OS === 'ios' ? 'transparent' : 'rgba(255,255,255,0.90)',
          borderTopWidth: 1,
          borderColor: palette.edge,
          elevation: 14,
          shadowColor: '#4A6C9B',
          shadowOpacity: 0.16,
          shadowRadius: 20,
          shadowOffset: { width: 0, height: -6 },
        }}
      >
        {Platform.OS === 'ios' ? (
          <BlurView intensity={72} tint="light" style={StyleSheet.absoluteFill} experimentalBlurMethod="dimezisBlurView">
            <LinearGradient colors={['rgba(255,255,255,0.55)', 'rgba(255,255,255,0.30)']} style={StyleSheet.absoluteFill} />
          </BlurView>
        ) : (
          <LinearGradient colors={['rgba(255,255,255,0.96)', 'rgba(255,255,255,0.80)']} style={StyleSheet.absoluteFill} />
        )}
        <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: sc.s(30), right: sc.s(30), height: 1, backgroundColor: palette.edge }} />
      </View>

      {/* 三个入口各占三分之一 */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barContentHeight, flexDirection: 'row', alignItems: 'center' }}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const icon = ICONS[route.name] ?? { on: 'ellipse' as const, off: 'ellipse-outline' as const };
          return (
            <Pressable
              key={route.key}
              onPress={() => {
                const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
                if (!focused && !event.defaultPrevented) navigation.navigate(route.name as any);
              }}
              style={({ pressed }) => ({
                flex: 1,
                height: barContentHeight,
                alignItems: 'center',
                justifyContent: 'center',
                gap: sc.s(3),
                opacity: pressed ? 0.65 : 1,
              })}
            >
              <View style={{ alignItems: 'center', justifyContent: 'center', width: sc.s(52), height: sc.s(28), borderRadius: radius.pill, backgroundColor: focused ? palette.accentSoft : 'transparent' }}>
                <Ionicons name={focused ? icon.on : icon.off} size={sc.s(21)} color={focused ? palette.accent : palette.inkFaint} />
              </View>
              <Text numberOfLines={1} style={{ fontSize: sc.fs(11.5), fontWeight: focused ? '800' : '600', color: focused ? palette.accent : palette.inkFaint, letterSpacing: 0.3 }}>
                {LABELS[route.name] ?? route.name}
              </Text>
            </Pressable>
          );
        })}
      </View>

      {/* 悬浮启动按钮（浮在界面之上） */}
      <FloatingLaunchButton />
    </View>
  );
}