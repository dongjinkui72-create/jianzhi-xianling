import type { RelayResponse, RequestInitLite, Transport } from './relayApi';
import { uid } from '../lib/id';

/** 只依赖 injectJavaScript，避免与不同版本的 WebView 泛型打架 */
export type WebViewRefLike = { current: { injectJavaScript: (js: string) => void } | null };

/**
 * WebView 桥接传输层。
 *
 * 为什么用它而不是直接 fetch：
 *  中转站登录后的 session cookie 通常是 HttpOnly，JS 读不到；
 *  但在 WebView 内部发起 fetch 时，浏览器会自动带上同源 Cookie。
 *  所以「读取登录态 → 拉余额 → 自动建 Key → 签到」全部通过页面内 fetch 完成，
 *  不需要用户复制粘贴任何东西，也不依赖额外的原生 Cookie 模块。
 *
 * 限制（如实告知）：桥接只在 WebView 停留在该站点同源页面时有效。
 */
/** 页面加载前注入的网络探针：记录 SPA 真实调用的 /api/ 地址，用于发现非标准 API 根 */
export const SPY_JS = `;(function(){
  if (window.__jzSpy) return;
  window.__jzSpy = 1;
  window.__jzApis = [];
  var rec = function(u){
    try {
      if (typeof u !== 'string') return;
      // 相对地址（/apiroot/api/...）先补全成绝对地址，否则前缀会被丢掉
      var abs = u;
      if (!/^https?:\/\//i.test(abs)) {
        try { abs = new URL(abs, location.href).toString(); } catch (e) { if (abs.charAt(0) === '/') abs = location.origin + abs; }
      }
      var i = abs.indexOf('/api/');
      if (i < 0) return;
      var base = abs.slice(0, i);
      if (!base || window.__jzApis.indexOf(base) !== -1) return;
      if (window.__jzApis.length < 30) window.__jzApis.push(base);
    } catch (e) {}
  };
  try {
    var of = window.fetch;
    window.fetch = function(input){
      try { rec(typeof input === 'string' ? input : (input && input.url)); } catch (e) {}
      return of.apply(this, arguments);
    };
    var oo = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(m, u){
      try { rec(u); } catch (e) {}
      return oo.apply(this, arguments);
    };
  } catch (e) {}
})(); true;`;
export class RelayBridge implements Transport {
  readonly name = 'bridge' as const;

  private webviewRef: WebViewRefLike | null = null;
  private origin: string | null = null;
  /** 探针嗅探到的真实 API 根地址（可能与页面 origin 不同） */
  private apiBase: string | null = null;
  /** New API 部分部署要求 New-Api-User 头；从页面 localStorage 读到的用户 ID */
  private userId: string | null = null;
  private pending = new Map<string, (r: RelayResponse) => void>();
  private timers = new Map<string, any>();

  attach(webviewRef: WebViewRefLike) {
    this.webviewRef = webviewRef;
  }

  detach() {
    this.webviewRef = null;
    this.origin = null;
    this.rejectAll('WebView 已关闭');
  }

  setApiBase(base: string | null) {
    this.apiBase = base ? base.replace(/\/+$/, '') : null;
  }

  get currentApiBase(): string | null {
    return this.apiBase;
  }

  setUserId(id: string | number | null) {
    this.userId = id == null || id === '' ? null : String(id);
  }

  get currentUserId(): string | null {
    return this.userId;
  }

  setOrigin(url: string | null) {
    try {
      this.origin = url ? new URL(url).origin : null;
    } catch {
      this.origin = null;
    }
  }

  get currentOrigin(): string | null {
    return this.origin;
  }

  get ready(): boolean {
    return !!this.webviewRef?.current && !!this.origin;
  }

  rejectAll(reason: string) {
    for (const [, resolve] of this.pending) {
      resolve({ ok: false, status: 0, error: reason });
    }
    for (const [, t] of this.timers) clearTimeout(t);
    this.pending.clear();
    this.timers.clear();
  }

