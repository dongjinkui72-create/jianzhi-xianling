import React from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { AppProvider, useApp } from './src/store/AppStore';
import { LaunchProvider } from './src/launch/LaunchProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { Notice } from './src/components/Bits';
import { palette } from './src/theme/tokens';

/**
 * 剪纸仙灵 —— 免费开源的手机 App。
 * 免注册、免登录、打开即用；私有数据全部留在本机。
 * 交付形态锁定为手机 App，不提供网页 / H5 / 小程序版本。
 */

function BootGate() {
  const { ready, bootError } = useApp();
  if (!ready) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bgTop }}>
        <LinearGradient colors={[palette.bgTop, palette.bgBottom]} style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }} />
        <ActivityIndicator size="large" color={palette.accent} />
        <Text style={{ marginTop: 14, fontSize: 15, fontWeight: '700', color: palette.inkSoft }}>剪纸仙灵正在准备本机数据库…</Text>
      </View>
    );
  }
  if (bootError) {
    return (
      <View style={{ flex: 1, padding: 24, justifyContent: 'center', backgroundColor: palette.bgTop }}>
        <Notice tone="danger" title="本机数据库初始化失败">
          {bootError}
        </Notice>
      </View>
    );
  }
  return (
    <LaunchProvider>
      <RootNavigator />
    </LaunchProvider>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
        <StatusBar style="dark" />
        <AppProvider>
          <BootGate />
        </AppProvider>
    </SafeAreaProvider>
  );
}