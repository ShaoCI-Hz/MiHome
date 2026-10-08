/**
 * 本地偏好：设备本地重命名、自定义拖拽顺序、主题
 * 全部存 localStorage（不进云端，不影响其他端）
 */

const RENAME_KEY = 'mi-rename-map';
const ORDER_KEY = 'mi-card-order';
const THEME_KEY = 'mi-theme';

export type ThemePref = 'auto' | 'light' | 'dark';
export type SortMode = 'online' | 'name' | 'type' | 'order';

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

/* ===== 本地重命名 ===== */

export function getRenameMap(): Record<string, string> {
  return readJson<Record<string, string>>(RENAME_KEY, {});
}

export function getDisplayName(did: string, fallback: string): string {
  return getRenameMap()[did] ?? fallback;
}

export function setDisplayName(did: string, name: string): void {
  const map = getRenameMap();
  if (name.trim()) map[did] = name.trim();
  else delete map[did];
  writeJson(RENAME_KEY, map);
}

/* ===== 自定义拖拽顺序（按家庭） ===== */

export function getOrder(homeId: string): string[] {
  return readJson<Record<string, string[]>>(ORDER_KEY, {})[homeId] ?? [];
}

export function setOrder(homeId: string, dids: string[]): void {
  const all = readJson<Record<string, string[]>>(ORDER_KEY, {});
  all[homeId] = dids;
  writeJson(ORDER_KEY, all);
}

/** 把设备列表按自定义顺序排列；未收录设备按原序追加在后 */
export function applyOrder<T extends { did: string }>(homeId: string, list: T[]): T[] {
  const order = getOrder(homeId);
  if (!order.length) return list;
  const idx = new Map(order.map((d, i) => [d, i]));
  const known: T[] = [];
  const unknown: T[] = [];
  for (const d of list) (idx.has(d.did) ? known : unknown).push(d);
  known.sort((a, b) => (idx.get(a.did)!) - (idx.get(b.did)!));
  return [...known, ...unknown];
}

/** 将 dragged 移动到 target 之前，返回新顺序（基于当前列表） */
export function reorderList<T extends { did: string }>(list: T[], draggedDid: string, targetDid: string): T[] {
  const arr = [...list];
  const from = arr.findIndex((d) => d.did === draggedDid);
  const to = arr.findIndex((d) => d.did === targetDid);
  if (from < 0 || to < 0 || from === to) return arr;
  const [moved] = arr.splice(from, 1);
  arr.splice(to, 0, moved);
  return arr;
}

/* ===== 主题 ===== */

export function getThemePref(): ThemePref {
  const v = localStorage.getItem(THEME_KEY);
  return v === 'light' || v === 'dark' ? v : 'auto';
}

export function setThemePref(v: ThemePref): void {
  try {
    localStorage.setItem(THEME_KEY, v);
  } catch {
    /* ignore */
  }
}

/** 解析主题并应用到 <html data-theme> */
export function applyTheme(): void {
  const pref = getThemePref();
  const dark =
    pref === 'dark' ||
    (pref === 'auto' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
}
