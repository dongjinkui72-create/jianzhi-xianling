import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * 本机加密区（SecureStore）。
 *
 * 产品红线：真实 API Key、中转站访问令牌、账号密码一律只进这里，
 * SQLite 里只存掩码；任何数据都不上传云端。
 */

const available = Platform.OS === 'ios' || Platform.OS === 'android';

export async function putSecret(ref: string, value: string): Promise<boolean> {
  if (!available) return false;
  try {
    await SecureStore.setItemAsync(ref, value, { keychainAccessible: SecureStore.WHEN_UNLOCKED });
    return true;
  } catch {
    try {
      await SecureStore.setItemAsync(ref, value);
      return true;
    } catch {
      return false;
    }
  }
}

export async function getSecret(ref: string | null | undefined): Promise<string | null> {
  if (!available || !ref) return null;
  try {
    return await SecureStore.getItemAsync(ref);
  } catch {
    return null;
  }
}

export async function delSecret(ref: string | null | undefined): Promise<void> {
  if (!available || !ref) return;
  try {
    await SecureStore.deleteItemAsync(ref);
  } catch {
    /* 忽略 */
  }
}

/** SecureStore 单值上限约 2048 字节，超长内容分片存 */
const CHUNK = 1800;

export async function putSecretLarge(ref: string, value: string): Promise<boolean> {
  if (value.length <= CHUNK) return putSecret(ref, value);
  const parts = Math.ceil(value.length / CHUNK);
  let ok = await putSecret(`${ref}.n`, String(parts));
  for (let i = 0; i < parts && ok; i++) {
    ok = await putSecret(`${ref}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
  }
  return ok;
}

export async function getSecretLarge(ref: string): Promise<string | null> {
  const nRaw = await getSecret(`${ref}.n`);
  if (!nRaw) return getSecret(ref);
  const n = Number(nRaw);
  if (!isFinite(n) || n <= 0) return getSecret(ref);
  let out = '';
  for (let i = 0; i < n; i++) {
    const part = await getSecret(`${ref}.${i}`);
    if (part == null) return null;
    out += part;
  }
  return out;
}

/* base64 抽到 src/lib/base64.ts（纯函数，便于单测） */
export { toBase64, utf8Bytes, bytesToBase64 } from '../lib/base64';
