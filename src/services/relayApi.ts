import { quotaToUsd, usdToTokensEstimate } from '../lib/format';
import { normalizeUrl } from '../lib/normalize';
import type { CapabilityState } from '../lib/types';

/**
 * 中转站（API Relay）接口层。
 *
 * 目前主要适配 New API / One API 系（国内绝大多数中转站都是这套开源面板），
 * 接口已按其源码核对：
 *   GET  /api/status                     站点信息（判断是不是 New API）
 *   GET  /api/user/self                  用户信息（id / quota / used_quota）
 *   GET  /api/user/checkin               签到能力探测（enabled 字段）
 *   POST /api/user/checkin               执行签到（可能要求 Turnstile 人机验证）
 *   GET  /api/token/?p=1&page_size=100   令牌列表（新版返回掩码 key）
 *   POST /api/token/                     创建令牌（响应不含 key）
 *   POST /api/token/:id/key              取令牌完整 key
 *   POST /api/user/access_tokens         创建系统访问令牌（需浏览器会话）
 */

export interface RequestInitLite {
  method?: string;
  body?: any;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export interface RelayResponse<T = any> {
  ok: boolean;
  status: number;
  data?: T;
  message?: string;
  error?: string;
  text?: string;
}

export interface Transport {
  readonly name: 'bridge' | 'http';
  request(path: string, init?: RequestInitLite): Promise<RelayResponse>;
  /** 仅 WebView 桥接支持：在页面里求值 */
  eval?(expr: string, timeoutMs?: number): Promise<any>;
  setApiBase?(base: string | null): void;
}

/** App 侧 HTTP 传输（用系统访问令牌，长期免 WebView） */
export function httpTransport(baseUrl: string, opts: { accessToken?: string | null; userId?: number | null } = {}): Transport {
  const base = normalizeUrl(baseUrl);
  return {
    name: 'http',
    async request(path, init = {}) {
      const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
      const headers: Record<string, string> = {
        Accept: 'application/json',
        ...(init.headers || {}),
      };
      if (opts.accessToken) headers.Authorization = `Bearer ${opts.accessToken}`;
      if (opts.userId != null) headers['New-Api-User'] = String(opts.userId);

      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), init.timeoutMs ?? 15000);
      try {
        const res = await fetch(url, {
          method: (init.method || 'GET').toUpperCase(),
          headers: init.body != null ? { ...headers, 'Content-Type': 'application/json' } : headers,
          body: init.body != null ? JSON.stringify(init.body) : undefined,
          signal: ctrl.signal as any,
        });
        const text = await res.text();
        let data: any = null;
        try {
          data = JSON.parse(text);
        } catch {
          data = null;
        }
        return { ok: res.ok, status: res.status, data, text: text.slice(0, 3000) };
      } catch (e: any) {
        const msg = String(e?.message || e);
        return { ok: false, status: 0, error: /abort/i.test(msg) ? '请求超时' : msg };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/* ------------------------------- 响应解包 ------------------------------- */

interface Envelope {
  success: boolean;
  message: string;
  data: any;
}

export function envelope(res: RelayResponse): Envelope {
  const d: any = res.data;
  if (d && typeof d === 'object' && 'success' in d) {
    return { success: !!d.success, message: String(d.message ?? ''), data: d.data };
  }
  return { success: res.ok, message: res.error || '', data: d };
}

function num(v: any): number | null {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && isFinite(n) ? n : null;
}

export function describeFailure(res: RelayResponse, env: Envelope): string {
  if (res.status === 401 || res.status === 403) return `登录态无效或已过期（HTTP ${res.status}）`;
  if (res.status === 404) return '接口不存在（HTTP 404），该站点可能不是 New API / One API 架构';
  if (res.status === 0) return res.error || '网络不可达';
  return env.message || res.error || `HTTP ${res.status}`;
}

/* ------------------------------- 面板架构识别 ------------------------------- */

export type RelayFamily = 'new-api' | 'one-api' | 'veloera' | 'unknown';

/**
 * 识别中转站面板架构。
 * 国内绝大多数中转站都是 New API / One API / Veloera / Done-hub 这一系（接口同构），
 * 这里用多个路由指纹逐个探测；都不命中时如实返回 unknown，不假装认识。
 */
export async function detectRelayFamily(t: Transport): Promise<{ family: RelayFamily; detail: string }> {
  const st = await probeSite(t);
  if (st.looksLikeNewApi) {
    const ver = (st.version || '').toLowerCase();
    const family: RelayFamily = ver.includes('veloera') ? 'veloera' : 'new-api';
    return { family, detail: `${st.systemName || '站点'} · ${st.version || '版本未知'} · New API 系接口` };
  }
  const self = await t.request('/api/user/self');
  if (self.status === 401 || self.status === 403) {
    return { family: 'one-api', detail: '未登录但 /api/user/self 路由存在，按 One API 系处理' };
  }
  const tok = await t.request('/api/token/?p=1&page_size=1');
  if (tok.status === 401 || tok.status === 403) {
    return { family: 'one-api', detail: '/api/token 路由存在，按 One API 系处理' };
  }
  return {
    family: 'unknown',
    detail: st.reachable ? '未识别到已知面板接口；自动建档可能不可用，可手动粘贴' : '站点不可达，无法识别',
  };
}
/* ------------------------------- 站点探测 ------------------------------- */

export interface SiteInfo {
  reachable: boolean;
  systemName: string | null;
  version: string | null;
  looksLikeNewApi: boolean;
  detail: string;
}

export async function probeSite(t: Transport): Promise<SiteInfo> {
  const res = await t.request('/api/status', { timeoutMs: 12000 });
  const env = envelope(res);
  const d = env.data || {};
  const systemName = d.system_name ?? d.systemName ?? null;
  const version = d.version ?? d.data?.version ?? null;
  const looksLikeNewApi = res.ok && (env.success || !!systemName || !!d.start_time || !!d.version);
  return {
    reachable: res.status > 0,
    systemName: systemName ? String(systemName) : null,
    version: version ? String(version) : null,
    looksLikeNewApi,
    detail: res.status === 0 ? res.error || '无法连接' : looksLikeNewApi ? 'New API / One API 架构' : `非标准响应（HTTP ${res.status}）`,
  };
}

/* ------------------------------- 用户信息 ------------------------------- */

export interface SelfInfo {
  id: number;
  username: string | null;
  quota: number | null;
  usedQuota: number | null;
  requestCount: number | null;
  group: string | null;
}

export async function fetchSelf(t: Transport): Promise<{ ok: boolean; self?: SelfInfo; reason?: string }> {
  const res = await t.request('/api/user/self');
  const env = envelope(res);
  if (!env.success || !env.data || env.data.id == null) {
    return { ok: false, reason: describeFailure(res, env) };
  }
  const d = env.data;
  return {
    ok: true,
    self: {
      id: Number(d.id),
      username: d.username ?? d.display_name ?? null,
      quota: num(d.quota),
      usedQuota: num(d.used_quota),
      requestCount: num(d.request_count),
      group: d.group ?? null,
    },
  };
}

/** 从探针记录 + 页面 origin 推导候选 API 根地址（按可能性排序） */
export function deriveApiCandidates(hints: any, origin: string | null): string[] {
  const out: string[] = [];
  const push = (u: string | null | undefined) => {
    if (!u || typeof u !== 'string') return;
    const clean = u.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(clean)) return;
    if (out.indexOf(clean) === -1) out.push(clean);
  };
  if (Array.isArray(hints)) {
    for (const h of hints) {
      // 探针可能记录到完整请求地址，这里统一截出 /api/ 之前的根
      if (typeof h === 'string' && h.includes('/api/')) push(h.slice(0, h.indexOf('/api/')));
      else push(h);
    }
  }
  if (origin) {
    push(origin);
    try {
      const u = new URL(origin);
      const parts = u.hostname.split('.');
      if (parts.length > 2) {
        push(`${u.protocol}//${parts.slice(-2).join('.')}`);
        push(`${u.protocol}//api.${parts.slice(-2).join('.')}`);
      }
    } catch {
      /* ignore */
    }
  }
  return out;
}

/**
 * 网页按钮签到兜底：在页面里找「签到」按钮并点击，再确认是否变成「已签到」。
 * 用于接口签到 404 但主页确有签到按钮的面板（公益站/路由站常见）。
 */
export async function domCheckin(t: Transport): Promise<{ ok: boolean; message: string }> {
  if (!t.eval) return { ok: false, message: '当前传输不支持页面操作' };
  const res = await t.eval(
    `(async function(){
      var pick = function(){
        var nodes = document.querySelectorAll('button, a, div, span, [role="button"]');
        for (var i = 0; i < nodes.length; i++) {
          var el = nodes[i];
          var txt = (el.textContent || '').trim();
          if (!txt || txt.length > 8) continue;
          if (/已签到|签到成功/.test(txt)) continue;
          if (/签到/.test(txt)) {
            var r = el.getBoundingClientRect();
            if (r.width > 4 && r.height > 4) return el;
          }
        }
        return null;
      };
      var before = document.body.innerText || '';
      var el = pick();
      if (!el) return { clicked: false, done: /已签到/.test(before) };
      el.click();
      await new Promise(function(r){ setTimeout(r, 1500); });
      var after = document.body.innerText || '';
      var done = /已签到|签到成功/.test(after);
      return { clicked: true, done: done };
    })()`,
    20000,
  );
  if (!res || typeof res !== 'object') return { ok: false, message: '页面签到按钮探测无响应' };
  if (res.done) return { ok: true, message: '已通过网页签到按钮完成签到' };
  if (res.clicked) return { ok: false, message: '点了网页签到按钮但没确认到成功状态，请到页面里看一眼' };
  return { ok: false, message: '页面上没找到签到按钮（可能今天已签过或站点未开放）' };
}
/* ------------------------------- 签到 ------------------------------- */

export interface CheckinSupport {
  support: CapabilityState;
  reason: string | null;
  minQuota: number | null;
  maxQuota: number | null;
}

/**
 * 探测签到能力。红线：不确定就返回 unknown，绝不谎报「支持」。
 */
export async function fetchCheckinSupport(t: Transport): Promise<CheckinSupport> {
  const res = await t.request('/api/user/checkin');
  const env = envelope(res);

  if (res.status === 404) {
    return { support: 'no', reason: '该站点没有签到接口（HTTP 404）', minQuota: null, maxQuota: null };
  }
  if (!env.success) {
    const msg = env.message || describeFailure(res, env);
    if (/not enabled|未开启|未启用|not\s*open/i.test(msg)) {
      return { support: 'no', reason: `该站点未开启签到功能：${msg}`, minQuota: null, maxQuota: null };
    }
    if (res.status === 0) {
      return { support: 'unknown', reason: `网络不可达，无法确认：${msg}`, minQuota: null, maxQuota: null };
    }
    return { support: 'unknown', reason: `无法确认签到能力：${msg}`, minQuota: null, maxQuota: null };
  }

  const d = env.data || {};
  const enabled = d.enabled === true || d.enabled === undefined;
  return {
    support: enabled ? 'yes' : 'no',
    reason: enabled ? null : '站点已关闭签到',
    minQuota: num(d.min_quota),
    maxQuota: num(d.max_quota),
  };
}

export type CheckinOutcome = 'success' | 'failed' | 'manual_only' | 'unconfirmed';

export interface CheckinResult {
  outcome: CheckinOutcome;
  message: string;
  gainedUsd: number | null;
}

/**
 * 执行签到。红线：不支持自动签到的站点必须如实说明只能手动，绝不伪造成功。
 */
export async function doCheckin(t: Transport): Promise<CheckinResult> {
  const support = await fetchCheckinSupport(t);
  if (support.support === 'no') {
    return { outcome: 'manual_only', message: support.reason || '该站点不支持自动签到，只能到站点页面手动签到', gainedUsd: null };
  }

  const res = await t.request('/api/user/checkin', { method: 'POST' });
  const env = envelope(res);

  if (env.success) {
    const awarded = num(env.data?.quota_awarded);
    return {
      outcome: 'success',
      message: awarded != null ? `签到成功，本次获得 ${quotaToUsd(awarded)?.toFixed(3) ?? '—'} 美元等值额度` : '签到成功',
      gainedUsd: quotaToUsd(awarded),
    };
  }

  const msg = env.message || describeFailure(res, env);
  if (/turnstile|人机验证|captcha|验证失败/i.test(msg)) {
    return { outcome: 'manual_only', message: `该站点开启了人机验证（Turnstile），App 内代理签到无法通过，请到站点页面手动签到。原始信息：${msg}`, gainedUsd: null };
  }
  if (/already|已签到|重复签到|checked\s*in/i.test(msg)) {
    return { outcome: 'failed', message: `今天已经签到过了（${msg}）`, gainedUsd: null };
  }
  if (res.status === 0) {
    return { outcome: 'unconfirmed', message: `网络不可达，签到结果无法确认：${msg}`, gainedUsd: null };
  }
  return { outcome: 'failed', message: `签到失败：${msg}`, gainedUsd: null };
}

/* ------------------------------- 令牌（API Key） ------------------------------- */

export interface RelayToken {
  id: number;
  name: string;
  key: string | null;
  masked: boolean;
  status: number;
  remainQuota: number | null;
  unlimitedQuota: boolean;
  expiredTime: number | null;
}

function isMaskedKey(key: any): boolean {
  if (typeof key !== 'string' || !key) return true;
  return key.includes('*') || key.includes('…') || key.includes('...') || key.length < 20;
}

export async function listTokens(t: Transport): Promise<{ ok: boolean; tokens: RelayToken[]; reason?: string }> {
  const res = await t.request('/api/token/?p=1&page_size=100&size=100');
  const env = envelope(res);
  if (!env.success) return { ok: false, tokens: [], reason: describeFailure(res, env) };
  const d = env.data;
  const items: any[] = Array.isArray(d) ? d : Array.isArray(d?.items) ? d.items : [];
  return {
    ok: true,
    tokens: items.map((it) => ({
      id: Number(it.id),
      name: String(it.name ?? ''),
      key: typeof it.key === 'string' ? it.key : null,
      masked: isMaskedKey(it.key),
      status: Number(it.status ?? 1),
      remainQuota: num(it.remain_quota),
      unlimitedQuota: !!it.unlimited_quota,
      expiredTime: num(it.expired_time),
    })),
  };
}

export async function getTokenFullKey(t: Transport, id: number): Promise<string | null> {
  // 新版 New API：POST /api/token/:id/key
  const res = await t.request(`/api/token/${id}/key`, { method: 'POST' });
  let env = envelope(res);
  if (env.success) {
    const key = env.data?.key ?? env.data?.full_key ?? (typeof env.data === 'string' ? env.data : null);
    if (typeof key === 'string' && !isMaskedKey(key)) return key;
  }
  // 老版 one-api：GET /api/token/:id 直接返回完整 key
  const res2 = await t.request(`/api/token/${id}`);
  env = envelope(res2);
  if (env.success && !isMaskedKey(env.data?.key)) return String(env.data.key);
  return null;
}

export async function createToken(
  t: Transport,
  name: string,
  userQuota: number | null,
): Promise<{ ok: boolean; message?: string }> {
  const body = {
    name,
    remain_quota: 500000,
    expired_time: -1,
    unlimited_quota: true,
    model_limits_enabled: false,
    model_limits: '',
    group: '',
  };
  let res = await t.request('/api/token/', { method: 'POST', body });
  let env = envelope(res);
  if (env.success) return { ok: true };

  // 部分站点不允许无限额度，退回「按用户余额建有限额度令牌」
  if (/quota|额度/i.test(env.message || '')) {
    res = await t.request('/api/token/', {
      method: 'POST',
      body: { ...body, unlimited_quota: false, remain_quota: Math.max(1, userQuota ?? 500000) },
    });
    env = envelope(res);
    if (env.success) return { ok: true };
  }
  return { ok: false, message: describeFailure(res, env) };
}

export interface AutoProvisionResult {
  ok: boolean;
  key?: string;
  apiBase?: string;
  userId?: number;
  username?: string | null;
  quota?: number | null;
  usedQuota?: number | null;
  remainingUsd?: number | null;
  remainingTokens?: number | null;
  tokenName?: string;
  /** 失败时是否应引导用户手动粘贴 */
  needManual?: boolean;
  reason?: string;
  /** 每一步的实况，用于 UI 如实展示 */
  trace: string[];
}

export function joinApiBase(baseUrl: string): string {
  const b = normalizeUrl(baseUrl);
  if (/\/v\d+\/?$/.test(b)) return b.replace(/\/$/, '');
  return `${b}/v1`;
}

/**
 * 核心功能①：在中转站自动创建 API 密钥，并连同调用地址一起保存到本机。
 * 全流程无需用户复制粘贴。做不到时如实返回 needManual，由 UI 给出手动入口。
 */
export async function autoProvisionApiKey(t: Transport, baseUrl: string, labelPrefix = '剪纸仙灵'): Promise<AutoProvisionResult> {
  const trace: string[] = [];

  const selfRes = await fetchSelf(t);
  if (!selfRes.ok || !selfRes.self) {
    trace.push(`读取账号信息失败：${selfRes.reason}`);
    return { ok: false, needManual: true, reason: selfRes.reason || '未能读取账号信息', trace };
  }
  const self = selfRes.self;
  trace.push(`已读取账号：${self.username || `#${self.id}`}，余额 ${quotaToUsd(self.quota)?.toFixed(4) ?? '未知'} 美元`);

  const stamp = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const tokenName = `${labelPrefix}-${p(stamp.getMonth() + 1)}${p(stamp.getDate())}${p(stamp.getHours())}${p(stamp.getMinutes())}`;

  const created = await createToken(t, tokenName, self.quota);
  if (!created.ok) {
    trace.push(`创建令牌失败：${created.message}`);
    return {
      ok: false,
      needManual: true,
      userId: self.id,
      username: self.username,
      quota: self.quota,
      usedQuota: self.usedQuota,
      remainingUsd: quotaToUsd(self.quota),
      remainingTokens: usdToTokensEstimate(quotaToUsd(self.quota)),
      reason: created.message || '创建令牌失败',
      trace,
    };
  }
  trace.push(`已创建令牌「${tokenName}」`);

  const listRes = await listTokens(t);
  if (!listRes.ok) {
    trace.push(`读取令牌列表失败：${listRes.reason}`);
    return { ok: false, needManual: true, reason: listRes.reason, trace, userId: self.id, username: self.username };
  }

  let hit = listRes.tokens.find((x) => x.name === tokenName);
  if (!hit) hit = listRes.tokens.sort((a, b) => b.id - a.id)[0];
  if (!hit) {
    trace.push('令牌列表为空，无法取回 Key');
    return { ok: false, needManual: true, reason: '创建后未能取回令牌', trace, userId: self.id };
  }

  let key = hit.masked ? null : hit.key;
  if (!key) {
    key = await getTokenFullKey(t, hit.id);
    trace.push(key ? '已通过令牌详情接口取回完整 Key' : '令牌详情接口未返回完整 Key');
  } else {
    trace.push('令牌列表已直接返回完整 Key');
  }

  if (!key) {
    return {
      ok: false,
      needManual: true,
      userId: self.id,
      username: self.username,
      quota: self.quota,
      usedQuota: self.usedQuota,
      remainingUsd: quotaToUsd(self.quota),
      reason: '站点只返回掩码 Key，且未开放完整 Key 查询接口',
      trace,
    };
  }

  const apiBase = joinApiBase(baseUrl);
  const remainingUsd = quotaToUsd(self.quota);
  trace.push(`自动建档完成，调用地址 ${apiBase}`);

  return {
    ok: true,
    key,
    apiBase,
    userId: self.id,
    username: self.username,
    quota: self.quota,
    usedQuota: self.usedQuota,
    remainingUsd,
    remainingTokens: usdToTokensEstimate(remainingUsd),
    tokenName,
    trace,
  };
}

/* --------------------------- 系统访问令牌（长期免 WebView） --------------------------- */

export async function createSystemAccessToken(t: Transport, name = '剪纸仙灵'): Promise<{ ok: boolean; token?: string; reason?: string }> {
  // 该接口要求「浏览器会话」，只能通过 WebView 桥接调用
  if (t.name !== 'bridge') {
    return { ok: false, reason: '系统访问令牌只能在站点页面内创建（需要浏览器会话）' };
  }

  let scopes: any = undefined;
  const scopeRes = await t.request('/api/user/access_tokens/scopes');
  const scopeEnv = envelope(scopeRes);
  if (scopeEnv.success && scopeEnv.data) {
    const arr = Array.isArray(scopeEnv.data) ? scopeEnv.data : scopeEnv.data.scopes ?? scopeEnv.data.items;
    if (Array.isArray(arr)) {
      scopes = arr
        .map((s: any) => (typeof s === 'string' ? s : s?.key ?? s?.value ?? s?.scope ?? s?.name))
        .filter((s: any) => typeof s === 'string');
    }
  }

  const attempts: any[] = [
    { name, expires_at: 0, scopes },
    { name, expires_at: 0 },
    { name },
  ];

  let lastReason = '未知原因';
  for (const body of attempts) {
    const cleaned: any = {};
    for (const k of Object.keys(body)) if (body[k] !== undefined) cleaned[k] = body[k];
    const res = await t.request('/api/user/access_tokens', { method: 'POST', body: cleaned });
    const env = envelope(res);
    if (env.success) {
      const raw = env.data?.token ?? env.data?.item?.token ?? null;
      if (typeof raw === 'string' && raw.length > 8) return { ok: true, token: raw };
      lastReason = '接口返回成功但没有给出令牌明文';
      continue;
    }
    lastReason = describeFailure(res, env);
    if (/security|proof|2fa|验证|password/i.test(lastReason)) break;
  }
  return { ok: false, reason: lastReason };
}

/* ------------------------------- 账号密码登录（兜底） ------------------------------- */

export async function loginWithPassword(
  t: Transport,
  username: string,
  password: string,
): Promise<{ ok: boolean; reason?: string }> {
  const res = await t.request('/api/user/login', { method: 'POST', body: { username, password } });
  const env = envelope(res);
  if (env.success) return { ok: true };
  return { ok: false, reason: describeFailure(res, env) };
}