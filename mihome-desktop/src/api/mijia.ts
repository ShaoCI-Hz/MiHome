/**
 * 米家业务 API 封装
 * 端点/参数对照 mijia-api 公开实现，本文件为独立 TS 实现。
 */
import { MiClient } from './client';
import type {
  MiDevice,
  MiHome,
  MiScene,
  PropKey,
  PropValue,
} from './types';

export interface PropSetValue extends PropKey {
  value: unknown;
}

export interface ActionParam {
  did: string;
  siid: number;
  aiid: number;
  value?: unknown[];
}

export class MiHomeApi {
  constructor(private client: MiClient) {}

  /** 家庭列表（含房间） */
  async getHomesList(): Promise<MiHome[]> {
    const ret = (await this.client.request('/v2/homeroom/gethome_merged', {
      fg: true,
      fetch_share: true,
      fetch_share_dev: true,
      fetch_cariot: true,
      limit: 300,
      app_ver: 7,
      plat_form: 0,
    })) as { homelist: MiHome[] };
    return ret.homelist;
  }

  private homeOwner(homes: MiHome[], homeId: string): number {
    const home = homes.find((h) => String(h.id) === String(homeId));
    if (!home) throw new Error(`未找到 home_id=${homeId} 的家庭信息`);
    return Number(home.uid);
  }

  /** 指定家庭的设备列表（自动分页） */
  async getDevicesList(homeId: string, homes?: MiHome[]): Promise<MiDevice[]> {
    const list = homes ?? (await this.getHomesList());
    const homeOwner = this.homeOwner(list, homeId);
    const devices: MiDevice[] = [];
    let startDid = '';
    let hasMore = true;
    while (hasMore) {
      const ret = (await this.client.request('/home/home_device_list', {
        home_owner: homeOwner,
        home_id: Number(homeId),
        limit: 200,
        start_did: startDid,
        get_split_device: true,
        support_smart_home: true,
        get_cariot_device: true,
        get_third_device: true,
      })) as { device_info?: MiDevice[]; max_did?: string; has_more?: boolean };
      if (ret?.device_info?.length) {
        for (const d of ret.device_info) d.home_id = String(homeId);
        devices.push(...ret.device_info);
        startDid = ret.max_did ?? '';
        hasMore = Boolean(ret.has_more) && startDid !== '';
      } else {
        hasMore = false;
      }
    }
    return devices;
  }

  /** 所有家庭的设备 */
  async getAllDevices(): Promise<MiDevice[]> {
    const homes = await this.getHomesList();
    const out: MiDevice[] = [];
    for (const h of homes) {
      out.push(...(await this.getDevicesList(String(h.id), homes)));
    }
    return out;
  }

  /** 手动场景列表 */
  async getScenesList(homeId?: string): Promise<MiScene[]> {
    if (homeId === undefined) {
      const homes = await this.getHomesList();
      const out: MiScene[] = [];
      for (const h of homes) out.push(...(await this.getScenesList(String(h.id))));
      return out;
    }
    const homes = await this.getHomesList();
    const ret = (await this.client.request(
      '/appgateway/miot/appsceneservice/AppSceneService/GetSimpleSceneList',
      {
        app_version: 12,
        get_type: 2,
        home_id: String(homeId),
        owner_uid: this.homeOwner(homes, homeId),
      },
    )) as { manual_scene_info_list?: MiScene[] };
    const scenes = ret?.manual_scene_info_list ?? [];
    for (const s of scenes) s.home_id = String(homeId);
    return scenes;
  }

  /** 执行手动场景 */
  async runScene(sceneId: string, homeId: string): Promise<unknown> {
    const homes = await this.getHomesList();
    return this.client.request(
      '/appgateway/miot/appsceneservice/AppSceneService/NewRunScene',
      {
        scene_id: sceneId,
        scene_type: 2,
        phone_id: 'null',
        home_id: String(homeId),
        owner_uid: this.homeOwner(homes, homeId),
      },
    );
  }

  /** 批量读属性 */
  async getDevicesProp(data: PropKey[] | PropKey): Promise<PropValue[] | PropValue> {
    const isSingle = !Array.isArray(data);
    const params = isSingle ? [data] : data;
    const ret = (await this.client.request('/miotspec/prop/get', {
      params,
      datasource: 1,
    })) as PropValue[];
    if (isSingle && ret.length === 1) return ret[0];
    return ret;
  }

  /** 批量写属性 */
  async setDevicesProp(data: PropSetValue[] | PropSetValue): Promise<PropValue[]> {
    const isSingle = !Array.isArray(data);
    const params = isSingle ? [data] : data;
    const ret = (await this.client.request('/miotspec/prop/set', {
      params,
    })) as PropValue[];
    if (isSingle && ret.length === 1) return [ret[0]];
    return ret;
  }

  /** 执行设备动作 */
  async runAction(data: ActionParam | ActionParam[]): Promise<unknown[]> {
    const isSingle = !Array.isArray(data);
    const params = isSingle ? [data] : data;
    const out: unknown[] = [];
    for (const param of params) {
      out.push(await this.client.request('/miotspec/action', { params: param }));
    }
    return out;
  }

  /** 消息检查（也用于探测 token 可用性） */
  async checkNewMsg(beginAt?: number): Promise<unknown> {
    return this.client.request('/v2/message/v2/check_new_msg', {
      begin_at: beginAt ?? Math.floor(Date.now() / 1000) - 3600,
    });
  }

  /**
   * 设备能耗统计（如插座用电量）
   * @param key 属性键 "siid.piid"（如 "7.1"，从 spec 的 power-consumption 属性取）
   * @param dataType stat_day_v3 / stat_hour_v3 / stat_month_v3 等
   */
  async getStatistics(params: {
    did: string;
    key: string;
    data_type: string;
    limit: number;
    time_start: number;
    time_end: number;
  }): Promise<{ value: string; time: number }[]> {
    return (await this.client.request('/v2/user/statistics', params)) as {
      value: string;
      time: number;
    }[];
  }

  /** 耗材列表（滤芯/电池等，按家庭） */
  async getConsumableItems(homeId: string): Promise<
    { did: string; name?: string; details?: unknown }[]
  > {
    const homes = await this.getHomesList();
    const ret = (await this.client.request('/v2/home/standard_consumable_items', {
      home_id: Number(homeId),
      owner_id: this.homeOwner(homes, homeId),
      filter_ignore: true,
    })) as { items?: { consumes_data?: { did: string; name?: string; details?: unknown }[] }[] };
    return ret.items?.[0]?.consumes_data ?? [];
  }
}
