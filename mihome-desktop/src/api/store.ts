/** 全局状态：登录流程 + 家庭/设备数据 */
import { create } from 'zustand';
import { MiClient } from './client';
import { MiHomeApi } from './mijia';
import { deleteAuth, loadAuth, saveAuth } from './storage';
import { schedulePropsFetch } from './propsStore';
import { log } from './log';
import type { MiDevice, MiHome, MiRoom, MiScene, QrLoginData } from './types';
import { MiLoginError } from './types';
import { saveDataCache, loadDataCache, cacheAgeText } from './cache';

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
  /** 离线模式：网络不可用，展示本地缓存数据（只读，控制不可用） */
  offline: boolean;
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
  /** 清除全局错误提示 */
  clearError: () => void;
  /** 登录态失效：回到登录页并提示（全链路自愈入口） */
  sessionExpired: () => void;
  /** 退出登录 */
  logout: () => Promise<void>;
}

export const useApp = create<AppState>((set, get) => {
  const client = new MiClient();
  const api = new MiHomeApi(client);
  /** 扫码长轮询取消器：重新获取二维码/退出登录时中止旧轮询，避免并发登录 */
  let loginAbort: AbortController | null = null;

  const cancelLoginPoll = () => {
    loginAbort?.abort();
    loginAbort = null;
  };

  /**
   * 加载家庭数据并进入主界面。
   * 失败回退登录页并展示错误，避免“ready 但空白无提示”状态。
   */
  const loadHomes = async () => {
    try {
      const homes = await api.getHomesList();
      log('loadHomes 成功, homes=', homes.length);
      set({ homes, currentHomeId: homes[0] ? String(homes[0].id) : null });
      if (homes[0]) await get().selectHome(String(homes[0].id));
    } catch (e) {
      if (e instanceof MiLoginError && e.expired) {
        get().sessionExpired();
        return;
      }
      // 网络问题且有缓存 → 降级为离线只读，而不是打回登录页
      if (e instanceof MiLoginError && !e.expired) {
        const cache = loadDataCache();
        if (cache) {
          log('loadHomes 网络失败，降级离线模式');
          set({
            phase: 'ready',
            offline: true,
            loading: false,
            homes: cache.homes,
            currentHomeId: cache.currentHomeId,
            devices: cache.devices,
            scenes: cache.scenes,
            currentRooms: cache.currentRooms,
            error: `网络不可用，正在离线浏览缓存数据（${cacheAgeText(cache.savedAt)}）`,
          });
          return;
        }
      }
      const msg = e instanceof Error ? e.message : String(e);
      log('loadHomes 失败 -', msg);
      set({ phase: 'login', loading: false, error: `加载数据失败: ${msg}` });
    }
  };

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
    offline: false,
    lastQrData: null,

    init: async () => {
      log('init: 启动');
      try {
        const auth = await loadAuth();
        log('loadAuth:', auth ? `有保存凭据 keys=${Object.keys(auth).join(',')}` : '无');
        if (auth) {
          client.auth = auth;
          const ok = await client.checkAvailable();
          log('已存凭据 checkAvailable =>', ok, '|', client.lastDiag);
          if (ok) {
            set({ phase: 'ready', offline: false });
            await loadHomes();
            return;
          }
          // 探测失败：先试静默刷新（可能只是 serviceToken 过期，passToken 还能救）
          const refreshed = await client.tryRefresh();
          if (refreshed) {
            await saveAuth(client.auth);
            set({ phase: 'ready', offline: false });
            await loadHomes();
            return;
          }
          // 网络问题且有缓存 → 离线只读模式（不再"接口一抖就变砖"）
          if (client.lastRefreshVerdict === 'network') {
            const cache = loadDataCache();
            if (cache) {
              log('init: 网络不可用，进入离线模式，缓存于', cacheAgeText(cache.savedAt));
              set({
                phase: 'ready',
                offline: true,
                homes: cache.homes,
                currentHomeId: cache.currentHomeId,
                devices: cache.devices,
                scenes: cache.scenes,
                currentRooms: cache.currentRooms,
                error: `网络不可用，正在离线浏览缓存数据（${cacheAgeText(cache.savedAt)}）`,
              });
              return;
            }
          }
        }
      } catch (e) {
        log('恢复凭据失败 -', e);
      }
      set({ phase: 'login' });
    },

    beginQrLogin: async () => {
      cancelLoginPoll(); // 旧轮询作废
      const qr = await client.getQrLoginData();
      if (qr === null) {
        // 静默刷新成功
        await saveAuth(client.auth);
        set({ phase: 'ready' });
        await loadHomes();
        return '';
      }
      set({ lastQrData: qr });
      return qr.loginUrl;
    },

    confirmQrLogin: async (qr) => {
      cancelLoginPoll();
      const ac = new AbortController();
      loginAbort = ac;
      set({ loading: true, error: null });
      log('qr: 长轮询等待扫码…');
      try {
        await client.completeQrLogin(qr, ac.signal);
        log('qr: 登录完成, auth keys=', Object.keys(client.auth).join(','));
        await saveAuth(client.auth);
        log('qr: 凭据已保存');
        set({ phase: 'ready', loading: false });
        await loadHomes();
      } catch (e) {
        if (ac.signal.aborted) {
          log('qr: 已取消（重新获取二维码或退出）');
          set({ loading: false });
          return;
        }
        log('qr: 失败 -', e, '| diag=', client.lastDiag);
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
        throw e;
      } finally {
        if (loginAbort === ac) loginAbort = null;
      }
    },

    selectHome: async (homeId) => {
      set({ currentHomeId: homeId, loading: true, error: null });
      try {
        const { homes } = get();
        const home = homes.find((h) => String(h.id) === homeId);
        // 设备与场景并行拉取（此前串行多等一整个场景请求）
        const [devices, scenes] = await Promise.all([
          api.getDevicesList(homeId, homes),
          api.getScenesList(homeId, homes).catch(() => []),
        ]);
        log('selectHome: devices=', devices.length, 'scenes=', scenes.length, 'rooms=', home?.roomlist?.length ?? 0);
        set({
          devices,
          scenes,
          currentRooms: home?.roomlist ?? [],
          loading: false,
          offline: false,
        });
        // 快照落盘，供网络异常时离线只读展示
        const st = get();
        saveDataCache({
          homes: st.homes,
          currentHomeId: homeId,
          devices,
          scenes,
          currentRooms: home?.roomlist ?? [],
        });
        // 列表就绪后立即批量拉一轮属性（并接管后续轮询）
        schedulePropsFetch(devices.map((d) => d.did));
      } catch (e) {
        log('selectHome 失败 -', e);
        if (e instanceof MiLoginError && e.expired) {
          get().sessionExpired();
          return;
        }
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    refresh: async () => {
      const { currentHomeId, homes, scenes } = get();
      if (!currentHomeId) return;
      set({ loading: true });
      try {
        // 设备与场景同步刷新（此前场景页点刷新无效果）
        const [devices, newScenes] = await Promise.all([
          api.getDevicesList(currentHomeId, homes),
          api.getScenesList(currentHomeId, homes).catch(() => scenes),
        ]);
        // 成功即清除历史错误，避免网络抖动的错误常驻误导
        set({ devices, scenes: newScenes, loading: false, error: null, offline: false });
        const st = get();
        saveDataCache({
          homes: st.homes,
          currentHomeId,
          devices,
          scenes: newScenes,
          currentRooms: st.currentRooms,
        });
      } catch (e) {
        if (e instanceof MiLoginError && e.expired) {
          get().sessionExpired();
          return;
        }
        set({ loading: false, error: e instanceof Error ? e.message : String(e) });
      }
    },

    clearError: () => set({ error: null }),

    sessionExpired: () => {
      cancelLoginPoll();
      log('sessionExpired: 登录态失效，回到登录页');
      set({
        phase: 'login',
        loading: false,
        error: '登录已过期，请重新扫码',
        homes: [],
        devices: [],
        scenes: [],
        currentRooms: [],
        currentHomeId: null,
        lastQrData: null,
      });
    },

    logout: async () => {
      cancelLoginPoll();
      await deleteAuth();
      client.auth = {};
      client.invalidateAvailable();
      set({ phase: 'login', homes: [], devices: [], scenes: [], currentHomeId: null });
    },
  };
});
