/**
 * 本地定时执行手动场景（本机自动化，不依赖云端自动化接口）
 *
 * 云端自动化列表接口未逆向（见 HANDOFF），但手动场景执行 API 已可用：
 * 这里在本机做定时调度，到点执行指定场景。全部数据存 localStorage，
 * 只在本机生效，换机不迁移。
 */
import { log } from './log';

const KEY = 'mi-local-schedules';

export interface LocalSchedule {
  id: string;
  /** 目标场景 */
  sceneId: string;
  sceneName: string;
  /** 场景所属家庭（执行时用它，避免切家庭后跑错） */
  homeId: string;
  /** 触发时间 "HH:MM" */
  time: string;
  /** 重复：0=周日 … 6=周六；空数组=每天 */
  days: number[];
  enabled: boolean;
  /** 上次触发标记 "YYYY-MM-DD HH:MM"，防同一分钟重复执行 */
  lastRun?: string;
}

export function loadSchedules(): LocalSchedule[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as LocalSchedule[];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function saveSchedules(list: LocalSchedule[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* ignore */
  }
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** 当前时刻的 "HH:MM" 与 "YYYY-MM-DD" */
function nowParts(now: Date): { hm: string; day: string; weekday: number } {
  return {
    hm: `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    day: `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    weekday: now.getDay(),
  };
}

export type ScheduleDue = { schedule: LocalSchedule; runKey: string };

/**
 * 找出当前分钟应当执行且尚未执行过的任务（不修改存储，由调用方执行成功后标记）
 */
export function dueSchedules(now = new Date()): ScheduleDue[] {
  const { hm, day, weekday } = nowParts(now);
  const out: ScheduleDue[] = [];
  for (const s of loadSchedules()) {
    if (!s.enabled) continue;
    if (s.time !== hm) continue;
    if (s.days.length > 0 && !s.days.includes(weekday)) continue;
    const runKey = `${day} ${hm}`;
    if (s.lastRun === runKey) continue;
    out.push({ schedule: s, runKey });
  }
  return out;
}

/** 标记任务已执行（防同一分钟重跑） */
export function markRan(id: string, runKey: string): void {
  const list = loadSchedules();
  const item = list.find((x) => x.id === id);
  if (!item) return;
  item.lastRun = runKey;
  saveSchedules(list);
  log('定时任务已标记执行', id, runKey);
}

/** 重复描述文本 */
export function daysText(days: number[]): string {
  if (days.length === 0 || days.length === 7) return '每天';
  const names = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => names[d]).join('、');
}

export function newId(): string {
  return `sch-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}
