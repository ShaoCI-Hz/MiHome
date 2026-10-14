/**
 * 小米账号/米家云 HTTP 客户端（底层）
 *
 * 登录流程与业务请求均通过 Tauri 的 http 插件发出（无浏览器 CORS 限制）。
 * 端点与请求头格式对照 mijia-api 的公开实现，为独立编写的 TS 版本。
 */
import { fetch } from '@tauri-apps/plugin-http';
import { invoke } from '@tauri-apps/api/core';
import { log } from './log';
import {
  decryptResponse,
  generateEncParams,
  genNonce,
  signedNonce,
} from './crypto';
import {
  type AuthData,
  type QrLoginData,
  type QrLoginResult,
  type ServiceLoginResult,
  MiApiError,
  MiLoginError,
} from './types';

const API_BASE = 'https://api.mijia.tech/app';
const LOGIN_URL = 'https://account.xiaomi.com/longPolling/loginUrl';

/** 生成随机 UA（伪装米家 Android 客户端） */
function genUA(locale: string, passO: string): string {
  const hex = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  const upper = (n: number) =>
    Array.from(crypto.getRandomValues(new Uint8Array(n)))
      .map((b) => b.toString(16).toUpperCase().padStart(2, '0'))
      .join('');
  const region = locale.split('_')[1] ?? 'CN';
  const id1 = upper(20).toUpperCase();
  const id2 = hex(16);
  const id3 = hex(16);
  const id4 = upper(20).toUpperCase();
  return (
    `Android-15-11.0.701-Xiaomi-23046RP50C-OS2.0.212.0.VMYCNXM-` +
    `${id1}-${region}-${id3}-${id2}-SmartHome-MI_APP_STORE-${id1}|${id4}|${passO}-64`
  );
}

