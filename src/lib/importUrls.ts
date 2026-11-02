import { toBase64 } from './base64';
import { normalizeUrl } from './normalize';
import type { ApiKeyItem, ApiProtocol, ChatClient } from './types';

/**
 * 「全自动写入配置」的 URL 构造（纯函数，便于单测）。
 * 各协议格式均已对照官方文档 / 源码核实，见文件尾注。
 */

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

/** 按协议归一化出对方 App 需要的 apiHost / baseURL */
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

/** LobeChat keyVaults 的提供方键名 */
export function lobeProviderFor(protocol: ApiProtocol): string {
  switch (protocol) {
    case 'claude':
      return 'anthropic';
    case 'gemini':
      return 'google';
    case 'ollama':
      return 'ollama';
    default:
      return 'openai';
  }
}

export function canAutoImport(c: ChatClient): boolean {
  if (c.importKind === 'deeplink_import') return !!c.importTemplate;
  if (c.importKind === 'url_settings_import') return !!c.settingsTemplate;
  return false;
}

/** Chatbox 官方 deep link 的 payload */
export function chatboxPayload(key: ApiKeyItem, secret: string): { apiHost: string; apiKey: string; name: string } {
  return { apiHost: apiHostFor(key), apiKey: secret, name: key.label };
}

/** LobeChat 官方 URL 分享配置的 payload */
export function lobeSettingsPayload(key: ApiKeyItem, secret: string): Record<string, any> {
  const provider = lobeProviderFor(key.protocol);
  return { keyVaults: { [provider]: { apiKey: secret, baseURL: apiHostFor(key) } } };
}

/** 构造「全自动写入配置」的 URL；做不到时返回 null */
export function buildImportUrl(client: ChatClient, key: ApiKeyItem, secret: string): string | null {
  if (client.importKind === 'deeplink_import' && client.importTemplate) {
    const data = toBase64(JSON.stringify(chatboxPayload(key, secret)));
    return client.importTemplate
      .replace('{type}', chatboxTypeFor(key.protocol))
      .replace('{data}', encodeURIComponent(data));
  }
  if (client.importKind === 'url_settings_import' && client.settingsTemplate) {
    const base = normalizeUrl(client.settingsBase || 'https://chat.lobehub.com');
    const json = encodeURIComponent(JSON.stringify(lobeSettingsPayload(key, secret)));
    return client.settingsTemplate.replace('{base}', base).replace('{json}', json);
  }
  return null;
}

/** 构造「仅拉起」的 URL */
export function buildLaunchUrl(client: ChatClient): string | null {
  if (client.launchTemplate) return client.launchTemplate.replace('{scheme}', client.scheme || '');
  return client.scheme ? `${client.scheme}://` : null;
}

/*
 * 协议出处：
 *  - Chatbox  docs.chatboxai.app《导入第三方提供方配置》(v1.15.1+)
 *  - LobeChat lobehub 官方博客《通过 URL 链接分享配置参数》：?settings={"keyVaults":{...}}
 */