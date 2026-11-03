import type { Confidence } from './types';

/**
 * 情报归一化引擎。
 *
 * 产品红线：外部抓取的数据必须做「边界归一化」和「噪声词排除」，
 * 防止把「262,144 tokens 上下文窗口」这类上下文长度误判成赠送额度。
 *
 * 三道防线：
 *  1. 文本归一化：全角转半角、NFKC、压缩空白、去掉零宽字符。
 *  2. 噪声排除：数字的前后邻域若出现「上下文 / context window / 最大输出」等词，
 *     且没有「赠送 / 免费 / 额度」等福利词，直接丢弃。
 *  3. 边界归一化：数字必须紧邻一个明确的额度单位（tokens / $ / 次 / 天），
 *     中文数量级（万、亿）与英文数量级（K/M/B）统一折算。
 */

export type QuotaKind = 'usd' | 'cny' | 'tokens' | 'requests' | 'days' | 'trial' | 'none';

export interface ParsedQuota {
  kind: QuotaKind;
  value: number | null;
  /** 归一化后的展示文案 */
  text: string;
  /** 折算 token 数（仅 tokens 口径） */
  tokens: number | null;
  /** 折算美元（仅 usd 口径） */
  usd: number | null;
  confidence: Confidence;
  rejected: boolean;
  rejectReason?: string;
}

export const EMPTY_QUOTA: ParsedQuota = {
  kind: 'none',
  value: null,
  text: '',
  tokens: null,
  usd: null,
  confidence: 'unconfirmed',
  rejected: true,
  rejectReason: '未识别到额度',
};

/** 上下文窗口 / 长度类噪声词 */
const NOISE_CONTEXT =
  /(上下文|语境|context\s*window|context\s*length|context\s*size|窗口|max[\s_\-]*tokens?|max[\s_\-]*output|最大输出|输出长度|输出上限|输入长度|最大长度|长度上限|token\s*上限|sliding\s*window|context)/i;

/** 福利 / 赠送类正向词 */
const BENEFIT_HINT =
  /(赠送|赠予|附赠|免费送|免费额度|免费试用|免费|白嫖|试用|额度|福利|领取|新用户|新人|注册送|首充|credit|bonus|free\s*tier|free\s*credit|trial|\$|¥|返现|赠送金|体验金)/i;

/** 明确的噪声整句（直接排除） */
const NOISE_SENTENCE =
  /(上下文窗口|context\s*window|context\s*length|最大上下文|支持\s*\d[\d,\.]*\s*(万|亿|k|m|b)?\s*tokens?\s*上下文|sliding\s*window|温度|top[_\-\s]?p|stream\s*输出|token\s*限制|速率限制|rate\s*limit|rpm|tpm|qps|并发)/i;

const UNIT_MAP: Record<string, { kind: QuotaKind; mult: number }> = {
  token: { kind: 'tokens', mult: 1 },
  tokens: { kind: 'tokens', mult: 1 },
  额度: { kind: 'tokens', mult: 1 },
  次: { kind: 'requests', mult: 1 },
  请求: { kind: 'requests', mult: 1 },
  requests: { kind: 'requests', mult: 1 },
  usd: { kind: 'usd', mult: 1 },
  美元: { kind: 'usd', mult: 1 },
  美金: { kind: 'usd', mult: 1 },
  元: { kind: 'cny', mult: 1 },
  人民币: { kind: 'cny', mult: 1 },
  天: { kind: 'days', mult: 1 },
  day: { kind: 'days', mult: 1 },
  days: { kind: 'days', mult: 1 },
  个月: { kind: 'days', mult: 30 },
  月: { kind: 'days', mult: 30 },
};

/** 数量级折算 */
function magnitudeMultiplier(m?: string): number {
  if (!m) return 1;
  const t = m.toLowerCase();
  switch (t) {
    case 'k':
    case '千':
      return 1e3;
    case 'm':
    case '百万':
      return 1e6;
    case 'b':
    case '十亿':
      return 1e9;
    case '万':
      return 1e4;
    case '亿':
      return 1e8;
    default:
      return 1;
  }
}

