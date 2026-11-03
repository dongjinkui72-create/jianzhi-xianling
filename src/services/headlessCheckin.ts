import { RelayBridge } from './relayBridge';
import {
  deriveApiCandidates,
  doCheckin,
  domCheckin,
  domHasCheckinButton,
  fetchCheckinSupport,
  fetchSelf,
  readLocalUserId,
  type SelfInfo,
} from './relayApi';
import type { CapabilityState, Relay } from '../lib/types';

/**
 * 后台隐形签到执行器。
 *
 * 目标：用户在「每日签到」点一次就完成签到，绝不跳转到网站界面。
 * 做法：App 里常驻一个 1x1 像素、不可见的 WebView（见 HeadlessCheckinHost），
 *      它和登录用的 WebView 共享同一份 Cookie，所以在后台打开站点页面就等于「已登录状态」，
 *      然后优先走签到接口；接口不存在就在页面里自动点签到按钮并确认「已签到」。
 *      整个过程用户看不到任何页面跳转。
 */

export const headlessBridge = new RelayBridge();

type Navigator = (uri: string) => void;
let navigator: Navigator | null = null;
let loadResolve: (() => void) | null = null;
let busy = false;

export function registerHeadlessNavigator(n: Navigator) {
  navigator = n;
}

export function notifyHeadlessLoad() {
  if (loadResolve) {
    const r = loadResolve;
    loadResolve = null;
    r();
  }
}

export function headlessReady(): boolean {
  return !!navigator;
}

function waitLoad(timeoutMs = 18000): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (loadResolve) loadResolve = null;
      resolve(false);
    }, timeoutMs);
    loadResolve = () => {
      clearTimeout(timer);
      resolve(true);
    };
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pageRoot(url: string): string {
  try {
    return new URL(url).origin;
  } catch {
    return url.replace(/\/+$/, '');
  }
}

export interface HeadlessProbe {
  /** 实际找到签到入口的页面地址，供下次直接打开 */
  pageUrl?: string;
  session: boolean;
  apiBase: string | null;
  self: SelfInfo | null;
  checkinSupport: CapabilityState;
  checkinMode: 'api' | 'dom' | null;
  note: string | null;
}

/**
 * 后台打开站点、嗅探真实 API 根、读取登录态与签到方式（不执行签到）。
 * 用于「手动粘贴 Key 后自动把站点收进每日签到」以及余额同步。
 */
async function probeAt(relay: Relay, pageUrl: string): Promise<HeadlessProbe> {
  headlessBridge.setUserId(null);
  headlessBridge.setApiBase(null);
  headlessBridge.setOrigin(pageUrl);
  navigator!(pageUrl);
  await waitLoad();
  // SPA 首屏请求可能晚于 onLoadEnd，稍等一下再读探针
  await sleep(1200);

  const uid = await readLocalUserId(headlessBridge);
  if (uid) headlessBridge.setUserId(uid);

  const hints = await headlessBridge.collectApiHints();
  const cands: string[] = [];
  const push = (u: string | null | undefined) => {
    if (!u) return;
    const clean = u.replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(clean)) return;
    if (cands.indexOf(clean) === -1) cands.push(clean);
  };
  if (relay.apiBase) {
    try {
      const u = new URL(relay.apiBase);
      if (/\/v\d+\/?$/i.test(u.pathname)) {
        // 手动粘贴的 /v1 地址不是面板 API 根，改用站点根
        push(u.origin);
      } else {
        push(relay.apiBase);
        push(u.origin);
      }
    } catch {
      push(relay.apiBase);
    }
  }
  for (const c of deriveApiCandidates(hints, headlessBridge.currentOrigin)) push(c);
  push(headlessBridge.currentOrigin);

  let self: SelfInfo | null = null;
  let apiBase: string | null = null;
  for (const c of cands) {
    headlessBridge.setApiBase(c);
    const s = await fetchSelf(headlessBridge);
    if (s.ok && s.self) {
      self = s.self;
      apiBase = c;
      break;
    }
  }
  if (!self) {
    // 读不到账号接口，但页面可能仍然有「签到 / 已签到」按钮。
    // 只要能确认页面上的签到入口，就允许后续用网页按钮签到。
    const dom = await domHasCheckinButton(headlessBridge);
    if (dom.found) {
      return { pageUrl, session: false, apiBase: null, self: null, checkinSupport: 'unknown', checkinMode: 'dom', note: dom.message };
    }
    return { pageUrl, session: false, apiBase: null, self: null, checkinSupport: 'unknown', checkinMode: null, note: '后台读不到登录态（Cookie 可能已失效）' };
  }

  const support = await fetchCheckinSupport(headlessBridge);
  if (support.support === 'yes') {
    return { pageUrl, session: true, apiBase, self, checkinSupport: 'yes', checkinMode: 'api', note: null };
  }
  const dom = await domHasCheckinButton(headlessBridge);
  if (dom.found) {
    return { pageUrl, session: true, apiBase, self, checkinSupport: 'yes', checkinMode: 'dom', note: dom.message };
  }
  const explicitNo = support.support === 'no' && /未开启|未启用|已关闭|not enabled/i.test(support.reason || '');
  return {
    pageUrl,
    session: true,
    apiBase,
    self,
    // 只是接口 404、页面按钮又没抓到时，不能断言「不支持」，只能说「无法确认」
    checkinSupport: explicitNo ? 'no' : 'unknown',
    checkinMode: null,
    note: support.reason || dom.message || null,
  };
}

