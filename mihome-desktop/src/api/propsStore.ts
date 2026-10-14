/**
 * 属性中心化仓库 + 统一调度（批次2性能核心）
 *
 * 之前：每张卡片各自请求属性、各自 60s 轮询 → N 卡 = N 路签名请求；
 * 现在：卡片只订阅本机数据，请求由调度器合并去重、分批批量拉取（O(N) → O(1)）。
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { useApp } from './store';
import { getSpec, expandSpec } from './spec';
import { log } from './log';
import type { PropKey, PropValue } from './types';
import { MiLoginError } from './types';

/** 复合键：`${did}:${siid}.${piid}` */
const propKey = (did: string, siid: number, piid: number) => `${did}:${siid}.${piid}`;

interface PropsState {
  values: Record<string, unknown>;
  /** 读取失败的属性：key → 错误码（区分"没数据/需网关/设备异常"） */
  failed: Record<string, number>;
  /** 最近一次成功批量拉取的时间戳（数据新鲜度） */
  updatedAt: number;
  patch: (next: Record<string, unknown>) => void;
  /** 记录/清除失败（成功读取时自动清除对应 key） */
  markFailed: (fails: Record<string, number>, oks: string[]) => void;
}

export const useProps = create<PropsState>((set) => ({
  values: {},
  failed: {},
  updatedAt: 0,
  patch: (next) => set((s) => ({ values: { ...s.values, ...next } })),
  markFailed: (fails, oks) =>
    set((s) => {
      const failed = { ...s.failed };
      for (const k of oks) delete failed[k];
      for (const [k, code] of Object.entries(fails)) failed[k] = code;
      return { failed };
    }),
}));

/** 失败码 → 用户可读原因 */
export function explainPropError(code: number): string {
  switch (code) {
    case -704040003:
      return '需蓝牙网关在线';
    case -704042011:
      return '设备离线';
    case -704010000:
      return '无权限读取';
    case -704040004:
    case -704040005:
      return '设备不支持';
    default:
      return `暂无数据(${code})`;
  }
}

/** 卡片订阅：本设备的失败码切片 */
function pickFailed(failed: Record<string, number>, did: string): Record<string, number> {
  const prefix = `${did}:`;
  const out: Record<string, number> = {};
  for (const k of Object.keys(failed)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = failed[k];
  }
  return out;
}

export function useDidFailed(did: string): Record<string, number> {
  return useProps(useShallow((s) => pickFailed(s.failed, did)));
}

/** 乐观写入单个属性值（控制时立即回显，失败由调用方回滚） */
export function setPropValue(did: string, siid: number, piid: number, value: unknown): void {
  useProps.getState().patch({ [propKey(did, siid, piid)]: value });
}

/** 拖动中的属性 key：轮询回包跳过这些键，防止旧值覆盖本地回显（滑条回跳） */
const frozenKeys = new Set<string>();
export function setPropFrozen(did: string, siid: number, piid: number, on: boolean): void {
  const k = propKey(did, siid, piid);
  if (on) frozenKeys.add(k);
  else frozenKeys.delete(k);
}

/** 提取某设备的全部属性切片（key 形如 `2.1`），配合 useShallow 避免无效重渲染 */
function pickDid(values: Record<string, unknown>, did: string): Record<string, unknown> {
  const prefix = `${did}:`;
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(values)) {
    if (k.startsWith(prefix)) out[k.slice(prefix.length)] = values[k];
  }
  return out;
}

/** 卡片订阅：本设备的属性切片（值相等时不重渲染） */
export function useDidValues(did: string): Record<string, unknown> {
  return useProps(useShallow((s) => pickDid(s.values, did)));
}

/* ===== 统一调度器：合并去重 + 短延迟批处理 ===== */
const pending = new Set<string>();
let timer: number | null = null;

/** 请求一批设备的属性（120ms 内合并去重，多次调用只发一轮） */
export function schedulePropsFetch(dids: string[]): void {
  for (const d of dids) pending.add(d);
  if (timer !== null) return;
  timer = window.setTimeout(() => {
    timer = null;
    const batch = [...pending];
    pending.clear();
    void doFetch(batch);
  }, 120);
}

/** 分批批量拉取（每批 300 key，规避服务端上限） */
async function doFetch(dids: string[]): Promise<void> {
  const { api, devices } = useApp.getState();
  const keys: PropKey[] = [];
  for (const did of dids) {
    const dev = devices.find((d) => d.did === did);
    if (!dev) continue;
    try {
      const spec = await getSpec(dev.model);
      if (!spec) continue;
      // 全量可读属性（含只读与开发者模式项）：详情页与卡片共用同一仓库、同一刷新节奏
      for (const p of expandSpec(spec).props) {
        keys.push({ did, siid: p.siid, piid: p.piid });
      }
    } catch {
      /* 该设备 spec 失败，跳过 */
    }
  }
  if (!keys.length) return;

  const CHUNK = 300;
  for (let i = 0; i < keys.length; i += CHUNK) {
    const chunk = keys.slice(i, i + CHUNK);
    try {
      const ret = (await api.getDevicesProp(chunk)) as PropValue[];
      const next: Record<string, unknown> = {};
      const fails: Record<string, number> = {};
      const oks: string[] = [];
      for (const r of ret) {
        const k = propKey(r.did, r.siid, r.piid);
        if (r.code === 0 || r.code === 1) {
          next[k] = r.value;
          oks.push(k);
        } else {
          // 不再静默丢弃：记录失败码供 UI 分类解释
          fails[k] = r.code;
        }
      }
      const st = useProps.getState();
      // 拖动未提交的键不覆盖（否则轮询旧值会让滑条回跳）
      for (const k of Object.keys(next)) {
        if (frozenKeys.has(k)) delete next[k];
      }
      st.patch(next);
      st.markFailed(fails, oks);
      useProps.setState({ updatedAt: Date.now() });
      const failCount = Object.keys(fails).length;
      log(`批量属性: ${chunk.length} keys → ${Object.keys(next).length} 值${failCount ? `（${failCount} 项失败）` : ''}`);
    } catch (e) {
      // 登录态失效（非网络抖动）→ 全链路回到登录页；其他失败保持静默重试（下轮轮询自愈）
      if (e instanceof MiLoginError && e.expired) {
        log('批量属性：登录态失效，触发自愈');
        useApp.getState().sessionExpired();
        return;
      }
      log('批量属性请求失败 -', e);
    }
  }
}
