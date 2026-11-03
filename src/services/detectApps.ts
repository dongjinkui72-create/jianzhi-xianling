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
/** 开源 AI 聊天 / AI 恋爱聊天客户端的名称特征（GitHub 生态常见命名） */
export const CLIENT_LABEL_HINTS = [
  'tavern',
  'risu',
  'silly',
  'chatbox',
  'lobe',
  'cherry studio',
  'cherrystudio',
  'nextchat',
  'deepchat',
  'chatterui',
  'chatter',
  'opencat',
  'boltai',
  'chatwise',
  'janitor',
  'chub',
  'roleplay',
  'character',
  '酒馆',
  '角色',
  '恋爱',
  'ai聊天',
  'ai chat',
];

export interface ReconcileResult {
  updates: ChatClient[];
  creates: ChatClient[];
}

/**
 * 用「全量已安装应用列表」做三层识别：
 *  1. 包名精确命中登记表 / 远程清单；
 *  2. 名称启发式命中开源客户端生态（tavern / risu / chatbox / lobe …），
 *     自动建档为「悬浮窗送达」适配器，GitHub 上新出的同类软件也能被认出来；
 *  3. 其余仍走 scheme 白名单探测。
 */
export function reconcileWithInstalled(installed: { label: string; packageName: string }[], clients: ChatClient[]): ReconcileResult {
  const updates: ChatClient[] = [];
  const creates: ChatClient[] = [];
  const byPkg = new Map(installed.map((a) => [a.packageName.toLowerCase(), a]));

  for (const c of clients) {
    if (!c.androidPackage) continue;
    const hit = byPkg.get(c.androidPackage.toLowerCase());
    const status: DetectStatus = hit ? 'installed' : c.browserBased ? c.detected : 'not_installed';
    if (status !== c.detected) {
      updates.push({ ...c, detected: status, detectReason: hit ? '已在本机安装列表中找到' : '本机安装列表中未找到' });
    }
  }

  const knownPkgs = new Set(clients.map((c) => (c.androidPackage || '').toLowerCase()).filter(Boolean));
  const knownIds = new Set(clients.map((c) => c.id));
  const strip = (x: string) => x.toLowerCase().replace(/[（(].*?[）)]/g, '').replace(/[\s_\-.]/g, '');
  for (const a of installed) {
    const key = a.packageName.toLowerCase();
    if (knownPkgs.has(key)) continue;
    // 登记表里有同名适配器（如 TauriTavern / SillyTavern），把真实包名回填到它身上，
    // 这样启动时可以直接用包名拉起，而不是再建一条重复项。
    const nameHit = clients.find(
      (c) => !c.androidPackage && (strip(a.label).includes(strip(c.name)) || strip(c.name).includes(strip(a.label))),
    );
    if (nameHit) {
      if (nameHit.detected !== 'installed') {
        updates.push({
          ...nameHit,
          androidPackage: a.packageName,
          detected: 'installed',
          detectReason: '按应用名称匹配到登记表，并回填了包名',
        });
      } else if (nameHit.androidPackage !== a.packageName) {
        updates.push({ ...nameHit, androidPackage: a.packageName });
      }
      knownIds.add(nameHit.id);
      continue;
    }
    const hay = `${a.label} ${a.packageName}`.toLowerCase();
    if (!CLIENT_LABEL_HINTS.some((h) => hay.includes(h))) continue;
    const id = 'auto_' + a.packageName.replace(/[^a-z0-9_]/g, '_');
    if (knownIds.has(id)) continue;
    creates.push({
      id,
      name: a.label,
      scheme: null,
      androidPackage: a.packageName,
      iosBundleId: null,
      importKind: 'unconfirmed',
      platform: 'all',
      builtin: false,
      detected: 'installed',
      detectReason: '按名称自动识别；无已知导入协议，启动时用悬浮窗凭证层送达',
      addedAt: Date.now(),
      source: 'auto',
      note: '自动识别到的客户端；没有已知导入协议，启动时用悬浮窗凭证层送达',
    });
  }
  return { updates, creates };
}