async function probeLocked(relay: Relay): Promise<HeadlessProbe> {
  const root = pageRoot(relay.baseUrl);
  // 先打开用户保存的完整页面（很多站的「签到」按钮只在控制台路由上），
  // 再依次尝试站点根和常见控制台路由。以「能找到签到按钮」的页面为准。
  const urls: string[] = [];
  const push = (u: string) => {
    const v = (u || '').replace(/\/+$/, '');
    if (v && urls.indexOf(v) === -1) urls.push(v);
  };
  push(relay.baseUrl);
  push(root + '/');
  push(root + '/console');

  let best: HeadlessProbe | null = null;
  let bestScore = -1;
  let bestUrl = '';
  let lastUrl = '';
  for (const u of urls) {
    const p = await probeAt(relay, u);
    lastUrl = u;
    const score = p.session && p.checkinMode ? 3 : p.checkinMode ? 2 : p.session ? 1 : 0;
    if (score > bestScore) {
      best = p;
      bestScore = score;
      bestUrl = u;
    }
    // 已经读到登录态，并且这个页面确实有签到入口：直接采用
    if (score === 3) return p;
  }
  // 最后停在的页面可能不是读到登录态的那一页；切回最佳页面再确认，
  // 否则后面的签到会点在错误的页面上。
  if (best && (best.session || best.checkinMode) && bestUrl && bestUrl !== lastUrl) {
    const again = await probeAt(relay, bestUrl);
    if (again.session || again.checkinMode) return again;
  }
  return (
    best || {
      session: false,
      apiBase: null,
      self: null,
      checkinSupport: 'unknown',
      checkinMode: null,
      note: '后台读不到登录态（Cookie 可能已失效）',
    }
  );
}

export async function headlessProbeSite(relay: Relay): Promise<HeadlessProbe> {
  if (!navigator) {
    return { session: false, apiBase: null, self: null, checkinSupport: 'unknown', checkinMode: null, note: '后台组件未就绪' };
  }
  if (busy) {
    return { session: false, apiBase: null, self: null, checkinSupport: 'unknown', checkinMode: null, note: '上一个后台任务还在执行' };
  }
  busy = true;
  try {
    return await probeLocked(relay);
  } catch (e: any) {
    return { session: false, apiBase: null, self: null, checkinSupport: 'unknown', checkinMode: null, note: `后台探测异常：${e?.message || e}` };
  } finally {
    busy = false;
  }
}

export interface HeadlessCheckinResult {
  ok: boolean;
  /** success | failed | manual_only | unconfirmed */
  outcome: 'success' | 'failed' | 'manual_only' | 'unconfirmed';
  message: string;
  mode?: 'api' | 'dom' | null;
  probe?: HeadlessProbe;
}

/** 单站点后台签到；同一时刻只跑一个，避免隐形 WebView 被并发抢占 */
export async function headlessCheckin(relay: Relay): Promise<HeadlessCheckinResult> {
  if (!navigator) {
    return { ok: false, outcome: 'unconfirmed', message: '后台签到组件未就绪，请稍后再点一次' };
  }
  if (busy) {
    return { ok: false, outcome: 'unconfirmed', message: '上一个签到还在后台执行，请稍后再点' };
  }
  busy = true;
  try {
    const probe = await probeLocked(relay);
    if (!probe.session && !probe.checkinMode) {
      return {
        ok: false,
        outcome: 'unconfirmed',
        message: '后台读不到登录态：请到「中转站」里打开该站并登录一次，登录后会自动保存会话，之后就能一键签到',
        mode: null,
        probe,
      };
    }

    if (probe.checkinMode === 'api') {
      const r = await doCheckin(headlessBridge);
      return {
        ok: r.outcome === 'success',
        outcome: r.outcome,
        message: r.message,
        mode: 'api',
        probe,
      };
    }
    if (probe.checkinMode === 'dom') {
      const dom = await domCheckin(headlessBridge);
      return {
        ok: dom.ok,
        outcome: dom.ok ? 'success' : 'unconfirmed',
        message: dom.message,
        mode: 'dom',
        probe,
      };
    }
    // 最后一搏：有些 SPA 的签到按钮是延迟渲染的，直接再找一次并点击
    const late = await domCheckin(headlessBridge);
    if (late.ok) {
      return { ok: true, outcome: 'success', message: late.message, mode: 'dom', probe };
    }
    return {
      ok: false,
      outcome: probe.checkinSupport === 'no' ? 'manual_only' : 'unconfirmed',
      message: late.message || probe.note || '该站点没有检测到可用的签到入口',
      mode: null,
      probe,
    };
  } catch (e: any) {
    return { ok: false, outcome: 'unconfirmed', message: `后台签到异常：${e?.message || e}` };
  } finally {
    busy = false;
  }
}
