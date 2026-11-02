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
import { maskKey } from '../lib/format';

/**
 * 底部导航（水晶玻璃）。
 *
 * 布局按迭代要求：[雷达站] [中转站] (圆形启动按钮) [可用池]
 *  - 启动按钮为圆形，位置正好在「中转站」和「可用池」中间
 *  - 面积为标准 FAB 的 2 倍（56 -> 80）
 *  - 底部 UI 比常规更高
 *  - 未选中 API 时按钮为灰色且不可点击
 */

const ICONS: Record<string, { on: keyof typeof Ionicons.glyphMap; off: keyof typeof Ionicons.glyphMap }> = {
  Radar: { on: 'radio', off: 'radio-outline' },
  Relay: { on: 'swap-horizontal', off: 'swap-horizontal-outline' },
  Pool: { on: 'shield-checkmark', off: 'shield-checkmark-outline' },
};

export function CrystalTabBar({ state, navigation }: BottomTabBarProps) {
  const sc = useScale();
  const { keys, selectedKeyId } = useApp();
  const { requestLaunch, launchEnabledReason } = useLaunch();

  const selected = keys.find((k) => k.id === selectedKeyId) ?? null;
  const enabled = !!selected && (selected.status === 'ok' || selected.status === 'unknown');
  const barContentHeight = sc.tabHeight - sc.insets.bottom;

  const renderTab = (routeIndex: number) => {
    const route = state.routes[routeIndex];
    const focused = state.index === routeIndex;
    const icon = ICONS[route.name] ?? { on: 'ellipse' as const, off: 'ellipse-outline' as const };
    const label = route.name === 'Radar' ? '雷达站' : route.name === 'Relay' ? '中转站' : '可用池';
    return (
      <Pressable
        key={route.key}
        onPress={() => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name as any);
        }}
        style={({ pressed }) => ({ flex: 1, height: barContentHeight, alignItems: 'center', justifyContent: 'center', gap: sc.s(3), opacity: pressed ? 0.65 : 1 })}
      >
        <View style={{ alignItems: 'center', justifyContent: 'center', width: sc.s(46), height: sc.s(28), borderRadius: radius.pill, backgroundColor: focused ? palette.accentSoft : 'transparent' }}>
          <Ionicons name={focused ? icon.on : icon.off} size={sc.s(21)} color={focused ? palette.accent : palette.inkFaint} />
        </View>
        <Text style={{ fontSize: sc.fs(11), fontWeight: focused ? '800' : '600', color: focused ? palette.accent : palette.inkFaint, letterSpacing: 0.3 }}>
          {label}
        </Text>
      </Pressable>
    );
  };

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

      {/* 内容行 */}
      <View pointerEvents="box-none" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: barContentHeight, flexDirection: 'row', alignItems: 'center' }}>
        {renderTab(0)}
        {renderTab(1)}

        {/* 圆形启动按钮：夹在「中转站」与「可用池」中间 */}
        <View style={{ width: sc.fabSize + sc.s(10), alignItems: 'center', justifyContent: 'center' }}>
          <Pressable
            disabled={!enabled}
            onPress={() => requestLaunch()}
            hitSlop={6}
            style={({ pressed }) => ({
              width: sc.fabSize,
              height: sc.fabSize,
              borderRadius: sc.fabSize / 2,
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              transform: [{ translateY: -sc.fabSize * 0.30 }, { scale: pressed && enabled ? 0.955 : 1 }],
              opacity: enabled ? 1 : 0.95,
              backgroundColor: enabled ? 'transparent' : palette.disabledFill,
              borderWidth: enabled ? 0 : 1.5,
              borderColor: enabled ? 'transparent' : 'rgba(146,160,180,0.35)',
              ...(enabled
                ? ({
                    shadowColor: '#2E7BFF',
                    shadowOpacity: 0.44,
                    shadowRadius: 22,
                    shadowOffset: { width: 0, height: 10 },
                    elevation: 16,
                  } as any)
                : ({
                    shadowColor: '#4A6C9B',
                    shadowOpacity: 0.1,
                    shadowRadius: 6,
                    shadowOffset: { width: 0, height: 3 },
                    elevation: 2,
                  } as any)),
            })}
          >
            {enabled ? (
              <LinearGradient
                colors={[palette.accent, '#5FA0FF', palette.accentDeep]}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={StyleSheet.absoluteFill}
              />
            ) : null}
            <View pointerEvents="none" style={{ position: 'absolute', top: sc.s(6), left: sc.s(14), right: sc.s(14), height: sc.s(14), borderRadius: sc.s(10), backgroundColor: 'rgba(255,255,255,0.35)' }} />
            <Ionicons name={enabled ? 'play' : 'play'} size={sc.s(enabled ? 34 : 30)} color={enabled ? '#FFFFFF' : palette.disabledInk} style={{ marginLeft: enabled ? sc.s(3) : 0 }} />
            {enabled ? (
              <Text numberOfLines={1} style={{ position: 'absolute', bottom: sc.s(11), fontSize: sc.fs(9.5), color: 'rgba(255,255,255,0.94)', fontWeight: '800', maxWidth: sc.fabSize - sc.s(14), textAlign: 'center' }}>
                {selected ? maskKey(selected.maskedKey).slice(-4) : '启动'}
              </Text>
            ) : null}
          </Pressable>
        </View>

        {renderTab(2)}
      </View>

      {/* 不可点时的原因提示（悬浮在按钮上方，不占布局） */}
      {!enabled && launchEnabledReason ? (
        <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: barContentHeight + sc.s(6), alignItems: 'center' }}>
          <View style={{ paddingHorizontal: sc.s(12), paddingVertical: sc.s(6), borderRadius: radius.pill, backgroundColor: 'rgba(255,255,255,0.92)', borderWidth: 1, borderColor: palette.hairline }}>
            <Text style={{ fontSize: sc.fs(11), color: palette.inkSoft, fontWeight: '600' }}>{launchEnabledReason}</Text>
          </View>
        </View>
      ) : null}
    </View>
  );
}