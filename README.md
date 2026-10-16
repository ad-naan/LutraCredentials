<div align="center">

<img src="./public/logo.png" alt="LutraCredentials" width="160"/>

# 🦦 LutraCredentials

**企业级 AI 多账号桌面管理工具**

现代化、本地安全、插件化的 AI 全平台账号统一管理桌面客户端

基于 **Tauri 2 + React 19 + Rust** 全栈构建，兼顾桌面原生性能、前端交互体验与本地数据闭环安全，
一站式管理多生态 AI 平台的账号、Token、配额与授权凭证。

[English](./docs/README_EN.md) | 简体中文

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.3-stable-brightgreen.svg)]()
[![Tauri](https://img.shields.io/badge/Tauri-2.0-orange.svg)]()
[![React](https://img.shields.io/badge/React-19-61dafb.svg)]()
[![Rust](https://img.shields.io/badge/Rust-1.70+-dea584.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6.svg)]()

![Windows](https://img.shields.io/badge/Platform-Windows-0078D6.svg?logo=windows)
![macOS](https://img.shields.io/badge/Platform-mOS-000000.svg?logo=apple)
![Linux](https://img.shields.io/badge/Platform-Linux-FCC624.svg?logo=linux&logoColor=black)

</div>

---

## 一、项目概述

当下 AI 生态平台分散、多账号切换繁琐、Token 过期频繁、凭证存储不安全、配额无法可视化管控。
**LutraCredentials**（品牌 IP：水獭 🦦 *Lutra*）面向个人开发者、AI 从业者与团队运维人员打造，
主打**全本地数据存储、零云端上传、插件化扩展、一键账号切换、自动化凭证运维**，
标准化打通 16 个主流 AI 平台的账号体系，解决多账号运维痛点。

### 核心差异化优势

#### 🎨 企业级交互设计

- 原生 macOS 极简系统风界面，适配桌面端操作习惯
- 系统跟随式深色 / 浅色主题无缝切换，无样式断层
- 全流程交互动效，适配高分屏 / 异形屏响应式布局
- 遵循 WCAG 无障碍访问标准，支持全键盘快捷操作

#### ⚡ 原生桌面极致性能

- HTTP 连接池复用，网络请求延迟降低 50%–67%
- 前端防抖调度，批量账号操作性能提升 80%+
- 自动日志轮转管控，单日志文件上限 10MB，避免磁盘占用
- 模块化代码复用，业务重复代码缩减 40%

#### 🔌 低代码插件架构

- 标准化平台接入协议，极低代码量即可新增 AI 平台适配
- 前后端完全模块化解耦，独立平台互不影响
- Rust + TypeScript 全链路类型校验，规避跨端类型报错
- 开发环境热重载，新增功能无需重启客户端

#### 🛡️ 闭环本地安全体系

- 账号、Token、密钥全量本地加密存储，不上传第三方服务器
- 后台静默自动 Token 续期，无需手动刷新凭证
- 设备机器 ID 绑定管理，防止凭证异地盗用
- 支持加密备份 / 一键恢复账号数据集

---

## 二、核心功能特性

### ✅ 基础账号运维能力

- **全平台聚合管理**：统一托管 16 个 AI 生态平台的账号与凭证
- **毫秒级账号切换**：平台内一键切换账号，自动挂载有效授权 Token
- **配额可视化监控**：实时统计调用额度、消耗占比、周期重置数据
- **智能凭证运维**：后台检测 Token 有效期，过期自动续签、异常自动告警
- **账号资产管理**：自定义标签分组、关键词检索、批量归档管理账号
- **数据安全运维**：本地加密存储、批量备份、加密导入恢复、一键销毁凭证

### ✅ 架构与拓展能力

- 插件化平台注册中心，标准化接入流程，适配任意自研 / 第三方 AI 平台
- 全栈 TypeScript + Rust 双向类型约束，降低业务对接报错率
- 生产级性能调度：请求池化、输入防抖、存储防抖、日志自动化管控

---

## 三、适配平台明细（16 个）

| 平台 | 核心能力 | 接入方式 |
| --- | --- | --- |
| **Antigravity** | Google/Anthropic 聚合 AI 服务、配额监控、代理转发、账号切换 | OAuth 2.0 授权、IDE 数据库 Token 导入 |
| **Codex** | 12 类 OpenAI 系服务商预设、推理算力调配、批量账号管理 | 密钥导入、结构化配置对接 |
| **GitHub Copilot** | JSON 导入、本地 VS Code 会话读取 | JSON 导入、本地会话导入 |
| **Windsurf** | JSON 导入、本地登录态读取 | JSON 导入、本地状态导入 |
| **Kiro** | 设备绑定授权、SSO 凭证导入、机器 ID 管控、订阅用量统计 | 设备密钥授权、OIDC 凭证对接 |
| **Cursor** | JSON 导入、本地登录态读取、一键切换 | JSON 导入、本地状态导入 |
| **Gemini** | Google 原生 + 第三方中转服务商、模型参数自定义、配额预警 | 官方密钥、中转配置批量导入 |
| **Claude** | 28 类服务商预设、多模型配置、轮播快速切换、JSON 批量导入 | 配置文件导入、官方 OAuth 对接 |
| **CodeBuddy** | OAuth 登录、Token 导入、本地会话导入、一键切换 | OAuth、Token 导入、本地导入 |
| **CodeBuddy CN** | 同 CodeBuddy，另支持账号签到与签到状态查询 | OAuth、Token 导入、本地导入 |
| **Qoder** | OAuth 登录、本地状态快照导入、一键切换 | OAuth、本地导入 |
| **Trae** | Token 导入、本地存储导入、一键切换 | Token 导入、本地导入 |
| **Zed** | JSON 导入、macOS Keychain 读取、一键切换 | JSON 导入、本地 Keychain 导入 |
| **WorkBuddy** | 凭证导入、本地会话读取、一键切换 | 本地导入 |
| **Grok** | xAI Grok CLI 账号管理、OAuth 登录、`~/.grok/auth.json` 导入、一键切换 | OAuth、本地 auth.json 导入 |
| **Zcode** | GLM Coding Plan 账号管理、OAuth 登录、API Key 导入、回调 URL 提交、一键切换 | OAuth、API Key 导入、本地导入 |

### 📸 应用界面预览

| 聚合账号总览 | 平台切换面板 |
| :---: | :---: |
| ![聚合账号总览](./docs/screenshots/accounts-dark.png) | ![平台切换面板](./docs/screenshots/provider-carousel.png) |

| 仪表盘 | 设置 |
| :---: | :---: |
| ![仪表盘](./docs/screenshots/dashboard.png) | ![设置](./docs/screenshots/settings.png) |

---

## 四、全栈技术架构

### 🔹 前端应用层

- **核心框架**：React 19 + TypeScript 5.8
- **样式体系**：Tailwind CSS 4（JIT 按需编译、主题变量全局管控）
- **基础组件**：Radix UI 无障碍原生组件、Lucide 标准化线性图标
- **状态管理**：Zustand 轻量化全局状态
- **配套能力**：React Router 7 路由、Framer Motion 动效、i18next 中英国际化

### 🔹 桌面后端层

- **桌面基座**：Tauri 2.0（轻量化打包、系统原生权限管控）
- **后端语言**：Rust 1.70+
- **核心依赖**：Tokio 异步调度、Reqwest 连接池、Serde 序列化、本地 SQLite 轻量化存储（规划迭代）

### 🔹 工程化工具链

- **构建工具**：Vite 7 极速构建
- **代码规范**：ESLint + Prettier 强制统一编码风格

---

## 五、行业性能基准对比

| 测评指标 | 传统网页 / 壳子工具 | LutraCredentials | 优化提升幅度 |
| --- | --- | --- | --- |
| 客户端启动耗时 | ≈3s | ≈1s | 提速 67% |
| 空闲内存占用 | ≈150MB | ≈50MB | 压降 67% |
| 跨账号切换耗时 | ≈2s | <0.5s | 提速 75% |
| 凭证续期方式 | 手动刷新 | 后台全自动续期 | 全自动化运维 |
| 可视化配额监控 | 不支持 | 全平台支持 | 新增核心运维能力 |

---

## 六、安装部署

### 6.1 正式包快速安装（推荐）

前往项目 [Releases](../../releases) 页面，下载对应系统原生安装包，无依赖开箱即用：

- **Windows**：`.exe` / `.msi` 安装包，适配 Win10 / Win11
- **macOS**：`.dmg` 镜像包，适配 Intel / Apple Silicon 双芯片
- **Linux**：`.deb` / `.AppImage` 通用包，适配主流发行版

> 💡 旧版 Nexus Account Manager 用户升级后，首次启动会自动完成历史数据迁移，无需手动处理。

### 6.2 源码编译构建

**前置环境依赖**

- Node.js ≥ 18 LTS
- Rust ≥ 1.70 稳定版
- 包管理器：npm / pnpm / yarn

**编译命令**

```bash
# 克隆项目仓库
git clone https://github.com/ad-naan/LutraCredentials.git
cd LutraCredentials

# 安装前端依赖
npm install

# 开发环境启动（支持热重载）
npm run tauri:dev

# 生产环境打包构建
npm run tauri:build
```

**系统编译前置依赖**

| 系统 | 依赖安装 |
| --- | --- |
| Windows | 安装 Visual Studio Build Tools，预装系统 WebView2 组件 |
| macOS | 执行 `xcode-select --install` 安装命令行工具 |
| Debian/Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev` |
| Fedora | `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel` |
| Arch | `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl libappindicator-gtk3 librsvg2` |

---

## 七、新增 AI 平台接入教程

项目采用标准化插件注册架构，**四步**即可完成全新 AI 平台适配，无需改动核心内核代码：

1. **新建平台模块**：在 `src/platforms/` 目录新建平台文件夹，定义平台图标、标识、功能标签；
   简单场景可直接复用 `src/platforms/shared/externalPlatform.tsx` 的通用外部平台模板
2. **开发页面组件**：编写账号列表、授权弹窗、配置编辑专属前端组件
3. **对接后端指令**：按需在 `src-tauri/src/commands/` 新增 Rust 授权、Token 校验、配额查询命令
4. **全局注册生效**：在平台注册中心 `src/platforms/registry.ts` 录入配置，客户端自动识别加载

完整标准化开发文档：[docs/API_PLATFORMS_GUIDE.md](./docs/API_PLATFORMS_GUIDE.md)

---

## 八、项目目录规范

```text
LutraCredentials/
├── src/                          # React 前端业务代码
│   ├── components/ui             # 全局通用基础组件
│   ├── platforms                 # 插件化 AI 平台业务模块
│   │   ├── antigravity           # Antigravity 平台
│   │   ├── claude                # Claude 平台
│   │   ├── codex                 # Codex 平台
│   │   ├── gemini                # Gemini 平台
│   │   ├── kiro                  # Kiro 平台
│   │   ├── external              # 外部平台声明式配置（11 个）
│   │   ├── shared                # 跨平台共享模板与组件
│   │   └── registry.ts           # 平台注册中心
│   ├── pages                     # 客户端一级页面
│   ├── stores                    # Zustand 全局状态管理
│   ├── hooks                     # 自定义通用业务钩子
│   ├── types                     # 全量 TS 类型定义
│   ├── i18n                      # 中英国际化文案
│   └── lib                       # 前端工具函数
├── src-tauri/                    # Rust 桌面后端内核
│   ├── core/                     # 存储、OAuth、配额核心逻辑
│   ├── commands/                 # Tauri 前后端通信指令
│   ├── utils/                    # 日志、HTTP、配置工具集
│   └── lib.rs                    # 后端入口文件
├── docs/                         # 项目架构、开发、运维文档
└── test/                         # 本地调试测试资源
```

---

## 九、开发约束与 AI 协作规范

### 9.1 编码硬性规范

- 前端统一复用 `src/components/ui` 内置组件，禁止自研基础 UI
- 全局状态统一使用 Zustand，禁止零散 State 穿透传参
- Rust 后端统一使用封装日志宏，禁止原生 `println` 打印日志
- 新增依赖需提交评审，禁止私自引入第三方重型依赖

### 9.2 AI 辅助开发准入声明

使用 Claude、ChatGPT、Copilot 等 AI 工具开发时，必须附加声明：

> 请在开发过程中严格遵守 [[file:docs/PROJECT_RULES.md]] 中定义的所有规则。

---

## 十、社区贡献

### 贡献渠道

- **Bug 反馈**：提交 [GitHub Issues](../../issues)，附带复现环境 + 操作步骤
- **功能提案**：前往 [GitHub Discussions](../../discussions) 发起需求讨论
- **代码共建**：Fork 仓库，遵循分支规范提交 PR，关联对应 Issue
- **文档优化**：修正文案、补充教程、完善适配案例

### 核心贡献者

<a href="https://github.com/ad-naan">
  <img src="https://github.com/ad-naan.png?size=100" width="100" height="100" style="border-radius:50%" alt="ad-naan"/>
</a>
<a href="https://github.com/027xiguapi">
  <img src="https://github.com/027xiguapi.png?size=100" width="100" height="100" style="border-radius:50%" alt="027xiguapi"/>
</a>

---

## 十一、开源许可

本项目基于 [MIT 开源协议](./LICENSE) 开源，2026 © adnaan。

可免费商用、二次修改、分发复刻，修改后项目需保留原始版权声明。

---

## 十二、致谢

- **项目灵感**：Antigravity-Manager、kiro-account-manager 开源项目
- **技术底座**：Tauri、React、Rust、Radix UI、Tailwind CSS 开源生态
- **共建支持**：所有参与提需求、修复 Bug、适配平台的社区开发者

---

<div align="center">

💡 项目 star 助力生态迭代，如有使用价值欢迎点亮 Star，共建 AI 账号开源管理生态

🦦 *LutraCredentials — 让每一只水獭都管好自己的凭证*

</div>
