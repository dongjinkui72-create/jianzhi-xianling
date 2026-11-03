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

/** 用包名直接拉起目标 App（比 URL Scheme 更可靠，TauriTavern 等无 scheme 软件靠它） */
export async function launchAppPackage(packageName: string): Promise<boolean> {
  if (Platform.OS !== 'android' || !packageName) return false;
  const mod = (NativeModules as any).JZAppList;
  if (!mod || typeof mod.launchApp !== 'function') return false;
  try {
    return !!(await mod.launchApp(packageName));
  } catch {
    return false;
  }
}

/** 按应用名称在本机应用列表里找到并拉起；返回命中的包名，找不到返回 null */
export async function launchAppByName(name: string): Promise<string | null> {
  if (Platform.OS !== 'android' || !name) return null;
  const mod = (NativeModules as any).JZAppList;
  if (!mod || typeof mod.launchAppByName !== 'function') return null;
  try {
    const pkg = await mod.launchAppByName(name);
    return typeof pkg === 'string' && pkg ? pkg : null;
  } catch {
    return null;
  }
}

export function appListAvailable(): boolean {
  return Platform.OS === 'android' && !!(NativeModules as any).JZAppList;
}