  /** WebView onMessage 回调入口 */
  handleMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || msg.__jz !== 1 || typeof msg.rid !== 'string') return;
    if (msg.isEval) {
      const resolveEval = this.pending.get(msg.rid);
      if (resolveEval) {
        const t = this.timers.get(msg.rid);
        if (t) clearTimeout(t);
        this.timers.delete(msg.rid);
        this.pending.delete(msg.rid);
        resolveEval({ ok: true, status: 200, data: msg.data });
      }
      return;
    }
    const resolve = this.pending.get(msg.rid);
    if (!resolve) return;
    const timer = this.timers.get(msg.rid);
    if (timer) clearTimeout(timer);
    this.timers.delete(msg.rid);
    this.pending.delete(msg.rid);
    resolve({
      ok: !!msg.ok,
      status: Number(msg.status) || 0,
      data: msg.data ?? undefined,
      error: msg.error ? String(msg.error) : undefined,
      text: msg.text ? String(msg.text) : undefined,
    });
  }

  async request(path: string, init: RequestInitLite = {}): Promise<RelayResponse> {
    const wv = this.webviewRef?.current;
    if (!wv) {
      return { ok: false, status: 0, error: 'WebView 尚未就绪' };
    }
    if (!this.origin) {
      return { ok: false, status: 0, error: '当前页面不在站点域内，无法代理请求' };
    }

    const rid = uid('rq');
    // 请求根优先用嗅探出来的真实 API 根（公益站常见 api.xxx 子域 / 非 /api 前缀）
    const base = this.apiBase || this.origin;
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? '' : '/'}${path}`;
    const method = (init.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers || {}) };
    if (this.userId) headers['New-Api-User'] = this.userId;
    let bodyLiteral = 'null';
    if (init.body != null) {
      headers['Content-Type'] = 'application/json';
      bodyLiteral = JSON.stringify(typeof init.body === 'string' ? init.body : JSON.stringify(init.body));
    }

    const js = `;(function(){
  var rid = ${JSON.stringify(rid)};
  var send = function(p){ try { window.ReactNativeWebView.postMessage(JSON.stringify(p)); } catch(e) {} };
  try {
    fetch(${JSON.stringify(url)}, {
      method: ${JSON.stringify(method)},
      credentials: 'include',
      headers: ${JSON.stringify(headers)},
      body: ${bodyLiteral}
    }).then(function(r){
      return r.text().then(function(t){ return { status: r.status, text: t }; });
    }).then(function(res){
      var data = null;
      try { data = JSON.parse(res.text); } catch(e) {}
      send({ __jz: 1, rid: rid, ok: res.status >= 200 && res.status < 300, status: res.status, data: data, text: (res.text || '').slice(0, 3000) });
    }).catch(function(e){
      send({ __jz: 1, rid: rid, ok: false, status: 0, error: String((e && e.message) || e) });
    });
  } catch (e) {
    send({ __jz: 1, rid: rid, ok: false, status: 0, error: String((e && e.message) || e) });
  }
})(); true;`;

    return new Promise<RelayResponse>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pending.has(rid)) {
          this.pending.delete(rid);
          this.timers.delete(rid);
          resolve({ ok: false, status: 0, error: '请求超时（15s），可能是站点未响应或页面已跳走' });
        }
      }, init.timeoutMs ?? 15000);
      this.timers.set(rid, timeout);
      this.pending.set(rid, resolve);
      try {
        wv.injectJavaScript(js);
      } catch (e: any) {
        clearTimeout(timeout);
        this.timers.delete(rid);
        this.pending.delete(rid);
        resolve({ ok: false, status: 0, error: `注入失败：${e?.message || e}` });
      }
    });
  }

  /** 汇总页面探针 + 浏览器 performance 里的 API 请求地址（双保险，防止探针漏记） */
  async collectApiHints(): Promise<string[]> {
    const a = await this.eval('(window.__jzApis || [])', 8000);
    const b = await this.eval(
      `(function(){try{return performance.getEntriesByType('resource').map(function(e){return e.name;}).filter(function(n){return n.indexOf('/api')>=0;}).slice(0,80);}catch(e){return [];}})()`,
      8000,
    );
    const out: string[] = [];
    for (const arr of [a, b]) {
      if (Array.isArray(arr)) for (const v of arr) if (typeof v === 'string' && out.indexOf(v) === -1) out.push(v);
    }
    return out;
  }

  /** 在页面里求值（支持 Promise），用于读取探针记录 / 操作 DOM */
  async eval(expr: string, timeoutMs = 15000): Promise<any> {
    const wv = this.webviewRef?.current;
    if (!wv) return undefined;
    const rid = uid('ev');
    const js = `;(function(){
  var rid = ${JSON.stringify(rid)};
  var send = function(v){ try { window.ReactNativeWebView.postMessage(JSON.stringify({ __jz: 1, rid: rid, isEval: true, data: v })); } catch(e) {} };
  try {
    Promise.resolve().then(function(){ return ${expr}; }).then(send, function(e){ send('EVAL_ERROR: ' + String((e && e.message) || e)); });
  } catch (e) {
    send('EVAL_ERROR: ' + String((e && e.message) || e));
  }
})(); true;`;
    return new Promise<any>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pending.has(rid)) {
          this.pending.delete(rid);
          this.timers.delete(rid);
          resolve(undefined);
        }
      }, timeoutMs);
      this.timers.set(rid, timer);
      this.pending.set(rid, (r) => resolve(r.data));
      try {
        wv.injectJavaScript(js);
      } catch {
        clearTimeout(timer);
        this.pending.delete(rid);
        this.timers.delete(rid);
        resolve(undefined);
      }
    });
  }
}