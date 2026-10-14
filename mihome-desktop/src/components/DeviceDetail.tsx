/** 设备详情页（全屏浮层）：完整属性/动作 + 设备信息，对齐米家设备详情 */
import { useEffect, useRef, useState } from 'react';
import type { MiDevice, PropValue } from '../api/types';
import { findEnergyKey, getSpec, isUserFacingProp, type ControlDesc, type DeviceSpec } from '../api/spec';
import { getDisplayName, getDevMode, setDisplayName, subscribeDevMode } from '../api/prefs';
import { useApp } from '../api/store';

/** 解析统计值：value 是 "[123.4]" 形式的字符串，取第一项 */
function parseStatValue(raw: string): number {
  try {
    const arr = JSON.parse(raw);
    if (Array.isArray(arr) && arr.length) return Number(arr[0]) || 0;
  } catch {
    /* 非法 JSON，走正则 */
  }
  const m = raw.match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
}

/** 耗材 details → 展示文本 */
function fmtConsumable(d: unknown): string {
  if (d === null || d === undefined) return '';
  if (typeof d === 'string' || typeof d === 'number') return String(d);
  if (Array.isArray(d)) return d.length === 1 ? fmtConsumable(d[0]) : JSON.stringify(d);
  const o = d as Record<string, unknown>;
  const desc = String(o.description ?? o.consumable_type ?? o.type ?? '');
  const val = o.value !== undefined ? String(o.value) : '';
  const line = `${desc} ${val}`.trim();
  return line || JSON.stringify(o).slice(0, 80);
}

interface FullProp extends ControlDesc {
  siid: number;
  piid: number;
  readonly?: boolean;
}

/** 从完整规格展开全部可读属性与可写控件 */
function expandSpec(spec: DeviceSpec): { props: FullProp[]; actions: { siid: number; aiid: number; label: string; hasIn: boolean }[] } {
  const props: FullProp[] = [];
  const actions: { siid: number; aiid: number; label: string; hasIn: boolean }[] = [];
  for (const svc of spec.services) {
    const svcLabel = svc.label ?? svc.description ?? svc.type;
    for (const p of svc.properties ?? []) {
      const name = p.label ?? p.description ?? p.type;
      if (p.type.startsWith('parent')) continue;
      const access = p.access ?? [];
      const canWrite = access.includes('write') || access.includes('readwrite');
      const canRead = access.includes('read') || access.includes('notify');
      if (!canRead && !canWrite) continue;
      if (p.format === 'string' || p.format === 'object' || p.format === 'array') continue;
      if (canWrite) {
        let desc: FullProp;
        if (p.format === 'bool') {
          desc = { siid: svc.iid, piid: p.iid, kind: 'switch', label: name, urn: p.type };
        } else if (p['value-range']) {
          desc = { siid: svc.iid, piid: p.iid, kind: 'slider', label: name, urn: p.type, range: p['value-range'] };
        } else if (p['value-list']) {
          desc = {
            siid: svc.iid, piid: p.iid, kind: 'enum', label: name, urn: p.type,
            options: p['value-list'].map((o) => ({ value: o.value, label: o.label ?? o.description ?? String(o.value) })),
          };
        } else {
          desc = { siid: svc.iid, piid: p.iid, kind: 'readonly', label: name, urn: p.type, readonly: true };
        }
        props.push({ ...desc, label: `${svcLabel} · ${name}` });
      } else if (canRead) {
        props.push({ siid: svc.iid, piid: p.iid, kind: 'readonly', label: `${svcLabel} · ${name}`, urn: p.type, readonly: true });
      }
    }
    for (const a of svc.actions ?? []) {
      if (a.type.startsWith('parent')) continue;
      actions.push({
        siid: svc.iid,
        aiid: a.iid,
        label: `${svcLabel} · ${a.label ?? a.description ?? a.type}`,
        hasIn: (a.in ?? []).length > 0,
      });
    }
  }
  return { props, actions };
}

