# MiHome Desktop 🏠

> 在 Windows PC 上独立运行的米家（Mi Home）客户端 —— 非官方开源实现。

基于 **Tauri 2 + React + TypeScript** 构建的桌面应用：扫码登录你的小米账号，在电脑上查看和控制全屋米家设备，界面与交互对齐官方米家 App。

![platform](https://img.shields.io/badge/platform-Windows%2010%2F11-blue) ![tauri](https://img.shields.io/badge/Tauri-2-black) ![license](https://img.shields.io/badge/license-MIT-green)

## ✨ 功能

### 核心
- 📱 **扫码登录**：米家 App 扫码授权，凭据加密存储于 **Windows 凭据管理器**（不落明文）
- 🏡 **多家庭 / 房间管理**：家庭切换、房间标签过滤
- 🎛️ **自动控件**：根据 MIoT 规格自动生成开关 / 滑块 / 下拉 / 只读属性（全中文，来自 miot-spec 官方词典）
- 🖼️ **官方产品图**：每台设备显示小米 IoT 产品中心的官方渲染图
- ⚡ **手动场景**：一键执行米家场景
- 📊 **能耗统计**：智能插座等设备的近 7 天用电柱状图
- 🔋 **耗材信息**：滤芯 / 电池状态

### 体验
- 🎨 仿官方米家 UI：分型卡片（温湿度大数字卡 / 亮度滑条卡）、圆形电源键、底部三导航
- 🪟 **Acrylic 窗口毛玻璃**（Win11）+ 深色模式（跟随系统）
- 🎞️ 全套动效：卡片展开、详情页进出场、页面转场、按压反馈、骨架动画（全部 transform/opacity，无重排卡顿）
- 🔍 设备搜索 + **Ctrl+K 命令面板**（一键执行场景 / 切换房间 / 打开设备详情）
- 📌 **系统托盘**：关闭到托盘、托盘快捷场景菜单
- 🚀 60 秒轮询 + **批量属性拉取**（N 台设备 1 个请求）、窗口恢复可见立即刷新
- ✏️ 卡片尺寸（小/中/大）、拖拽排序、本地重命名、批量全开/全关、开机自启

## 🛠️ 开发与构建

**环境要求**：[Node.js](https://nodejs.org) ≥ 18、[Rust](https://rustup.rs)（stable, MSVC）、pnpm

```bash
# 开发（热重载窗口）
pnpm install
pnpm tauri dev

# 打包（生成 MSI / NSIS 安装包于 src-tauri/target/release/bundle/）
pnpm tauri build
```

> 首次构建需下载 Rust 依赖，建议配置国内镜像（rsproxy / 清华源）。

## 📁 结构

```
src/                     前端（React + TS）
├── api/                 协议层（自研 TypeScript 实现）
│   ├── client.ts        登录流程 / 签名加密请求 / token 刷新
│   ├── crypto.ts        RC4 + SHA1/256 签名（等价于小米 miutils）
│   ├── mijia.ts         业务 API（家庭/设备/场景/属性/统计）
│   ├── spec.ts          MIoT 规格解析 + 官方中文词典 + 产品图
│   ├── propsStore.ts    属性中心化仓库（批量拉取 + 统一轮询）
│   ├── store.ts         应用状态机（登录/数据）
│   └── prefs.ts         本地偏好（重命名/排序/主题）
├── components/          设备卡片 / 详情页 / 命令面板 / Toast
└── pages/               登录页 / 主界面
src-tauri/               Rust 后端
└── src/lib.rs           凭据管理器存取 / 登录回调(mi_fetch) / 托盘 / 毛玻璃
```

## ⚠️ 声明

- **非官方项目**，与小米公司无任何关联。"米家"、"Xiaomi" 等商标归小米所有。
- 云端接口为社区逆向所得，可能随小米服务端变更失效；请勿用于商业用途。
- 凭据仅保存在你自己的电脑（Windows 凭据管理器），本软件不上传任何账号数据；
  所有网络请求仅发往小米自有域名（代码内有域名白名单强制约束）。
- 账号安全风险自担，建议仅使用小号或低权限家庭测试。

## 🙏 致谢

- [Do1e/mijia-api](https://github.com/Do1e/mijia-api) —— 协议流程与接口参考（GPL-3.0，本项目为独立实现，未复用其代码）
- [home.miot-spec.com](https://home.miot-spec.com) —— 设备规格、官方中文词典与产品图
- [micloud / miutils](https://github.com/Squachen/micloud) —— 签名算法参考（MIT）
- [Tauri](https://tauri.app) · [React](https://react.dev) · [window-vibrancy](https://github.com/nico-abraham/window-vibrancy)

## 📄 License

[MIT](./LICENSE)
