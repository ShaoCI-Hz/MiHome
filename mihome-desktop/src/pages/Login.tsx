/** 扫码登录页 */
import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';
import type { QrLoginData } from '../api/types';
import { useApp } from '../api/store';

export function Login() {
  const { beginQrLogin, confirmQrLogin, loading, error } = useApp();
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<'loading' | 'waiting' | 'error'>('loading');
  // 真实错误透出（不再吞错只显示"二维码过期"）
  const [localError, setLocalError] = useState<string | null>(null);
  const qrRef = useRef<QrLoginData | null>(null);
  const seqRef = useRef(0);

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
  }, []);

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
        if (!dead) {
          console.error(e);
          setLocalError(e instanceof Error ? e.message : String(e));
          setStatus('error');
        }
      }
    };
    poll();
    return () => {
      dead = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const displayError = error ?? localError ?? '二维码已过期或获取失败';

  return (
    <div className="login-page">
      <div className="login-card glass">
        <h1>🏠 MiHome</h1>
        <p className="login-hint">使用米家 App 扫码登录</p>
        {error && status !== 'error' && <div className="error-banner">{error}</div>}
        <div className="qr-box">
          {status === 'loading' && <div className="qr-loading">正在获取二维码…</div>}
          {status === 'waiting' && qrDataUrl && (
            <>
              <img src={qrDataUrl} alt="登录二维码" />
              {loading && <div className="qr-tip">等待扫码确认…</div>}
            </>
          )}
          {status === 'error' && (
            <div className="qr-error">
              <p>{displayError}</p>
              <button onClick={() => window.location.reload()}>重新获取二维码</button>
            </div>
          )}
        </div>
        <p className="login-foot">凭据仅保存在本机系统凭据管理器中</p>
      </div>
    </div>
  );
}
