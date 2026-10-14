# MiHome 项目交接说明

面向接手本项目的 AI 助手 / 开发者。请先完整读一遍再动手。

## 0. 位置与开局

- 项目根目录（本文件所在处）：`D:\RuanJian\Reasonix Studio\XiangMu\MiHome`
- 应用本体：`D:\RuanJian\Reasonix Studio\XiangMu\MiHome\mihome-desktop`
- 迁移说明：本项目原位于 `D:\RuanJian\Xiangmu\MIHOME`，已整体迁至上述新目录（含 `.git` 全部提交历史）。旧目录已不存在，任何地方引用旧路径都要改过来。源码内没有硬编码路径，只有 `.venv\Scripts\activate.bat` 和 `.venv\pyvenv.cfg` 记录了旧路径（重建 venv 即可，见第 7 节）。
- 新 AI 助手的工作区应指向：`D:\RuanJian\Reasonix Studio\XiangMu\MiHome`

## 1. 项目定位

- 非官方米家（MiHome）Windows 桌面客户端，开源，MIT 协议。
- 仓库：https://github.com/ShaoCI-Hz/MiHome （公开，默认分支 master）
- 技术栈：Tauri 2（Rust 后端）+ React 19 + TypeScript + Vite + zustand（状态管理），无 UI 框架，样式为手写 CSS（`src/App.css`）。
- 数据来源：米家 App 的私有 HTTP 接口，通过 `src/api/mijia.ts` 封装（登录、家庭、设备、属性、场景）。
- 目标形态：与官方米家 App 视觉与操作一致（浅色卡片、分型卡片、官方产品图、中文控件）。

目录结构：

```
MiHome 根/
  README.md              项目说明（无 emoji）
  CHANGELOG.md           更新日志（无 emoji）
  LICENSE                MIT
  HANDOFF.md             本文件
  .gitignore             忽略 .venv/、MiHome/、logs/、*.log
  .venv/                 Python 虚拟环境（仅用于图标生成脚本，含 pillow）
  MiHome/                旧 Reasonix 会话目录，已被 .gitignore 忽略，可安全删除
  mihome-desktop/
    package.json        前端依赖与脚本
    src/
      api/              mijia.ts（协议）、store.ts（全局状态）、propsStore.ts（属性轮询）、
                        spec.ts（miot-spec 解析与白名单）、prefs.ts（偏好）、tray.ts（托盘桥）、
                        notify.ts（系统通知）、log.ts
      components/       DeviceCard、DeviceDetail、CommandPalette、Toast 等
      pages/            Login（扫码）、Home（顶栏 + 房间 + 网格 + 底部导航）
    src-tauri/
      src/lib.rs        Rust 后端全部命令（凭据存取、HTTP 代理转发、托盘、窗口行为）
      capabilities/default.json   权限与网络白名单
      tauri.conf.json   窗口与打包配置
      icons/            应用图标
      target/           Rust 构建产物（体积很大，路径变化后会自动重新编译）
```

## 2. 本机环境（Windows 11）

- Rust 1.98：`D:\RuanJian\Rust`，其中 `RUSTUP_HOME=D:\RuanJian\Rust`、`CARGO_HOME=D:\RuanJian\Rust\cargo`（用户级环境变量已设）；crates 源为 rsproxy.cn 镜像，配置在 `CARGO_HOME\config.toml`。
- pnpm：`D:\RuanJian\pnpm\pnpm.cmd`（Node v24 / npm 11 已装）。
- Python：3.14（`C:\Python314`）；项目 venv 见第 7 节。
- MSVC 生成工具：`D:\RuanJian\VS Build Tools`（Tauri 编译必需）。
- 代理：Clash 监听 `127.0.0.1:7897`，**仅在需要访问 GitHub 时打开**。不要在系统级或用户级设置 `HTTP_PROXY` / `HTTPS_PROXY`：代理关闭时这些变量会毒化所有进程的网络（曾导致"二维码已过期"的假故障）。rsproxy.cn、米家接口在国内可直连，无需代理。
- GitHub 操作使用 `gh` CLI（账号 ShaoCI-Hz），`gh auth setup-git` 已配置凭据助手。

## 3. 硬性规则（不要违反）

1. 开源发布，仓库里绝不出现任何个人 token、账号密码或凭据。每个用户自行扫码登录，凭据只写进本机 Windows 凭据管理器（keyring），不落明文文件。
2. `CHANGELOG.md`、Release Notes、README 一律不使用 emoji，纯文字。
3. UI 风格与官方米家 App 对齐，控件与文案使用中文。
4. 用户已明确决定不做：多语言 UI、自动化规则编辑器（只读列表可做）、摄像头实时视频流（短中期均不做）。
5. 没有抓包证据的私有接口（消息中心列表、自动化列表、房间管理写接口）不靠猜测实现，先抓包验证再写代码。
6. 提交信息用中文，前缀 `feat:` / `fix:` / `docs:` / `release:` / `chore:`。

## 4. 当前状态

