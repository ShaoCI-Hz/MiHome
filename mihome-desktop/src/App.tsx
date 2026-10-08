import { useEffect } from 'react';
import { useApp } from './api/store';
import { applyTheme } from './api/prefs';
import { Login } from './pages/Login';
import { Home } from './pages/Home';
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

  // 设备列表自动轮询：60 秒刷新在线状态（后台标签页暂停）
  useEffect(() => {
    if (phase !== 'ready') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        useApp.getState().refresh().catch(() => undefined);
      }
    }, 60000);
    return () => clearInterval(timer);
  }, [phase]);

  if (phase === 'loading') {
    return (
      <div className="boot">
        <div className="boot-spinner" />
        <p>正在启动…</p>
      </div>
    );
  }
  if (phase === 'login') return <Login />;
  return <Home />;
}
