/**
 * MIoT 设备规格（spec）获取与缓存
 * spec_type 来自设备列表的 urn，如 urn:miot-spec-v2:device:fans:...
 * 在线规格库: home.miot-spec.com
 */
import { fetch } from '@tauri-apps/plugin-http';

export interface SpecProperty {
  type: string; // urn:miot-spec-v2:property:on
  iid: number;
  description?: string;
  /** 官方中文名（来自 i18n.zh_cn，无则回退 description） */
  label?: string;
  format: 'bool' | 'uint8' | 'uint16' | 'uint32' | 'int8' | 'int16' | 'int32' | 'float' | 'string' | 'object' | 'array';
  'value-list'?: { value: number | string; description?: string; label?: string }[];
  'value-range'?: [number, number, number];
  access?: string[];
  unit?: string;
}

export interface SpecAction {
  type: string;
  iid: number;
  description?: string;
  /** 官方中文名 */
  label?: string;
  in?: number[];
  out?: number[];
}

export interface SpecService {
  type: string; // urn:miot-spec-v2:service:fans / :property:...
  iid: number;
  description?: string;
  /** 官方中文名 */
  label?: string;
  properties?: SpecProperty[];
  actions?: SpecAction[];
}

export interface DeviceSpec {
  type: string;
  services: SpecService[];
}

const cache = new Map<string, DeviceSpec>();
const imageCache = new Map<string, string | null>();
const htmlCache = new Map<string, string | null>();

/** 抓取 miot-spec 页面 HTML（带缓存，image/spec 共用） */
async function fetchSpecPage(url: string): Promise<string | null> {
  if (htmlCache.has(url)) return htmlCache.get(url) ?? null;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      htmlCache.set(url, null);
      return null;
    }
    const html = await res.text();
    htmlCache.set(url, html);
    return html;
  } catch {
    htmlCache.set(url, null);
    return null;
  }
}

function urnTail(type: string): string {
  // urn:miot-spec-v2:property:on → on；短名如 "fan" 原样
  const parts = type.split(':');
  return parts[parts.length - 1];
}

/**
 * 获取设备官方产品图（miot-spec 页面的 og:image，小米 IoT 产品中心 CDN）
 * 失败返回 null（调用方回退占位图）
 */
export async function getDeviceImage(model: string): Promise<string | null> {
  if (imageCache.has(model)) return imageCache.get(model) ?? null;
  const html = await fetchSpecPage(`https://home.miot-spec.com/spec/${encodeURIComponent(model)}`);
  const m = html?.match(/property="og:image"\s+content="([^"]+)"/);
  const url = m ? m[1].replace(/&amp;/g, '&') : null;
  imageCache.set(model, url);
  return url;
}

/** 从任意对象深度优先找到含 services 数组的 tree 节点 */
function findTree(node: unknown): { services: unknown[] } | null {
  if (!node || typeof node !== 'object') return null;
  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.services)) return obj as unknown as { services: unknown[] };
  for (const v of Object.values(obj)) {
    const r = findTree(v);
    if (r) return r;
  }
  return null;
}

interface RawProp {
  iid: number;
  type: string;
  description?: string;
  format: string;
  access?: string[];
  valueList?: { value: number | string; description?: string }[];
  valueRange?: [number, number, number];
}

interface RawService {
  iid: number;
  type: string;
  description?: string;
  i18nKey?: string;
  properties?: RawProp[];
  actions?: { iid: number; type: string; description?: string; in?: number[]; out?: number[] }[];
}

/**
 * 获取设备规格（带缓存）
 * 从 miot-spec 页面内嵌的 <script data-page="app" type="application/json"> 中提取 tree.services
 * @param model 设备型号（如 dmaker.fan.p5c）
 */
