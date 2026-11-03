import { Linking } from 'react-native';
import { toBase64 } from '../lib/base64';
import { normalizeUrl } from '../lib/normalize';
import type { ApiKeyItem, ApiProtocol, ChatClient } from '../lib/types';
import { storeUrl } from './detectApps';
import { launchAppByName, launchAppPackage } from '../native/installedApps';

/**
 * 核心功能②：点一下启动按钮 → 拉起 AI 聊天软件 → 全自动写入 API Key 与调用地址，
 * 用户全程不需要复制粘贴。
 *
 * 适配器按 importKind 分四类，全部如实回报：
 *  - deeplink_import     Chatbox 官方 deep link，由对方 App 自己解析写入（已核实）
 *  - url_settings_import LobeChat 官方「URL 分享配置」，把 keyVaults 写进 URL 参数（已核实）
 *  - launch_only         只能拉起（DeepChat 官方 DeepLinks 只到「开始聊天」这一层）
 *  - unconfirmed         协议未核实（如 Cherry Studio 的 providers/api-keys 入口），不贸然发送
 */

export type LaunchMode = 'auto_import' | 'url_import' | 'launch_only' | 'unconfirmed' | 'failed';

export interface LaunchResult {
  ok: boolean;
  mode: LaunchMode;
  title: string;
  message: string;
  url?: string;
  clientName: string;
}

export { chatboxTypeFor, apiHostFor, lobeProviderFor, canAutoImport, buildImportUrl, buildLaunchUrl, chatboxPayload, lobeSettingsPayload } from '../lib/importUrls';
import { buildImportUrl, buildLaunchUrl, canAutoImport, apiHostFor, lobeProviderFor } from '../lib/importUrls';
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

  const url = buildImportUrl(client, key, secret);

  if (client.importKind === 'deeplink_import' && url) {
    const r = await tryOpen(url);
    if (r.ok) {
      return {
        ok: true,
        mode: 'auto_import',
        title: `已拉起 ${client.name} 并自动写入配置`,
        message: `「${key.label}」的 API Key 与调用地址 ${apiHostFor(key)} 已通过 ${client.name} 官方 deep link 直接写入，全程没有经过剪贴板。若对方弹出确认框，点一下允许即可开始对话。`,
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

  if (client.importKind === 'url_settings_import' && url) {
    const r = await tryOpen(url);
    if (r.ok) {
      return {
        ok: true,
        mode: 'url_import',
        title: `已通过 URL 参数写入 ${client.name} 配置`,
        message: `已在浏览器打开 ${client.settingsBase || '目标地址'} 并把 keyVaults.${lobeProviderFor(key.protocol)} 的密钥与调用地址随 URL 参数写入。该方式适用于 ${client.name} 的网页版 / PWA / 桌面版；如果你用的是自建实例，请在「设置 → 适配器」里改 base 地址。`,
        url,
        clientName: client.name,
      };
    }
    return {
      ok: false,
      mode: 'failed',
      title: '打开失败',
      message: `URL 打开失败：${r.error || '未知原因'}`,
      url,
      clientName: client.name,
    };
  }

  if (client.importKind === 'launch_only') {
    const launchUrl = buildLaunchUrl(client) || storeUrl(client);
    if (launchUrl) {
      const r = await tryOpen(launchUrl);
      if (r.ok) {
        return {
          ok: true,
          mode: 'launch_only',
          title: `已拉起 ${client.name}`,
          message: `${client.name}${client.note ? `（${client.note}）` : ' 没有公开「一键写入提供方配置」的协议'}，App 只能把它打开，无法代替它写入密钥。要全自动导入请选用支持该能力的适配器（当前为 Chatbox 与 LobeChat）。`,
          url: launchUrl,
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
    message: `${client.name}${client.note ? `：${client.note}` : ' 的自动导入协议尚未核实'}。本 App 不会谎报「已导入」。你可以在设置里改用支持全自动导入的适配器，或通过远程适配器清单补充确切格式。`,
    clientName: client.name,
  };
}

/** 仅拉起（不导入） */
export async function launchOnly(client: ChatClient): Promise<LaunchResult> {
  // 1) 官方 URL Scheme
  const schemeUrl = buildLaunchUrl(client);
  if (schemeUrl) {
    const r = await tryOpen(schemeUrl);
    if (r.ok) {
      return { ok: true, mode: 'launch_only', title: `已拉起 ${client.name}`, message: '已打开 App，未写入配置。', url: schemeUrl, clientName: client.name };
    }
  }
  // 2) 已登记的 Android 包名直接启动
  if (client.androidPackage && (await launchAppPackage(client.androidPackage))) {
    return { ok: true, mode: 'launch_only', title: `已拉起 ${client.name}`, message: '已通过应用包名打开，未写入配置。', clientName: client.name };
  }
  // 3) 按应用名称在本机已安装列表里查找并启动（包名未登记也能拉起）
  const foundPkg = await launchAppByName(client.name);
  if (foundPkg) {
    return { ok: true, mode: 'launch_only', title: `已拉起 ${client.name}`, message: `已在本机找到并打开（${foundPkg}），未写入配置。`, clientName: client.name };
  }
  // 4) 网页版 / PWA：直接用浏览器打开
  if (client.browserBased) {
    const web = client.settingsBase || 'https://chat.lobehub.com';
    const r = await tryOpen(web);
    if (r.ok) {
      return { ok: true, mode: 'launch_only', title: `已打开 ${client.name}`, message: `已用浏览器打开 ${web}。`, url: web, clientName: client.name };
    }
  }
  // 5) 确实没安装：打开应用商店，避免用户点完启动后原地卡住
  const store = storeUrl(client);
  if (store) {
    const r = await tryOpen(store);
    if (r.ok) {
      return {
        ok: false,
        mode: 'failed',
        title: `没有在手机上找到 ${client.name}`,
        message: '已打开应用商店，请先安装；安装完成后回到 App 再点一次「再拉起一次」。',
        url: store,
        clientName: client.name,
      };
    }
  }
  return {
    ok: false,
    mode: 'failed',
    title: `没有在手机上找到 ${client.name}`,
    message: `请在设置里重新选择该软件，或先安装它。安装后回到这里再点一次启动。`,
    clientName: client.name,
  };
}

/** 去应用商店 */
export async function openStore(client: ChatClient): Promise<boolean> {
  const url = storeUrl(client);
  if (!url) return false;
  const r = await tryOpen(url);
  return r.ok;
}