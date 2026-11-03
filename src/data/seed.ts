import { parseQuota } from '../lib/normalize';
import type { Benefit, Confidence, RadarSection } from '../lib/types';

/**
 * 内置情报种子库（离线兜底）。
 *
 * 为什么要内置：App 冷启动、断网、或厂商页面结构变化时，
 * 雷达站也必须「中转站分区 ≥ 5 条内容」，不能白屏。
 *
 * 所有条目都带 confidence：
 *  - verified   已核实（官方长期稳定政策）
 *  - likely     大概率有效，以官网实时页为准
 *  - unconfirmed 无法确认（政策常变 / 需登录才可见），绝不谎报
 */

interface SeedBenefit {
  id: string;
  section: RadarSection;
  provider: string;
  title: string;
  summary: string;
  quotaText: string;
  validUntil: string | null;
  url: string;
  steps: string[];
  keywords: string[];
  confidence: Confidence;
  /** 雷达站每日自动巡检的目标页 */
  probeUrl: string;
}

export const SEED_BENEFITS: SeedBenefit[] = [
  /* ==================== 官方 ==================== */
  {
    id: 'off-google-aistudio',
    section: 'official',
    provider: 'Google AI Studio',
    title: 'Gemini API 免费层长期可用',
    summary: '登录 Google 账号即可直接创建 API Key，免费层有速率限制但长期开放，适合日常薅。',
    quotaText: '免费层 每日免费调用额度',
    validUntil: '长期',
    url: 'https://aistudio.google.com/apikey',
    steps: [
      '打开 aistudio.google.com 并登录 Google 账号',
      '点左侧「Get API key / 获取 API 密钥」',
      '点「Create API key」，选中一个 Google Cloud 项目（没有会自动建）',
      '复制生成的 Key，回到本 App「中转站 → 手动粘贴」建档',
      '调用地址填 https://generativelanguage.googleapis.com/v1beta',
    ],
    keywords: ['api', 'gemini', 'free tier'],
    confidence: 'verified',
    probeUrl: 'https://ai.google.dev/gemini-api/docs/pricing',
  },
  {
    id: 'off-openai',
    section: 'official',
    provider: 'OpenAI',
    title: '新用户赠送额度（政策多变，需实时核对）',
    summary:
      'OpenAI 早期对新账号赠送 $5 / $18 试用额度，现已多次调整。当前多数新账号需绑卡后按量计费，是否仍有赠送以官网定价页为准。',
    quotaText: '新用户赠送 $5 试用额度（历史政策，可能已取消）',
    validUntil: '以官网为准',
    url: 'https://platform.openai.com/docs/pricing',
    steps: [
      '打开 platform.openai.com 注册并登录',
      '进入 Settings → Billing，查看是否出现「Free trial credit」提示',
      '若出现赠送额度，直接在 API keys 页 Create new secret key',
      '若没有赠送提示，说明当前账号无免费额度，请勿轻信第三方代充',
      '调用地址 https://api.openai.com/v1',
    ],
    keywords: ['api', 'free trial credit'],
    confidence: 'unconfirmed',
    probeUrl: 'https://platform.openai.com/docs/pricing',
  },
  {
    id: 'off-siliconflow',
    section: 'official',
    provider: '硅基流动 SiliconFlow',
    title: '注册赠送免费额度 + 多款模型长期免费',
    summary: '国内可直连，注册后账户自带赠送额度，另有一批开源模型标注为「免费」，零成本跑通。',
    quotaText: '注册赠送 ¥14 免费额度',
    validUntil: '以控制台余额为准',
    url: 'https://cloud.siliconflow.cn/',
    steps: [
      '打开 cloud.siliconflow.cn 用手机号注册',
      '进入控制台 → 账户信息，确认赠送额度已到账',
      '左侧「API 密钥」→ 新建 API 密钥，复制保存',
      '回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://api.siliconflow.cn/v1',
    ],
    keywords: ['api', '免费额度', '赠送'],
    confidence: 'likely',
    probeUrl: 'https://siliconflow.cn/zh-cn/pricing',
  },
  {
    id: 'off-zhipu',
    section: 'official',
    provider: '智谱 AI 开放平台',
    title: 'GLM 系列含免费模型 + 新用户赠送额度',
    summary: 'bigmodel.cn 注册后可领新用户赠送额度，Flash 系列长期免费调用。',
    quotaText: '新用户赠送免费额度',
    validUntil: '以控制台为准',
    url: 'https://bigmodel.cn/',
    steps: [
      '打开 bigmodel.cn 注册并完成手机号验证',
      '进入「控制台 → 账户总览」查看赠送额度',
      '「API Keys」页新建密钥并复制',
      '回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://open.bigmodel.cn/api/paas/v4',
    ],
    keywords: ['api', '免费', '赠送'],
    confidence: 'likely',
    probeUrl: 'https://bigmodel.cn/pricing',
  },
  {
    id: 'off-aliyun-bailian',
    section: 'official',
    provider: '阿里云百炼',
    title: '新用户各模型百万级 tokens 免费额度',
    summary: '阿里云百炼对新开通用户按模型发放免费额度，通义千问系列可直接白嫖一段时间。',
    quotaText: '新用户赠送 1000000 tokens 免费额度',
    validUntil: '开通后 180 天',
    url: 'https://bailian.console.aliyun.com/',
    steps: [
      '用阿里云账号登录 bailian.console.aliyun.com',
      '首次进入会提示开通「模型服务灵积」，勾选同意开通',
      '在「费用与额度」页确认各模型的免费额度已发放',
      '「API-KEY 管理」→ 创建我的 API-KEY 并复制',
      '调用地址 https://dashscope.aliyuncs.com/compatible-mode/v1',
    ],
    keywords: ['api', '免费额度', 'tokens'],
    confidence: 'likely',
    probeUrl: 'https://help.aliyun.com/zh/model-studio/models',
  },
  {
    id: 'off-deepseek',
    section: 'official',
    provider: 'DeepSeek',
    title: '注册赠少量余额，价格常年极低',
    summary: 'DeepSeek 开放平台注册后偶发赠送少量余额；即便无赠送，单价也低到几乎可以忽略。',
    quotaText: '注册赠送 ¥5 余额（以实际到账为准）',
    validUntil: '以控制台为准',
    url: 'https://platform.deepseek.com/',
    steps: [
      '打开 platform.deepseek.com 注册登录',
      '进入「余额」页查看是否有赠送余额',
      '「API keys」→ 创建 API key 并复制',
      '回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://api.deepseek.com/v1',
    ],
    keywords: ['api', '赠送', '余额'],
    confidence: 'unconfirmed',
    probeUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing',
  },
  {
    id: 'off-groq',
    section: 'official',
    provider: 'Groq',
    title: '免费层高速推理，无需信用卡',
    summary: 'Groq 免费层给足日常用量，Llama / Qwen 系列推理速度极快，注册即拿 Key。',
    quotaText: '免费层 每日免费调用额度',
    validUntil: '长期',
    url: 'https://console.groq.com/keys',
    steps: [
      '打开 console.groq.com 用 Google / GitHub 登录',
      '左侧「API Keys」→ Create API Key',
      '复制 Key（只显示一次）',
      '回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://api.groq.com/openai/v1',
    ],
    keywords: ['api', 'free tier'],
    confidence: 'verified',
    probeUrl: 'https://groq.com/pricing',
  },
  {
    id: 'off-openrouter',
    section: 'official',
    provider: 'OpenRouter',
    title: '一批 :free 后缀模型零成本调用',
    summary: 'OpenRouter 上带 :free 后缀的模型不扣费，每天有请求数上限，一个 Key 打遍全网模型。',
    quotaText: '免费模型 每日免费请求额度',
    validUntil: '长期',
    url: 'https://openrouter.ai/models?max_price=0',
    steps: [
      '打开 openrouter.ai 注册登录',
      '在 Models 页把 Max price 拉到 0，筛出全部免费模型',
      '右上头像 → Keys → Create Key，复制保存',
      '回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://openrouter.ai/api/v1，模型名带 :free 后缀',
    ],
    keywords: ['api', 'free'],
    confidence: 'verified',
    probeUrl: 'https://openrouter.ai/docs/api-reference/limits',
  },
  {
    id: 'off-mistral',
    section: 'official',
    provider: 'Mistral AI',
    title: 'La Plateforme 免费实验层',
    summary: 'Mistral 免费实验层可直接调用自家模型，有速率限制，注册即拿 Key。',
    quotaText: '免费实验层 免费调用额度',
    validUntil: '长期',
    url: 'https://console.mistral.ai/',
    steps: [
      '打开 console.mistral.ai 注册登录',
      '进入 API Keys 页面创建密钥',
      '复制 Key 并回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://api.mistral.ai/v1',
    ],
    keywords: ['api', 'free'],
    confidence: 'likely',
    probeUrl: 'https://mistral.ai/products/la-plateforme#pricing',
  },
  {
    id: 'off-cloudflare-wai',
    section: 'official',
    provider: 'Cloudflare Workers AI',
    title: '每日免费 neurons 额度',
    summary: '有 Cloudflare 账号就能用，每天发放免费算力额度，OpenAI 兼容接口。',
    quotaText: '每日赠送 10000 neurons 免费额度',
    validUntil: '每日刷新',
    url: 'https://dash.cloudflare.com/?to=/:account/workers-ai',
    steps: [
      '登录 dash.cloudflare.com',
      '左侧进入 Workers AI，首次使用点 Enable',
      '在「API Tokens」创建 Token（权限选 Workers AI: Edit）',
      '复制 Account ID 与 Token，回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://api.cloudflare.com/client/v4/accounts/{AccountID}/ai/v1',
    ],
    keywords: ['api', '免费额度'],
    confidence: 'likely',
    probeUrl: 'https://developers.cloudflare.com/workers-ai/platform/pricing/',
  },

  /* ==================== 中转站（关键词：api） ==================== */
  {
    id: 'relay-302ai',
    section: 'relay',
    provider: '302.AI',
    title: '一站式 API 超市，注册即送试用额度',
    summary: '聚合了主流模型的 API 中转站，注册后可在控制台看到赠送的试用额度，按量扣费。',
    quotaText: '注册赠送 $1 试用额度',
    validUntil: '以控制台为准',
    url: 'https://302.ai/',
    steps: [
      '打开 302.ai 注册账号（邮箱或第三方登录）',
      '进入控制台首页，确认赠送额度已到账',
      '左侧「API」→ 创建新的 API Key',
      '复制 Key，回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://api.302.ai/v1',
    ],
    keywords: ['api', '中转', '赠送'],
    confidence: 'likely',
    probeUrl: 'https://302.ai/pricing/',
  },
  {
    id: 'relay-aihubmix',
    section: 'relay',
    provider: 'AIHubMix',
    title: 'API 中转站，新号注册赠送体验额度',
    summary: 'New API 架构的中转站，支持在 App 内 WebView 登录后自动建档 API Key。',
    quotaText: '注册赠送 $1 体验额度',
    validUntil: '以控制台为准',
    url: 'https://aihubmix.com/',
    steps: [
      '打开 aihubmix.com 注册并登录',
      '在本 App「中转站」页点该站点，进入内嵌浏览器登录',
      '登录成功后 App 会自动读取登录态并尝试自动创建 API Key',
      '若站点关闭了自动建档，App 会如实提示并给出手动粘贴入口',
      '调用地址 https://aihubmix.com/v1',
    ],
    keywords: ['api', '中转站'],
    confidence: 'unconfirmed',
    probeUrl: 'https://aihubmix.com/',
  },
  {
    id: 'relay-yunwu',
    section: 'relay',
    provider: '云雾 API',
    title: '国内直连 API 中转，注册赠送额度',
    summary: 'New API 架构，支持自动建档；国内网络直连速度快。',
    quotaText: '注册赠送免费额度',
    validUntil: '以控制台为准',
    url: 'https://yunwu.ai/',
    steps: [
      '打开 yunwu.ai 注册账号',
      '在本 App「中转站」页点该站点，用内嵌浏览器登录',
      'App 自动读取登录态 → 自动创建 API Key → 保存到本机',
      '调用地址 https://yunwu.ai/v1',
    ],
    keywords: ['api', '中转'],
    confidence: 'unconfirmed',
    probeUrl: 'https://yunwu.ai/',
  },
  {
    id: 'relay-ohmygpt',
    section: 'relay',
    provider: 'OhMyGPT',
    title: 'API 中转站，注册送试用金',
    summary: 'New API 架构中转站，支持 App 内登录自动建档，充值门槛低。',
    quotaText: '注册赠送 $1 试用额度',
    validUntil: '以控制台为准',
    url: 'https://www.ohmygpt.com/',
    steps: [
      '打开 ohmygpt.com 注册账号',
      '在本 App「中转站」页点该站点进入内嵌浏览器登录',
      '登录成功后 App 自动创建 API Key 并入库',
      '调用地址 https://apiohmygpt.com/v1 或站点首页给出的地址',
    ],
    keywords: ['api', '中转站'],
    confidence: 'unconfirmed',
    probeUrl: 'https://www.ohmygpt.com/',
  },
  {
    id: 'relay-anyrouter',
    section: 'relay',
    provider: 'AnyRouter',
    title: 'New API 架构中转，注册赠额度',
    summary: '标准 New API 站点，本 App 的自动建档 / 自动签到能力对它兼容度最高。',
    quotaText: '注册赠送免费额度',
    validUntil: '以控制台为准',
    url: 'https://anyrouter.top/',
    steps: [
      '打开 anyrouter.top 注册账号',
      '在本 App「中转站」页点该站点，内嵌浏览器登录',
      'App 自动读取登录态、拉取余额、创建 API Key',
      '调用地址 https://anyrouter.top',
    ],
    keywords: ['api', '中转'],
    confidence: 'unconfirmed',
    probeUrl: 'https://anyrouter.top/',
  },
  {
    id: 'relay-laozhang',
    section: 'relay',
    provider: '老张 API',
    title: '老牌 API 中转站，注册送体验额度',
    summary: 'New API 架构，支持自动建档；站点运营时间较长。',
    quotaText: '注册赠送 $1 体验额度',
    validUntil: '以控制台为准',
    url: 'https://laozhang.ai/',
    steps: [
      '打开 laozhang.ai 注册账号',
      '在本 App「中转站」页点该站点进入内嵌浏览器登录',
      'App 自动建档 API Key 并保存到本机加密区',
      '调用地址 https://laozhang.ai/v1',
    ],
    keywords: ['api', '中转站'],
    confidence: 'unconfirmed',
    probeUrl: 'https://laozhang.ai/',
  },
  {
    id: 'relay-147api',
    section: 'relay',
    provider: '147API',
    title: 'API 中转站，新用户赠送额度',
    summary: '标准中转站，支持 OpenAI 兼容协议，可在 App 内登录自动建档。',
    quotaText: '新用户赠送 $1 免费额度',
    validUntil: '以控制台为准',
    url: 'https://www.147api.com/',
    steps: [
      '打开 147api.com 注册账号',
      '在本 App「中转站」页点该站点，内嵌浏览器登录',
      'App 自动创建 API Key；若站点结构不支持会如实提示',
      '调用地址 https://api.147api.com/v1',
    ],
    keywords: ['api', '中转'],
    confidence: 'unconfirmed',
    probeUrl: 'https://www.147api.com/',
  },
  {
    id: 'relay-api2d',
    section: 'relay',
    provider: 'API2D',
    title: 'API 中转，免费额度 + 低价转发',
    summary: '老牌中转站，提供 OpenAI 兼容接口，注册后可领取免费额度。',
    quotaText: '注册赠送免费额度',
    validUntil: '以控制台为准',
    url: 'https://api2d.com/',
    steps: [
      '打开 api2d.com 注册账号',
      '在用户中心领取免费额度',
      '创建 Forward Key 并复制',
      '回到本 App「中转站 → 手动粘贴」建档',
      '调用地址 https://oa.api2d.net/v1',
    ],
    keywords: ['api', '中转站'],
    confidence: 'likely',
    probeUrl: 'https://api2d.com/',
  },
  {
    id: 'relay-gptapi',
    section: 'relay',
    provider: 'GPTAPI.us',
    title: 'API 中转站，注册赠体验额度',
    summary: 'New API 架构中转站，支持 App 内登录自动建档。',
    quotaText: '注册赠送 $0.5 体验额度',
    validUntil: '以控制台为准',
    url: 'https://www.gptapi.us/',
    steps: [
      '打开 gptapi.us 注册账号',
      '在本 App「中转站」页点该站点，内嵌浏览器登录',
      'App 自动读取登录态并创建 API Key',
      '调用地址 https://www.gptapi.us/v1',
    ],
    keywords: ['api', '中转'],
    confidence: 'unconfirmed',
    probeUrl: 'https://www.gptapi.us/',
  },
  {
    id: 'relay-closeai-asia',
    section: 'relay',
    provider: 'CloseAI-asia',
    title: 'API 中转站，注册赠送额度',
    summary: '标准 New API 站点，OpenAI 兼容，支持自动建档与签到探测。',
    quotaText: '注册赠送免费额度',
    validUntil: '以控制台为准',
    url: 'https://api.closeai-asia.com/',
    steps: [
      '打开 closeai-asia.com 注册账号',
      '在本 App「中转站」页点该站点，内嵌浏览器登录',
      'App 自动创建 API Key 并写入本机加密区',
      '调用地址 https://api.closeai-asia.com/v1',
    ],
    keywords: ['api', '中转站'],
    confidence: 'unconfirmed',
    probeUrl: 'https://api.closeai-asia.com/',
  },
  {
    id: 'relay-dukaai',
    section: 'relay',
    provider: 'DukAICloud',
    title: 'API 中转，注册即赠额度',
    summary: 'New API 架构，支持自动建档；对国内网络友好。',
    quotaText: '注册赠送 ¥5 免费额度',
    validUntil: '以控制台为准',
    url: 'https://duk.058151.xyz/',
    steps: [
      '打开站点注册账号',
      '在本 App「中转站」页点该站点，内嵌浏览器登录',
      'App 自动建档 API Key',
      '调用地址以站点控制台给出的为准',
    ],
    keywords: ['api', '中转'],
    confidence: 'unconfirmed',
    probeUrl: 'https://duk.058151.xyz/',
  },
  {
    id: 'relay-tokenapi',
    section: 'relay',
    provider: 'TokenAPI',
    title: 'API 中转站，新用户赠送额度',
    summary: '标准中转站，OpenAI 兼容协议，可自动建档。',
    quotaText: '新用户赠送 $1 免费额度',
    validUntil: '以控制台为准',
    url: 'https://tokenapi.top/',
    steps: [
      '打开站点注册账号',
      '在本 App「中转站」页点该站点，内嵌浏览器登录',
      'App 自动创建 API Key 并入库',
      '调用地址以站点控制台给出的为准',
    ],
    keywords: ['api', '中转站'],
    confidence: 'unconfirmed',
    probeUrl: 'https://tokenapi.top/',
  },
];

