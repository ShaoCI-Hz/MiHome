# MiHome Desktop

在 Windows PC 上独立运行的米家（Mi Home）客户端，非官方开源实现。基于 Tauri 2 + React + TypeScript 构建，在电脑上查看和控制全屋米家设备，界面与交互对齐官方米家 App。

## 功能特性

### 账号与数据安全
- 米家 App **扫码登录**，无需输入账号密码
- 登录凭据（serviceToken / passToken / ssecurity）加密存储于 **Windows 凭据管理器**，不落明文文件
- 登录与业务请求仅发往小米自有域名（代码内置域名白名单强制约束）；设备规格、中文词典与产品图取自社区站点 home.miot-spec.com；检查更新仅访问 api.github.com。以上均为本机发起的只读请求，不上传任何账号数据
- Token 自动静默续期，过期后提示重新扫码

### 设备控制
- **自动控件生成**：依据 MIoT 规格为每台设备自动生成开关、滑块、下拉框、只读属性等控件，全中文显示（采用 miot-spec 官方词典翻译）
- **官方产品图**：每台设备显示小米 IoT 产品中心的官方渲染图
- **核心 / 高阶分层**：默认仅展示官方米家风格的核心控制项（开关、亮度、色温、温度、档位、模式等），电压、电流、厂商自定义等高阶属性自动隐藏；`我的 → 开发者模式` 一键查看全部属性与动作
- **设备详情页**：完整属性与控制、设备信息（本地 IP、MAC、固件版本、信号强度）、动作执行
- **批量操作**：编辑模式多选设备，一键全部开启 / 关闭
- **能耗统计**：智能插座等支持设备的近 7 天用电柱状图
- **耗材信息**：滤芯、电池等耗材状态

### 场景与快捷操作
- 手动场景列表与一键执行
- **托盘快捷场景**：右键系统托盘图标即可执行场景，无需打开主窗口
- **Ctrl+K 命令面板**：全局搜索场景、房间、设备；场景直接执行、房间直接切换、设备直接打开详情，支持纯键盘操作（↑↓ + Enter）

### 界面与交互
- 仿官方米家设计：浅色 / 深色双主题（可跟随系统）、分型设备卡片（温湿度大数字卡、灯光亮度常显卡）、圆形电源键、底部三导航
- **Acrylic 窗口毛玻璃**（Windows 11）
- 完整动效体系：卡片平滑展开收起、详情页侧滑进出场、页面转场、网格错落入场、按压反馈、轻量 Toast 通知
- 房间标签过滤、设备搜索、三种排序（在线优先 / 名称 / 类型）+ 自定义拖拽排序
- 卡片尺寸三档可调（小 / 中 / 大），长按或编辑模式进入，逐设备记忆
- 本地重命名设备（不影响云端，仅本软件内显示）

### 系统集成
- 关闭窗口最小化到**系统托盘**，后台持续运行
- **开机自启**开关
- 属性状态 60 秒自动轮询，窗口恢复可见立即刷新；批量属性拉取（多设备合并为单请求）

## 安装

从 [Releases](../../releases) 下载最新版本：

- `mihome-desktop_x.x.x_x64-setup.exe` — NSIS 安装器（推荐，双击安装）
- `mihome-desktop_x.x.x_x64_en-US.msi` — MSI 安装包

环境要求：Windows 10 / 11 x64。

## 开发与构建

环境要求：[Node.js](https://nodejs.org) ≥ 18、[Rust](https://rustup.rs)（stable，MSVC 工具链）、pnpm。

```bash
pnpm install       # 安装依赖
pnpm tauri dev     # 开发模式（热重载窗口）
pnpm tauri build   # 打包（输出 MSI / NSIS 于 src-tauri/target/release/bundle/）
```

国内环境建议配置 crates.io 镜像（rsproxy / 清华源）以加速 Rust 依赖下载。

## 项目结构

```
src/                       前端（React + TypeScript）
├── api/                   协议层（自研 TypeScript 实现）
│   ├── client.ts          扫码登录、token 刷新、签名加密请求
│   ├── crypto.ts          RC4 + SHA1/SHA256 签名（与小米 miutils 等价）
│   ├── mijia.ts           业务 API：家庭、房间、设备、场景、属性、统计
│   ├── spec.ts            MIoT 规格解析、官方中文词典、产品图、核心项白名单
│   ├── propsStore.ts      属性中心化仓库（批量拉取、统一轮询）
│   ├── store.ts           应用状态机（登录、数据流）
│   └── prefs.ts           本地偏好（重命名、排序、主题、开发者模式）
├── components/            设备卡片、详情页、命令面板、Toast
└── pages/                 登录页、主界面

src-tauri/                 Rust 后端
└── src/lib.rs             凭据管理器读写、登录回调（Set-Cookie 链收集）、
                           系统托盘与场景菜单、Acrylic 毛玻璃
```

## 声明

- 本项目为**非官方开源实现**，与小米公司无任何关联。"米家"、"Xiaomi" 等商标归小米所有。
- 云端接口来自社区逆向，可能随小米服务端变更而失效；请勿用于商业用途。
- 凭据仅保存在使用者本机，开发者无法接触任何用户账号数据。
- 使用风险自担，建议使用小号或低权限家庭测试。

## 致谢

- [Do1e/mijia-api](https://github.com/Do1e/mijia-api) — 登录流程与接口参考（GPL-3.0，本项目为独立实现，未复用其代码）
- [home.miot-spec.com](https://home.miot-spec.com) — 设备规格、官方中文词典与产品图
- [micloud](https://github.com/Squachen/micloud) — 签名算法参考（MIT）
- [Tauri](https://tauri.app) · [React](https://react.dev) · [window-vibrancy](https://github.com/nico-abraham/window-vibrancy)

## 更新日志

见 [CHANGELOG.md](./CHANGELOG.md)。

## 许可证

[MIT](./LICENSE)
