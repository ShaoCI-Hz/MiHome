import { useEffect } from 'react';
import { useApp } from './api/store';
import { applyTheme } from './api/prefs';
import { schedulePropsFetch } from './api/propsStore';
import { initTrayEvents, syncTrayScenes } from './api/tray';
import { notify } from './api/notify';
import { log } from './api/log';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
import { ToastHost } from './components/Toast';
import './App.css';

export default function App() {
  const phase = useApp((s) => s.phase);
  const init = useApp((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  // 主题：应用偏好并跟随系统变化（auto 模式）
  useEffect(() => {
    applyTheme();
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => applyTheme();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // 统一轮询：60 秒刷设备列表 + 批量刷属性；窗口恢复可见时立即刷一轮
  useEffect(() => {
    if (phase !== 'ready') return;
    let lastOnline: Map<string, boolean> | null = null;
    const tick = async () => {
      if (document.visibilityState !== 'visible') return;
      const { refresh, devices } = useApp.getState();
      if (!lastOnline) lastOnline = new Map(devices.map((d) => [d.did, d.isOnline]));
      await refresh().catch(() => undefined);
      const { devices: latest } = useApp.getState();
      // 离线告警：由在线转离线的设备发系统通知（窗口可见时 notify 自动跳过）
      const offline: string[] = [];
      for (const d of latest) {
        if (lastOnline.get(d.did) === true && !d.isOnline) offline.push(d.name);
      }
      lastOnline = new Map(latest.map((d) => [d.did, d.isOnline]));
      if (offline.length) {
        log('设备离线告警', offline.join(','));
        notify(
          '设备离线',
          `${offline.slice(0, 3).join('、')}${offline.length > 3 ? ` 等 ${offline.length} 台` : ''} 已离线`,
        );
      }
      schedulePropsFetch(latest.map((d) => d.did));
    };
    const timer = setInterval(() => void tick(), 60000);
    const onVis = () => {
      if (document.visibilityState === 'visible') void tick();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [phase]);

  // 托盘：注册场景执行事件 + 场景列表变化时同步菜单
  const scenes = useApp((s) => s.scenes);
  useEffect(() => {
    if (phase !== 'ready') return;
    return initTrayEvents();
  }, [phase]);
  useEffect(() => {
    if (phase !== 'ready') return;
    syncTrayScenes();
  }, [phase, scenes]);

  const screen =
    phase === 'loading' ? (
      <div className="boot">
        <div className="boot-spinner" />
        <p>正在启动…</p>
      </div>
    ) : phase === 'login' ? (
      <Login />
    ) : (
      <Home />
    );
  return (
    <>
      {screen}
      <ToastHost />
    </>
  );
}
