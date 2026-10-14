/** 设备卡片（仿米家 App）：官方产品图 + 分型卡片（传感大数字/亮度滑条/普通）+ 圆形电源钮 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { MiDevice } from '../api/types';
import { extractControls, filterControlsForMode, getDeviceImage, getSpec, type ControlDesc } from '../api/spec';
import { getDisplayName, getDevMode, subscribeDevMode } from '../api/prefs';
import { toast } from './Toast';
import { log } from '../api/log';
import { schedulePropsFetch, setPropValue, setPropFrozen, useDidValues, useDidFailed, explainPropError, useProps } from '../api/propsStore';
import { useApp } from '../api/store';
import { DeviceDetail } from './DeviceDetail';

const ICONS: Record<string, string> = {
  'health-pot': '🫖',
  sensor: '🌡️',
  fan: '🌀',
  light: '💡',
  plug: '🔌',
  outlet: '🔌',
  switch: '🎛️',
  airer: '🧺',
  vacuum: '🤖',
  'air-conditioner': '❄️',
  'air-fresh': '🌬️',
  heater: '🔥',
  camera: '📷',
  speaker: '🔊',
  clock: '⏰',
  washer: '🧺',
  'motion-sensor': '🚶',
  'magnet-sensor': '🚪',
  'smoke-detector': '🚨',
  curtain: '🪟',
  'temp-humidity': '🌡️',
};

function iconFor(model: string, specType?: string): string {
  const key = model.split('.')[1] ?? '';
  if (ICONS[key]) return ICONS[key];
  const m = (specType ?? '').match(/device:([a-z-]+):/);
  if (m && ICONS[m[1]]) return ICONS[m[1]];
  return '📡';
}

/** 圆形电源按钮图标（对齐米家卡片右上角电源键） */
function PowerIcon() {
  return (
    <svg viewBox="0 0 24 24" width="17" height="17" fill="none" aria-hidden>
      <path
        d="M12 3.5v7.2"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      <path
        d="M7.2 6.6a7.2 7.2 0 1 0 9.6 0"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function DeviceCard({
  device,
  editing,
  editMode,
  onLongPress,
  checked,
  onToggleCheck,
  draggable,
  onDragStartDid,
  onDropDid,
  index,
}: {
  device: MiDevice;
  editing?: boolean;
  editMode?: 'check' | 'size' | 'drag';
  onLongPress?: () => void;
  checked?: boolean;
  onToggleCheck?: () => void;
  draggable?: boolean;
  onDragStartDid?: () => void;
  onDropDid?: () => void;
  /** 网格中的序号（入场 stagger 用） */
  index?: number;
}) {
  const api = useApp((s) => s.api);
  const offline = useApp((s) => s.offline);
  const [img, setImg] = useState<string | null>(null);
  const [controls, setControls] = useState<ControlDesc[] | null>(null);
  // 属性值改由中心化仓库提供（批量拉取 + 统一轮询）
  const values = useDidValues(device.did);
  const failed = useDidFailed(device.did);
  // 新鲜度标签需要随时间更新，但不订阅全局 updatedAt（否则每轮轮询/回前台全量卡片重渲染）：
  // 30s 一次轻量 tick + getState 读取即可
  const [, setFreshTick] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setFreshTick((x) => x + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDetail, setShowDetail] = useState(false);
  // 开发者模式（默认关=易用模式，仅显示核心控制项；切换即时生效）
  const [devMode, setDevModeState] = useState(getDevMode());
  useEffect(() => subscribeDevMode(() => setDevModeState(getDevMode())), []);
  // 单卡尺寸（本机记忆）：s=紧凑 m=标准 l=大卡
  const [size, setSize] = useState<'s' | 'm' | 'l'>(() => {
    try {
      const v = localStorage.getItem(`mi-card-size:${device.did}`);
      if (v === 's' || v === 'm' || v === 'l') return v;
    } catch {
      /* ignore */
    }
    return 'm';
  });
  const applySize = (next: 's' | 'm' | 'l') => {
    setSize(next);
    try {
      localStorage.setItem(`mi-card-size:${device.did}`, next);
    } catch {
      /* ignore */
    }
  };

  // 长按（500ms）进入编辑模式（官方米家交互）
  const longTimer = useRef<number | null>(null);
  const longFired = useRef(false);
  const startLong = () => {
    longFired.current = false;
    longTimer.current = window.setTimeout(() => {
      longFired.current = true;
      onLongPress?.();
    }, 500);
  };
  const cancelLong = () => {
    if (longTimer.current) {
      clearTimeout(longTimer.current);
      longTimer.current = null;
    }
  };

  const specType = device.spec_type;

  // 官方产品图
  useEffect(() => {
    let dead = false;
    getDeviceImage(device.model).then((u) => !dead && setImg(u));
    return () => {
      dead = true;
    };
  }, [device.model]);

  // 规格加载：控件来自 spec，属性值交由调度器批量拉取（O(N)→O(1)）
  const loadControls = useCallback(async () => {
    if (!device.model) {
      setControls([]);
      return;
    }
    const spec = await getSpec(device.model);
    const ctrls = spec ? extractControls(spec) : [];
    setControls(ctrls);
    if (ctrls.length) schedulePropsFetch([device.did]);
  }, [device.did, device.model]);

  // 首次加载（规格 → 控件 → 交调度器批量拉值）
  useEffect(() => {
    void loadControls();
  }, [loadControls]);

  const setValue = useCallback(
    async (c: ControlDesc, value: unknown) => {
      const prev = values[`${c.siid}.${c.piid}`];
      setPropValue(device.did, c.siid, c.piid, value); // 乐观回显
      setBusy(true);
      setErr(null);
      try {
        await api.setDevicesProp({ did: device.did, siid: c.siid, piid: c.piid, value });
      } catch (e) {
        setPropValue(device.did, c.siid, c.piid, prev); // 回滚
        const msg = e instanceof Error ? e.message : String(e);
        setErr(msg);
        // 失败必须可感知：卡片展开区可能收起，全局 Toast 兜底
        toast(`控制失败：${msg}`, 'err');
        log('设备控制失败', device.did, c.label, msg);
      } finally {
        setBusy(false);
      }
    },
    [api, device.did, values],
  );

  // 滑条平滑提交：拖动仅本地回显，停顿 300ms 合并为一次请求（修复"每像素一请求+拖动中禁用"）
  const sliderTimer = useRef<number | null>(null);
  const sliderPending = useRef<{ c: ControlDesc; v: unknown; prev: unknown } | null>(null);
  const setSliderSmooth = useCallback(
    (c: ControlDesc, value: unknown) => {
      const key = `${c.siid}.${c.piid}`;
      const first = sliderPending.current === null;
      setPropValue(device.did, c.siid, c.piid, value);
      setPropFrozen(device.did, c.siid, c.piid, true); // 拖动中：轮询不覆盖本地回显
      sliderPending.current = {
        c,
        v: value,
        prev: first ? values[key] : sliderPending.current!.prev,
      };
      if (sliderTimer.current) window.clearTimeout(sliderTimer.current);
      sliderTimer.current = window.setTimeout(() => {
        sliderTimer.current = null;
        void (async () => {
          const p = sliderPending.current;
          sliderPending.current = null;
          if (!p) return;
          try {
            await api.setDevicesProp({ did: device.did, siid: p.c.siid, piid: p.c.piid, value: p.v });
          } catch (e) {
            setPropValue(device.did, p.c.siid, p.c.piid, p.prev);
            const msg = e instanceof Error ? e.message : String(e);
            setErr(msg);
            toast(`控制失败：${msg}`, 'err');
            log('滑条提交失败', device.did, p.c.label, msg);
          } finally {
            setPropFrozen(device.did, p.c.siid, p.c.piid, false); // 已提交/回滚，恢复轮询写入
          }
        })();
      }, 300);
    },
    [api, device.did, values],
  );

  // 易用模式过滤：只保留核心控制项（开发者模式显示全部）；过滤后再取 4 个
  const visible = useMemo(
    () => (controls ? filterControlsForMode(controls, devMode).slice(0, 4) : controls),
    [controls, devMode],
  );

  const switchCtrl = useMemo(() => visible?.find((c) => c.kind === 'switch'), [visible]);
  const otherCtrls = useMemo(() => visible?.filter((c) => c.kind !== 'switch'), [visible]);
  const readonlyCtrls = useMemo(() => otherCtrls?.filter((c) => c.kind === 'readonly'), [otherCtrls]);
  const editableCtrls = useMemo(() => otherCtrls?.filter((c) => c.kind !== 'readonly'), [otherCtrls]);
  const sliderCtrls = useMemo(() => editableCtrls?.filter((c) => c.kind === 'slider'), [editableCtrls]);

  const emoji = useMemo(() => iconFor(device.model, specType), [device.model, specType]);

  // 卡片分型（对齐官方米家）：sensor=温湿度大数字卡 / dimmer=常显滑条卡 / normal
  const variant: 'sensor' | 'dimmer' | 'normal' = (() => {
    if (
      readonlyCtrls?.some((c) => /temperature|humidity/i.test(c.urn)) &&
      (editableCtrls?.length ?? 0) <= 1
    ) {
      return 'sensor';
    }
    if (sliderCtrls?.some((c) => /brightness/i.test(c.urn))) return 'dimmer';
    return 'normal';
  })();

  // sensor 卡主/副读数
  const sensorMain =
    readonlyCtrls?.find((c) => /temperature/i.test(c.urn)) ?? readonlyCtrls?.[0];
  const sensorSub = readonlyCtrls?.find((c) => /humidity/i.test(c.urn) && c !== sensorMain);
  // dimmer 卡常显的亮度控件
  const dimmerCtrl = sliderCtrls?.find((c) => /brightness/i.test(c.urn));
  // 展开区展示的控件（排除已常显的）
  const detailCtrls = editableCtrls?.filter((c) => c !== dimmerCtrl);

  const valOf = (c?: ControlDesc) =>
    c ? values[`${c.siid}.${c.piid}`] : undefined;
  /** 该属性是否有可解释的失败码 */
  const failOf = (c?: ControlDesc) =>
    c ? failed[`${c.siid}.${c.piid}`] : undefined;

  const isOn = valOf(switchCtrl) === true;

  // 数据新鲜度标签（>90s 才提示，避免常驻噪音）
  const freshLabel = (() => {
    const updatedAt = useProps.getState().updatedAt;
    if (!updatedAt) return '';
    const age = Math.floor((Date.now() - updatedAt) / 1000);
    if (age <= 90) return '';
    if (age < 300) return ` · ${Math.floor(age / 60)} 分钟前更新`;
    return ' · 数据较旧';
  })();

  // 状态文案
  const statusText = (() => {
    if (!device.isOnline) return '离线';
    if (switchCtrl) {
      const v = valOf(switchCtrl);
      if (v === true) return '已开启';
      if (v === false) return '已关闭';
    }
    if (sensorMain) {
      const v = valOf(sensorMain);
      if (v !== undefined) return `${sensorMain.label}: ${String(v)}${freshLabel}`;
      const code = failOf(sensorMain);
      if (code !== undefined) return explainPropError(code);
    }
    if (readonlyCtrls?.length) {
      const r = readonlyCtrls[0];
      const v = valOf(r);
      if (v !== undefined) return `${r.label}: ${String(v)}${freshLabel}`;
      const code = failOf(r);
      if (code !== undefined) return explainPropError(code);
    }
    return '在线';
  })();

  const fmtVal = (c?: ControlDesc, suffix = '') => {
    const v = valOf(c);
    if (v === undefined || v === null) return '—';
    return `${String(v)}${suffix}`;
  };

  // 控件区开合（大卡常显）
  const detailOpen = expanded || size === 'l';

  // 入场动画一次性：挂载后短时携带 mi-card--enter，随后移除。
  // 避免排序/轮询改变 --card-i 时 animation-delay 变化触发重放
  const [entering, setEntering] = useState(true);
  useEffect(() => {
    const t = window.setTimeout(() => setEntering(false), 900); // 0.36s + 0.32s delay 上限 + 余量
    return () => window.clearTimeout(t);
  }, []);

  const sensorUnit = (c?: ControlDesc) => {
    if (!c) return '';
    if (/temperature/i.test(c.urn)) return '°C';
    if (/humidity/i.test(c.urn)) return '%';
    return '';
  };

  return (
    <div
      className={`mi-card mi-card--${variant} mi-card--size-${size} ${device.isOnline ? '' : 'offline'} ${expanded ? 'expanded' : ''} ${editing ? 'editing' : ''} ${checked ? 'checked' : ''} ${entering ? 'mi-card--enter' : ''}`}
      style={{ '--card-i': index ?? 0 } as CSSProperties}
      draggable={draggable}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move';
        onDragStartDid?.();
      }}
      onDragOver={(e) => {
        if (draggable) e.preventDefault();
      }}
      onDrop={(e) => {
        if (draggable) {
          e.preventDefault();
          onDropDid?.();
        }
      }}
      onPointerDown={startLong}
      onPointerUp={cancelLong}
      onPointerLeave={cancelLong}
      onContextMenu={(e) => {
        // 桌面惯例：右键直达设备详情（原为全面禁用右键）
        e.preventDefault();
        if (!editing) setShowDetail(true);
      }}
      onClick={() => {
        cancelLong();
        if (longFired.current) {
          longFired.current = false;
          return; // 长按触发过，忽略本次点击
        }
        if (editing) {
          // 仅多选模式下点击=勾选；尺寸/拖拽模式点击不动作
          if (editMode === 'check') onToggleCheck?.();
          return;
        }
        setExpanded((v) => !v);
      }}
    >
      {editing && (
        <div className={`mi-check ${checked ? 'on' : ''}`} aria-hidden>
          {checked ? '✓' : ''}
        </div>
      )}
      {editing && editMode === 'size' && (
        <div className="mi-size-picker" onClick={(e) => e.stopPropagation()}>
          <span>尺寸</span>
          <button className={size === 's' ? 'active' : ''} onClick={() => applySize('s')} title="紧凑">小</button>
          <button className={size === 'm' ? 'active' : ''} onClick={() => applySize('m')} title="标准">中</button>
          <button className={size === 'l' ? 'active' : ''} onClick={() => applySize('l')} title="大卡">大</button>
        </div>
      )}
      <div className="mi-card-main">
        {variant === 'sensor' ? (
          <div className="mi-card-sensor">
            <div className="mi-sensor-value">
              {fmtVal(sensorMain)}
              <em>{sensorUnit(sensorMain)}</em>
            </div>
            <div className="mi-sensor-sub">
              {getDisplayName(device.did, device.name)}
              {sensorSub && (
                <span className="mi-sensor-side">
                  {sensorSub.label} {fmtVal(sensorSub)}{sensorUnit(sensorSub)}
                </span>
              )}
            </div>
          </div>
        ) : (
          <>
            <div className="mi-card-img">
              {img ? (
                <img src={img} alt="" loading="lazy" onError={() => setImg(null)} />
              ) : (
                <span className="mi-card-emoji">{emoji}</span>
              )}
            </div>
            <div className="mi-card-info">
              <div className="mi-card-name" title={device.name}>
                {getDisplayName(device.did, device.name)}
              </div>
              <div className="mi-card-status">{statusText}</div>
            </div>
          </>
        )}

        {switchCtrl && (
          <button
            className={`mi-power ${isOn ? 'on' : ''}`}
            disabled={!device.isOnline || busy || offline}
            onClick={(e) => {
              e.stopPropagation();
              setValue(switchCtrl, !isOn);
            }}
            aria-label="开关"
          >
            <PowerIcon />
          </button>
        )}
      </div>

      {/* dimmer 卡：亮度滑条常显 */}
      {variant === 'dimmer' && dimmerCtrl && (
        <div className="mi-card-inline-slider" onClick={(e) => e.stopPropagation()}>
          <span>{dimmerCtrl.label}</span>
          <input
            type="range"
            min={dimmerCtrl.range?.[0] ?? 1}
            max={dimmerCtrl.range?.[1] ?? 100}
            step={dimmerCtrl.range?.[2] ?? 1}
            value={typeof valOf(dimmerCtrl) === 'number' ? (valOf(dimmerCtrl) as number) : (dimmerCtrl.range?.[0] ?? 1)}
            disabled={!device.isOnline || offline}
            onChange={(e) => setSliderSmooth(dimmerCtrl, Number(e.target.value))}
          />
          <em>{fmtVal(dimmerCtrl)}</em>
        </div>
      )}

      {/* 控件区：常渲染 + grid-rows 平滑展开/收起；大卡常显 */}
      <div
        className={`mi-card-detail ${detailOpen ? 'is-open' : ''}`}
        onClick={(e) => e.stopPropagation()}
        aria-hidden={!detailOpen}
        aria-expanded={detailOpen}
      >
        <div className="mi-card-detail-inner">
          {visible === null && <div className="mi-card-loading">加载控件…</div>}
          {visible !== null && visible.length === 0 && (
            <div className="mi-card-loading">
              {devMode ? '该设备暂无可用控件' : '暂无易用控制项（可在"我的"开启开发者模式查看全部）'}
            </div>
          )}
          {detailCtrls?.map((c) => {
            const key = `${c.siid}.${c.piid}`;
            const val = values[key];
            if (c.kind === 'slider' && c.range) {
              const [min, max, step] = c.range;
              const num = typeof val === 'number' ? val : min;
              return (
                <div key={key} className="mi-slider">
                  <span>{c.label}</span>
                  <input
                    type="range"
                    min={min}
                    max={max}
                    step={step}
                    value={num}
                    disabled={!device.isOnline || offline}
                    onChange={(e) => setSliderSmooth(c, Number(e.target.value))}
                  />
                  <em>{num}</em>
                </div>
              );
            }
            if (c.kind === 'enum' && c.options) {
              return (
                <div key={key} className="mi-slider">
                  <span>{c.label}</span>
                  <select
                    value={String(val ?? '')}
                    disabled={!device.isOnline || busy || offline}
                    onChange={(e) => {
                      const opt = c.options!.find((o) => String(o.value) === e.target.value);
                      if (opt) setValue(c, opt.value);
                    }}
                  >
                    <option value="">--</option>
                    {c.options.map((o) => (
                      <option key={String(o.value)} value={String(o.value)}>{o.label}</option>
                    ))}
                  </select>
                </div>
              );
            }
            return null;
          })}
          {readonlyCtrls?.map((c) => {
            const key = `${c.siid}.${c.piid}`;
            const val = values[key];
            return (
              <div key={key} className="mi-readonly">
                <span>{c.label}</span>
                <b>{val === undefined ? '—' : String(val)}</b>
              </div>
            );
          })}
          <div className="mi-detail-actions">
            <button
              className="mi-detail-link"
              onClick={(e) => {
                e.stopPropagation();
                setShowDetail(true);
              }}
            >
              设备详情 ›
            </button>
            <button
              className="mi-collapse"
              onClick={(e) => {
                e.stopPropagation();
                setExpanded(false);
              }}
            >
              收起 ▲
            </button>
          </div>
          {err && <div className="mi-card-error">{err}</div>}
        </div>
      </div>

      {showDetail &&
        createPortal(
          <DeviceDetail device={device} onClose={() => setShowDetail(false)} />,
          document.body,
        )}
    </div>
  );
}
