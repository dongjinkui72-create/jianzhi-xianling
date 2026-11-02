import { normalizeUrl } from '../lib/normalize';
import type { ApiKeyItem, KeyStatus } from '../lib/types';

/**
 * 可用池体检。
 *
 * 红线：额度不足 / 失效的 Key 只做「静默标红 + 移入预警区」，
 * 任何文案都不得出现「建议删除该 API」这类提示。
 * 网络不可达时标 unknown（无法确认），不谎报「已失效」。
 */

export interface HealthResult {
  status: KeyStatus;
  remainingTokens: number | null;
  remainingUsd: number | null;
  note: string;
  latencyMs: number | null;
}

interface Probe {
  ok: boolean;
  status: number;
  body: any;
  text: string;
  error?: string;
}

async function probe(url: string, headers: Record<string, string>, timeoutMs = 12000): Promise<Probe> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { method: 'GET', headers, signal: ctrl.signal as any });
    const text = await res.text();
    let body: any = null;
    try {
      body = JSON.parse(text);
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body, text: text.slice(0, 1200) };
  } catch (e: any) {
    return { ok: false, status: 0, body: null, text: '', error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

function stripVersionSuffix(base: string): string {
  return base.replace(/\/(v\d+|api\/paas\/v\d+|openai\/v\d+)(\/)?$/i, '').replace(/\/$/, '');
}

function classifyQuota(
  usd: number | null,
  tokens: number | null,
  lowUsd: number,
  lowTokens: number,
): { status: Exclude<KeyStatus, 'dead' | 'unknown'>; reason: string } {
  const lowByUsd = usd != null && usd < lowUsd;
  const lowByTokens = tokens != null && tokens < lowTokens;
  if (lowByUsd || lowByTokens) {
    const parts: string[] = [];
    if (usd != null) parts.push(`剩余约 $${usd.toFixed(usd < 1 ? 3 : 2)}`);
    if (tokens != null) parts.push(`约 ${Math.round(tokens).toLocaleString('en-US')} tokens`);
    return { status: 'low', reason: `额度低于预警阈值（${parts.join('，') || '数值未知'}）` };
  }
  return { status: 'ok', reason: '额度充足' };
}

export async function checkKeyHealth(
  k: ApiKeyItem,
  thresholds: { lowTokens: number; lowUsd: number },
  secret: string | null,
): Promise<HealthResult> {
  if (!secret) {
    return { status: 'unknown', remainingTokens: k.remainingTokens, remainingUsd: k.remainingUsd, note: '加密区里没有找到真实 Key，无法体检', latencyMs: null };
  }

  const base = normalizeUrl(k.baseUrl);
  const started = Date.now();
  const bearer = { Authorization: `Bearer ${secret}`, Accept: 'application/json' };

  let alive: Probe;
  if (k.protocol === 'gemini') {
    alive = await probe(`${base}/models?key=${encodeURIComponent(secret)}`, { Accept: 'application/json' });
  } else if (k.protocol === 'claude') {
    alive = await probe(`${base}/v1/models`, {
      'x-api-key': secret,
      'anthropic-version': '2023-06-01',
      Accept: 'application/json',
    });
  } else {
    alive = await probe(`${base.replace(/\/$/, '')}/models`, bearer);
  }

  const latency = Date.now() - started;

  if (alive.status === 0) {
    return {
      status: 'unknown',
      remainingTokens: k.remainingTokens,
      remainingUsd: k.remainingUsd,
      note: `网络不可达，无法确认：${alive.error || '请求超时'}`,
      latencyMs: latency,
    };
  }

  if (alive.status === 401 || alive.status === 403) {
    return { status: 'dead', remainingTokens: null, remainingUsd: null, note: `密钥无效或已被吊销（HTTP ${alive.status}）`, latencyMs: latency };
  }

  const quotaText = `${alive.text || ''}`.toLowerCase();
  if (alive.status === 402 || /insufficient[_\s]?quota|余额不足|额度不足|arrearage|no\s*balance/i.test(quotaText)) {
    return { status: 'dead', remainingTokens: 0, remainingUsd: 0, note: '账户额度已耗尽', latencyMs: latency };
  }

  if (alive.status === 429) {
    return { status: 'low', remainingTokens: k.remainingTokens, remainingUsd: k.remainingUsd, note: '接口返回 429：触发限流或额度告急', latencyMs: latency };
  }

  if (!alive.ok) {
    return { status: 'unknown', remainingTokens: k.remainingTokens, remainingUsd: k.remainingUsd, note: `连通性检查返回 HTTP ${alive.status}，无法确认`, latencyMs: latency };
  }

  // 连通正常，再查余额（New API / One API / OpenAI 兼容的 dashboard 接口）
  let usd: number | null = null;
  let tokens: number | null = null;
  let quotaNote = '站点未提供余额查询接口，仅确认连通';

  const root = stripVersionSuffix(base);
  const bill = await probe(`${root}/dashboard/billing/subscription`, bearer, 10000);
  if (bill.status > 0 && bill.body && typeof bill.body === 'object') {
    const b = bill.body;
    const avail = typeof b.total_available === 'string' ? Number(b.total_available) : b.total_available;
    const granted = typeof b.total_granted === 'string' ? Number(b.total_granted) : b.total_granted;
    if (typeof avail === 'number' && isFinite(avail)) {
      usd = avail;
      quotaNote = `余额接口返回可用 $${avail.toFixed(avail < 1 ? 3 : 2)}`;
    } else if (typeof granted === 'number' && isFinite(granted)) {
      usd = granted;
      quotaNote = `余额接口返回总额度 $${granted.toFixed(2)}`;
    }
  }

  if (usd == null) {
    const usage = await probe(`${root}/dashboard/billing/usage?start_date=2020-01-01&end_date=2035-01-01`, bearer, 10000);
    if (usage.status > 0 && usage.body && typeof usage.body.total_usage === 'number') {
      quotaNote = `已用 $${(usage.body.total_usage / 100).toFixed(3)}（站点未返回可用余额）`;
    }
  }

  if (usd != null) {
    // 折算等效 token（仅用于阈值预警，不作计费依据）
    tokens = Math.round((usd / 0.7) * 1e6);
  } else {
    tokens = k.remainingTokens;
    usd = k.remainingUsd;
  }

  const verdict = classifyQuota(usd, tokens, thresholds.lowUsd, thresholds.lowTokens);
  return {
    status: verdict.status,
    remainingTokens: tokens,
    remainingUsd: usd,
    note: verdict.status === 'low' ? `${verdict.reason}；${quotaNote}` : quotaNote,
    latencyMs: latency,
  };
}