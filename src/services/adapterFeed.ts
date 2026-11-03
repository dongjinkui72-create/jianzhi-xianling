import { normalizeUrl } from '../lib/normalize';
import type { ChatClient, DetectStatus, ImportKind } from '../lib/types';

/**
 * 远程适配器清单。
 *
 * 为什么需要它：市面上的 AI 聊天软件（尤其 GitHub 上的开源项目） constantly 在变，
 * 把「导入协议」做成数据而不是代码，新增一个软件就不用发新版 App。
 * 清单本身是公开情报，匿名可读，不含任何私有数据 —— 符合数据分层红线。
 *
 * 清单 JSON 格式：
 * {
 *   "adapters": [
 *     {
 *       "id": "chatbox",
 *       "name": "Chatbox",
 *       "scheme": "chatbox",
 *       "androidPackage": "ai.chatbox",
 *       "iosBundleId": null,
 *       "importKind": "deeplink_import",
 *       "importTemplate": "chatbox://app/import-config?type={type}&data={data}",
 *       "settingsTemplate": null,
 *       "settingsBase": null,
 *       "launchTemplate": null,
 *       "browserBased": false,
 *       "platform": "all",
 *       "note": "可选的诚实说明"
 *     }
 *   ]
 * }
 */

/** 官方适配器清单：仓库上传后，新软件的导入协议不用发版就能生效 */
export const OFFICIAL_ADAPTER_FEED =
  'https://raw.githubusercontent.com/dongjinkui72-create/jianzhi-xianling/main/adapters/clients.json';

const VALID_KINDS: ImportKind[] = ['deeplink_import', 'url_settings_import', 'launch_only', 'unconfirmed'];

export interface AdapterFeedResult {
  adapters: ChatClient[];
  notes: string[];
}

export async function fetchAdapters(urls: string[]): Promise<AdapterFeedResult> {
  const adapters: ChatClient[] = [];
  const notes: string[] = [];

  for (const rawUrl of urls) {
    const url = normalizeUrl(rawUrl);
    if (!/^https?:\/\//i.test(url)) {
      notes.push(`适配器源 ${rawUrl} 不是合法 http(s) 地址，已跳过`);
      continue;
    }
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
      const res = await fetch(url, { signal: ctrl.signal as any });
      if (!res.ok) {
        notes.push(`适配器源 ${url} 返回 HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const arr: any[] = Array.isArray(json) ? json : Array.isArray(json?.adapters) ? json.adapters : [];
      let okCount = 0;
      for (const it of arr) {
        const parsed = parseAdapter(it);
        if (!parsed) continue;
        adapters.push(parsed);
        okCount++;
      }
      notes.push(`适配器源 ${url}：解析出 ${okCount} 条`);
    } catch (e: any) {
      notes.push(`适配器源 ${url} 拉取失败：${e?.message || e}`);
    } finally {
      clearTimeout(timer);
    }
  }

  return { adapters, notes };
}

function parseAdapter(it: any): ChatClient | null {
  if (!it || typeof it !== 'object') return null;
  const id = String(it.id || '').trim();
  const name = String(it.name || '').trim();
  const kind = String(it.importKind || '') as ImportKind;
  if (!id || !name || !VALID_KINDS.includes(kind)) return null;

  const importTemplate = typeof it.importTemplate === 'string' && it.importTemplate ? it.importTemplate : undefined;
  const settingsTemplate = typeof it.settingsTemplate === 'string' && it.settingsTemplate ? it.settingsTemplate : undefined;
  if (kind === 'deeplink_import' && !importTemplate) return null;
  if (kind === 'url_settings_import' && !settingsTemplate) return null;

  return {
    id,
    name,
    scheme: typeof it.scheme === 'string' && it.scheme ? it.scheme : null,
    androidPackage: typeof it.androidPackage === 'string' && it.androidPackage ? it.androidPackage : null,
    iosBundleId: typeof it.iosBundleId === 'string' && it.iosBundleId ? it.iosBundleId : null,
    importKind: kind,
    importTemplate,
    settingsTemplate,
    settingsBase: typeof it.settingsBase === 'string' && it.settingsBase ? it.settingsBase : undefined,
    launchTemplate: typeof it.launchTemplate === 'string' && it.launchTemplate ? it.launchTemplate : undefined,
    browserBased: !!it.browserBased,
    note: typeof it.note === 'string' && it.note ? it.note : undefined,
    platform: it.platform === 'android' || it.platform === 'ios' ? it.platform : 'all',
    builtin: false,
    detected: 'unknown' as DetectStatus,
    detectReason: '来自远程适配器清单，未做本机扫描',
    addedAt: Date.now(),
    source: 'feed',
  };
}