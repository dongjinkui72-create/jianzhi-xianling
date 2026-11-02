import type { ApiKeyItem } from './types';

/**
 * 可用池三分组（纯函数，便于单测）：
 *  - 绿色可用：体检通过 / 还没体检（待体检也先放可用区，体检后自动归位）
 *  - 黄色预警：额度低于阈值，静默移入
 *  - 红色无效：接口不可用 / 额度耗尽，静默移入
 * 红线：任何分组都不出现「建议删除该 API」这类提示。
 */
export interface PoolGroups {
  green: ApiKeyItem[];
  yellow: ApiKeyItem[];
  red: ApiKeyItem[];
}

export function groupKeys(keys: ApiKeyItem[]): PoolGroups {
  const green: ApiKeyItem[] = [];
  const yellow: ApiKeyItem[] = [];
  const red: ApiKeyItem[] = [];
  for (const k of keys) {
    if (k.status === 'low') yellow.push(k);
    else if (k.status === 'dead') red.push(k);
    else green.push(k);
  }
  const byQuota = (a: ApiKeyItem, b: ApiKeyItem) => (b.remainingTokens ?? 0) - (a.remainingTokens ?? 0);
  green.sort(byQuota);
  yellow.sort(byQuota);
  red.sort((a, b) => (b.checkedAt ?? 0) - (a.checkedAt ?? 0));
  return { green, yellow, red };
}

/** 只有绿色分组里的 Key 可以被选中启动 */
export function isSelectable(k: ApiKeyItem): boolean {
  return k.status === 'ok' || k.status === 'unknown';
}