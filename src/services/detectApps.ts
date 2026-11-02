import Constants from 'expo-constants';
import { Linking, Platform } from 'react-native';
import type { ChatClient, DetectStatus } from '../lib/types';

/**
 * 手机上的 AI 聊天软件识别。
 *
 * 红线：能力做不到就如实标注。
 * Android 11+ 的「包可见性」与 iOS 的 LSApplicationQueriesSchemes 都要求
 * 原生壳预先声明白名单（见 plugins/withChatAppQueries.js）。
 * 在 Expo Go 这种无法扩展白名单的壳里，检测结果不可信，
 * 必须标「无法确认」，绝不能谎报「未安装」。
 */

export function isWhitelistCapableShell(): boolean {
  const c = Constants as any;
  const ee: string | undefined = c.executionEnvironment;
  const ownership: string | undefined = c.appOwnership;
  const inExpoGo = ee === 'storeClient' || ownership === 'expo';
  return !inExpoGo && (Platform.OS === 'ios' || Platform.OS === 'android');
}

export function shellCapabilityNote(): string | null {
  if (Platform.OS !== 'ios' && Platform.OS !== 'android') return '当前不是手机运行环境，无法扫描已安装应用';
  if (!isWhitelistCapableShell()) {
    return '当前运行在 Expo Go 内，原生壳的 Scheme / 包名白名单无法扩展，扫描结果不可信，已统一标为「无法确认」。用开发版（npx expo run:android）构建后即可真实检测。';
  }
  return null;
}

export function platformMismatch(c: ChatClient): boolean {
  if (c.platform === 'all') return false;
  return c.platform !== Platform.OS;
}

export async function detectClient(c: ChatClient): Promise<{ status: DetectStatus; reason: string | null }> {
  if (c.browserBased) {
    return { status: 'unknown', reason: '网页版 / PWA 通过浏览器打开，无需安装检测' };
  }
  if (platformMismatch(c)) {
    return { status: 'not_installed', reason: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} 平台没有对应版本` };
  }

  if (!c.scheme) {
    return {
      status: 'unknown',
      reason: '该软件未公开 URL Scheme，原生壳在不申请「查询已安装应用」权限的前提下无法确认安装状态',
    };
  }

  if (!isWhitelistCapableShell()) {
    return { status: 'unknown', reason: '当前壳无法扩展 Scheme 白名单，检测结果不可信' };
  }

  try {
    const ok = await Linking.canOpenURL(`${c.scheme}://`);
    return ok
      ? { status: 'installed', reason: null }
      : { status: 'not_installed', reason: `未检测到 ${c.scheme}:// 协议` };
  } catch (e: any) {
    return { status: 'unknown', reason: `探测失败：${e?.message || e}` };
  }
}

export async function detectClients(list: ChatClient[]): Promise<ChatClient[]> {
  const out: ChatClient[] = [];
  for (const c of list) {
    const r = await detectClient(c);
    out.push({ ...c, detected: r.status, detectReason: r.reason });
  }
  return out;
}

/** 应用商店链接，供「去安装」使用 */
export function storeUrl(c: ChatClient): string | null {
  if (Platform.OS === 'android' && c.androidPackage) {
    return `market://details?id=${c.androidPackage}`;
  }
  if (Platform.OS === 'ios' && c.iosBundleId) {
    return `https://apps.apple.com/app/${c.iosBundleId}`;
  }
  return null;
}