function genRandomString(n: number, alphabet: string): string {
  const bytes = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

/** 时区 cookie（如 GMT+08:00） */
function tzOffset(): string {
  const m = new Date().toString().match(/GMT([+-]\d{2})(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : '+08:00';
}

/** 去掉小米响应的 &&&START&&& 前缀并解析 JSON */
function parseServiceRet(text: string): Record<string, unknown> {
  return JSON.parse(text.replace('&&&START&&&', ''));
}

/** 用 Rust 侧发起 GET 并提取 Set-Cookie（JS 侧读不到该头） */
async function fetchWithCookies(
  url: string,
  headers: Record<string, string>,
): Promise<{ status: number; text: string; cookies: Record<string, string>; hops: string[] }> {
  return invoke('mi_fetch', { url, headers });
}

export class MiClient {
  auth: AuthData = {};
  private locale = 'zh_CN';
  private availableCache: boolean | null = null;
  private availableCacheTime = 0;

  constructor() {}

  private get passO(): string {
    if (!this.auth.pass_o) {
      this.auth.pass_o = genRandomString(16, '0123456789abcdef');
    }
    return this.auth.pass_o;
  }

  private get deviceId(): string {
    if (!this.auth.deviceId) {
      this.auth.deviceId = genRandomString(
        16,
        '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_-',
      );
    }
    return this.auth.deviceId;
  }

  private get ua(): string {
    if (!this.auth.ua) this.auth.ua = genUA(this.locale, this.passO);
    return this.auth.ua;
  }

  /** 业务请求头（对照 mijia-api _init_session） */
  private sessionHeaders(): Record<string, string> {
    const offset = tzOffset();
    return {
      'User-Agent': this.ua,
      'accept-encoding': 'identity',
      'Content-Type': 'application/x-www-form-urlencoded',
      'miot-accept-encoding': 'GZIP',
      'miot-encrypt-algorithm': 'ENCRYPT-RC4',
      'x-xiaomi-protocal-flag-cli': 'PROTOCAL-HTTP2',
      Cookie: [
        `cUserId=${this.auth.cUserId ?? ''}`,
        `yetAnotherServiceToken=${this.auth.serviceToken ?? ''}`,
        `serviceToken=${this.auth.serviceToken ?? ''}`,
        `timezone_id=Asia/Shanghai`,
        `timezone=GMT${offset}`,
        `is_daylight=0`,
        `dst_offset=0`,
        `channel=MI_APP_STORE`,
        `countryCode=${this.locale.split('_')[1] ?? 'CN'}`,
        `PassportDeviceId=${this.deviceId}`,
        `locale=${this.locale}`,
      ].join(';'),
    };
  }

  /** serviceLogin 头（登录/刷新用） */
  private serviceHeaders(): Record<string, string> {
    return {
      'User-Agent': this.ua,
      Connection: 'keep-alive',
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: [
        `deviceId=${this.deviceId}`,
        `pass_o=${this.passO}`,
        `passToken=${this.auth.passToken ?? ''}`,
        `userId=${this.auth.userId ?? ''}`,
        `cUserId=${this.auth.cUserId ?? ''}`,
        `uLocale=${this.locale}`,
      ].join(';'),
    };
  }

  private plainHeaders(): Record<string, string> {
    return {
      'User-Agent': this.ua,
      'Accept-Encoding': 'gzip',
      'Content-Type': 'application/x-www-form-urlencoded',
      Connection: 'keep-alive',
    };
  }

  /** GET serviceLogin，返回 location/ssecurity 等 */
  async getServiceLogin(): Promise<ServiceLoginResult> {
    const url =
      `https://account.xiaomi.com/pass/serviceLogin?_json=true&sid=mijia&_locale=${this.locale}`;
    const res = await fetch(url, { headers: this.serviceHeaders() });
    if (!res.ok) throw new MiLoginError(res.status, await res.text());
    return parseServiceRet(await res.text()) as unknown as ServiceLoginResult;
  }

  /** 诊断信息（错误时透出给 UI，便于定位） */
  lastDiag = '';

  /**
   * 尝试用 passToken 静默刷新 token。
   * 成功返回 true（auth 已更新），失败返回 false（需要扫码）。
   * 失败时同步 lastRefreshVerdict：'expired'=凭据确实失效，'network'=探测/请求异常（可能只是断网）。
   */
  lastRefreshVerdict: 'expired' | 'network' = 'network';
  async tryRefresh(): Promise<boolean> {
    const diag: string[] = [];
    try {
      const data = await this.getServiceLogin();
      diag.push(`serviceLogin code=${data.code}${data.desc ? ` desc=${data.desc}` : ''}${data.qs ? ` qs=${String(data.qs).slice(0, 20)}` : ''}`);
      if (data.code === 0 && data.location) {
        const ret = await fetchWithCookies(data.location, this.sessionHeaders());
        diag.push(`locFetch hops=${JSON.stringify(ret.hops)} text=${JSON.stringify(ret.text.slice(0, 40))}`);
        if (ret.status === 200 && ret.text === 'ok') {
          this.auth = {
            ...this.auth,
            ...ret.cookies,
            // 响应带 ssecurity 则更新；不带则沿用扫码时获取的
            ...(data.ssecurity ? { ssecurity: data.ssecurity } : {}),
          };
          this.lastDiag = diag.join(' | ');
          return true;
        }
        // 服务端正常应答但确认页不是 ok（跳登录页）→ 凭据失效
        this.lastRefreshVerdict = 'expired';
      } else if (data.location) {
        diag.push(`location=${data.location.slice(0, 80)}`);
        // 有 location 但 code≠0（如需重新登录）→ 凭据失效
        this.lastRefreshVerdict = data.code === 0 ? 'network' : 'expired';
      } else {
        // code≠0 且无 location → 凭据失效
        this.lastRefreshVerdict = 'expired';
      }
      this.lastDiag = diag.join(' | ');
      return false;
    } catch (e) {
      // 请求异常（断网/超时/DNS）→ 不能断定凭据失效
      this.lastRefreshVerdict = 'network';
      this.lastDiag = `${diag.join(' | ')} | EX=${e instanceof Error ? e.message : String(e)}`;
      return false;
    }
  }

  /**
   * 第一步：获取二维码登录数据（不阻塞）
   * 若静默刷新成功返回 null
   */
  async getQrLoginData(): Promise<QrLoginData | null> {
    if ((await this.tryRefresh()) && this.available()) return null;

    const loc = await this.getServiceLogin();
    const params = new URLSearchParams();
    if (loc.location) {
      // location 本身的 query 参数并入
      const q = new URL(loc.location).searchParams;
      q.forEach((v, k) => params.set(k, v));
    }
    params.set('theme', '');
    params.set('bizDeviceType', '');
    params.set('_hasLogo', 'false');
    params.set('_qrsize', '240');
    params.set('_dc', String(Date.now()));

    const res = await fetch(`${LOGIN_URL}?${params.toString()}`, {
      headers: this.plainHeaders(),
    });
    if (!res.ok) throw new MiLoginError(res.status, await res.text());
    const data = parseServiceRet(await res.text());
    if (data.code !== 0) {
      throw new MiLoginError(Number(data.code), String(data.desc ?? '获取二维码失败'));
    }
    return data as unknown as QrLoginData;
  }

  /**
   * 第二步：长轮询等待扫码，完成登录并保存 auth
   * @param qrData getQrLoginData 的返回
   * @param onTimeout 轮询超时回调（用于 UI 提示）
   */
  async completeQrLogin(qrData: QrLoginData, external?: AbortSignal): Promise<void> {
    let lpData: QrLoginResult;
    // 2 分钟扫码窗口 + 外部取消（重新获取二维码/退出登录时中止）
    const signals = [AbortSignal.timeout(120000)];
    if (external) signals.push(external);
    try {
      const res = await fetch(qrData.lp, {
        headers: this.plainHeaders(),
        signal: AbortSignal.any(signals),
      });
      if (!res.ok) throw new MiLoginError(res.status, await res.text());
      lpData = parseServiceRet(await res.text()) as unknown as QrLoginResult;
    } catch (e) {
      if (external?.aborted) throw e; // 取消：原样抛出供上层识别
      if (e instanceof MiLoginError) throw e;
      throw new MiLoginError(-1, `扫码超时或网络错误，请重试（${e instanceof Error ? e.message : e}）`);
    }
    if (lpData.code && lpData.code !== 0) {
      throw new MiLoginError(lpData.code, lpData.desc ?? '登录失败');
    }
    const keys = ['psecurity', 'nonce', 'ssecurity', 'passToken', 'userId', 'cUserId'] as const;
    for (const k of keys) {
      (this.auth as Record<string, string>)[k] = lpData[k];
    }
    // 回调地址换取 serviceToken 等 cookie（必须走 Rust 侧读整条重定向链的 Set-Cookie）
    const cb = await fetchWithCookies(lpData.location, this.plainHeaders());
    this.auth = { ...this.auth, ...cb.cookies };
    this.lastDiag = `cb status=${cb.status} cookies=[${Object.keys(cb.cookies).join(',')}]`;
    log('QR cb hops=', JSON.stringify(cb.hops), 'cookies=', Object.keys(cb.cookies).join(','), 'authKeys=', Object.keys(this.auth).join(','));
    this.auth.expireTime = Date.now() + 30 * 24 * 3600 * 1000;
    this.auth.saveTime = Date.now();
    this.invalidateAvailable();
  }

  /** token 是否可用（用 check_new_msg 探测，60s 缓存） */
  available(): boolean {
    if (!this.auth.ssecurity || !this.auth.serviceToken) return false;
    const now = Date.now();
    if (this.availableCache !== null && now - this.availableCacheTime < 60000) {
      return this.availableCache;
    }
    return this.availableCache ?? false; // 异步路径由 ensureAvailable 更新
  }

  invalidateAvailable(): void {
    this.availableCache = null;
    this.availableCacheTime = 0;
  }

  async checkAvailable(): Promise<boolean> {
    if (!this.auth.ssecurity || !this.auth.serviceToken) {
      // 脱敏：ID 只保留前后 2 位
      const mask = (s?: string) => {
        const v = s ?? '-';
        return v.length <= 4 ? '**' : `${v.slice(0, 2)}**${v.slice(-2)}`;
      };
      this.lastDiag = `missing cred: ssecurity=${this.auth.ssecurity ? 'Y' : 'N'} serviceToken=${this.auth.serviceToken ? 'Y' : 'N'} userId=${mask(this.auth.userId)} cUserId=${mask(this.auth.cUserId)}`;
      return false;
    }
    const now = Date.now();
    if (this.availableCache !== null && now - this.availableCacheTime < 60000) {
      return this.availableCache;
    }
    try {
      await this.request('/v2/message/v2/check_new_msg', { begin_at: Math.floor(now / 1000) - 3600 }, false);
      this.availableCache = true;
    } catch (e) {
      this.availableCache = false;
      this.lastDiag = `check_new_msg FAIL: ${e instanceof Error ? e.message : String(e)}`;
    }
    this.availableCacheTime = now;
    return this.availableCache;
  }

  /**
   * 业务 API 请求（签名 + RC4 加密 + POST）
   */
  async request(uri: string, data: Record<string, unknown>, refreshToken = true): Promise<unknown> {
    if (refreshToken) await this.ensureRefresh();
    const ssecurity = this.auth.ssecurity;
    if (!ssecurity) throw new MiLoginError(-1, '未登录');

    const nonce = genNonce();
    const snb = await signedNonce(ssecurity, nonce);
    const params: Record<string, string> = { data: JSON.stringify(data) };
    const enc = await generateEncParams(uri, 'POST', snb, nonce, params, ssecurity);

    const body = new URLSearchParams(enc);
    const res = await fetch(API_BASE + uri, {
      method: 'POST',
      headers: this.sessionHeaders(),
      body: body.toString(),
    });
    const text = await res.text();
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(text);
    } catch {
      const dec = await decryptResponse(snb, text);
      parsed = JSON.parse(dec);
    }
    if (Number(parsed.code ?? 0) !== 0 || !('result' in parsed)) {
      log('API 失败', uri, 'code=', parsed.code, 'msg=', parsed.message ?? parsed.desc, 'hasResult=', 'result' in parsed);
      throw new MiApiError(Number(parsed.code), String(parsed.message ?? parsed.desc ?? '未知错误'));
    }
    return parsed.result;
  }

  /** token 刷新：先试静默刷新，失败则报错要求重新扫码 */
  private async ensureRefresh(): Promise<void> {
    if (await this.checkAvailable()) return;
    const checkDiag = this.lastDiag;
    const ok = await this.tryRefresh();
    if (ok) {
      this.invalidateAvailable();
      return;
    }
    // 仅当刷新失败可断定凭据失效时才标记 expired（网络问题不应把用户踢回登录页）
    const expired = this.lastRefreshVerdict === 'expired';
    throw new MiLoginError(
      -1,
      expired
        ? `登录已过期，请重新扫码\n[探测] ${checkDiag}\n[刷新] ${this.lastDiag}`
        : `网络异常，登录状态无法确认\n[探测] ${checkDiag}\n[刷新] ${this.lastDiag}`,
      expired,
    );
  }
}