export function DeviceDetail({ device, onClose }: { device: MiDevice; onClose: () => void }) {
  const api = useApp((s) => s.api);
  const [spec, setSpec] = useState<DeviceSpec | null>(null);
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [dispName, setDispName] = useState(() => getDisplayName(device.did, device.name));
  const [energy, setEnergy] = useState<{ time: number; v: number }[]>([]);
  const [consumables, setConsumables] = useState<string[]>([]);
  // 开发者模式：关闭时仅展示核心控制项与官方式动作（隐藏高阶项）
  const [devMode, setDevModeState] = useState(getDevMode());
  useEffect(() => subscribeDevMode(() => setDevModeState(getDevMode())), []);

  // 能耗 + 耗材
  useEffect(() => {
    let dead = false;
    (async () => {
      const s = await getSpec(device.model);
      if (dead || !s) return;
      const key = findEnergyKey(s);
      if (key) {
        try {
          const now = Math.floor(Date.now() / 1000);
          const list = await api.getStatistics({
            did: device.did,
            key,
            data_type: 'stat_day_v3',
            limit: 7,
            time_start: now - 7 * 86400,
            time_end: now,
          });
          if (dead) return;
          setEnergy(list.map((it) => ({ time: it.time, v: parseStatValue(it.value) })));
        } catch {
          /* 无统计数据 */
        }
      }
      // 耗材（按当前家庭过滤本设备）
      const homeId = useApp.getState().currentHomeId;
      if (homeId) {
        try {
          const items = await api.getConsumableItems(homeId);
          if (dead) return;
          const mine = items.filter((x) => x.did === device.did);
          setConsumables(mine.map((x) => fmtConsumable(x.details) || x.name || '有耗材需更换'));
        } catch {
          /* 无耗材数据 */
        }
      }
    })();
    return () => {
      dead = true;
    };
  }, [api, device.did, device.model]);

  // 本地重命名（不影响云端，仅本软件内显示）
  const rename = () => {
    const next = window.prompt('重命名设备（仅本机显示）', dispName);
    if (next === null) return;
    setDisplayName(device.did, next);
    setDispName(getDisplayName(device.did, device.name));
  };

  useEffect(() => {
    let dead = false;
    (async () => {
      const s = await getSpec(device.model);
      if (dead || !s) return;
      setSpec(s);
      const { props } = expandSpec(s);
      try {
        const keys = props.map((p) => ({ did: device.did, siid: p.siid, piid: p.piid }));
        const ret = (await api.getDevicesProp(keys)) as PropValue[];
        if (dead) return;
        const map: Record<string, unknown> = {};
        for (const r of ret) if (r.code === 0 || r.code === 1) map[`${r.siid}.${r.piid}`] = r.value;
        setValues(map);
      } catch {
        /* ignore */
      }
    })();
    return () => {
      dead = true;
    };
  }, [api, device.did, device.model]);

  const setProp = async (p: FullProp, value: unknown) => {
    const key = `${p.siid}.${p.piid}`;
    const prev = values[key];
    setValues((v) => ({ ...v, [key]: value }));
    setBusy(true);
    setMsg(null);
    try {
      await api.setDevicesProp({ did: device.did, siid: p.siid, piid: p.piid, value });
    } catch (e) {
      setValues((v) => ({ ...v, [key]: prev }));
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // 滑条节流：拖动仅本地回显，停顿 300ms 合并提交一次
  const sliderTimer = useRef<number | null>(null);
  const sliderPending = useRef<{ p: FullProp; v: unknown; prev: unknown } | null>(null);
  const setPropSmooth = (p: FullProp, value: unknown) => {
    const key = `${p.siid}.${p.piid}`;
    const first = sliderPending.current === null;
    setValues((v) => ({ ...v, [key]: value }));
    sliderPending.current = {
      p,
      v: value,
      prev: first ? values[key] : sliderPending.current!.prev,
    };
    if (sliderTimer.current) window.clearTimeout(sliderTimer.current);
    sliderTimer.current = window.setTimeout(() => {
      sliderTimer.current = null;
      void (async () => {
        const q = sliderPending.current;
        sliderPending.current = null;
        if (!q) return;
        try {
          await api.setDevicesProp({ did: device.did, siid: q.p.siid, piid: q.p.piid, value: q.v });
        } catch (e) {
          setValues((v) => ({ ...v, [`${q.p.siid}.${q.p.piid}`]: q.prev }));
          setMsg(e instanceof Error ? e.message : String(e));
        }
      })();
    }, 300);
  };

  const runAct = async (siid: number, aiid: number, label: string) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.runAction({ did: device.did, siid, aiid });
      setMsg(`已执行：${label}`);
    } catch (e) {
      setMsg(`${label} 失败: ${e instanceof Error ? e.message : e}`);
    } finally {
      setBusy(false);
    }
  };

  // 展开规格（易用模式：只保留白名单核心属性；动作区仅开发者模式显示）
  const expanded = (() => {
    if (!spec) return null;
    const full = expandSpec(spec);
    if (devMode) return full;
    return {
      props: full.props.filter((p) => isUserFacingProp(p.urn)),
      actions: [] as typeof full.actions,
    };
  })();
  const extra = (device.extra ?? {}) as Record<string, unknown>;

  // 退场：先播 280ms 动画再真正卸载
  const [closing, setClosing] = useState(false);
  const requestClose = () => {
    if (closing) return;
    setClosing(true);
    window.setTimeout(onClose, 280);
  };

  // Esc 关闭详情（桌面弹层键盘闭环）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        requestClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing]);

  return (
    <div
      className={`mi-detail-overlay ${closing ? 'closing' : ''}`}
      onClick={(e) => {
        e.stopPropagation();
        requestClose();
      }}
    >
      <div className={`mi-detail ${closing ? 'closing' : ''}`} onClick={(e) => e.stopPropagation()}>
        <header className="mi-detail-header">
          <button className="mi-back" onClick={requestClose}>‹ 返回</button>
          <span>设备详情</span>
          <span className={`mi-dot ${device.isOnline ? 'on' : ''}`} />
        </header>

        <div className="mi-detail-body">
          {/* 设备概要 */}
          <div className="mi-detail-hero">
            <div className="mi-detail-hero-info">
              <h2>
                {dispName}
                <button className="mi-rename-btn" title="重命名（仅本机）" onClick={rename}>✎</button>
              </h2>
              <p>{device.isOnline ? '在线' : '离线'} · {device.model}</p>
            </div>
          </div>

          {/* 设备信息 */}
          <div className="mi-detail-section">
            <div className="mi-detail-title">设备信息</div>
            <div className="mi-info-grid">
              <div><span>房间</span><b>{
                (() => {
                  const rooms = useApp.getState().currentRooms;
                  const r = rooms.find((x) => (x.didlist ?? []).includes(device.did));
                  return r?.name ?? '—';
                })()
              }</b></div>
              <div><span>本地 IP</span><b>{device.localip ?? '—'}</b></div>
              <div><span>MAC</span><b>{device.mac ?? '—'}</b></div>
              <div><span>固件</span><b>{String(extra.fw_version ?? '—')}</b></div>
              <div><span>信号</span><b>{typeof device.rssi === 'number' ? `${device.rssi} dBm` : '—'}</b></div>
              <div><span>型号</span><b>{device.model}</b></div>
            </div>
          </div>

          {/* 用电统计（设备具备能耗属性时显示） */}
          {energy.length > 0 && (
            <div className="mi-detail-section">
              <div className="mi-detail-title">近 7 天用电（Wh）</div>
              <div className="mi-chart">
                {(() => {
                  const max = Math.max(...energy.map((x) => x.v), 1);
                  return energy.map((e) => {
                    const d = new Date(e.time * 1000);
                    const h = Math.max(3, Math.round((e.v / max) * 100));
                    return (
                      <div className="mi-chart-col" key={e.time}>
                        <em>{e.v >= 100 ? Math.round(e.v) : e.v.toFixed(1)}</em>
                        <div className="mi-chart-bar" style={{ height: `${h}%` }} />
                        <span>{d.getMonth() + 1}/{d.getDate()}</span>
                      </div>
                    );
                  });
                })()}
              </div>
            </div>
          )}

          {/* 耗材 */}
          {consumables.length > 0 && (
            <div className="mi-detail-section">
              <div className="mi-detail-title">耗材</div>
              {consumables.map((c, i) => (
                <div key={i} className="mi-detail-row">
                  <span>状态</span>
                  <b>{c}</b>
                </div>
              ))}
            </div>
          )}

          {/* 全部属性 */}
          <div className="mi-detail-section">
            <div className="mi-detail-title">属性与控制</div>
            {!expanded && <div className="mi-detail-loading">加载规格…</div>}
            {expanded && expanded.props.length === 0 && (
              <div className="mi-detail-loading">
                {devMode ? '无可显示属性' : '暂无易用控制项（"我的"→ 开发者模式 可查看全部）'}
              </div>
            )}
            {expanded?.props.map((p) => {
              const key = `${p.siid}.${p.piid}`;
              const val = values[key];
              if (p.kind === 'switch') {
                return (
                  <div key={key} className="mi-detail-row">
                    <span>{p.label}</span>
                    <button
                      className={`mi-power small ${val === true ? 'on' : ''}`}
                      disabled={!device.isOnline || busy}
                      onClick={() => setProp(p, !(val === true))}
                    >
                      ⏻
                    </button>
                  </div>
                );
              }
              if (p.kind === 'slider' && p.range) {
                const [min, max, step] = p.range;
                const num = typeof val === 'number' ? val : min;
                return (
                  <div key={key} className="mi-detail-row slider">
                    <span>{p.label}</span>
                    <input
                      type="range"
                      min={min}
                      max={max}
                      step={step}
                      value={num}
                      disabled={!device.isOnline}
                      onChange={(e) => setPropSmooth(p, Number(e.target.value))}
                    />
                    <em>{num}</em>
                  </div>
                );
              }
              if (p.kind === 'enum' && p.options) {
                return (
                  <div key={key} className="mi-detail-row">
                    <span>{p.label}</span>
                    <select
                      value={String(val ?? '')}
                      disabled={!device.isOnline || busy}
                      onChange={(e) => {
                        const opt = p.options!.find((o) => String(o.value) === e.target.value);
                        if (opt) setProp(p, opt.value);
                      }}
                    >
                      <option value="">--</option>
                      {p.options.map((o) => (
                        <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                );
              }
              return (
                <div key={key} className="mi-detail-row">
                  <span>{p.label}</span>
                  <b>{val === undefined ? '—' : String(val)}</b>
                </div>
              );
            })}
          </div>

          {/* 动作 */}
          {expanded && expanded.actions.length > 0 && (
            <div className="mi-detail-section">
              <div className="mi-detail-title">动作</div>
              <div className="mi-action-grid">
                {expanded.actions.map((a) => (
                  <button
                    key={`${a.siid}.${a.aiid}`}
                    disabled={!device.isOnline || busy || a.hasIn}
                    title={a.hasIn ? '该动作需要参数，暂不支持' : undefined}
                    onClick={() => runAct(a.siid, a.aiid, a.label)}
                  >
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {msg && <div className="mi-detail-msg">{msg}</div>}
          <p className="mi-detail-note">非官方客户端 · 数据来自小米 MIoT 云</p>
        </div>
      </div>
    </div>
  );
}
