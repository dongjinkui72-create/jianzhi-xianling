import type { ChatClient } from '../lib/types';

/**
 * 市面 AI 聊天软件适配器登记表（数据驱动）。
 *
 * 每种软件一条适配器，importKind 决定启动按钮的行为：
 *  - deeplink_import     目标 App 官方 deep link 直写提供方配置，全自动、零复制粘贴
 *  - url_settings_import 通过 URL 参数把配置写进目标 App 的网页版 / PWA / 桌面版
 *  - launch_only         只能拉起（可带模型/消息参数），无法写入密钥，UI 明说
 *  - unconfirmed         协议未收录或参数结构未核实，UI 标「无法确认」，绝不贸然发送
 *
 * 已核实来源：
 *  - Chatbox     官方文档《导入第三方提供方配置》(v1.15.1+)：
 *                chatbox://app/import-config?type=<TYPE>&data=<BASE64(JSON{apiHost,apiKey,name?})>
 *  - LobeChat    官方博客《通过 URL 链接分享配置参数》：
 *                {base}/?settings=<URL_ENCODED JSON{keyVaults:{<provider>:{apiKey,baseURL}}}>
 *  - DeepChat    官方 wiki《DeepLinks》：只有 deepchat://start 与 deepchat://mcp/install，
 *                没有写入 API 密钥的协议 -> 如实标 launch_only
 *  - Cherry Studio 已知入口 cherrystudio://providers/api-keys?v=1&data=...，
 *                但 data 的参数结构未能从源码核实 -> 如实标 unconfirmed，不贸然发送
 *
 * 长尾软件（尤其 GitHub 上的开源项目）通过「远程适配器清单」扩展，
 * 无需发新版 App：见 src/services/adapterFeed.ts 与设置页。
 */

export const CHATBOX_IMPORT_TEMPLATE = 'chatbox://app/import-config?type={type}&data={data}';
export const LOBE_SETTINGS_TEMPLATE = '{base}/?settings={json}';

type Seed = Omit<ChatClient, 'builtin' | 'detected' | 'detectReason' | 'addedAt' | 'source'>;

