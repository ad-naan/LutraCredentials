<div align="center">

<img src="../public/logo.png" alt="LutraCredentials" width="160"/>

# 🦦 LutraCredentials

**Enterprise-grade multi-account AI desktop manager**

A modern, local-first, plugin-based desktop client for unified AI account management

Built on **Tauri 2 + React 19 + Rust**, combining native desktop performance, polished frontend UX,
and fully local data security — manage accounts, tokens, quotas and credentials across the AI
ecosystem in one place.

[English](./README_EN.md) | [简体中文](../README.md)

[![MIT License](https://img.shields.io/badge/License-MIT-blue.svg)](../LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.3-stable-brightgreen.svg)]()
[![Tauri](https://img.shields.io/badge/Tauri-2.0-orange.svg)]()
[![React](https://img.shields.io/badge/React-19-61dafb.svg)]()
[![Rust](https://img.shields.io/badge/Rust-1.70+-dea584.svg)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178c6.svg)]()

![Windows](https://img.shields.io/badge/Platform-Windows-0078D6.svg?logo=windows)
![macOS](https://img.shields.io/badge/Platform-macOS-000000.svg?logo=apple)
![Linux](https://img.shields.io/badge/Platform-Linux-FCC624.svg?logo=linux&logoColor=black)

</div>

---

## 1. Overview

The AI ecosystem today is fragmented: multi-account switching is tedious, tokens expire
constantly, credentials are stored unsafely, and quotas cannot be monitored visually.
**LutraCredentials** (brand mascot: the otter 🦦 *Lutra*) is built for individual developers,
AI practitioners and ops teams. It delivers **fully local storage, zero cloud upload, plugin-based
extensibility, one-click account switching, and automated credential maintenance**, unifying the
account systems of 16 mainstream AI platforms.

### Key Differentiators

#### 🎨 Enterprise-grade UX

- Native macOS-style minimal interface designed for desktop workflows
- Seamless system-following dark / light theme switching with no style glitches
- Fluid motion across all flows, responsive layout for HiDPI and irregular screens
- WCAG-accessible with full keyboard operation

#### ⚡ Native desktop performance

- HTTP connection pooling reduces network latency by 50–67%
- Frontend debouncing improves batch account operations by 80%+
- Automatic log rotation caps each log file at 10MB to protect disk space
- Modular code reuse reduces duplicated business code by 40%

#### 🔌 Low-code plugin architecture

- Standardized platform integration protocol — add a new AI platform with minimal code
- Fully decoupled frontend/backend modules; platforms never interfere with each other
- End-to-end Rust + TypeScript type checking prevents cross-layer type errors
- Hot reload in development; new features require no client restart

#### 🛡️ Closed-loop local security

- Accounts, tokens and keys are encrypted and stored locally — never uploaded to third-party servers
- Silent background token refresh; no manual credential renewal
- Device machine-ID binding prevents credential theft across machines
- Encrypted backup and one-click restore of account datasets

---

## 2. Core Features

### ✅ Account operations

- **Unified management**: host accounts and credentials for 16 AI platforms in one place
- **Millisecond account switching**: one-click switch within a platform, auto-mounting the active token
- **Visual quota monitoring**: real-time usage, consumption ratio and cycle reset data
- **Smart credential maintenance**: background token expiry detection with auto-renewal and alerts
- **Account asset management**: custom tags, keyword search, batch archiving
- **Secure data ops**: local encrypted storage, batch backup, encrypted import/restore, one-click credential destruction

### ✅ Architecture & extensibility

- Plugin-based platform registry with a standardized integration workflow for any in-house or third-party AI platform
- Full-stack TypeScript + Rust bidirectional type constraints reduce integration errors
- Production-grade scheduling: request pooling, input debouncing, storage debouncing, automated log control

---

## 3. Supported Platforms (16)

| Platform | Capabilities | Integration |
| --- | --- | --- |
| **Antigravity** | Google/Anthropic aggregated AI, quota monitoring, proxy forwarding, account switching | OAuth 2.0, IDE database token import |
| **Codex** | 12 OpenAI-family provider presets, inference capacity tuning, batch account management | API key import, structured config |
| **GitHub Copilot** | JSON import, local VS Code session reading | JSON import, local session import |
| **Windsurf** | JSON import, local login-state reading | JSON import, local state import |
| **Kiro** | Device-bound authorization, SSO credential import, machine-ID control, subscription usage stats | Device key authorization, OIDC credentials |
| **Cursor** | JSON import, local login-state reading, one-click switching | JSON import, local state import |
| **Gemini** | Google-native + third-party relay providers, custom model parameters, quota alerts | Official keys, batch relay config import |
| **Claude** | 28 provider presets, multi-model config, quick carousel switching, batch JSON import | Config file import, official OAuth |
| **CodeBuddy** | OAuth login, token import, local session import, one-click switching | OAuth, token import, local import |
| **CodeBuddy CN** | Same as CodeBuddy, plus account check-in and check-in status query | OAuth, token import, local import |
| **Qoder** | OAuth login, local state snapshot import, one-click switching | OAuth, local import |
| **Trae** | Token import, local storage import, one-click switching | Token import, local import |
| **Zed** | JSON import, macOS Keychain reading, one-click switching | JSON import, local Keychain import |
| **WorkBuddy** | Credential import, local session reading, one-click switching | Local import |
| **Grok** | xAI Grok CLI account management, OAuth login, `~/.grok/auth.json` import, one-click switching | OAuth, local auth.json import |
| **Zcode** | GLM Coding Plan account management, OAuth login, API key import, callback URL submission, one-click switching | OAuth, API key import, local import |

### 📸 App Preview

| Accounts Overview | Provider Carousel |
| :---: | :---: |
| ![Accounts Overview](../docs/screenshots/accounts-dark.png) | ![Provider Carousel](../docs/screenshots/provider-carousel.png) |

| Dashboard | Settings |
| :---: | :---: |
| ![Dashboard](../docs/screenshots/dashboard.png) | ![Settings](../docs/screenshots/settings.png) |

---

## 4. Tech Stack

### 🔹 Frontend

- **Framework**: React 19 + TypeScript 5.8
- **Styling**: Tailwind CSS 4 (JIT compilation, global theme variables)
- **Components**: Radix UI accessible primitives, Lucide icons
- **State**: Zustand lightweight global state
- **Utilities**: React Router 7, Framer Motion, i18next (English / Chinese)

### 🔹 Desktop backend

- **Shell**: Tauri 2.0 (lightweight bundling, native system permissions)
- **Language**: Rust 1.70+
- **Crates**: Tokio async runtime, Reqwest connection pooling, Serde serialization, local SQLite storage (planned)

### 🔹 Tooling

- **Build**: Vite 7
- **Code style**: ESLint + Prettier

---

## 5. Performance Comparison

| Metric | Web / wrapper tools | LutraCredentials | Improvement |
| --- | --- | --- | --- |
| Cold start | ≈3s | ≈1s | 67% faster |
| Idle memory | ≈150MB | ≈50MB | 67% less |
| Account switch | ≈2s | <0.5s | 75% faster |
| Token renewal | Manual refresh | Automatic background renewal | Fully automated |
| Visual quota monitoring | Not available | All platforms | New core capability |

---

## 6. Installation

### 6.1 Prebuilt packages (recommended)

Download the native installer for your OS from the [Releases](../../releases) page:

- **Windows**: `.exe` / `.msi` — Windows 10 / 11
- **macOS**: `.dmg` — Intel and Apple Silicon
- **Linux**: `.deb` / `.AppImage` — major distributions

> 💡 Users upgrading from the legacy Nexus Account Manager: historical data is migrated
> automatically on first launch — no manual steps required.

### 6.2 Build from source

**Prerequisites**

- Node.js ≥ 18 LTS
- Rust ≥ 1.70 stable
- Package manager: npm / pnpm / yarn

**Build commands**

```bash
# Clone the repository
git clone https://github.com/ad-naan/LutraCredentials.git
cd LutraCredentials

# Install frontend dependencies
npm install

# Start development mode (hot reload)
npm run tauri:dev

# Production build
npm run tauri:build
```

**System build dependencies**

| OS | Dependencies |
| --- | --- |
| Windows | Visual Studio Build Tools; system WebView2 runtime |
| macOS | `xcode-select --install` |
| Debian/Ubuntu | `sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libssl-dev libayatana-appindicator3-dev librsvg2-dev` |
| Fedora | `sudo dnf install webkit2gtk4.1-devel openssl-devel curl wget file libappindicator-gtk3-devel librsvg2-devel` |
| Arch | `sudo pacman -S webkit2gtk-4.1 base-devel curl wget file openssl libappindicator-gtk3 librsvg2` |

---

## 7. Adding a New AI Platform

The project uses a standardized plugin registry — integrate a brand-new AI platform in
**four steps** without touching the core kernel:

1. **Create the platform module**: add a folder under `src/platforms/` with the platform icon,
   identifier and feature tags; simple cases can reuse the generic external platform template
   at `src/platforms/shared/externalPlatform.tsx`
2. **Build the UI components**: account list, authorization dialog, config editor
3. **Wire the backend commands**: add Rust commands under `src-tauri/src/commands/` for
   authorization, token validation and quota queries as needed
4. **Register globally**: add the config to `src/platforms/registry.ts`; the client picks it up automatically

Full development guide: [API_PLATFORMS_GUIDE.md](./API_PLATFORMS_GUIDE.md)

---

## 8. Project Structure

```text
LutraCredentials/
├── src/                          # React frontend
│   ├── components/ui             # Shared UI primitives
│   ├── platforms                 # Plugin-based AI platform modules
│   │   ├── antigravity           # Antigravity platform
│   │   ├── claude                # Claude platform
│   │   ├── codex                 # Codex platform
│   │   ├── gemini                # Gemini platform
│   │   ├── kiro                  # Kiro platform
│   │   ├── external              # Declarative external platform configs (11)
│   │   ├── shared                # Cross-platform shared templates & components
│   │   └── registry.ts           # Platform registry
│   ├── pages                     # Top-level pages
│   ├── stores                    # Zustand global state
│   ├── hooks                     # Custom hooks
│   ├── types                     # TS type definitions
│   ├── i18n                      # English / Chinese translations
│   └── lib                       # Frontend utilities
├── src-tauri/                    # Rust desktop backend
│   ├── core/                     # Storage, OAuth, quota core logic
│   ├── commands/                 # Tauri IPC commands
│   ├── utils/                    # Logging, HTTP, config utilities
│   └── lib.rs                    # Backend entry
├── docs/                         # Architecture, development and ops docs
└── test/                         # Local test resources
```

---

## 9. Development Rules & AI Collaboration

### 9.1 Hard coding rules

- Reuse components from `src/components/ui`; do not hand-roll base UI
- Use Zustand for global state; no scattered prop drilling
- Use the provided logging macros in Rust; no raw `println`
- New dependencies require review; no heavyweight third-party crates without approval

### 9.2 AI-assisted development notice

When developing with Claude, ChatGPT, Copilot or other AI tools, always include:

> Please strictly follow all rules defined in [[file:docs/PROJECT_RULES.md]] during development.

---

## 10. Contributing

- **Bug reports**: open a [GitHub Issue](../../issues) with environment and reproduction steps
- **Feature proposals**: start a discussion in [GitHub Discussions](../../discussions)
- **Code**: fork the repo, follow branch conventions, and link the related issue in your PR
- **Docs**: fix wording, add tutorials, share integration examples

### Contributors

<a href="https://github.com/ad-naan">
  <img src="https://github.com/ad-naan.png?size=100" width="100" height="100" style="border-radius:50%" alt="ad-naan"/>
</a>
<a href="https://github.com/027xiguapi">
  <img src="https://github.com/027xiguapi.png?size=100" width="100" height="100" style="border-radius:50%" alt="027xiguapi"/>
</a>

---

## 11. License

Released under the [MIT License](../LICENSE). © 2026 adnaan.

Free for commercial use, modification and redistribution; derived projects must retain
the original copyright notice.

---

## 12. Acknowledgements

- **Inspiration**: Antigravity-Manager, kiro-account-manager open-source projects
- **Foundation**: Tauri, React, Rust, Radix UI, Tailwind CSS ecosystems
- **Thanks**: every community member who files issues, fixes bugs and adapts platforms

---

<div align="center">

💡 Star the project if you find it useful — let's build the open-source AI account
management ecosystem together.

🦦 *LutraCredentials — let every otter mind its own credentials*

</div>
