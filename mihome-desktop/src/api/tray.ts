/** 托盘场景桥：把手动场景同步到托盘菜单，接收托盘执行事件 */
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { useApp } from './store';
import { toast } from '../components/Toast';
import { log } from './log';

/** 场景变化后同步托盘子菜单（fire-and-forget） */
export function syncTrayScenes(): void {
  const { scenes } = useApp.getState();
  const payload = scenes.map((s) => ({ id: String(s.scene_id), name: s.name }));
  invoke('update_tray_scenes', { scenes: payload }).catch((e) =>
    log('托盘场景同步失败 -', e),
  );
}

/** 监听托盘点击场景事件（App 启动注册一次） */
export function initTrayEvents(): () => void {
  const un = listen<string>('run-scene', async (event) => {
    const sceneId = event.payload;
    const { api, scenes } = useApp.getState();
    const scene = scenes.find((s) => String(s.scene_id) === sceneId);
    log('托盘触发场景', sceneId, scene?.name ?? '(未知)');
    try {
      await api.runScene(sceneId, String(scene?.home_id ?? ''));
      toast(`已执行「${scene?.name ?? '场景'}」`, 'ok');
    } catch (e) {
      toast(`场景失败: ${e instanceof Error ? e.message : e}`, 'err');
    }
  });
  return () => {
    un.then((fn) => fn()).catch(() => undefined);
  };
}
