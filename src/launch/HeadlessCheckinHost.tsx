import React, { useEffect, useRef } from 'react';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';
import { headlessBridge, notifyHeadlessLoad, registerHeadlessNavigator } from '../services/headlessCheckin';
import { SPY_JS } from '../services/relayBridge';

/**
 * 常驻的 1x1 隐形 WebView：后台签到的执行环境。
 * 不占布局、不可见、不拦截触摸；与登录 WebView 共享 Cookie。
 */
export function HeadlessCheckinHost() {
  const ref = useRef<any>(null);

  useEffect(() => {
    registerHeadlessNavigator((uri: string) => {
      ref.current?.stopLoading?.();
      ref.current?.injectJavaScript?.('window.location.href = ' + JSON.stringify(uri) + '; true;');
    });
    headlessBridge.attach(ref);
    return () => {
      headlessBridge.detach();
    };
  }, []);

  return (
    <View pointerEvents="none" style={{ position: 'absolute', top: -4, left: -4, width: 2, height: 2, opacity: 0, overflow: 'hidden' }}>
      <WebView
        ref={ref}
        source={{ uri: 'about:blank' }}
        injectedJavaScriptBeforeContentLoaded={SPY_JS}
        onMessage={(e) => headlessBridge.handleMessage(e.nativeEvent.data)}
        onLoadEnd={() => notifyHeadlessLoad()}
        onNavigationStateChange={(nav: any) => headlessBridge.setOrigin(nav?.url)}
        originWhitelist={['*']}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        setSupportMultipleWindows={false}
        style={{ width: 2, height: 2 }}
      />
    </View>
  );
}