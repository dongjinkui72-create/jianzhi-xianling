import type { ChatClient } from '../lib/types';

/**
 * 市面主流 AI 聊天软件登记表。
 *
 * importKind 的含义（产品红线：做不到就如实标注，绝不谎报）：
 *  - deeplink_import：目标 App 官方提供 deep link 可直写提供方配置，
 *                     能做到「点一下启动 → 密钥与调用地址全自动导入 → 用户零复制粘贴」。
 *  - launch_only    ：只能拉起 App，无法自动写入配置，UI 必须明说。
 *  - unconfirmed    ：协议未收录 / 原生壳白名单拿不到，UI 标「无法确认」。
 *
 * Chatbox 的 deep link 来自其官方文档《导入第三方提供方配置》（自 v1.15.1 起支持）：
 *   chatbox://app/import-config?type=<TYPE>&data=<BASE64(JSON)>
 *   JSON: { "apiHost": "...", "apiKey": "...", "name": "可选" }
 *   TYPE: openai_compatible / openai_response / gemini / claude / ollama / lmstudio
 */

export const CHATBOX_IMPORT_TEMPLATE = 'chatbox://app/import-config?type={type}&data={data}';

type Seed = Omit<ChatClient, 'builtin' | 'detected' | 'detectReason' | 'addedAt'>;

export const CHAT_APP_REGISTRY: Seed[] = [
  {
    id: 'chatbox',
    name: 'Chatbox',
    scheme: 'chatbox',
    androidPackage: 'ai.chatbox',
    iosBundleId: 'ai.chatbox.desktop',
    importKind: 'deeplink_import',
    importTemplate: CHATBOX_IMPORT_TEMPLATE,
    platform: 'all',
  },
  {
    id: 'chatbox-desktop',
    name: 'Chatbox（桌面包名）',
    scheme: 'chatbox',
    androidPackage: 'ai.chatbox.desktop',
    iosBundleId: null,
    importKind: 'deeplink_import',
    importTemplate: CHATBOX_IMPORT_TEMPLATE,
    platform: 'android',
  },
  {
    id: 'lobechat',
    name: 'LobeChat',
    scheme: 'lobehub',
    androidPackage: 'com.lobehub.app',
    iosBundleId: 'com.lobehub.app',
    importKind: 'unconfirmed',
    platform: 'all',
  },
  {
    id: 'nextchat',
    name: 'NextChat',
    scheme: 'nextchat',
    androidPackage: 'com.github.yidadaa.chatgptnextweb',
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
  },
  {
    id: 'opencat',
    name: 'OpenCat',
    scheme: 'opencat',
    androidPackage: null,
    iosBundleId: 'tech.baye.opencat',
    importKind: 'unconfirmed',
    platform: 'ios',
  },
  {
    id: 'cherrystudio',
    name: 'Cherry Studio',
    scheme: 'cherrystudio',
    androidPackage: 'com.cherryai.studio',
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'android',
  },
  {
    id: 'chatwise',
    name: 'ChatWise',
    scheme: 'chatwise',
    androidPackage: 'com.chatwise.android',
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
  },
  {
    id: 'boltai',
    name: 'BoltAI',
    scheme: 'boltai',
    androidPackage: 'com.boltai.android',
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT 官方',
    scheme: 'chatgpt',
    androidPackage: 'com.openai.chatgpt',
    iosBundleId: 'com.openai.chat',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'claude',
    name: 'Claude 官方',
    scheme: 'claude',
    androidPackage: 'com.anthropic.claude',
    iosBundleId: 'com.anthropic.cloude',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'gemini',
    name: 'Gemini 官方',
    scheme: 'gemini',
    androidPackage: 'com.google.android.apps.bard',
    iosBundleId: 'com.google.Gemini',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    scheme: 'deepseek',
    androidPackage: 'com.deepseek.chat',
    iosBundleId: 'com.deepseek.deepseek.chat',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    scheme: 'kimi',
    androidPackage: 'com.moonshot.kimichat',
    iosBundleId: 'com.moonshot.kimi',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'doubao',
    name: '豆包',
    scheme: null,
    androidPackage: 'com.larus.nova',
    iosBundleId: 'com.larus.nova',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'tongyi',
    name: '通义',
    scheme: 'tongyi',
    androidPackage: 'com.aliyun.tongyi',
    iosBundleId: 'com.alibaba.tongyi',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'yuanbao',
    name: '腾讯元宝',
    scheme: 'yuanbao',
    androidPackage: 'com.tencent.hunyuan.app.chat',
    iosBundleId: 'com.tencent.hunyuan',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'grok',
    name: 'Grok',
    scheme: 'grok',
    androidPackage: 'ai.x.grok',
    iosBundleId: 'ai.x.grok',
    importKind: 'launch_only',
    platform: 'all',
  },
  {
    id: 'poe',
    name: 'Poe',
    scheme: 'poe',
    androidPackage: 'com.poe.android',
    iosBundleId: 'com.quora.poe',
    importKind: 'launch_only',
    platform: 'all',
  },
];

/** 具备「全自动导入」能力的客户端（核心功能②的真正落点） */
export function autoImportCapable(c: ChatClient): boolean {
  return c.importKind === 'deeplink_import' && !!c.importTemplate;
}

/** 默认推荐：优先能全自动导入的（Chatbox） */
export function preferredAutoClient(clients: ChatClient[]): ChatClient | null {
  return clients.find((c) => autoImportCapable(c) && c.detected !== 'not_installed') ?? null;
}

export const CLIENT_SEEDS = CHAT_APP_REGISTRY;