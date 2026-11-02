import type { ApiKeyItem } from './types';

/** API Key 掩码：数据库里只存掩码，真实值只进 SecureStore。 */
export function maskKey(key: string): string {
  const k = (key || '').trim();
  if (!k) return '（空）';
  if (k.length <= 10) return k.slice(0, 2) + '****';
  return `${k.slice(0, 6)}****${k.slice(-4)}`;
}

export function compactNumber(n: number | null | undefined, digits = 1): string {
  if (n == null || !isFinite(n)) return '—';
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${trim(n / 1e9, digits)}B`;
  if (abs >= 1e6) return `${trim(n / 1e6, digits)}M`;
  if (abs >= 1e4) return `${trim(n / 1e4, digits)}万`;
  if (abs >= 1e3) return `${trim(n / 1e3, digits)}K`;
  return `${trim(n, abs < 10 ? 2 : 0)}`;
}

function trim(n: number, digits: number): string {
  const v = Number(n.toFixed(digits));
  return String(v);
}

export function formatTokens(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '未知';
  return `${compactNumber(n)} tokens`;
}

export function formatUsd(n: number | null | undefined): string {
  if (n == null || !isFinite(n)) return '—';
  return `$${n.toFixed(n < 1 ? 3 : 2)}`;
}

/** New API 的 quota 单位：500000 quota = $1 */
export const QUOTA_PER_USD = 500000;

export function quotaToUsd(quota: number | null | undefined): number | null {
  if (quota == null || !isFinite(quota)) return null;
  return quota / QUOTA_PER_USD;
}

/** 粗略把美元额度折算成「等效 token 数」，仅用于阈值预警，不用于计费展示 */
export function usdToTokensEstimate(usd: number | null, per1M = 0.7): number | null {
  if (usd == null || !isFinite(usd)) return null;
  return Math.round((usd / per1M) * 1e6);
}

export function relativeTime(ts: number | null | undefined): string {
  if (!ts) return '从未';
  const diff = Date.now() - ts;
  if (diff < 0) return '刚刚';
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h} 小时前`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

export function dateTime(ts: number | null | undefined): string {
  if (!ts) return '—';
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function todayKey(ts: number = Date.now()): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

export const STATUS_LABEL: Record<ApiKeyItem['status'], string> = {
  unknown: '待体检',
  ok: '可用',
  low: '额度预警',
  dead: '已失效',
};

export const STATUS_HINT: Record<ApiKeyItem['status'], string> = {
  unknown: '还没有做过体检，点右上角体检按钮开始检测',
  ok: '接口连通，剩余额度充足',
  low: '剩余额度低于你设定的阈值，已静默移入预警区',
  dead: '接口不可用或额度耗尽，已静默移入预警区',
};