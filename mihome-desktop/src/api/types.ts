/**
 * 米家协议类型定义
 * 参考 Do1e/mijia-api 的数据结构（GPL-3.0），本文件为独立实现。
 */

/** 认证数据（存于系统凭据管理器，绝不明文落盘） */
export interface AuthData {
  ua?: string;
  deviceId?: string;
  pass_o?: string;
  ssecurity?: string;
  userId?: string;
  cUserId?: string;
  passToken?: string;
  serviceToken?: string;
  /** 过期时间戳（毫秒） */
  expireTime?: number;
  saveTime?: number;
}

/** 小米账号 serviceLogin 返回 */
export interface ServiceLoginResult {
  code: number;
  desc?: string;
  location?: string;
  ssecurity?: string;
  qs?: string;
  passToken?: string;
  userId?: string;
}

/** 二维码登录数据（_get_qr_login_data 返回） */
export interface QrLoginData {
  loginUrl: string;
  qr: string;
  lp: string;
  [key: string]: string;
}

/** 长轮询扫码完成后的返回 */
export interface QrLoginResult {
  psecurity: string;
  nonce: string;
  ssecurity: string;
  passToken: string;
  userId: string;
  cUserId: string;
  location: string;
  code?: number;
  desc?: string;
}

/** 家庭 */
export interface MiHome {
  id: string;
  name: string;
  uid: number;
  roomlist?: MiRoom[];
  [key: string]: unknown;
}

/** 房间 */
export interface MiRoom {
  id: string;
  name: string;
  didlist?: string[];
  [key: string]: unknown;
}

/** 设备 */
export interface MiDevice {
  did: string;
  name: string;
  model: string;
  localip?: string;
  isOnline: boolean;
  token?: string;
  mac?: string;
  spec_type?: string;
  pid?: number;
  parent_id?: string;
  home_id?: string;
  [key: string]: unknown;
}

/** 属性查询参数 */
export interface PropKey {
  did: string;
  siid: number;
  piid: number;
}

/** 属性查询结果 */
export interface PropValue {
  did: string;
  siid: number;
  piid: number;
  iid?: string;
  value?: unknown;
  code: number;
  updateTime?: number;
  exe_time?: number;
}

/** 手动场景 */
export interface MiScene {
  scene_id: string;
  name: string;
  home_id?: string;
  [key: string]: unknown;
}

/** 业务 API 错误 */
export class MiApiError extends Error {
  constructor(public code: number, message: string) {
    super(`code: ${code}, message: ${message}`);
    this.name = 'MiApiError';
  }
}

/** 登录错误 */
export class MiLoginError extends Error {
  constructor(public code: number, message: string) {
    super(`code: ${code}, message: ${message}`);
    this.name = 'MiLoginError';
  }
}
