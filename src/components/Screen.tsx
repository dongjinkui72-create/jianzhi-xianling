import React from 'react';
import { StyleSheet, StyleProp, Text, View, ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SafeAreaView } from 'react-native-safe-area-context';
import { palette } from '../theme/tokens';
import { useScale } from '../theme/useScale';

/** 全屏水晶背景（固定水晶白，不随系统深色模式变化） */
export function ScreenShell({ children, edges = ['top'], style }: { children: React.ReactNode; edges?: any; style?: StyleProp<ViewStyle> }) {
  const sc = useScale();
  return (
    <View style={{ flex: 1, backgroundColor: palette.bgTop }}>
      <LinearGradient
        colors={[palette.bgTop, palette.bgBottom, palette.bgDeep]}
        locations={[0, 0.52, 1]}
        start={{ x: 0.2, y: 0 }}
        end={{ x: 0.8, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View pointerEvents="none" style={{ position: 'absolute', top: -sc.s(90), left: -sc.s(70), width: sc.s(260), height: sc.s(260), borderRadius: sc.s(130), backgroundColor: 'rgba(255,255,255,0.60)' }} />
      <View pointerEvents="none" style={{ position: 'absolute', top: sc.s(150), right: -sc.s(110), width: sc.s(230), height: sc.s(230), borderRadius: sc.s(115), backgroundColor: 'rgba(255,255,255,0.42)' }} />
      <SafeAreaView edges={edges} style={[{ flex: 1 }, style]}>
        {children}
      </SafeAreaView>
    </View>
  );
}


export interface HeaderProps {
  title: string;
  subtitle?: string | null;
  right?: React.ReactNode;
}

/** 顶部标题栏。设置入口固定在主界面右上角。 */
export function Header({ title, subtitle, right }: HeaderProps) {
  const sc = useScale();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: sc.gutter, paddingTop: sc.s(4), paddingBottom: sc.s(12) }}>
      <View style={{ flex: 1, paddingRight: sc.s(8) }}>
        <Text numberOfLines={1} style={{ fontSize: sc.fs(28), fontWeight: '800', color: palette.ink, letterSpacing: 0.6 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text numberOfLines={2} style={{ marginTop: sc.s(3), fontSize: sc.fs(12.5), color: palette.inkFaint, lineHeight: sc.fs(17) }}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View style={{ flexDirection: 'row', alignItems: 'center', gap: sc.s(8) }}>{right}</View> : null}
    </View>
  );
}