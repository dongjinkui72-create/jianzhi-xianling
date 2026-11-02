import { Linking } from 'react-native';
import { toBase64 } from '../lib/base64';
import { normalizeUrl } from '../lib/normalize';
import type { ApiKeyItem, ApiProtocol, ChatClient } from '../lib/types';
import { storeUrl } from './detectApps';

/**
 * 核心功能②：点一下启动按钮 → 拉起手机上的 AI 聊天软件 →
 * 全自动把 API Key 与调用地址写进去，用户全程不需要复制粘贴。
 *
 * 落地方式：Chatbox 官方提供的 deep link「导入第三方提供方配置」
 *   chatbox://app/import-config?type=<TYPE>&data=<BASE64(JSON)>
 *   JSON = { apiHost, apiKey, name? }
 * 由对方 App 自己解析并写入配置，本 App 不做任何剪贴板操作。
 *
 * 对不支持该协议的软件，一律如实标注 launch_only / unconfirmed，
 * 绝不伪装成「已导入」。
 */

export type LaunchMode = 'auto_import' | 'launch_only' | 'unconfirmed' | 'failed';

export interface LaunchResult {
  ok: boolean;
  mode: LaunchMode;
  title: string;
  message: string;
  url?: string;
  clientName: string;
}

export function chatboxTypeFor(protocol: ApiProtocol): string {
  switch (protocol) {
    case 'openai_response':
      return 'openai_response';
    case 'gemini':
      return 'gemini';
    case 'claude':
      return 'claude';
    case 'ollama':
      return 'ollama';
    case 'lmstudio':
      return 'lmstudio';
    case 'openai_compatible':
    default:
      return 'openai_compatible';
  }
}

/** 按协议归一化出对方 App 需要的 apiHost */
export function apiHostFor(key: ApiKeyItem): string {
  const base = normalizeUrl(key.baseUrl);
  switch (key.protocol) {
    case 'gemini':
      return base.replace(/\/v1beta\/?$/i, '').replace(/\/v1\/?$/i, '');
    case 'claude':
      return base.replace(/\/v1\/?$/i, '');
    case 'openai_compatible':
    case 'openai_response':
      return /\/v\d+\/?$/.test(base) ? base : `${base}/v1`;
    default:
      return base;
  }
}

export function canAutoImport(c: ChatClient): boolean {
  return c.importKind === 'deeplink_import' && !!c.importTemplate;
}

export function buildAutoImportUrl(client: ChatClient, key: ApiKeyItem, secret: string): string | null {
  if (!canAutoImport(client) || !client.importTemplate) return null;
  const payload = {
    apiHost: apiHostFor(key),
    apiKey: secret,
    name: key.label || client.name,
  };
  const data = toBase64(JSON.stringify(payload));
  return client.importTemplate
    .replace('{type}', chatboxTypeFor(key.protocol))
    .replace('{data}', encodeURIComponent(data));
}

async function tryOpen(url: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const supported = await Linking.canOpenURL(url);
    if (!supported) {
      // canOpenURL 在白名单不可信的壳里会假阴性，这里仍然尝试真正打开
      try {
        await Linking.openURL(url);
        return { ok: true };
      } catch (e: any) {
        return { ok: false, error: String(e?.message || e) };
      }
    }
    await Linking.openURL(url);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: String(e?.message || e) };
  }
}

/** 启动 + 全自动导入 */
export async function launchWithImport(client: ChatClient, key: ApiKeyItem, secret: string | null): Promise<LaunchResult> {
  if (!secret) {
    return {
      ok: false,
      mode: 'failed',
      title: '无法导入',
      message: '本机加密区里没有找到这条 API 的真实密钥，无法自动导入。',
      clientName: client.name,
    };
  }

  if (canAutoImport(client)) {
    const url = buildAutoImportUrl(client, key, secret);
    if (url) {
      const r = await tryOpen(url);
      if (r.ok) {
        return {
          ok: true,
          mode: 'auto_import',
          title: `已拉起 ${client.name} 并自动写入配置`,
          message: `「${key.label}」的 API Key 与调用地址 ${apiHostFor(key)} 已通过 deep link 直接写入 ${client.name}，全程没有经过剪贴板。若对方弹出确认框，点一下允许即可开始对话。`,
          url,
          clientName: client.name,
        };
      }
      const store = storeUrl(client);
      return {
        ok: false,
        mode: 'failed',
        title: `${client.name} 未能拉起`,
        message: `deep link 打开失败：${r.error || '未知原因'}。${store ? '可能尚未安装该 App。' : ''}`,
        url,
        clientName: client.name,
      };
    }
  }

  if (client.importKind === 'launch_only') {
    const url = client.scheme ? `${client.scheme}://` : null;
    if (url) {
      const r = await tryOpen(url);
      if (r.ok) {
        return {
          ok: true,
          mode: 'launch_only',
          title: `已拉起 ${client.name}`,
          message: `${client.name} 没有公开「一键写入提供方配置」的协议，App 只能把它打开，无法代替它写入密钥。要全自动导入请选用 Chatbox（本 App 已内置其官方 deep link 协议）。`,
          url,
          clientName: client.name,
        };
      }
    }
    return {
      ok: false,
      mode: 'failed',
      title: `${client.name} 未能拉起`,
      message: '既没有可用协议，也未能通过应用商店打开。',
      clientName: client.name,
    };
  }

  return {
    ok: false,
    mode: 'unconfirmed',
    title: '无法确认导入能力',
    message: `${client.name} 的自动导入协议尚未收录，本 App 不会谎报「已导入」。请在设置里把它换成支持全自动导入的 Chatbox，或手动在对方 App 内添加。`,
    clientName: client.name,
  };
}

/** 仅拉起（不导入） */
export async function launchOnly(client: ChatClient): Promise<LaunchResult> {
  const url = client.scheme ? `${client.scheme}://` : storeUrl(client);
  if (!url) {
    return { ok: false, mode: 'failed', title: '无法拉起', message: `${client.name} 没有登记可用的打开方式`, clientName: client.name };
  }
  const r = await tryOpen(url);
  return r.ok
    ? { ok: true, mode: 'launch_only', title: `已拉起 ${client.name}`, message: '仅打开 App，未写入配置。', url, clientName: client.name }
    : { ok: false, mode: 'failed', title: '拉起失败', message: r.error || '未知原因', url, clientName: client.name };
}

/** 去应用商店 */
export async function openStore(client: ChatClient): Promise<boolean> {
  const url = storeUrl(client);
  if (!url) return false;
  const r = await tryOpen(url);
  return r.ok;
}