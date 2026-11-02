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
export class RelayBridge implements Transport {
  readonly name = 'bridge' as const;

  private webviewRef: WebViewRefLike | null = null;
  private origin: string | null = null;
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
    const url = path.startsWith('http') ? path : `${this.origin}${path.startsWith('/') ? '' : '/'}${path}`;
    const method = (init.method || 'GET').toUpperCase();
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers || {}) };
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
}