/** 全局共享类型定义 */

/** 情报分区：产品红线 —— 雷达站只保留「官方」和「中转站」两个分区，不再有分组筛选条 */
export type RadarSection = 'official' | 'relay';

export type Confidence = 'verified' | 'likely' | 'unconfirmed';

export interface Benefit {
  id: string;
  section: RadarSection;
  provider: string;
  title: string;
  summary: string;
  /** 原始额度文案，例如 "新用户赠送 $5" */
  quotaText: string;
  /** 归一化后的额度（token 数），无法归一化时为 null */
  quotaTokens: number | null;
  /** 归一化后的额度（美元），无法归一化时为 null */
  quotaUsd: number | null;
  validUntil: string | null;
  url: string;
  /** 「怎么领」的步骤 */
  steps: string[];
  /** 命中关键词，中转站情报固定含 api */
  keywords: string[];
  sourceUrl: string;
  fetchedAt: number;
  confidence: Confidence;
  /** 数据出处：内置种子 / 在线抓取 */
  origin: 'seed' | 'live';
  /** 实抓证据（原始句子），抓不到时如实写明原因，绝不伪造 */
  evidence: string | null;
}

/** 中转站（API Relay）站点档位类型 */
export type RelayKind = 'new-api' | 'one-api' | 'veloera' | 'unknown';

export type CapabilityState = 'yes' | 'no' | 'unknown';

export interface Relay {
  id: string;
  name: string;
  baseUrl: string;
  kind: RelayKind;
  /** 站点用户 ID（New API 的 New-Api-User 头） */
  userId: number | null;
  username: string | null;
  /** SecureStore 中系统访问令牌的引用名 */
  accessTokenRef: string | null;
  /** SecureStore 中账号密码的引用名（访问令牌拿不到时的兜底） */
  credentialRef: string | null;
  hasSession: boolean;
  /** 该站点是否支持自动签到：yes / no / unknown（无法确认，绝不谎报） */
  checkinSupport: CapabilityState;
  checkinSupportNote: string | null;
  /** 自动建档 API Key 的能力：yes / no / unknown */
  autoKeySupport: CapabilityState;
  autoKeyNote: string | null;
  /** 实际可用的 API 根地址（探针嗅探出来，可能与站点首页不同域/不同前缀） */
  apiBase: string | null;
  /** 签到方式：api 接口签到 / dom 网页按钮签到 */
  checkinMode: 'api' | 'dom' | null;
  quota: number | null;
  usedQuota: number | null;
  remainingUsd: number | null;
  /** 估算剩余 token 数 */
  remainingTokens: number | null;
  lastSyncAt: number | null;
  lastCheckinAt: number | null;
  note: string | null;
  builtin: boolean;
  createdAt: number;
}

export type KeyStatus = 'unknown' | 'ok' | 'low' | 'dead';

export type ApiProtocol = 'openai_compatible' | 'openai_response' | 'gemini' | 'claude' | 'ollama' | 'lmstudio';

export interface ApiKeyItem {
  id: string;
  relayId: string | null;
  label: string;
  /** 数据库里只存掩码，真实 Key 在 SecureStore */
  maskedKey: string;
  /** SecureStore 引用名 */
  secretRef: string;
  baseUrl: string;
  provider: string;
  protocol: ApiProtocol;
  status: KeyStatus;
  remainingTokens: number | null;
  remainingUsd: number | null;
  statusNote: string | null;
  checkedAt: number | null;
  source: 'auto' | 'manual';
  createdAt: number;
}

export interface CheckinLog {
  id: string;
  relayId: string;
  relayName: string;
  at: number;
  /** success / failed / manual_only / unconfirmed */
  result: 'success' | 'failed' | 'manual_only' | 'unconfirmed';
  message: string;
  gainedUsd: number | null;
}

/**
 * AI 聊天软件的自动导入能力（适配器类型）。
 * 红线：做不到就如实标注，绝不谎报「已导入」。
 */
export type ImportKind =
  /** 目标 App 官方 deep link 直写提供方配置（Chatbox），全自动、零复制粘贴 */
  | 'deeplink_import'
  /** 通过 URL 参数把配置写进目标 App 的网页版 / PWA / 桌面版（LobeChat） */
  | 'url_settings_import'
  /** 只能拉起 App（可带模型/消息参数），无法写入密钥 */
  | 'launch_only'
  /** 协议未收录或参数结构未核实，UI 标「无法确认」 */
  | 'unconfirmed';

export type DetectStatus = 'installed' | 'not_installed' | 'unknown';

export interface ChatClient {
  id: string;
  name: string;
  scheme: string | null;
  androidPackage: string | null;
  iosBundleId: string | null;
  importKind: ImportKind;
  /** deeplink_import 的 URL 模板，{type} 与 {data} 会被替换 */
  importTemplate?: string;
  /** url_settings_import 的 URL 模板，{base} 与 {json} 会被替换 */
  settingsTemplate?: string;
  /** url_settings_import 的默认站点地址（可在设置里改） */
  settingsBase?: string;
  /** launch_only 的拉起模板，默认 {scheme}:// */
  launchTemplate?: string;
  /** 走浏览器/网页版，无需安装检测 */
  browserBased?: boolean;
  /** 如实说明该适配器的能力边界 */
  note?: string;
  platform: 'all' | 'android' | 'ios';
  builtin: boolean;
  detected: DetectStatus;
  detectReason: string | null;
  addedAt: number;
  /** 适配器来源：内置 / 远程清单 / 用户自建 */
  source: 'builtin' | 'feed' | 'custom' | 'auto';
}

export interface AppSettings {
  /** 可用池预警阈值：剩余 token 低于该值静默标红移入预警区 */
  lowTokenThreshold: number;
  /** 预警阈值（美元口径），二者取其一命中即预警 */
  lowUsdThreshold: number;
  /** 启动按钮默认拉起的聊天软件 id，null 表示每次询问 */
  preferredClientId: string | null;
  /** 多个软件时是否总是让用户自选 */
  alwaysAskClient: boolean;
  /** 情报源（可追加） */
  feedUrls: string[];
  /** 聊天软件适配器清单（远程，可追加；GitHub 上的开源软件靠它扩展） */
  adapterFeedUrls: string[];
  /** 自动体检 */
  autoHealthCheck: boolean;
  lastRadarFetchAt: number | null;
  lastAdapterFetchAt: number | null;
  /** 已读通告的版本号 */
  announcementSeen: string | null;
  /** 主题：crystal 水晶白玻璃 / dark 黑夜玻璃 */
  theme: 'crystal' | 'dark';
}