export async function getSpec(model: string): Promise<DeviceSpec | null> {
  if (cache.has(model)) return cache.get(model)!;
  if (!model) return null;
  try {
    const url = `https://home.miot-spec.com/spec/${encodeURIComponent(model)}`;
    const html = await fetchSpecPage(url);
    if (!html) return null;

    // JSON 数据在 <script data-page="app" type="application/json"> 体内
    const m = html.match(
      /<script[^>]*data-page="app"[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/,
    );
    if (!m) return null;
    const page = JSON.parse(m[1]) as Record<string, unknown>;
    const pageProps = (page.props ?? page) as Record<string, unknown>;
    const tree = findTree(pageProps);
    if (!tree) return null;

    // 官方中文词典：i18n.zh_cn，键如 service:002:property:001
    const i18n =
      ((pageProps.i18n as Record<string, Record<string, string>> | undefined)?.zh_cn) ?? {};
    const pad = (n: number) => String(n).padStart(3, '0');

    const spec: DeviceSpec = {
      type: model,
      services: (tree.services as RawService[]).map((s) => {
        const svcKey = s.i18nKey ?? '';
        return {
          type: s.type,
          iid: s.iid,
          description: s.description,
          label: (svcKey && i18n[svcKey]) ?? s.description,
          properties: (s.properties ?? []).map((p) => {
            const pKey = svcKey ? `${svcKey}:property:${pad(p.iid)}` : '';
            return {
              type: p.type,
              iid: p.iid,
              description: p.description,
              label: (pKey && i18n[pKey]) ?? p.description,
              format: p.format as SpecProperty['format'],
              access: p.access,
              'value-list': p.valueList?.map((o, idx) => ({
                ...o,
                label: (pKey && i18n[`${pKey}:valuelist:${pad(idx)}`]) ?? o.description,
              })),
              'value-range': p.valueRange,
            };
          }),
          actions: (s.actions ?? []).map((a) => {
            const aKey = svcKey ? `${svcKey}:action:${pad(a.iid)}` : '';
            return {
              type: a.type,
              iid: a.iid,
              description: a.description,
              label: (aKey && i18n[aKey]) ?? a.description,
              in: a.in,
              out: a.out,
            };
          }),
        };
      }),
    };
    cache.set(model, spec);
    return spec;
  } catch (e) {
    console.error('getSpec 失败', model, e);
    return null;
  }
}

/**
 * 从规格中找能耗属性键（"siid.piid"），如插座的 power-consumption；无则 null
 */
export function findEnergyKey(spec: DeviceSpec | null): string | null {
  if (!spec) return null;
  const names = ['power-consumption', 'electric-energy', 'energy-consumption', 'power-cost'];
  for (const svc of spec.services) {
    for (const p of svc.properties ?? []) {
      const tail = p.type.split(':').pop() ?? p.type;
      if (names.includes(tail)) return `${svc.iid}.${p.iid}`;
    }
  }
  return null;
}

/** 从规格中提取控件描述 */
export interface ControlDesc {
  siid: number;
  piid: number;
  kind: 'switch' | 'slider' | 'enum' | 'readonly';
  label: string;
  urn: string;
  /** slider: min/max/step */
  range?: [number, number, number];
  /** enum: value → label */
  options?: { value: number | string; label: string }[];
}

/** 按优先级挑出设备的核心控件（最多 4 个） */
export function extractControls(spec: DeviceSpec): ControlDesc[] {
  const out: ControlDesc[] = [];
  const priority = ['on', 'brightness', 'target-temperature', 'target-humidity', 'mode', 'fan-level'];
  for (const svc of spec.services) {
    if (!svc.properties) continue;
    for (const p of svc.properties) {
      const name = urnTail(p.type);
      if (name.startsWith('parent') || name === 'device-information') continue;
      const access = p.access ?? [];
      const canWrite = access.includes('write') || access.includes('readwrite');
      let desc: ControlDesc | null = null;
      const label = p.label ?? p.description ?? name;
      if (p.format === 'bool' && canWrite) {
        desc = { siid: svc.iid, piid: p.iid, kind: 'switch', label, urn: p.type };
      } else if (p.format === 'string' || p.format === 'object' || p.format === 'array') {
        continue;
      } else if (p['value-range'] && canWrite) {
        desc = {
          siid: svc.iid, piid: p.iid, kind: 'slider', label,
          urn: p.type, range: p['value-range'],
        };
      } else if (p['value-list'] && canWrite) {
        desc = {
          siid: svc.iid, piid: p.iid, kind: 'enum', label,
          urn: p.type,
          options: p['value-list'].map((o) => ({
            value: o.value,
            label: o.label ?? o.description ?? String(o.value),
          })),
        };
      } else if (access.includes('read') && ['on', 'status', 'temperature', 'relative-humidity', 'battery-level'].includes(name)) {
        desc = { siid: svc.iid, piid: p.iid, kind: 'readonly', label, urn: p.type };
      }
      if (desc) {
        desc as ControlDesc & { _p?: number };
        (desc as unknown as { _p: number })._p = priority.indexOf(name) === -1 ? 99 : priority.indexOf(name);
        out.push(desc);
      }
    }
  }
  out.sort((a, b) => ((a as unknown as { _p: number })._p) - ((b as unknown as { _p: number })._p));
  return out.slice(0, 4);
}
