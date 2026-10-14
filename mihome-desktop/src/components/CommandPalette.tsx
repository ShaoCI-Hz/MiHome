/**
 * Ctrl+K 命令面板：搜索设备/场景/房间并直达
 * - 场景 → 直接执行
 * - 房间 → 切换到该房间
 * - 设备 → 打开设备详情
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../api/store';
import { getDisplayName } from '../api/prefs';
import { DeviceDetail } from './DeviceDetail';
import { toast } from './Toast';
import { log } from '../api/log';

interface Props {
  open: boolean;
  onClose: () => void;
  onGotoRoom: (didlist: string[]) => void;
}

type Kind = 'scene' | 'device' | 'room';
interface Result {
  kind: Kind;
  key: string;
  label: string;
  sub?: string;
  run: () => void;
}

export function CommandPalette({ open, onClose, onGotoRoom }: Props) {
  const { currentHomeId, devices, scenes, currentRooms, api } = useApp();
  const [q, setQ] = useState('');
  const [cursor, setCursor] = useState(0);
  /** 已按下一次 Enter 的场景项（两段确认防误触：Enter 第一下=就绪，第二下=执行） */
  const [armedKey, setArmedKey] = useState<string | null>(null);
  /** 退场状态机：open=false 后保留挂载 200ms 播完 out 动画再卸载 */
  const [mounted, setMounted] = useState(open);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!mounted) return;
    setClosing(true);
    const t = window.setTimeout(() => setMounted(false), 200);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  const [detailDevice, setDetailDevice] = useState<typeof devices[0] | null>(null);
  const [allDevices, setAllDevices] = useState<typeof devices | null>(null); // 跨家庭缓存
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQ('');
      setCursor(0);
      setArmedKey(null);
      setDetailDevice(null);
      // 首次打开加载跨家庭设备（getAllDevices 此前已封装但闲置）
      if (!allDevices) {
        api
          .getAllDevices()
          .then((list) => {
            setAllDevices(list);
            log('命令面板跨家庭设备', list.length);
          })
          .catch((e) => log('跨家庭设备加载失败 -', e));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const results = useMemo<Result[]>(() => {
    const keyword = q.trim().toLowerCase();
    const out: Result[] = [];
    // 场景（可直接执行）
    for (const s of scenes) {
      if (keyword && !s.name.toLowerCase().includes(keyword)) continue;
      out.push({
        kind: 'scene',
        key: `s:${s.scene_id}`,
        label: s.name,
        sub: '执行场景',
        run: async () => {
          try {
            await api.runScene(s.scene_id, String(s.home_id ?? currentHomeId));
            toast(`已执行「${s.name}」`, 'ok');
            log('命令面板执行场景', s.scene_id);
          } catch (e) {
            toast(`场景失败: ${e instanceof Error ? e.message : e}`, 'err');
          }
          onClose();
        },
      });
    }
    // 房间（切换）
    for (const r of currentRooms) {
      if (keyword && !r.name.toLowerCase().includes(keyword)) continue;
      out.push({
        kind: 'room',
        key: `r:${r.id}`,
        label: r.name,
        sub: '切换房间',
        run: () => {
          onGotoRoom(r.didlist ?? []);
          onClose();
        },
      });
    }
    // 设备（打开详情，跨家庭全量）
    const devicePool = allDevices ?? devices;
    for (const d of devicePool) {
      const name = getDisplayName(d.did, d.name);
      if (
        keyword &&
        !name.toLowerCase().includes(keyword) &&
        !d.model.toLowerCase().includes(keyword)
      )
        continue;
      out.push({
        kind: 'device',
        key: `d:${d.did}`,
        label: name,
        sub: d.isOnline ? d.model : `离线 · ${d.model}`,
        run: () => {
          setDetailDevice(d);
          onClose();
        },
      });
    }
    // 排序：场景优先，其次房间，最后设备；有关键词时前缀匹配优先
    const order: Record<Kind, number> = { scene: 0, room: 1, device: 2 };
    out.sort((a, b) => {
      if (keyword) {
        const ap = a.label.toLowerCase().startsWith(keyword) ? 0 : 1;
        const bp = b.label.toLowerCase().startsWith(keyword) ? 0 : 1;
        if (ap !== bp) return ap - bp;
      }
      return order[a.kind] - order[b.kind];
    });
    return out.slice(0, 30);
  }, [q, scenes, devices, allDevices, currentRooms, api, currentHomeId, onClose, onGotoRoom]);

  // 键盘导航
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setArmedKey(null);
        setCursor((c) => Math.min(c + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setArmedKey(null);
        setCursor((c) => Math.max(c - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const item = results[cursor];
        if (!item) return;
        // 场景执行有副作用：Enter 需两段确认，防默认光标停在场景上时误触发
        if (item.kind === 'scene' && armedKey !== item.key) {
          setArmedKey(item.key);
          return;
        }
        setArmedKey(null);
        item.run();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, results, cursor, armedKey, onClose]);

  // 光标项滚入视野
  useEffect(() => {
    const el = listRef.current?.children[cursor] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!mounted && !detailDevice) return null;

  const iconOf = (k: Kind) => (k === 'scene' ? '⚡' : k === 'room' ? '🚪' : '📡');

  return (
    <>
      {mounted && (
        <div
          className={`cp-overlay ${closing ? 'closing' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
        >
          <div className="cp-panel" onClick={(e) => e.stopPropagation()}>
            <input
              autoFocus
              className="cp-input"
              placeholder="搜索场景执行 / 房间切换 / 设备详情…  (Ctrl+K)"
              value={q}
              onChange={(e) => {
                setQ(e.target.value);
                setCursor(0);
                setArmedKey(null);
              }}
            />
            <div className="cp-list" ref={listRef}>
              {results.length === 0 && <div className="cp-empty">无匹配结果</div>}
              {results.map((r, i) => (
                <div
                  key={r.key}
                  className={`cp-item ${i === cursor ? 'active' : ''} ${armedKey === r.key ? 'armed' : ''}`}
                  onMouseMove={() => {
                    setCursor(i);
                    setArmedKey(null);
                  }}
                  onClick={() => {
                    setArmedKey(null);
                    r.run();
                  }}
                >
                  <span className="cp-icon">{iconOf(r.kind)}</span>
                  <span className="cp-label">{r.label}</span>
                  <span className="cp-sub">{armedKey === r.key ? '再按 Enter 确认执行' : r.sub}</span>
                </div>
              ))}
            </div>
            <div className="cp-foot">
              <span>↑↓ 选择</span>
              <span>Enter 执行</span>
              <span>Esc 关闭</span>
            </div>
          </div>
        </div>
      )}

      {detailDevice && (
        <DeviceDetail device={detailDevice} onClose={() => setDetailDevice(null)} />
      )}
    </>
  );
}
