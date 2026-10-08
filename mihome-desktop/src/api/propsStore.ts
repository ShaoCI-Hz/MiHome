/**
 * 属性中心化仓库 + 统一调度（批次2性能核心）
 *
 * 之前：每张卡片各自请求属性、各自 60s 轮询 → N 卡 = N 路签名请求；
 * 现在：卡片只订阅本机数据，请求由调度器合并去重、分批批量拉取（O(N) → O(1)）。
 */
import { create } from 'zustand';
import { useShallow } from 'zustand/shallow';
import { useApp } from './store';
import { getSpec, extractControls } from './spec';
import { log } from './log';
import type { PropKey, PropValue } from './types';

/** 复合键：`${did}:${siid}.${piid}` */
const propKey = (did: string, siid: number, piid: number) => `${did}:${siid}.${piid}`;

interface PropsState {
  values: Record<string, unknown>;
  patch: (next: Record<string, unknown>) => void;
}

export const useProps = create<PropsState>((set) => ({
  values: {},
  patch: (next) => set((s) => ({ values: { ...s.values, ...next } })),
}));

/** 乐观写入单个属性值（控制时立即回显，失败由调用方回滚） */
export function setPropValue(did: string, siid: number, piid: number, value: unknown): void {
  useProps.getState().patch({ [propKey(did, siid, piid)]: value });
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
      for (const c of extractControls(spec)) {
        keys.push({ did, siid: c.siid, piid: c.piid });
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
      for (const r of ret) {
        if (r.code === 0 || r.code === 1) next[propKey(r.did, r.siid, r.piid)] = r.value;
      }
      useProps.getState().patch(next);
      log(`批量属性: ${chunk.length} keys → ${Object.keys(next).length} 值`);
    } catch (e) {
      log('批量属性请求失败 -', e);
    }
  }
}
