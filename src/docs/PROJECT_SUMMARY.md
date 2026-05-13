# OpenPaw-JS 迁移总结

> Flutter → React 19 + Next.js 16 + Tauri v2 + TypeScript  
> 迁移日期：2026年4月–5月  
> 源项目：`D:\software\vscodeFiles\selfTool\openpaw` (Flutter/Dart)  
> 目标项目：`D:\software\vscodeFiles\selfTool\openpaw-js` (React/TypeScript)

---

## 技术栈

| 层 | 技术 |
|---|---|
| 框架 | Next.js 16.2.6 (Turbopack, static export) |
| UI | React 19.2, Tailwind CSS 4, Lucide React 图标 |
| 状态管理 | Zustand 5 + Immer 中间件 |
| 桌面壳 | Tauri v2 (Rust 1.95, edition 2021) |
| 桌面自动化 | `windows` 0.58 crate (GDI, SendInput, EnumWindows) |
| Markdown | react-markdown + remark-gfm |
| 数据库 | SQLite (Tauri: `tauri-plugin-sql`, Web: sql.js WASM) |
| 加密 | Web Crypto API (AES-GCM 256 + PBKDF2) |
| 本地 LLM | `@mlc-ai/web-llm` (WebGPU 推理) |
| PWA | Service Worker + manifest.json |

---

## 目录结构

```
openpaw-js/
├── src/
│   ├── adapters/           # LLM 适配器 (OpenAI, Anthropic, Google)
│   ├── app/                # Next.js App Router 页面
│   │   ├── desktop/        # 桌面自动化页面
│   │   ├── models/         # 模型配置页面 (CRUD)
│   │   ├── settings/       # 设置页面
│   │   ├── skills/         # 技能管理页面
│   │   ├── web/            # Web 自动化页面
│   │   ├── layout.tsx      # 根布局 + PWA meta
│   │   ├── globals.css     # Tailwind + CSS 变量
│   │   └── page.tsx        # Chat 主页面
│   ├── components/
│   │   ├── app-shell.tsx       # 响应式侧边栏布局
│   │   ├── app-init.tsx        # 应用初始化 (theme/settings/locale)
│   │   ├── error-boundary.tsx  # 全局错误边界
│   │   ├── theme-provider.tsx  # 主题切换 (auto/light/dark)
│   │   ├── model-config-form.tsx
│   │   └── chat/
│   │       ├── chat-bubble.tsx     # 消息气泡 (用户/助手/工具)
│   │       ├── message-input.tsx   # 输入框 + 图片上传
│   │       ├── markdown-body.tsx   # Markdown 渲染 + 代码块
│   │       ├── streaming-text.tsx  # 流式文本 + 光标动画
│   │       ├── model-switcher.tsx  # 模型选择下拉
│   │       └── tool-mode-bar.tsx   # 工具模式切换
│   ├── db/
│   │   ├── index.ts     # DB 工厂 + DDL + 索引
│   │   ├── adapter.ts   # SQLiteAdapter 接口
│   │   ├── tauri.ts     # Tauri SQL 插件适配器
│   │   ├── wasm.ts      # sql.js WASM 适配器
│   │   └── types.ts     # 表行类型定义
│   ├── i18n/
│   │   └── strings.ts   # 中/英翻译字典 + useT() hook
│   ├── llm/
│   │   ├── local-llm.ts  # WebLLM 本地推理适配器
│   │   └── fallback.ts   # 三级回退链 (本地→远程→离线)
│   ├── services/
│   │   ├── chat-service.ts           # Chat 核心服务
│   │   ├── desktop-service.ts        # Tauri invoke 封装
│   │   ├── desktop-automation-agent.ts # 桌面自动化 Agent
│   │   ├── extension-bridge.ts       # Chrome Extension 通信桥
│   │   ├── web-screen-service.ts     # iframe 通信服务
│   │   └── web-automation-agent.ts   # Web 自动化 Agent
│   ├── skills/
│   │   ├── skill.ts      # Skill 接口 + 工具函数
│   │   ├── executor.ts   # SkillExecutor 调度器
│   │   ├── loader.ts     # Markdown 技能解析器
│   │   ├── desktop.ts    # 桌面技能 (14 工具)
│   │   ├── web.ts        # Web 技能 (14 工具, 双后端)
│   │   ├── phone.ts      # 手机技能 (13 工具, 桩)
│   │   └── app-builder.ts # 应用构建技能 (5 工具)
│   ├── stores/
│   │   ├── chat-store.ts          # Chat 状态 + 消息流
│   │   ├── model-config-store.ts  # 模型配置 CRUD
│   │   ├── settings-store.ts      # 主题/语言/工具偏好
│   │   └── skill-store.ts         # 技能状态
│   ├── types/
│   │   ├── message.ts   # Chat 消息类型
│   │   ├── provider.ts  # 模型提供商类型
│   │   └── skill.ts     # 技能/工具类型
│   └── utils/
│       ├── platform.ts  # isTauri(), isMobile()
│       ├── content.ts   # 消息内容序列化
│       ├── crypto.ts    # AES-GCM 加密
│       └── retry.ts     # 指数退避重试
├── src-tauri/
│   ├── Cargo.toml       # Rust 依赖 (windows 0.58, base64, serde)
│   ├── tauri.conf.json  # Tauri 配置
│   └── src/
│       ├── lib.rs       # 命令注册
│       ├── main.rs      # 入口
│       └── commands/
│           ├── mod.rs
│           ├── screenshot.rs  # GDI 截图 (GetDC→BitBlt→base64)
│           ├── input.rs       # 鼠标/键盘 (SendInput)
│           ├── window.rs      # 窗口枚举/聚焦 (EnumWindows)
│           └── app.rs         # 应用列表/启动 (PowerShell/Registry)
├── public/
│   ├── manifest.json  # PWA manifest
│   ├── sw.js          # Service Worker (缓存策略)
│   ├── icons/         # PWA 图标 (SVG)
│   └── skills/        # 技能定义 (Markdown)
└── package.json
```