/** 文本归一化：全角转半角 + NFKC + 压空白 + 去零宽 */
export function normalizeText(input: string): string {
  if (!input) return '';
  let t = input
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\u00A0/g, ' ');
  try {
    t = t.normalize('NFKC');
  } catch {
    /* 老引擎兜底 */
  }
  t = t.replace(/[￥]/g, '¥').replace(/［/g, '[').replace(/］/g, ']');
  t = t.replace(/[ \t]+/g, ' ');
  return t.trim();
}

/** URL 边界归一化 */
export function normalizeUrl(input: string): string {
  if (!input) return '';
  let u = normalizeText(input).replace(/^<|>$/g, '');
  if (!/^[a-zA-Z][a-zA-Z0-9+\-.]*:\/\//.test(u)) {
    if (u.startsWith('//')) u = 'https:' + u;
    else u = 'https://' + u;
  }
  u = u.replace(/\/+$/, '');
  return u;
}

/** 用于去重的站点根标识 */
export function siteKeyOf(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    return u.hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return normalizeUrl(url).toLowerCase();
  }
}

/** 数字边界归一化："1,000,000" / "100万" / "1.5M" -> 1500000 */
export function normalizeNumber(raw: string, magnitude?: string): number | null {
  if (!raw) return null;
  // 先做文本归一化（全角数字 -> 半角），否则「１２３」这类会解析失败
  const cleaned = normalizeText(raw).replace(/[,，\s_]/g, '');
  if (!/^\d*\.?\d+$/.test(cleaned)) return null;
  const n = Number(cleaned);
  if (!isFinite(n)) return null;
  return n * magnitudeMultiplier(magnitude);
}

interface Candidate {
  kind: QuotaKind;
  value: number;
  index: number;
  text: string;
  score: number;
}

/**
 * 邻域噪声判定。
 *  - 前文用窄窗口（8 字）：只有紧贴数字的「最大输出 / 上下文」才算噪声，
 *    避免同一句里前半段是噪声、后半段是真福利时被误杀。
 *  - 后文比距离：噪声词比福利词更靠近数字，则判为噪声。
 */
function isNoisyContext(text: string, start: number, end: number): boolean {
  const before = text.slice(Math.max(0, start - 8), start);
  if (NOISE_CONTEXT.test(before)) return true;

  const after = text.slice(end, Math.min(text.length, end + 22));
  const noiseAt = after.search(NOISE_CONTEXT);
  if (noiseAt < 0) return false;
  const benefitAt = after.search(BENEFIT_HINT);
  if (benefitAt < 0 || noiseAt < benefitAt) return true;
  return false;
}

