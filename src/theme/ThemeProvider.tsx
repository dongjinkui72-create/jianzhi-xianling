import React, { useEffect } from 'react';
import { StatusBar } from 'expo-status-bar';
import { useApp } from '../store/AppStore';
import { applyTheme, currentThemeName, type ThemeName } from './tokens';

/**
 * 主题提供者：把设置里的 theme 应用到全局 palette，并同步状态栏颜色。
 * 默认水晶白玻璃；黑夜主题在设置 → 外观 里切换。
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const { settings } = useApp();
  const theme: ThemeName = settings.theme === 'dark' ? 'dark' : 'crystal';

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // 首帧也先应用一次，避免闪白/闪黑
  if (currentThemeName() !== theme) applyTheme(theme);

  return (
    <>
      {children}
      <StatusBar style={theme === 'dark' ? 'light' : 'dark'} />
    </>
  );
}

export function useThemeName(): ThemeName {
  const { settings } = useApp();
  return settings.theme === 'dark' ? 'dark' : 'crystal';
}