/**
 * 数据快照缓存（离线降级用）
 *
 * 凭据走 Windows 凭据管理器（storage.ts），这里只缓存可公开的家庭/设备/场景
 * 结构化数据，用于网络不可用或接口失效时的只读展示。存 localStorage，不含凭据。
 */
import type { MiDevice, MiHome, MiRoom, MiScene } from './types';

const CACHE_KEY = 'mi-data-cache';
/** 缓存有效期：超过 7 天视为太旧，不再当离线数据展示 */
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

export interface DataCache {
  savedAt: number;
  homes: MiHome[];
  currentHomeId: string | null;
  devices: MiDevice[];
  scenes: MiScene[];
  currentRooms: MiRoom[];
}

export function saveDataCache(
  data: Omit<DataCache, 'savedAt'>,
): void {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    /* 存储失败不影响主流程 */
  }
}

export function loadDataCache(): DataCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as DataCache;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 缓存新鲜度：X 分钟前 / X 小时前 */
export function cacheAgeText(savedAt: number): string {
  const min = Math.floor((Date.now() - savedAt) / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  return `${Math.floor(min / 60)} 小时前`;
}
