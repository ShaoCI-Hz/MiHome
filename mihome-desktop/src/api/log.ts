/** 文件日志：写入 logs/app.log（Rust 侧落盘），同时输出 console */
import { invoke } from '@tauri-apps/api/core';

// 控制字符清洗：0x00-0x08, 0x0B, 0x0C, 0x0E-0x1F（保留 0x09 Tab / 0x0A 换行）
const CONTROL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');

export function log(...args: unknown[]): void {
  const line = args
    .map((a) => {
      if (a instanceof Error) return `${a.name}:${a.message}`;
      if (typeof a === 'object') {
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      }
      return String(a);
    })
    .join(' ')
    .replace(CONTROL_CHARS, '*');
  console.log('[LOG]', line);
  invoke('log_write', { line }).catch(() => {
    /* 日志失败不阻塞 */
  });
}
