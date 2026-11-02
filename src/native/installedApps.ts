import { NativeModules, Platform } from 'react-native';

export interface InstalledApp {
  label: string;
  packageName: string;
}

/** 拉取手机上已安装的、有启动图标的应用列表（Android；需原生模块） */
export async function listInstalledApps(): Promise<InstalledApp[]> {
  if (Platform.OS !== 'android') return [];
  const mod = (NativeModules as any).JZAppList;
  if (!mod) return [];
  try {
    const list = await mod.getInstalledApps();
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function appListAvailable(): boolean {
  return Platform.OS === 'android' && !!(NativeModules as any).JZAppList;
}