/** 从一段文本里抽取额度 */
export function parseQuota(input: string): ParsedQuota {
  const text = normalizeText(input);
  if (!text) return EMPTY_QUOTA;

  if (NOISE_SENTENCE.test(text) && !BENEFIT_HINT.test(text)) {
    return { ...EMPTY_QUOTA, text, rejectReason: '命中噪声词（上下文/速率限制类），已排除' };
  }

  const candidates: Candidate[] = [];

  // 形态一：$5 / ¥14 前置符号
  const symbolRe = /([\$¥])\s*(\d[\d,\.]*)\s*(万|亿|k|m|b)?/gi;
  let m: RegExpExecArray | null;
  while ((m = symbolRe.exec(text))) {
    const value = normalizeNumber(m[2], m[3]);
    if (value == null) continue;
    if (isNoisyContext(text, m.index, m.index + m[0].length)) continue;
    const kind: QuotaKind = m[1] === '$' ? 'usd' : 'cny';
    candidates.push({
      kind,
      value,
      index: m.index,
      text: `${m[1]}${value}`,
      score: 90 + (BENEFIT_HINT.test(text) ? 8 : 0),
    });
  }

  // 形态二：数字 + 数量级 + 单位
  const unitRe =
    /(\d[\d,\.]*)\s*(万|亿|k|m|b|千|百万)?\s*(tokens?|额度|次请求|次|请求|requests?|美元|美金|usd|元|人民币|天|days?|个月|月)/gi;
  while ((m = unitRe.exec(text))) {
    const value = normalizeNumber(m[1], m[2]);
    if (value == null) continue;
    const unit = m[3].toLowerCase().replace(/\s+/g, '');
    const meta = UNIT_MAP[unit] ?? UNIT_MAP[unit.replace(/s$/, '')];
    if (!meta) continue;
    const end = m.index + m[0].length;
    if (isNoisyContext(text, m.index, end)) continue;
    let score = 60;
    if (BENEFIT_HINT.test(text.slice(Math.max(0, m.index - 24), end + 8))) score += 30;
    if (meta.kind === 'tokens' || meta.kind === 'usd') score += 6;
    candidates.push({
      kind: meta.kind,
      value: meta.kind === 'days' ? value * meta.mult : value,
      index: m.index,
      text: `${value}${m[3]}`,
      score,
    });
  }

  // 形态三：free tier / 免费试用（无数值）
  if (candidates.length === 0) {
    if (/(free\s*tier|免费|试用|trial)/i.test(text)) {
      return {
        kind: 'trial',
        value: null,
        text: /trial|试用/i.test(text) ? '限时试用' : '免费额度',
        tokens: null,
        usd: null,
        confidence: 'likely',
        rejected: false,
      };
    }
    return { ...EMPTY_QUOTA, text, rejectReason: '未匹配到额度单位' };
  }

  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  const best = candidates[0];

  const confidence: Confidence = best.score >= 90 ? 'verified' : best.score >= 70 ? 'likely' : 'unconfirmed';

  return {
    kind: best.kind,
    value: best.value,
    text: best.text,
    tokens: best.kind === 'tokens' ? best.value : null,
    usd: best.kind === 'usd' ? best.value : null,
    confidence,
    rejected: false,
  };
}

/** 关键词命中（中转站情报固定用 api） */
export function hitKeyword(text: string, keyword: string): boolean {
  const t = normalizeText(text).toLowerCase();
  return t.includes(keyword.toLowerCase());
}

/** 从 HTML 里剥出可读文本 */
export function htmlToText(html: string): string {
  if (!html) return '';
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\s*br\s*\/?\s*>/gi, '\n')
    .replace(/<\/\s*(p|div|li|ul|ol|tr|td|th|h[1-6]|section|article|table|blockquote|header|footer|figure|dt|dd)\s*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/** 按句子切分，便于逐句做噪声排除 */
export function splitSentences(text: string): string[] {
  return normalizeText(text)
    .split(/[\n\r。；;！!？?|]+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 4 && s.length <= 220);
}

/**
 * 从任意网页文本里提炼「福利句」。
 * 只有同时满足：含福利词 + 含 api 或额度单位 + 未命中上下文噪声，才算候选。
 */
export function extractBenefitLines(pageText: string, keyword: string | string[] = 'api'): string[] {
  const kws = Array.isArray(keyword) ? keyword : [keyword];
  const sentences = splitSentences(htmlToText(pageText));
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of sentences) {
    if (NOISE_SENTENCE.test(s) && !BENEFIT_HINT.test(s)) continue;
    if (!BENEFIT_HINT.test(s)) continue;
    const q = parseQuota(s);
    if (q.rejected) continue;
    if (!kws.some((k) => hitKeyword(s, k)) && q.kind === 'none') continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out.slice(0, 40);
}

/** 把「1.5M」这类简写转成 token 数，供体检阈值比较 */
export function toTokens(value: number | null, kind: QuotaKind): number | null {
  if (value == null) return null;
  if (kind === 'tokens') return value;
  return null;
}