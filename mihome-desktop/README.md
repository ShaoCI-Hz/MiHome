# mihome-desktop

MiHome Desktop 的应用本体（Tauri 2 + React 19 + TypeScript + Vite + zustand）。

项目说明、功能特性与安装方式见仓库根目录的 [README](../README.md)；接手开发请先读 [HANDOFF.md](../HANDOFF.md)。

## 常用命令

```bash
pnpm install       # 安装依赖
pnpm tauri dev     # 开发模式（Vite 端口 1420，启动前确认端口空闲）
pnpm tauri build   # 打包（产物在 src-tauri/target/release/bundle/）
pnpm exec tsc --noEmit   # 前端类型检查
```

## 目录

```
src/
  api/          协议层：client.ts（登录/签名）、crypto.ts、mijia.ts（业务 API）、
                spec.ts（MIoT 规格与词典）、propsStore.ts（属性轮询）、store.ts（状态机）
  components/   DeviceCard、DeviceDetail、CommandPalette、Toast
  pages/        Login（扫码）、Home（主界面）
src-tauri/
  src/lib.rs    凭据管理器、HTTP 代理、托盘、窗口行为（全部 Rust 命令）
```
