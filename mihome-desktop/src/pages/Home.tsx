/** 主界面（仿米家 App）：顶栏家庭切换 + 房间标签 + 设备网格 + 底部导航 */
import { useState, useRef, useEffect, useMemo } from 'react';
import { useApp } from '../api/store';
import { DeviceCard } from '../components/DeviceCard';
import { log } from '../api/log';
import { toast } from '../components/Toast';
import {
  applyOrder,
  applyTheme,
  getThemePref,
  reorderList,
  setOrder,
  setThemePref,
  type SortMode,
  type ThemePref,
} from '../api/prefs';
import { extractControls, getSpec } from '../api/spec';
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from '@tauri-apps/plugin-autostart';

type Tab = 'devices' | 'scenes' | 'me';

export function Home() {
  const {
    homes, currentHomeId, devices, scenes, currentRooms,
    loading, error, selectHome, refresh, logout,
  } = useApp();
  const [tab, setTab] = useState<Tab>('devices');
  const [roomIdx, setRoomIdx] = useState(0); // 0 = 全部
  const [sortMode, setSortMode] = useState<SortMode>('online');
  const [editing, setEditing] = useState(false); // 卡片尺寸编辑模式
  const [searching, setSearching] = useState(false); // 搜索框展开
  const [query, setQuery] = useState('');
  const [orderTick, setOrderTick] = useState(0); // 拖拽保存后触发重排
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref());
  const [autostart, setAutostart] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const dragDid = useRef<string | null>(null);

  // 开机自启状态
  useEffect(() => {
    autostartIsEnabled().then(setAutostart).catch(() => undefined);
  }, []);
  const toggleAutostart = async () => {
    try {
      if (autostart) await autostartDisable();
      else await autostartEnable();
      setAutostart(!autostart);
      log('开机自启', !autostart ? '开启' : '关闭');
    } catch (e) {
      log('开机自启设置失败', e);
    }
  };

  // 编辑模式切换（退出时清空勾选）
  const toggleEdit = () => {
    setEditing((v) => !v);
    setSelected(new Set());
  };
  const toggleSelect = (did: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(did)) n.delete(did);
      else n.add(did);
      return n;
    });
  };

  // 批量开/关（对选中且含开关控件的在线设备）
  const batchSet = async (value: boolean) => {
    setBatchBusy(true);
    let ok = 0;
    let fail = 0;
    let skip = 0;
    for (const did of selected) {
      // 每轮从 store 取最新设备列表，避免轮询刷新后的陈旧闭包
      const { api, devices: latest } = useApp.getState();
      const d = latest.find((x) => x.did === did);
      if (!d || !d.isOnline) {
        skip += 1;
        continue;
      }
      try {
        const spec = await getSpec(d.model);
        const ctrl = spec ? extractControls(spec).find((c) => c.kind === 'switch') : null;
        if (!ctrl) {
          skip += 1;
          continue;
        }
        await api.setDevicesProp({ did: d.did, siid: ctrl.siid, piid: ctrl.piid, value });
        ok += 1;
      } catch {
        fail += 1;
      }
    }
    setBatchBusy(false);
    log(`批量${value ? '开启' : '关闭'}: 成功${ok} 失败${fail} 跳过${skip}`);
    toast(
      `批量${value ? '开启' : '关闭'}：成功 ${ok} · 失败 ${fail} · 跳过 ${skip}`,
      fail > 0 ? 'err' : 'ok',
    );
    setSelected(new Set());
    refresh();
  };

  const homeId = currentHomeId ?? '';
  const room = roomIdx > 0 ? currentRooms[roomIdx - 1] : null;
  const shown = room?.didlist
    ? devices.filter((d) => room.didlist!.includes(d.did))
    : devices;

  // 关键词过滤（名称/型号）——memo 化，避免每次渲染重算
  const q = query.trim().toLowerCase();
  const filtered = useMemo(
    () =>
      q
        ? shown.filter(
            (d) => d.name.toLowerCase().includes(q) || d.model.toLowerCase().includes(q),
          )
        : shown,
    [shown, q],
  );

  // 排序：在线优先 / 按名称 / 按类型 / 自定义拖拽顺序
  const sorted = useMemo(() => {
    if (sortMode === 'order') return applyOrder(homeId, filtered);
    return [...filtered].sort((a, b) => {
      if (sortMode === 'online') {
        const d = Number(b.isOnline) - Number(a.isOnline);
        if (d !== 0) return d;
        return a.name.localeCompare(b.name, 'zh');
      }
      if (sortMode === 'name') return a.name.localeCompare(b.name, 'zh');
      const ta = a.model.split('.')[1] ?? '';
      const tb = b.model.split('.')[1] ?? '';
      return ta.localeCompare(tb) || a.name.localeCompare(b.name, 'zh');
    });
    // orderTick：拖拽保存自定义顺序后（sortMode 不变）强制重排
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, sortMode, homeId, orderTick]);

  // 拖拽落位：更新自定义顺序并切换到"自定义"排序
  const handleDrop = (draggedDid: string, targetDid: string) => {
    if (!draggedDid || draggedDid === targetDid) return;
    const next = reorderList(sorted, draggedDid, targetDid);
    setOrder(homeId, next.map((d) => d.did));
    setSortMode('order');
    setOrderTick((v) => v + 1);
    log('拖拽排序已保存', draggedDid, '→', targetDid);
  };

  // 主题切换
  const onThemeChange = (v: ThemePref) => {
    setTheme(v);
    setThemePref(v);
    applyTheme();
  };

  const runScene = async (sceneId: string, homeId: string, name: string) => {
    const { api } = useApp.getState();
    try {
      await api.runScene(sceneId, homeId);
      log('scene 执行成功', sceneId);
      toast(`已执行「${name}」`, 'ok');
    } catch (e) {
      log('scene 执行失败', e);
      toast(`场景失败: ${e instanceof Error ? e.message : e}`, 'err');
    }
  };

  return (
    <div className="mi-page">
      {/* ===== 顶栏：家庭切换 ===== */}
      <header className="mi-header">
        <div className="mi-home-picker">
          <select
            value={currentHomeId ?? ''}
            onChange={(e) => {
              setRoomIdx(0);
              selectHome(e.target.value);
            }}
          >
            {homes.map((h) => (
              <option key={String(h.id)} value={String(h.id)}>{h.name}</option>
            ))}
          </select>
          <span className="mi-home-caret">▾</span>
        </div>
        <div className="mi-header-actions">
          {tab === 'devices' && (
            <>
              <button
                className={`mi-icon-btn ${searching ? 'active' : ''}`}
                title="搜索设备"
                onClick={() => {
                  setSearching((v) => !v);
                  setQuery('');
                }}
              >
                🔍
              </button>
              <button
                className={`mi-icon-btn mi-edit-btn ${editing ? 'active' : ''}`}
                title="编辑卡片尺寸 / 批量操作"
                onClick={toggleEdit}
              >
                {editing ? '完成' : '编辑'}
              </button>
            </>
          )}
          <button className="mi-icon-btn" title="刷新" onClick={() => refresh()} disabled={loading}>⟳</button>
        </div>
      </header>

      {searching && tab === 'devices' && (
        <div className="mi-search-bar">
          <input
            autoFocus
            placeholder="搜索设备名称或型号…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {error && <div className="mi-error">{error}</div>}

      {/* ===== 设备页 ===== */}
      {tab === 'devices' && (
        <>
          <nav className="mi-rooms">
            <button className={roomIdx === 0 ? 'active' : ''} onClick={() => setRoomIdx(0)}>全部</button>
            {currentRooms.map((r, i) => (
              <button
                key={r.id}
                className={roomIdx === i + 1 ? 'active' : ''}
                onClick={() => setRoomIdx(i + 1)}
              >
                {r.name}
              </button>
            ))}
            <div className="mi-sort" title="设备排序">
              <select value={sortMode} onChange={(e) => setSortMode(e.target.value as SortMode)}>
                <option value="online">在线优先</option>
                <option value="name">按名称</option>
                <option value="type">按类型</option>
                <option value="order">自定义</option>
              </select>
            </div>
          </nav>
          <main className="mi-content" key={`d-${tab}-${roomIdx}`}>
            {loading && devices.length === 0 ? (
              <div className="mi-empty">加载设备中…</div>
            ) : sorted.length === 0 ? (
              <div className="mi-empty">该房间没有设备</div>
            ) : (
              <div className="mi-grid">
                {sorted.map((d, i) => (
                  <DeviceCard
                    key={d.did}
                    device={d}
                    index={i}
                    editing={editing}
                    onLongPress={() => setEditing(true)}
                    checked={selected.has(d.did)}
                    onToggleCheck={() => toggleSelect(d.did)}
                    draggable={editing && sortMode === 'order'}
                    onDragStartDid={() => {
                      dragDid.current = d.did;
                    }}
                    onDropDid={() => {
                      handleDrop(dragDid.current ?? '', d.did);
                      dragDid.current = null;
                    }}
                  />
                ))}
              </div>
            )}
            {editing && selected.size > 0 && (
              <div className="mi-batch-bar">
                <span>已选 {selected.size} 台</span>
                <button disabled={batchBusy} onClick={() => batchSet(true)}>全部开启</button>
                <button disabled={batchBusy} onClick={() => batchSet(false)}>全部关闭</button>
                <button disabled={batchBusy} onClick={() => setSelected(new Set())}>取消</button>
              </div>
            )}
          </main>
        </>
      )}

      {/* ===== 场景页 ===== */}
      {tab === 'scenes' && (
        <main className="mi-content" key="scenes">
          <div className="mi-section-title">手动场景</div>
          {scenes.length === 0 ? (
            <div className="mi-empty">
              暂无场景，在米家 App「智能 → 手动控制」中创建后可在此执行
            </div>
          ) : (
            <div className="mi-scene-list">
              {scenes.map((s) => (
                <button
                  key={s.scene_id}
                  className="mi-scene-item"
                  onClick={() => runScene(s.scene_id, String(s.home_id ?? currentHomeId), s.name)}
                >
                  <span className="mi-scene-play">▶</span>
                  <span className="mi-scene-name">{s.name}</span>
                </button>
              ))}
            </div>
          )}
        </main>
      )}

      {/* ===== 我的 ===== */}
      {tab === 'me' && (
        <main className="mi-content" key="me">
          <div className="mi-profile">
            <div className="mi-avatar">👤</div>
            <div className="mi-profile-info">
              <div className="mi-profile-name">米家用户</div>
              <div className="mi-profile-sub">{homes.length} 个家庭 · {devices.length} 台设备</div>
            </div>
          </div>
          <div className="mi-cell-list">
            <div className="mi-cell">
              <span>当前家庭</span>
              <em>{homes.find((h) => String(h.id) === currentHomeId)?.name ?? '—'}</em>
            </div>
            <div className="mi-cell">
              <span>房间数量</span>
              <em>{currentRooms.length}</em>
            </div>
            <div className="mi-cell">
              <span>手动场景</span>
              <em>{scenes.length}</em>
            </div>
            <div className="mi-cell">
              <span>主题</span>
              <select
                className="mi-theme-select"
                value={theme}
                onChange={(e) => onThemeChange(e.target.value as ThemePref)}
              >
                <option value="auto">跟随系统</option>
                <option value="light">浅色</option>
                <option value="dark">深色</option>
              </select>
            </div>
            <div className="mi-cell">
              <span>开机自启</span>
              <button
                className={`mi-toggle ${autostart ? 'on' : ''}`}
                onClick={() => toggleAutostart()}
              >
                <span className="mi-toggle-knob" />
              </button>
            </div>
            <div className="mi-cell">
              <span>关闭行为</span>
              <em>最小化到系统托盘</em>
            </div>
            <div className="mi-cell">
              <span>版本</span>
              <em>0.1.0 (dev)</em>
            </div>
            <button className="mi-cell mi-cell-btn danger" onClick={() => logout()}>
              退出登录
            </button>
          </div>
          <p className="mi-about">非官方客户端 · 凭据仅存于本机系统凭据管理器</p>
        </main>
      )}

      {/* ===== 底部导航 ===== */}
      <footer className="mi-tabbar">
        <button className={tab === 'devices' ? 'active' : ''} onClick={() => setTab('devices')}>
          <span className="mi-tab-icon">🏠</span>
          <span>设备</span>
        </button>
        <button className={tab === 'scenes' ? 'active' : ''} onClick={() => setTab('scenes')}>
          <span className="mi-tab-icon">⚡</span>
          <span>场景</span>
        </button>
        <button className={tab === 'me' ? 'active' : ''} onClick={() => setTab('me')}>
          <span className="mi-tab-icon">👤</span>
          <span>我的</span>
        </button>
      </footer>
    </div>
  );
}
