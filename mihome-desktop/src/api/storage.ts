/** 通过 Tauri command 存取系统凭据管理器中的认证数据 */
import { invoke } from '@tauri-apps/api/core';
import type { AuthData } from './types';

/** Windows 凭据管理器单条上限 2560 字符，只保留必要字段 */
const KEEP_KEYS = [
  'ua', 'deviceId', 'pass_o', 'ssecurity', 'userId', 'cUserId',
  'passToken', 'serviceToken', 'nonce', 'psecurity', 'expireTime', 'saveTime',
] as const;

function sanitizeAuth(a: AuthData): AuthData {
  const out: Record<string, unknown> = {};
  for (const k of KEEP_KEYS) {
    const v = (a as Record<string, unknown>)[k];
    if (v !== undefined && v !== null) out[k] = v;
  }
  return out as AuthData;
}

export async function loadAuth(): Promise<AuthData | null> {
  const s = await invoke<string | null>('load_auth');
  if (!s) return null;
  try {
    return JSON.parse(s) as AuthData;
  } catch {
    return null;
  }
}

export async function saveAuth(auth: AuthData): Promise<void> {
  await invoke('save_auth', { payload: { data: JSON.stringify(sanitizeAuth(auth)) } });
}

export async function deleteAuth(): Promise<void> {
  await invoke('delete_auth');
}
