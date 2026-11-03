import { RelayBridge } from './relayBridge';
import { doCheckin, domCheckin, fetchCheckinSupport, fetchSelf } from './relayApi';
import type { Relay } from '../lib/types';

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

export interface HeadlessCheckinResult {
  ok: boolean;
  /** success | failed | manual_only | unconfirmed */
  outcome: 'success' | 'failed' | 'manual_only' | 'unconfirmed';
  message: string;
}

function waitLoad(timeoutMs = 15000): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (loadResolve) {
        loadResolve = null;
      }
      resolve();
    }, timeoutMs);
    loadResolve = () => {
      clearTimeout(timer);
      resolve();
    };
  });
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
    const base = relay.apiBase || relay.baseUrl;
    let origin = base;
    try {
      origin = new URL(base).origin;
    } catch {
      /* keep base */
    }

    headlessBridge.setApiBase(base);
    headlessBridge.setOrigin(origin);
    navigator(origin + '/');
    await waitLoad();

    const self = await fetchSelf(headlessBridge);
    if (!self.ok || !self.self) {
      return {
        ok: false,
        outcome: 'manual_only',
        message: '后台读不到登录态（Cookie 可能已失效）：到「中转站」里重新登录一次即可恢复一键签到',
      };
    }

    const support = await fetchCheckinSupport(headlessBridge);
    if (support.support === 'yes') {
      const r = await doCheckin(headlessBridge);
      return { ok: r.outcome === 'success', outcome: r.outcome, message: r.message };
    }

    const dom = await domCheckin(headlessBridge);
    if (dom.ok) return { ok: true, outcome: 'success', message: dom.message };
    if (support.support === 'no') {
      return { ok: false, outcome: 'manual_only', message: support.reason || '该站未开放签到' };
    }
    return { ok: false, outcome: 'unconfirmed', message: dom.message || support.reason || '签到结果无法确认' };
  } catch (e: any) {
    return { ok: false, outcome: 'unconfirmed', message: `后台签到异常：${e?.message || e}` };
  } finally {
    busy = false;
  }
}