/** 内置中转站目录（「中转站」页可直接点进去登录建档） */
export interface SeedRelay {
  name: string;
  baseUrl: string;
  kind: 'new-api' | 'one-api' | 'unknown';
  note: string;
}

export const SEED_RELAYS: SeedRelay[] = [
  { name: '302.AI', baseUrl: 'https://302.ai', kind: 'unknown', note: '聚合超市，接口非标准 New API，可能需手动粘贴' },
  { name: 'AIHubMix', baseUrl: 'https://aihubmix.com', kind: 'new-api', note: 'New API 架构，支持自动建档' },
  { name: '云雾 API', baseUrl: 'https://yunwu.ai', kind: 'new-api', note: 'New API 架构，国内直连' },
  { name: 'OhMyGPT', baseUrl: 'https://www.ohmygpt.com', kind: 'new-api', note: 'New API 架构' },
  { name: 'AnyRouter', baseUrl: 'https://anyrouter.top', kind: 'new-api', note: 'New API 架构，自动建档兼容度最高' },
  { name: '老张 API', baseUrl: 'https://laozhang.ai', kind: 'new-api', note: '老牌中转站' },
  { name: '147API', baseUrl: 'https://www.147api.com', kind: 'new-api', note: '标准中转站' },
  { name: 'API2D', baseUrl: 'https://api2d.com', kind: 'unknown', note: '自有面板，可能需手动粘贴' },
  { name: 'GPTAPI', baseUrl: 'https://www.gptapi.us', kind: 'new-api', note: 'New API 架构' },
  { name: 'CloseAI-asia', baseUrl: 'https://api.closeai-asia.com', kind: 'new-api', note: 'New API 架构' },
];

/** 把种子条目转成运行时 Benefit（额度走同一套归一化管线，验证噪声排除是否生效） */
export function seedToBenefit(s: SeedBenefit, fetchedAt = Date.now()): Benefit {
  const q = parseQuota(s.quotaText);
  return {
    id: s.id,
    section: s.section,
    provider: s.provider,
    title: s.title,
    summary: s.summary,
    quotaText: s.quotaText,
    quotaTokens: q.rejected ? null : q.tokens,
    quotaUsd: q.rejected ? null : q.usd,
    validUntil: s.validUntil,
    url: s.url,
    steps: s.steps,
    keywords: s.section === 'relay' ? Array.from(new Set([...s.keywords, 'api', '中转站'])) : s.keywords,
    sourceUrl: s.probeUrl,
    fetchedAt,
    confidence: q.rejected && s.confidence === 'verified' ? 'likely' : s.confidence,
    origin: 'seed',
    evidence: null,
  };
}

export function allSeedBenefits(): Benefit[] {
  return SEED_BENEFITS.map((s) => seedToBenefit(s));
}