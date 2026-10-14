/** 轻量 Toast：替代原生 alert，不阻塞主线程，跟随主题 */
import { useEffect, useState } from 'react';

export type ToastKind = 'ok' | 'err' | 'info';
interface ToastItem {
  id: number;
  text: string;
  kind: ToastKind;
  /** 退场中（播 out 动画后真正移除，避免闪现消失） */
  closing?: boolean;
}

let listeners: ((t: ToastItem) => void)[] = [];
let seq = 0;

/** 发一条 Toast（模块级调用：toast('已保存')） */
export function toast(text: string, kind: ToastKind = 'ok'): void {
  const item = { id: ++seq, text, kind };
  for (const fn of listeners) fn(item);
}

export function ToastHost() {
  const [items, setItems] = useState<ToastItem[]>([]);

  useEffect(() => {
    const onToast = (t: ToastItem) => {
      setItems((prev) => [...prev, t]);
      window.setTimeout(() => {
        // 先播 220ms 退场动画，再真正移除
        setItems((prev) => prev.map((x) => (x.id === t.id ? { ...x, closing: true } : x)));
        window.setTimeout(() => {
          setItems((prev) => prev.filter((x) => x.id !== t.id));
        }, 220);
      }, 2600);
    };
    listeners.push(onToast);
    return () => {
      listeners = listeners.filter((fn) => fn !== onToast);
    };
  }, []);

  if (!items.length) return null;
  return (
    <div className="mi-toast-host" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`mi-toast mi-toast--${t.kind} ${t.closing ? 'closing' : ''}`}>{t.text}</div>
      ))}
    </div>
  );
}