---

## 10 阶段迁移清单

| 阶段 | 内容 | 产出 |
|---|---|---|
| 0 | 项目脚手架 | Next.js + Tauri 初始化, 核心依赖安装 |
| 1 | 基础设施 | 类型定义, 工具函数 (platform/crypto/content), DB 接口 |
| 2–3 | 数据层 | SQLite wasm/tauri 适配器, DDL + 索引, Zustand stores |
| 4 | Chat UI | 消息列表, 输入框 (文本+图片), Markdown 渲染, 代码高亮, 流式文本, 响应式侧边栏 |
| 5 | 技能系统 | SkillExecutor, 4 个 Skill (Desktop/Web/Phone/AppBuilder), Markdown 解析器, 技能管理页 |
| 6 | 模型配置 | ModelCallService, 3 个适配器 (OpenAI/Anthropic/Google), 模型 CRUD 页面 |
| 7 | 桌面自动化 | Rust 12 命令, DesktopService, DesktopAutomationAgent, 桌面控制页面 |
| 8 | Web 自动化 | Extension Bridge, WebScreenService, WebAutomationAgent, Web 控制页面 |
| 9 | 本地 LLM + PWA | WebLLM 适配器, 三级回退链, Service Worker, PWA manifest |
| 10 | 打磨 | 主题切换, 设置页, ErrorBoundary, 重试机制, React.memo, DB 索引 |

---

## 页面路由

| 路由 | 说明 |
|---|---|
| `/` | Chat 主页面 |
| `/desktop` | 桌面自动化 (Windows only) |
| `/web` | Web 自动化 |
| `/models` | 模型配置管理 |
| `/skills` | 技能管理 |
| `/settings` | 主题/语言设置 |
| `/_not-found` | 404 页面 |

---

## 构建与启动

### 开发模式 (Web)

```bash
cd openpaw-js
npm install
npm run dev        # http://localhost:3000
```

### 桌面开发 (Tauri)

```bash
# 前置：安装 Rust (rustup.rs) 和 VS Code C++ 工具链
cd openpaw-js
npx tauri dev      # Next.js + Tauri 桌面窗口
```

### 生产构建

```bash
npm run build      # → out/ 静态文件
npx tauri build    # → src-tauri/target/release/ 桌面安装包
```

### 部署 PWA

将 `out/` 目录部署到任意静态服务器即可。

---

## 关键设计决策

1. **Static Export**: Next.js `output: 'export'`，不支持动态路由 (`[id]`)，改用 search params (`?edit=id`, `?new=true`)
2. **平台检测**: `isTauri()` 检查 `window.__TAURI_INTERNALS__`，据此选择 Tauri SQL / sql.js WASM
3. **工具调用**: 流式 `__TOOLS__:` 前缀标记，SkillExecutor 按工具名调度到对应 Skill
4. **桌面自动化**: Rust `windows` 0.58 强类型封装，前端通过 `invoke()` 调用 Rust 命令
5. **Web 自动化**: Chrome Extension 通过 CustomEvent `openpaw-call`/`openpaw-response` 通信
6. **主题**: CSS `dark:` 前缀 + `prefers-color-scheme` 媒体查询，settings-store 存储用户选择
7. **字体**: 中国网络无法访问 Google Fonts，使用系统字体栈

---

## 与源项目 (Flutter) 的对应

| Flutter/Dart | React/TypeScript |
|---|---|
| `lib/main.dart` → Riverpod + GoRouter | `src/app/layout.tsx` → Next.js App Router |
| `lib/services/database/` → Drift | `src/db/` → sql.js WASM / tauri-plugin-sql |
| `lib/providers/` → Riverpod StateNotifier | `src/stores/` → Zustand + Immer |
| `lib/screens/` → Scaffold + ListView | `src/app/*/page.tsx` → Tailwind flex layout |
| `lib/skills/` → abstract Skill class | `src/skills/` → Skill interface |
| `lib/services/desktop/` → Win32 FFI | `src-tauri/src/commands/` → windows 0.58 crate |
| `lib/i18n/strings.dart` → Map | `src/i18n/strings.ts` → Record |
| `lib/adapters/` → LLMAdapter | `src/adapters/` → LLMAdapter interface |
