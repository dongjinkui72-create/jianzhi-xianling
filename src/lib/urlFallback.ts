/**
 * 加载失败时的回退链：当前地址 -> 逐级上级路径 -> 站点根。
 * 典型场景：公益站/路由站的 /docs 等子路由源站坏掉（Cloudflare 502），
 * 而站点根路径是好的。纯函数，便于单测。
 */
export function fallbackChain(u: string): string[] {
  const out: string[] = [];
  try {
    const parsed = new URL(u);
    out.push(u);
    let path = parsed.pathname;
    while (path && path !== '/') {
      path = path.replace(/\/[^/]*\/?$/, '') || '/';
      const cand = parsed.origin + path;
      if (out.indexOf(cand) === -1) out.push(cand);
    }
    if (out.indexOf(parsed.origin + '/') === -1) out.push(parsed.origin + '/');
  } catch {
    out.push(u);
  }
  return out;
}