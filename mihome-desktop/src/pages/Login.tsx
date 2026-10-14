/** 扫码登录页 */
import { useCallback, useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { QrLoginData } from '../api/types';
import { useApp } from '../api/store';

/** 二维码过期/超时类错误：可以自动重取，不需要用户干预 */
function isQrStaleError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  return /超时|过期|失效/.test(e.message);
}

/** 连续自动重取上限：超过后转手动（防异常网络下无限打接口） */
const AUTO_REFRESH_LIMIT = 10;

export function Login() {
  const { beginQrLogin, confirmQrLogin, loading, error } = useApp();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'error'>('loading');
  // 真实错误透出（不再吞错只显示"二维码过期"）
  const [localError, setLocalError] = useState<string | null>(null);
  /** 驱动重新取码（自动续期 / 手动按钮共用），替代整页 reload */
  const [qrTick, setQrTick] = useState(0);
  const [autoCount, setAutoCount] = useState(0);
  const [staleNote, setStaleNote] = useState(false);
  const qrRef = useRef<QrLoginData | null>(null);
  const seqRef = useRef(0);

  const refreshQr = useCallback(() => {
    setLocalError(null);
    setQrTick((t) => t + 1);
  }, []);

  // 取二维码
  useEffect(() => {
    let dead = false;
    const seq = ++seqRef.current;
    (async () => {
      setStatus('loading');
      setQrDataUrl(null);
      setLocalError(null);
      try {
        const loginUrl = await beginQrLogin();
        if (dead || seq !== seqRef.current) return;
        if (!loginUrl) return; // 静默刷新成功，store 已切换
        // beginQrLogin 返回 loginUrl；重新取完整数据用于长轮询
        // 为保持简单：store 的 beginQrLogin 内部已持有 qr 数据
        const url = await QRCode.toDataURL(loginUrl, { width: 240, margin: 1 });
        if (dead || seq !== seqRef.current) return;
        setQrDataUrl(url);
        setStatus('waiting');
      } catch (e) {
        if (dead || seq !== seqRef.current) return;
        console.error(e);
        setLocalError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    })();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrTick]);

  // 长轮询等待扫码
  useEffect(() => {
    if (status !== 'waiting') return;
    let dead = false;
    const poll = async () => {
      // store 中保存最近一次 qr 数据
      const qr = useApp.getState().lastQrData;
      if (!qr) return;
      qrRef.current = qr;
      try {
        await confirmQrLogin(qr);
        if (!dead) setStatus('waiting');
      } catch (e) {
        if (dead) return;
        console.error(e);
        // 二维码过期/轮询超时是扫码登录的常态：自动原地重取，不再要求重载整页
        if (isQrStaleError(e) && autoCount < AUTO_REFRESH_LIMIT) {
          setAutoCount((n) => n + 1);
          setStaleNote(true);
          setQrTick((t) => t + 1);
          return;
        }
        setLocalError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    };
    poll();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, qrTick]);

  const displayError = error ?? localError ?? '二维码获取失败，请重试';

  return (
    <div className="login-page">
      <div className="login-card">
        <h1>🏠 MiHome</h1>
        <p className="login-hint">使用米家 App 扫码登录</p>
        <ol className="login-steps">
          <li>打开手机<b>米家 App</b>，进入「我的 → 扫一扫」</li>
          <li>扫描下方二维码</li>
          <li>在手机上点击<b>「确认登录」</b></li>
        </ol>
        {error && status !== 'error' && <div className="error-banner">{error}</div>}
        <div className="qr-box">
          {status === 'loading' && <div className="qr-loading">正在获取二维码…</div>}
          {status === 'waiting' && qrDataUrl && (
            <>
              <img src={qrDataUrl} alt="登录二维码" />
              <div className="qr-tip">
                {loading ? '等待扫码确认…' : '请在手机上点击「确认登录」'}
              </div>
              {staleNote && <div className="qr-tip qr-tip-stale">二维码已自动刷新，请重新扫描</div>}
            </>
          )}
          {status === 'error' && (
            <div className="qr-error">
              <p>{displayError}</p>
              <button onClick={refreshQr}>重新获取二维码</button>
            </div>
          )}
        </div>
        <p className="login-foot">凭据仅保存在本机系统凭据管理器中</p>
      </div>
    </div>
  );
}
