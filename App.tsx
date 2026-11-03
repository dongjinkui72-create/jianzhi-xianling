import React, { useEffect, useRef, useState } from 'react';
import { Animated, Image, Text, View } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from './src/store/AppStore';
import { ThemeProvider } from './src/theme/ThemeProvider';
import { LaunchProvider } from './src/launch/LaunchProvider';
import { RootNavigator } from './src/navigation/RootNavigator';
import { Notice } from './src/components/Bits';
import { palette } from './src/theme/tokens';

/**
 * 剪纸仙灵 —— 免费开源的手机 App。
 * 免注册、免登录、打开即用；私有数据全部留在本机。
 * 交付形态锁定为手机 App，不提供网页 / H5 / 小程序版本。
 */

// 原生启动图先盖住一切，等 JS 就绪后再交给过场动画，用户看不到任何加载过程
SplashScreen.preventAutoHideAsync().catch(() => {});

function IntroSplash({ onDone }: { onDone: () => void }) {
  const scale = useRef(new Animated.Value(0.8)).current;
  const fade = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(0.25)).current;
  const out = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(scale, { toValue: 1, friction: 6, tension: 40, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 420, useNativeDriver: true }),
      Animated.timing(glow, { toValue: 0.6, duration: 900, useNativeDriver: true }),
    ]).start();
    const t = setTimeout(() => {
      Animated.timing(out, { toValue: 0, duration: 360, useNativeDriver: true }).start(() => onDone());
    }, 1300);
    return () => clearTimeout(t);
  }, [scale, fade, glow, out, onDone]);

  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: palette.bgTop,
        opacity: out,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Animated.View style={{ opacity: glow, position: 'absolute', width: 300, height: 300, borderRadius: 150, backgroundColor: palette.glow }} />
      <Animated.View style={{ opacity: fade, transform: [{ scale }], alignItems: 'center' }}>
        <Image source={require('./assets/splash-icon.png')} style={{ width: 148, height: 148, resizeMode: 'contain' }} />
        <Text style={{ marginTop: 20, fontSize: 27, fontWeight: '800', color: palette.ink, letterSpacing: 6 }}>剪纸仙灵</Text>
        <Text style={{ marginTop: 8, fontSize: 12, color: palette.inkFaint, letterSpacing: 3 }}>薅尽天下免费 API 额度</Text>
      </Animated.View>
    </Animated.View>
  );
}

function BootGate() {
  const { ready, bootError } = useApp();
  const [introDone, setIntroDone] = useState(false);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
  }, [ready]);

  return (
    <View style={{ flex: 1, backgroundColor: palette.bgTop }}>
      {bootError && introDone ? (
        <View style={{ flex: 1, padding: 24, justifyContent: 'center' }}>
          <Notice tone="danger" title="本机数据库初始化失败">{bootError}</Notice>
        </View>
      ) : (
        <LaunchProvider>
          <RootNavigator />
        </LaunchProvider>
      )}
      {!introDone ? <IntroSplash onDone={() => setIntroDone(true)} /> : null}
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <ThemeProvider>
          <BootGate />
        </ThemeProvider>
      </AppProvider>
    </SafeAreaProvider>
  );
}