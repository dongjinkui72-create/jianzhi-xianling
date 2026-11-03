import { NativeModules, Platform } from 'react-native';

/**
 * 悬浮窗凭证层（Android 系统悬浮窗）。
 * 对没有自动导入协议的软件：启动目标 App 后，把调用地址与密钥以悬浮窗盖在它上面。
 * 默认收起（一个小圆钮）；点一下展开显示地址与密钥（可复制）；再点收起；长按关闭。
 */

interface OverlayNative {
  canOverlay(): Promise<boolean>;
  requestOverlay(): Promise<boolean>;
  show(title: string, base: string, key: string): Promise<boolean>;
  hide(): Promise<boolean>;
}

const mod: OverlayNative | undefined = (NativeModules as any).JZOverlay;

export function overlayAvailable(): boolean {
  return Platform.OS === 'android' && !!mod;
}

export async function canOverlay(): Promise<boolean> {
  if (!mod) return false;
  try {
    return await mod.canOverlay();
  } catch {
    return false;
  }
}

export async function requestOverlay(): Promise<boolean> {
  if (!mod) return false;
  try {
    return await mod.requestOverlay();
  } catch {
    return false;
  }
}

export async function showCredentialOverlay(title: string, base: string, key: string): Promise<boolean> {
  if (!mod) return false;
  try {
    return await mod.show(title, base, key);
  } catch {
    return false;
  }
}

export async function hideCredentialOverlay(): Promise<boolean> {
  if (!mod) return false;
  try {
    return await mod.hide();
  } catch {
    return false;
  }
}