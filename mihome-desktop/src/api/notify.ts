/**
 * 系统通知：仅当窗口不可见时发送（可见时用 Toast 即可，避免重复打扰）
 */
import { isPermissionGranted, requestPermission, sendNotification } from '@tauri-apps/plugin-notification';
import { log } from './log';

let permission: boolean | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permission !== null) return permission;
  try {
    if (await isPermissionGranted()) {
      permission = true;
      return true;
    }
    permission = (await requestPermission()) === 'granted';
    return permission;
  } catch {
    permission = false;
    return false;
  }
}

/**
 * 发送系统通知（窗口可见时自动跳过，只留 Toast）
 * @returns 是否实际发送
 */
export function notify(title: string, body: string): boolean {
  if (document.visibilityState === 'visible') return false;
  void ensurePermission().then((ok) => {
    if (!ok) return;
    try {
      sendNotification({ title, body });
      log('系统通知:', title, '-', body);
    } catch (e) {
      log('通知失败 -', e);
    }
  });
  return true;
}
