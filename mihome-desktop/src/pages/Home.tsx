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
  getCloseToTrayPref,
  setCloseToTrayPref,
  getDevMode,
  setDevMode,
  subscribeDevMode,
  reorderList,
  setOrder,
  setThemePref,
  type SortMode,
  type ThemePref,
} from '../api/prefs';
import { extractControls, getSpec } from '../api/spec';
import { CommandPalette } from '../components/CommandPalette';
import { SchedulePanel } from '../components/SchedulePanel';
import { feedback } from '../api/tray';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { enable as autostartEnable, disable as autostartDisable, isEnabled as autostartIsEnabled } from '@tauri-apps/plugin-autostart';

type Tab = 'devices' | 'scenes' | 'me';

export function Home() {
  const {
    homes, currentHomeId, devices, scenes, currentRooms,
    loading, error, offline, selectHome, refresh, logout, clearError,
  } = useApp();
  const [tab, setTab] = useState<Tab>('devices');
  const [roomIdx, setRoomIdx] = useState(0); // 0 = 全部
  const [sortMode, setSortMode] = useState<SortMode>('online');
  const [editing, setEditing] = useState(false); // 编辑模式
  /** 编辑模式下的子意图（三合一拆分：多选/尺寸/拖拽互不打架） */
  const [editMode, setEditMode] = useState<'check' | 'size' | 'drag'>('check');
  const [orderTick, setOrderTick] = useState(0); // 拖拽保存后触发重排
  const [theme, setTheme] = useState<ThemePref>(() => getThemePref());
  const [autostart, setAutostart] = useState(false);
  const [closeToTray, setCloseToTray] = useState(() => getCloseToTrayPref()); // 关闭行为（本地记忆）
  const [appVersion, setAppVersion] = useState(''); // 运行时版本
  const [runningScene, setRunningScene] = useState<string | null>(null); // 场景执行中
  // 开发者模式（默认关）：开启后设备详情/卡片显示 miot-spec 全部控制项
  const [devMode, setDevModeState] = useState(getDevMode());
  useEffect(() => subscribeDevMode(() => setDevModeState(getDevMode())), []);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchBusy, setBatchBusy] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false); // Ctrl+K 命令面板
  const dragDid = useRef<string | null>(null);

  // 全局快捷键：Ctrl+K / Ctrl+F 开关命令面板；Ctrl+1/2/3 切换侧栏页签；Esc 退出编辑/搜索
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'k' || e.key === 'f')) {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if ((e.ctrlKey || e.metaKey) && ['1', '2', '3'].includes(e.key)) {
        e.preventDefault();
        setTab((['devices', 'scenes', 'me'] as const)[Number(e.key) - 1]);
        return;
      }
      if (e.key === 'Escape') {
        if (paletteOpen) return; // 面板自行处理
        if (editing) toggleEdit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paletteOpen, editing]);

  // 开机自启状态
  useEffect(() => {
    autostartIsEnabled().then(setAutostart).catch(() => undefined);
    // 关闭行为：把本地记忆同步给 Rust（重启后不再是硬编码默认值）
    invoke('set_close_to_tray', { v: getCloseToTrayPref() }).catch(() => undefined);
    // 运行时版本（消除 0.1.0/0.1.1/dev 三处硬编码不一致）
    void import('@tauri-apps/api/app')
      .then((m) => m.getVersion())
      .then(setAppVersion)
      .catch(() => setAppVersion('0.1.1'));
  }, []);
  const toggleAutostart = async () => {
    try {
      if (autostart) await autostartDisable();
      else await autostartEnable();
      setAutostart(!autostart);
      log('开机自启', !autostart ? '开启' : '关闭');
      toast(`开机自启已${autostart ? '关闭' : '开启'}`, 'ok');
    } catch (e) {
      log('开机自启设置失败', e);
      toast('开机自启设置失败', 'err');
    }
  };

  // 关闭行为开关（真实写入 Rust + 本地记忆，不是本地摆设）
  const toggleCloseToTray = async () => {
    const next = !closeToTray;
    setCloseToTray(next);
    setCloseToTrayPref(next);
    try {
      await invoke('set_close_to_tray', { v: next });
      log('关闭行为', next ? '隐藏到托盘' : '直接退出');
    } catch (e) {
      log('关闭行为设置失败', e);
    }
  };

  // 检查更新（GitHub Releases 最新版比对）
  const checkUpdate = async () => {
    try {
      const res = await fetch('https://api.github.com/repos/ShaoCI-Hz/MiHome/releases/latest', {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { tag_name?: string; html_url?: string };
      const latest = (data.tag_name ?? '').replace(/^v/, '');
      const cur = appVersion || '0.1.1';
      if (latest && latest !== cur) {
        toast(`发现新版本 v${latest}（当前 ${cur}），正在打开下载页`, 'ok');
        if (data.html_url) void openUrl(data.html_url);
      } else {
        toast(`已是最新版本（v${cur}）`, 'ok');
      }
    } catch (e) {
      log('检查更新失败', e);
      toast(`检查更新失败: ${e instanceof Error ? e.message : e}`, 'err');
    }
  };

  // 编辑模式切换（退出时清空勾选与子模式）
  const toggleEdit = () => {
    setEditing((v) => !v);
    setSelected(new Set());
    setEditMode('check');
  };
  const toggleSelect = (did: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(did)) n.delete(did);
      else n.add(did);
      return n;
    });
  };

  // 批量开/关：收集全部开关指令后走协议批量写（原 N 次串行 → 1 次请求）
  const batchSet = async (value: boolean) => {
    // 关闭是不可逆的硬件动作（夜里全屋断电类误触代价高），二次确认；开启保持一键
    if (!value && !window.confirm(`确定关闭所选 ${selected.size} 台设备？`)) return;
    setBatchBusy(true);
    const { api, devices: latest } = useApp.getState();
    const params: { did: string; siid: number; piid: number; value: unknown }[] = [];
    let skip = 0;
    for (const did of selected) {
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
        params.push({ did: d.did, siid: ctrl.siid, piid: ctrl.piid, value });
      } catch {
        skip += 1;
      }
    }
    let ok = 0;
    let fail = 0;
    if (params.length) {
      try {
        const ret = (await api.setDevicesProp(params)) as { code?: number }[];
        for (const r of ret) {
          if (r.code === 0 || r.code === 1) ok += 1;
          else fail += 1;
        }
      } catch {
        fail = params.length;
      }
    }
    setBatchBusy(false);
    log(`批量${value ? '开启' : '关闭'}: 成功${ok} 失败${fail} 跳过${skip}（单请求）`);
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

  // 排序：在线优先 / 按名称 / 按类型 / 自定义拖拽顺序（搜索已统一到 Ctrl+K 命令面板）
  const sorted = useMemo(() => {
    if (sortMode === 'order') return applyOrder(homeId, shown);
    return [...shown].sort((a, b) => {
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
  }, [shown, sortMode, homeId, orderTick]);

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
    if (runningScene) return; // 执行中防重复触发
    const { api } = useApp.getState();
    setRunningScene(sceneId);
    try {
      await api.runScene(sceneId, homeId);
      log('scene 执行成功', sceneId);
      feedback('场景已执行', `已执行「${name}」`, 'ok');
    } catch (e) {
      log('scene 执行失败', e);
      feedback('场景执行失败', `场景失败: ${e instanceof Error ? e.message : e}`, 'err');
    } finally {
      setRunningScene(null);
    }
  };

  return (
    <div className="mi-page">
      {/* ===== 侧边导航（桌面布局：左侧固定导航栏） ===== */}
      <nav className="mi-sidebar" role="tablist" aria-orientation="vertical" aria-label="主导航">
        <div className="mi-sidebar-brand">
          <span aria-hidden>🏠</span>
          <b>MiHome</b>
        </div>
        <button
          role="tab"
          aria-selected={tab === 'devices'}
          className={tab === 'devices' ? 'active' : ''}
          onClick={() => setTab('devices')}
          title="设备（Ctrl+1）"
        >
          <span className="mi-side-icon" aria-hidden>🏠</span>
          <span>设备</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'scenes'}
          className={tab === 'scenes' ? 'active' : ''}
          onClick={() => setTab('scenes')}
          title="场景（Ctrl+2）"
        >
          <span className="mi-side-icon" aria-hidden>⚡</span>
          <span>场景</span>
        </button>
        <button
          role="tab"
          aria-selected={tab === 'me'}
          className={tab === 'me' ? 'active' : ''}
          onClick={() => setTab('me')}
          title="我的（Ctrl+3）"
        >
          <span className="mi-side-icon" aria-hidden>👤</span>
          <span>我的</span>
        </button>
        {appVersion && <div className="mi-sidebar-version">v{appVersion}</div>}
      </nav>

      {/* ===== 主内容列 ===== */}
      <div className="mi-main-col">
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
                className="mi-icon-btn"
                title="搜索（Ctrl+K）"
                onClick={() => setPaletteOpen(true)}
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

      {/* 编辑模式工具条：多选 / 尺寸 / 拖拽 三选一（拆分原三合一冲突） */}
      {editing && tab === 'devices' && (
        <div className="mi-edit-modes">
          <span>编辑模式</span>
          <button className={editMode === 'check' ? 'active' : ''} onClick={() => setEditMode('check')}>多选</button>
          <button className={editMode === 'size' ? 'active' : ''} onClick={() => setEditMode('size')}>卡片尺寸</button>
          <button className={editMode === 'drag' ? 'active' : ''} onClick={() => setEditMode('drag')}>拖拽排序</button>
        </div>
      )}

      {offline && (
        <div className="mi-error mi-offline-banner">
          <span>📡 当前离线：显示的是缓存数据，控制操作不可用</span>
          <div className="mi-error-actions">
            <button onClick={() => refresh()} disabled={loading}>重新连接</button>
          </div>
        </div>
      )}

      {error && !offline && (
        <div className="mi-error">
          <span>{error}</span>
          <div className="mi-error-actions">
            <button onClick={() => refresh()} disabled={loading}>重试</button>
            <button onClick={() => clearError()}>关闭</button>
          </div>
        </div>
      )}

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
                    editMode={editMode}
                    onLongPress={() => setEditing(true)}
                    checked={selected.has(d.did)}
                    onToggleCheck={() => toggleSelect(d.did)}
                    draggable={editing && editMode === 'drag'}
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
                  className={`mi-scene-item ${runningScene === s.scene_id ? 'running' : ''}`}
                  disabled={runningScene !== null}
                  onClick={() => runScene(s.scene_id, String(s.home_id ?? currentHomeId), s.name)}
                >
                  <span className="mi-scene-play">{runningScene === s.scene_id ? '⋯' : '▶'}</span>
                  <span className="mi-scene-name">{s.name}</span>
                </button>
              ))}
            </div>
          )}
          <SchedulePanel scenes={scenes} currentHomeId={currentHomeId} />
        </main>
      )}

      {/* ===== 我的 ===== */}
      {tab === 'me' && (
        <main className="mi-content" key="me">
          {/* 账号概览 */}
          <div className="mi-profile">
            <div className="mi-avatar">👤</div>
            <div className="mi-profile-info">
              <div className="mi-profile-name">米家用户</div>
              <div className="mi-profile-sub">{homes.length} 个家庭 · {devices.length} 台设备 · {scenes.length} 个场景</div>
            </div>
          </div>

          {/* 外观 */}
          <div className="mi-cell-group-title">外观</div>
          <div className="mi-cell-list">
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
          </div>

          {/* 系统 */}
          <div className="mi-cell-group-title">系统</div>
          <div className="mi-cell-list">
            <div className="mi-cell">
              <span>开机自启</span>
              <button
                className={`mi-toggle ${autostart ? 'on' : ''}`}
                role="switch"
                aria-checked={autostart}
                aria-label="开机自启"
                onClick={() => toggleAutostart()}
              >
                <span className="mi-toggle-knob" />
              </button>
            </div>
            <div className="mi-cell">
              <span title="关闭窗口时隐藏到托盘后台运行；关闭后程序不退出">关闭窗口行为</span>
              <button
                className={`mi-toggle ${closeToTray ? 'on' : ''}`}
                role="switch"
                aria-checked={closeToTray}
                aria-label="关闭窗口时隐藏到托盘"
                onClick={() => toggleCloseToTray()}
              >
                <span className="mi-toggle-knob" />
              </button>
            </div>
            <div className="mi-cell">
              <span>关闭行为说明</span>
              <em>{closeToTray ? '隐藏到托盘（右键托盘可退出）' : '直接退出程序'}</em>
            </div>
          </div>

          {/* 开发者 */}
          <div className="mi-cell-group-title">开发者</div>
          <div className="mi-cell-list">
            <div className="mi-cell">
              <span title="开启后显示设备的全部高阶控制项（电压/电流/厂商自定义等）">开发者模式</span>
              <button
                className={`mi-toggle ${devMode ? 'on' : ''}`}
                role="switch"
                aria-checked={devMode}
                aria-label="开发者模式"
                onClick={() => setDevMode(!devMode)}
              >
                <span className="mi-toggle-knob" />
              </button>
            </div>
            {devMode && (
              <div className="mi-cell">
                <span style={{ color: 'var(--mi-sub)', fontSize: 12 }}>已开启：设备详情展示全部控制项</span>
              </div>
            )}
          </div>

          {/* 关于 */}
          <div className="mi-cell-group-title">关于</div>
          <div className="mi-cell-list">
            <div className="mi-cell">
              <span>版本</span>
              <em>v{appVersion || '…'}</em>
            </div>
            <div className="mi-cell">
              <span>检查更新</span>
              <button className="mi-cell-mini-btn" onClick={() => checkUpdate()}>检查</button>
            </div>
            <button
              className="mi-cell mi-cell-btn danger"
              onClick={() => {
                if (window.confirm('确定退出登录？需要重新扫码才能使用。')) logout();
              }}
            >
              退出登录
            </button>
          </div>
          <p className="mi-about">非官方客户端 · 凭据仅存于本机系统凭据管理器</p>
        </main>
      )}
      </div>

      {/* Ctrl+K 命令面板 */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        onGotoRoom={(didlist) => {
          const idx = currentRooms.findIndex(
            (r) => JSON.stringify(r.didlist ?? []) === JSON.stringify(didlist),
          );
          setRoomIdx(idx >= 0 ? idx + 1 : 0);
          setTab('devices');
        }}
      />
    </div>
  );
}