export const CHAT_APP_REGISTRY: Seed[] = [
  /* ---------- 可全自动导入 ---------- */
  {
    id: 'chatbox',
    name: 'Chatbox',
    scheme: 'chatbox',
    androidPackage: 'ai.chatbox',
    iosBundleId: 'ai.chatbox.desktop',
    importKind: 'deeplink_import',
    importTemplate: CHATBOX_IMPORT_TEMPLATE,
    platform: 'all',
    note: '官方 deep link 直写提供方配置，密钥不经剪贴板',
  },
  {
    id: 'lobechat',
    name: 'LobeChat（网页版 / PWA / 桌面版）',
    scheme: 'lobehub',
    androidPackage: null,
    iosBundleId: null,
    importKind: 'url_settings_import',
    settingsTemplate: LOBE_SETTINGS_TEMPLATE,
    settingsBase: 'https://chat.lobehub.com',
    browserBased: true,
    platform: 'all',
    note: '通过 URL 参数写入 keyVaults；自建实例请在「设置 → 适配器」里改 base 地址',
  },

  /* ---------- 只能拉起 ---------- */
  {
    id: 'deepchat',
    name: 'DeepChat（开源）',
    scheme: 'deepchat',
    androidPackage: null,
    iosBundleId: null,
    importKind: 'launch_only',
    launchTemplate: 'deepchat://start',
    platform: 'all',
    note: '官方 DeepLinks 只支持开始聊天 / 安装 MCP，没有写入 API 密钥的协议',
  },
  {
    id: 'chatgpt',
    name: 'ChatGPT 官方',
    scheme: 'chatgpt',
    androidPackage: 'com.openai.chatgpt',
    iosBundleId: 'com.openai.chat',
    importKind: 'launch_only',
    platform: 'all',
    note: '官方 App 不接受第三方密钥导入',
  },
  {
    id: 'claude',
    name: 'Claude 官方',
    scheme: 'claude',
    androidPackage: 'com.anthropic.claude',
    iosBundleId: 'com.anthropic.cloude',
    importKind: 'launch_only',
    platform: 'all',
    note: '官方 App 不接受第三方密钥导入',
  },
  {
    id: 'gemini',
    name: 'Gemini 官方',
    scheme: 'gemini',
    androidPackage: 'com.google.android.apps.bard',
    iosBundleId: 'com.google.Gemini',
    importKind: 'launch_only',
    platform: 'all',
    note: '官方 App 不接受第三方密钥导入',
  },
  {
    id: 'deepseek',
    name: 'DeepSeek 官方',
    scheme: 'deepseek',
    androidPackage: 'com.deepseek.chat',
    iosBundleId: 'com.deepseek.deepseek.chat',
    importKind: 'launch_only',
    platform: 'all',
    note: '官方 App 不接受第三方密钥导入',
  },
  {
    id: 'kimi',
    name: 'Kimi',
    scheme: 'kimi',
    androidPackage: 'com.moonshot.kimichat',
    iosBundleId: 'com.moonshot.kimi',
    importKind: 'launch_only',
    platform: 'all',
    note: '未公开密钥导入协议',
  },
  {
    id: 'doubao',
    name: '豆包',
    scheme: null,
    androidPackage: 'com.larus.nova',
    iosBundleId: 'com.larus.nova',
    importKind: 'launch_only',
    platform: 'all',
    note: '未公开 URL Scheme 与密钥导入协议',
  },
  {
    id: 'tongyi',
    name: '通义',
    scheme: 'tongyi',
    androidPackage: 'com.aliyun.tongyi',
    iosBundleId: 'com.alibaba.tongyi',
    importKind: 'launch_only',
    platform: 'all',
    note: '未公开密钥导入协议',
  },
  {
    id: 'yuanbao',
    name: '腾讯元宝',
    scheme: 'yuanbao',
    androidPackage: 'com.tencent.hunyuan.app.chat',
    iosBundleId: 'com.tencent.hunyuan',
    importKind: 'launch_only',
    platform: 'all',
    note: '未公开密钥导入协议',
  },
  {
    id: 'grok',
    name: 'Grok',
    scheme: 'grok',
    androidPackage: 'ai.x.grok',
    iosBundleId: 'ai.x.grok',
    importKind: 'launch_only',
    platform: 'all',
    note: '未公开密钥导入协议',
  },
  {
    id: 'poe',
    name: 'Poe',
    scheme: 'poe',
    androidPackage: 'com.poe.android',
    iosBundleId: 'com.quora.poe',
    importKind: 'launch_only',
    platform: 'all',
    note: '未公开密钥导入协议',
  },

  /* ---------- 协议存在但参数未核实：如实标「无法确认」 ---------- */
  {
    id: 'cherrystudio',
    name: 'Cherry Studio（开源）',
    scheme: 'cherrystudio',
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
    note: '已发现 cherrystudio://providers/api-keys?v=1&data=... 入口，但 data 参数结构未能从源码核实，App 不贸然发送；可用远程适配器清单补上确切格式',
  },
  {
    id: 'nextchat',
    name: 'NextChat（开源）',
    scheme: null,
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
    note: 'NextChat 的配置导入走「设置页导入 JSON 文件」，没有可自动化的对外协议',
  },
  {
    id: 'chatwise',
    name: 'ChatWise（开源）',
    scheme: 'chatwise',
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
    note: '未核实到可自动写入密钥的协议',
  },
  {
    id: 'opencat',
    name: 'OpenCat',
    scheme: 'opencat',
    androidPackage: null,
    iosBundleId: 'tech.baye.opencat',
    importKind: 'unconfirmed',
    platform: 'ios',
    note: '未核实到可自动写入密钥的协议',
  },

  /* ---------- 开源 tavern 系 / 其它接受自定义端点但无对外导入协议的客户端：悬浮窗凭证层兜底 ---------- */
  {
    id: 'sillytavern',
    name: 'SillyTavern（tavern）',
    scheme: null,
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    browserBased: true,
    platform: 'all',
    note: '开源 Web UI，设置里可填自定义端点但没有对外导入协议；启动后由悬浮窗凭证层把地址与密钥送到它界面上',
  },
  {
    id: 'tauritavern',
    name: 'TauriTavern（tauritavern）',
    scheme: 'tauritavern',
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
    note: 'Tauri 桌面客户端，无对外导入协议；启动后由悬浮窗凭证层兜底',
  },
  {
    id: 'risuai',
    name: 'RisuAI（开源恋爱/角色聊天）',
    scheme: null,
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
    note: '开源恋爱/角色聊天客户端，设置里可填自定义端点但无对外导入协议；启动后由悬浮窗凭证层兜底',
  },
  {
    id: 'chatterui',
    name: 'ChatterUI（开源）',
    scheme: null,
    androidPackage: null,
    iosBundleId: null,
    importKind: 'unconfirmed',
    platform: 'all',
    note: '开源 Android 客户端，设置里可填端点但无对外协议；悬浮窗凭证层兜底',
  },
];

/** 具备「全自动写入配置」能力的适配器 */
export function autoImportCapable(c: ChatClient): boolean {
  return (c.importKind === 'deeplink_import' && !!c.importTemplate) || (c.importKind === 'url_settings_import' && !!c.settingsTemplate);
}

/** 默认推荐：优先能全自动导入的 */
export function preferredAutoClient(clients: ChatClient[]): ChatClient | null {
  return clients.find((c) => autoImportCapable(c) && c.detected !== 'not_installed') ?? null;
}

export const CLIENT_SEEDS = CHAT_APP_REGISTRY;