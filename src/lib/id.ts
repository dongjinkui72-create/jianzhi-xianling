/** 本机 ID 生成（不依赖任何云端，不涉及账号体系） */
let counter = 0;

export function uid(prefix = 'id'): string {
  counter += 1;
  const rand = Math.random().toString(36).slice(2, 8);
  const time = Date.now().toString(36);
  return `${prefix}_${time}${rand}${counter.toString(36)}`;
}

/** SecureStore 的 key 只允许 [A-Za-z0-9._-] */
export function secretRef(prefix: string, id: string): string {
  return `${prefix}.${id.replace(/[^A-Za-z0-9_\-]/g, '_')}`;
}