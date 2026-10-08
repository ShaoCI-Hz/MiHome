/** 全局状态：登录流程 + 家庭/设备数据 */
import { create } from 'zustand';
import { MiClient } from './client';
import { MiHomeApi } from './mijia';
import { deleteAuth, loadAuth, saveAuth } from './storage';
import { log } from './log';
import type { MiDevice, MiHome, MiRoom, MiScene, QrLoginData } from './types';

export type AppPhase = 'loading' | 'login' | 'ready';

interface AppState {
  phase: AppPhase;
  client: MiClient;
  api: MiHomeApi;
  homes: MiHome[];
  currentHomeId: string | null;
  devices: MiDevice[];
  scenes: MiScene[];
  /** 当前家庭的房间列表 */
  currentRooms: MiRoom[];
  loading: boolean;
  error: string | null;
  /** 最近一次二维码登录数据（长轮询用） */
  lastQrData: QrLoginData | null;

  /** 启动：尝试恢复凭据并校验 */
  init: () => Promise<void>;
  /** 开始扫码登录，返回二维码内容（loginUrl） */
  beginQrLogin: () => Promise<string>;
  /** 等待扫码完成（长轮询） */
  confirmQrLogin: (qr: QrLoginData) => Promise<void>;
  /** 切换家庭 */
  selectHome: (homeId: string) => Promise<void>;
  /** 刷新当前家庭数据 */
  refresh: () => Promise<void>;
  /** 退出登录 */
  logout: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => {
  const client = new MiClient();
  const api = new MiHomeApi(client);
  return {
    phase: 'loading',
    client,
    api,
    homes: [],
    currentHomeId: null,
    devices: [],
    scenes: [],
    currentRooms: [],
    loading: false,
    error: null,
    lastQrData: null,

    init: async () => {
      log('init: 启动');
      // 【开发诊断】优先用已验证的测试凭据跑一次，验证请求构造是否正确
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const test = await invoke<string | null>('read_diag_auth');
        if (test) {
          client.auth = JSON.parse(test);
          log('diag: 测试凭据已加载, keys=', Object.keys(client.auth).join(','));
          const ok = await client.checkAvailable();
          log('diag: check_new_msg =>', ok, '|', client.lastDiag);
          if (ok) {
            const homes = await api.getHomesList();
            log('diag: getHomesList 成功, homes=', homes.length);
            set({
              phase: 'ready',
              homes,
              currentHomeId: homes[0] ? String(homes[0].id) : null,
            });
            if (homes[0]) await get().selectHome(String(homes[0].id));
            return;
          }
          set({ error: `[诊断] 请求构造验证失败: ${client.lastDiag}` });
        } else {
          log('diag: 无测试凭据文件');
        }
      } catch (e) {
        log('diag: 跳过 -', e);
      }

      try {
        const auth = await loadAuth();
        log('loadAuth:', auth ? `有保存凭据 keys=${Object.keys(auth).join(',')}` : '无');
        if (auth) {
          client.auth = auth;
          const ok = await client.checkAvailable();
          log('已存凭据 checkAvailable =>', ok, '|', client.lastDiag);
          if (ok) {
            const homes = await api.getHomesList();
            log('getHomesList 成功, homes=', homes.length);
            set({
              phase: 'ready',
              homes,
              currentHomeId: homes[0] ? String(homes[0].id) : null,
            });
            if (homes[0]) await get().selectHome(String(homes[0].id));
            return;
          }
        }
      } catch (e) {
        log('恢复凭据失败 -', e);
      }
      set({ phase: 'login' });
    },

    beginQrLogin: async () => {
      const qr = await client.getQrLoginData();
      if (qr === null) {
        // 静默刷新成功
        await saveAuth(client.auth);
        set({ phase: 'ready' });
        const homes = await api.getHomesList();
        set({ homes, currentHomeId: homes[0] ? String(homes[0].id) : null });
        if (homes[0]) await get().selectHome(String(homes[0].id));
        return '';
      }
      set({ lastQrData: qr });
      return qr.loginUrl;
    },

    confirmQrLogin: async (qr) => {
      set({ loading: true, error: null });
      log('qr: 长轮询等待扫码…');
      try {
        await client.completeQrLogin(qr);
        log('qr: 登录完成, auth keys=', Object.keys(client.auth).join(','));
        await saveAuth(client.auth);
        log('qr: 凭据已保存');
        set({ phase: 'ready', loading: false });
        const homes = await api.getHomesList();
        log('qr: getHomesList 成功, homes=', homes.length);
        set({ homes, currentHomeId: homes[0] ? String(homes[0].id) : null });
        if (homes[0]) await get().selectHome(String(homes[0].id));
      } catch (e) {
        log('qr: 失败 -', e, '| diag=', client.lastDiag);
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
      }
    },

    selectHome: async (homeId) => {
      set({ currentHomeId: homeId, loading: true, error: null });
      try {
        const { homes } = get();
        const home = homes.find((h) => String(h.id) === homeId);
        const devices = await api.getDevicesList(homeId, homes);
        const scenes = await api.getScenesList(homeId).catch(() => []);
        log('selectHome: devices=', devices.length, 'scenes=', scenes.length, 'rooms=', home?.roomlist?.length ?? 0);
        set({
          devices,
          scenes,
          currentRooms: home?.roomlist ?? [],
          loading: false,
        });
      } catch (e) {
        log('selectHome 失败 -', e);
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    refresh: async () => {
      const { currentHomeId, homes } = get();
      if (!currentHomeId) return;
      set({ loading: true });
      try {
        const devices = await api.getDevicesList(currentHomeId, homes);
        set({ devices, loading: false });
      } catch (e) {
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    logout: async () => {
      await deleteAuth();
      client.auth = {};
      client.invalidateAvailable();
      set({ phase: 'login', homes: [], devices: [], scenes: [], currentHomeId: null });
    },
  };
});