- 版本：`0.1.1`（`package.json`、`src-tauri/Cargo.toml`、`tauri.conf.json` 三处需保持一致）。
- 已发布：GitHub Release `v0.1.0`、`v0.1.1`，各含 `mihome-desktop_X.Y.Z_x64_en-US.msi` 与 `mihome-desktop_X.Y.Z_x64-setup.exe`。
- 已实现：扫码登录、家庭切换、房间筛选、设备网格（排序 / 拖拽自定义 / 卡片尺寸 / 多选批量开关）、设备卡片控制（开关、枚举、滑条、只读传感器）、设备详情（miot-spec 展开、动作执行、开发者模式全量控制项）、手动场景执行、场景同步到系统托盘、命令面板（Ctrl+K：场景 / 房间 / 设备跨家庭搜索）、主题（浅色 / 深色 / 跟随系统）、开机自启、关闭到托盘、系统通知（窗口不可见时才发）、检查更新（GitHub Releases 比对）、错误提示带重试与关闭。

## 5. 最近一轮修复内容

依据产品评估报告（体验 7.5 / 功能 6.5 / 桌面平台 5.5 / 场景 5.5）完成的修复：

- 桌面平台：新增单实例、窗口状态记忆、关闭到托盘（可在「我的」页切换为直接退出）、首次关闭弹系统通知说明去向、托盘常驻与场景菜单。
- 数据可信：属性读取失败记录错误码并在卡片上显示可读原因（如"设备离线""需蓝牙网关在线"）、数据陈旧提示（超过 90 秒显示更新时间）、刷新成功即清除历史错误。
- 交互：控制失败必有 Toast 反馈、滑条改为拖动本地回显 + 停顿 300ms 合并提交一次（不再拖动中禁用）、批量开关改为协议批量写（单请求）、场景执行中禁用防重复触发。
- 搜索统一：顶栏搜索框与 Ctrl+K 面板合并为一套，设备搜索覆盖全部家庭。
- 设置页重构：按「外观 / 系统 / 开发者 / 关于」分组，退出登录加二次确认，版本号改为运行时读取。
- 键盘与桌面习惯：Esc 关闭详情 / 退出编辑模式，右键设备卡片直达详情，补齐 `:focus-visible` 焦点样式。

## 6. 未完成 / 待办

需要抓包才能继续的：

- 消息中心列表（现有接口 `checkNewMsg` 只返回是否有新消息，列表接口未逆向）。
- 自动化规则列表与执行。
- 房间管理写操作（新建 / 重命名 / 移动设备）。
- 摄像头实时视频流（用户明确不做）。

其他：

- `mihome-desktop/README.md` 仍是 Vite 模板残留，需要改写成应用说明或删除。
- `src-tauri/target` 在目录迁移后编译缓存失效，首次构建会全量重新编译（约 30-40 分钟）。
- 通知接入点可继续扩展：登录态过期、长时间离线设备。

## 7. 常用命令

```powershell
# 前端类型检查
cd 'D:\RuanJian\Reasonix Studio\XiangMu\MiHome\mihome-desktop'
& 'D:\RuanJian\pnpm\pnpm.cmd' exec tsc --noEmit

# Rust 检查（设置好 RUSTUP_HOME / CARGO_HOME 与 PATH 后）
cd 'D:\RuanJian\Reasonix Studio\XiangMu\MiHome\mihome-desktop\src-tauri'
cargo check

# 开发调试（Vite 端口 1420，启动前确认端口未被占用）
& 'D:\RuanJian\pnpm\pnpm.cmd' tauri dev

# 打包（产物在 src-tauri\target\release\bundle\ 下的 msi 与 nsis 目录）
& 'D:\RuanJian\pnpm\pnpm.cmd' tauri build

# 重建 Python 虚拟环境（旧 venv 里的激活脚本仍写着迁移前的路径）
cd 'D:\RuanJian\Reasonix Studio\XiangMu\MiHome'
C:\Python314\python.exe -m venv .venv
.\.venv\Scripts\python.exe -m pip install pillow

# 发布新版本（改三处版本号后）
git add -A; git commit -m "release: vX.Y.Z"
git tag vX.Y.Z; git push origin master --tags
gh release create vX.Y.Z ...
```

## 8. 本机踩坑记录

- **PowerShell 5.1 读写文件默认走 ANSI/GBK**，会把 UTF-8 中文写成乱码。涉及编解码的文件操作一律使用专门的读写工具或 Python，不要用 `Get-Content` / `Set-Content` / `Out-File`。
- **zustand 不能直接给 store 对象属性赋值**（`st.updatedAt = Date.now()` 不触发订阅），必须用 `useStore.setState({...})`。
- `pnpm tauri build` 成功后有时仍返回退出码 1，属误报，检查是否出现 "Finished 2 bundles"。
- 端口 1420 被旧的 dev 进程占用会导致双重 Vite 冲突，启动前先确认。
- cargo 偶发 `Could not connect to server (rsproxy.cn:443)`：先确认网络，rsproxy 直连通常可用，不必挂代理；长时间失败可重试或改用 Clash。
- git push 若长时间无响应，先怀疑凭据助手没配置，而不是网络。
- 弹层 / 卡片的 CSS 类名集中在 `src/App.css`，修改样式时注意深色模式（`[data-theme='dark']`）与主题变量 `--mi-*`。

## 9. 计划中的里程碑

1. 抓包补全消息中心、自动化列表、房间管理（需用户配合抓包）。
2. 发布 `v0.2.0`：本批修复 + 上述功能（视抓包进度）。
3. 长期：与官方米家 App 的视觉一致性继续打磨（分型卡、产品图、动效）。
