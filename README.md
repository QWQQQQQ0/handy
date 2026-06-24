# Handy

> 🤖 AI 驱动的桌面自动化助手 — 通过自然语言控制桌面应用、浏览器和手机

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange)](https://www.rust-lang.org)
[![Python](https://img.shields.io/badge/Python-3.10+-yellow)](https://www.python.org)

---

## ✨ 核心能力

| 能力 | 说明 |
|------|------|
| 🖥️ **桌面自动化** | 截图 + 视觉分析定位 UI 元素，自动化执行鼠标/键盘操作 |
| 🌐 **浏览器控制** | Playwright 浏览器自动化，网页截图、元素交互、脚本执行、数据抓取 |
| ⏺️ **录制与回放** | 多源事件采集 → 手势分类 → 模板生成 → 工作流回放，形成自动化闭环 |
| 👁️ **屏幕监控** | 定时/屏幕变化触发，区域差异检测，自动响应 |
| 📝 **文档自动化** | Word/Excel/PPT 读取、编辑、生成（python-docx + pywin32 COM 实时编辑） |
| 💻 **代码生成** | AI 驱动的代码生成、沙箱执行（JS/Python/SQL/HTML）、Shell 命令 |
| 🔍 **网络搜索** | DuckDuckGo 搜索 + Playwright/httpx 双策略网页抓取（自动反检测） |
| 🧠 **能力学习** | 自动探索应用 UI，半自动/级联/受控浏览三种学习模式，生成可复用技能 |
| 🎯 **多 LLM 支持** | OpenAI / Anthropic / Google Gemini 可切换 |
| 🌍 **国际化** | 中文 / 英文双语支持 |

---

## 🚀 快速开始

### 环境要求

- **Node.js** 18+
- **Rust** 1.70+
- **Python** 3.10+（用于 Python 自动化引擎）
- **Android Studio**（用于 Android 构建）

### 安装与运行

```bash
# 克隆项目
git clone <repo-url>
cd handy

# 安装前端依赖
npm install

# 安装 Python 引擎依赖
pip install -r python-engine/requirements.txt

# 启动开发服务器 (Web 模式)
npm run dev

# 启动 Tauri 桌面应用
npm run tauri:dev
```

### Android 构建

```bash
# 加载 Android 构建环境
source scripts/android-env.sh

# 构建 Debug APK
npm run android:build:debug
# 输出: src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

> **注意**：不要跑 `tsc` 类型检查（前端有类型错误），直接用 `npx vite build`。不要跑 `rustBuild*` Gradle 任务（需要 Android Studio WebSocket 连接）。

---

## 🏗️ 架构概览

### Chat → Agent 路由流水线

```
用户输入 (Chat)
  ↓
Chat LLM（系统配置工具 + request_agent）
  ├── 直接调用系统配置工具
  │   list_skills, switch_model, update_settings …
  │
  └── request_agent(agent='desktop'|'web'|'document'|'code')
      ├── desktop  → TaskGateway（意图分类 → 工具筛选 → 执行/编排）
      ├── web      → WebGateway（Playwright 浏览器自动化）
      ├── document → DocGateway（Word/Excel/PPT 读写）
      └── code     → CodeGateway（文件读写、代码生成、Shell、沙箱）
```

### 技术架构

```
┌────────────────────────────────────────────┐
│  前端 (React 19 + Vite 6 + TypeScript 5)    │
│  ├── Zustand 状态管理                        │
│  ├── Tailwind CSS v4                        │
│  ├── SQLite 双适配器 (Tauri/WASM)            │
│  └── Vite 中间件后端 API                      │
├────────────────────────────────────────────┤
│  桌面端 (Tauri v2 + Rust)                    │
│  ├── Windows UIA 自动化                      │
│  ├── 80+ Rust 命令 (截图/输入/窗口管理)       │
│  └── 全局状态管理 (跨窗口共享)                │
├────────────────────────────────────────────┤
│  自动化引擎 (Python)                          │
│  ├── Playwright 浏览器自动化                  │
│  ├── OCR 文字识别                             │
│  ├── Office 文档生成 + COM 实时编辑           │
│  ├── 网络搜索 + 网页抓取                      │
│  └── JSON Line 协议通信                       │
└────────────────────────────────────────────┘
```

### 前端路由

```
index.html → main.tsx → RouterProvider
  ├── /float     → 浮窗（独立 Tauri 窗口，核心交互入口）
  └── AppShell
       ├── /        → ChatPage（AI 聊天）
       ├── /desktop → 桌面自动化
       ├── /web     → 浏览器自动化
       ├── /phone   → 手机控制
       ├── /models  → LLM 模型配置
       ├── /skills  → 技能管理
       ├── /settings→ 主题、语言、工具偏好
       └── /apps    → 应用预览
```

### 浮窗 — 核心交互入口

浮窗是一个独立的 Tauri 悬浮窗口，始终置顶，是日常使用的主要入口。支持 5 种模式，通过顶部 Tab 切换：

| 模式 | 用途 | 核心能力 |
|------|------|----------|
| **Chat** | AI 对话 | 流式 LLM 对话、图片粘贴、多模态识别、命令确认、工具调用可视化 |
| **Task** | 桌面自动化 | 自然语言 → 截图 → 视觉定位 → 执行操作，实时日志、Agent 思考过程透明展示 |
| **Watcher** | 屏幕监控 | 定时/屏幕变化自动触发，区域差异检测，图片前后对比 |
| **Recorder** | 操作录制与回放 | 自动捕获桌面操作 → 生成自动化模板 → 一键回放（详见下方录制与回放章节） |
| **Learn** | UI 能力学习 | 半自动引导式探索 / 级联自动探索 / 受控浏览器学习，生成可复用技能 |

浮窗状态自动持久化（当前模式、工具偏好等），关闭重开后恢复上次状态。

### 录制与回放

Handy 内置了一套完整的**操作录制 → 模板生成 → 工作流回放**闭环系统：

```
录制阶段                      分析阶段                      回放阶段
─────────                    ─────────                    ─────────
多源事件采集                 数据流提取                    模板选择
├─ 鼠标事件（点击/拖拽/滚轮）  ├─ 坐标模式检测               ↓
├─ 键盘事件（按键/热键）       ├─ 冗余操作清理             工作流回放引擎
├─ UIA 语义事件               ├─ LLM 语义分析               ├─ 步骤顺序执行
└─ DOM 事件（Web 页面上）      └─ 变量参数化                 ├─ 每步截图验证
     ↓                              ↓                      ├─ 失败自动重试
手势分类与去重                生成通用模板                   └─ 执行结果报告
├─ 单击/双击/右键             ├─ 语义定位（role+name）
├─ 拖拽路径                   ├─ 参数占位符
└─ 文本输入序列               └─ 条件分支/循环
     ↓
录制会话存储
（可预览、编辑、删除）
```

**核心组件**：

| 组件 | 说明 |
|------|------|
| `UnifiedRecorder` | 统一录制器：多源事件采集、手势分类、去重合并、会话管理 |
| `UnifiedAnalyzer` | 统一分析器：数据流提取、坐标规律检测、LLM 模板生成 |
| `WorkflowRecorder` / `WorkflowRecorderV2` | 工作流录制器：记录完整操作序列 |
| `WorkflowExecutor` / `WorkflowExecutorV2` | 工作流回放执行器：按步骤回放并验证 |
| `RecorderMode` 组件 | 录制流程控制 UI（开始/暂停/结束/预览/微调） |
| `TemplatePreview` | 模板预览与参数编辑 |

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端框架 | React 19 + TypeScript 5 |
| 构建工具 | Vite 6 |
| 桌面框架 | Tauri v2 (Rust) |
| 状态管理 | Zustand v5 + Immer |
| CSS | Tailwind CSS v4 |
| 路由 | react-router-dom v7 |
| 代码高亮 | Shiki |
| Markdown | react-markdown + remark-gfm |
| 数据库 | SQLite（Tauri 原生 + sql.js WASM 双适配器） |
| LLM | OpenAI / Anthropic / Google Gemini |
| 国际化 | i18next v26 |
| 自动化引擎 | Python 3.10+ (Playwright + OCR + Office) |

---

## 📁 项目结构

```
handy/
├── src/                          # 前端源码
│   ├── adapters/                 # LLM 适配器 + 平台适配器
│   ├── agents/                   # Agent API（前端直接调用后端）
│   ├── api/                      # API Client（fetch 封装 + SSE）
│   ├── backend/                  # 后端 API Server（Vite 中间件）
│   ├── components/               # React 组件
│   │   ├── chat/                 # 聊天组件（气泡/Markdown/流式文本）
│   │   └── recorder/             # 录制器组件
│   ├── config/                   # 配置（system-prompts.json）
│   ├── core/                     # 核心智能（技能解析/学习）
│   ├── db/                       # 数据库层（Tauri/WASM SQLite 双适配器）
│   ├── i18n/                     # 国际化字符串
│   ├── interfaces/               # 服务接口定义
│   ├── pages/                    # Vite SPA 页面
│   │   └── float/                # 浮窗模块（Chat/Task/Watcher/Recorder/Learn）
│   ├── services/                 # 核心服务
│   │   ├── agent/                # Agent 子模块（目标分解/计划执行/缓存回放）
│   │   ├── analyzer/             # 统一分析器（数据流/坐标模式/LLM 模板生成）
│   │   ├── capability-learner/   # 能力学习器（半自动/级联/受控浏览）
│   │   ├── code-agent/           # 代码/文件 Agent
│   │   ├── code-registry/        # 代码注册表
│   │   ├── code-sandbox/         # 代码沙箱（JS/HTML/SQL/Python）
│   │   ├── doc-agent/            # 文档自动化 Agent
│   │   ├── llm-gateway/          # 统一 LLM 调用入口
│   │   ├── multi-agent/          # 多 Agent 协作（编排器/上下文/断点恢复）
│   │   ├── recorder/             # 统一录制器（多源采集/手势分类/去重）
│   │   ├── scheduler/            # 任务调度器（1s TickLoop 定时/屏幕变化）
│   │   ├── skill-agents/         # Skill-Agent 模块
│   │   ├── task-agent/           # 桌面自动化 Task 架构（Gateway→Orchestrator→Runner）
│   │   ├── watcher/              # 屏幕监控系统（差异检测/区域发现/工作流录制）
│   │   └── web-agent/            # Web 浏览器 Agent
│   ├── skills/                   # 技能系统
│   │   ├── code-tools/           # 代码工具子模块
│   │   └── plugins/              # 插件目录
│   ├── stores/                   # Zustand 状态管理
│   ├── types/                    # TypeScript 类型定义
│   └── utils/                    # 工具函数
├── src-tauri/                    # Tauri Rust 后端
│   └── src/
│       └── commands/             # Rust 命令（截图/输入/窗口/Python 桥接）
├── python-engine/                # Python 自动化后端
│   ├── engine/                   # 引擎核心
│   │   └── office/               # Office 文档生成 + COM 实时编辑
│   └── extension/                # Chrome 扩展（Manifest V3 + WebSocket）
├── public/                       # 静态资源
│   └── skills/                   # 技能定义（Markdown 格式）
└── docs/                         # 架构文档
```

---

## 🔧 内置技能

Handy 通过技能系统为 LLM 提供工具调用能力，共 7 个内置技能：

| 技能 | 文件 | 能力 |
|------|------|------|
| **desktop_screen** | `desktop_screen.md` | 桌面视觉控制：截图、点击、拖拽、键盘、OCR、窗口管理 |
| **desktop_uia** | `desktop_uia.md` | Windows UIA 语义元素操作 |
| **web_screen** | `web_screen.md` | Web 屏幕控制 + `run_playwright_script` 脚本沙箱 |
| **phone_screen** | `phone_screen.md` | 手机屏幕控制 |
| **app_builder** | `app_builder.md` | 应用构建器 |
| **office_doc** | `office_doc.md` | Office 文档生成 + COM 实时编辑 (Word/Excel/PPT) |
| **code_tools** | `code_tools.md` | 代码工具：生成/沙箱执行、文件读写、Shell、`web_search`/`web_fetch` 联网搜索 |

**三级缓存系统**：L1（UI 指纹）→ L2（动作序列）→ L3（技能模板），逐步提升自动化复用率。

---

## 🧠 多 Agent 协作

复杂任务通过 **Orchestrator** 模式自动拆分和编排：

```
TaskGateway（入口：意图分类 + 复杂度判断）
  │
  ├── 简单任务 → TaskAgentRunner（LLM 工具调用循环）
  │
  └── 复杂任务 → TaskOrchestrator（4 阶段编排）
       ├── Decomposer  → 目标拆分为子任务
       ├── Executor×N  → 并行执行子任务
       ├── Verifier    → 验证执行结果
       └── Recovery    → 断点恢复 + 失败重试
```

Agent 类型：`desktop` | `web` | `document` | `code` — Chat LLM 通过 `request_agent` 工具自动路由。

---

## 🔌 插件开发

Handy 支持通过插件扩展功能：

```typescript
// src/skills/plugins/my-plugin.ts
import type { SkillPlugin } from '@/skills/plugin-loader';

const myPlugin: SkillPlugin = {
  metadata: {
    id: 'my_plugin',
    name: 'My Plugin',
    version: '1.0.0',
    description: 'My custom tools',
  },
  tools: [
    {
      name: 'my_tool',
      description: 'Does something useful',
      parameters: {
        type: 'object',
        properties: {
          input: { type: 'string' },
        },
        required: ['input'],
      },
      async execute(params, context) {
        const { input } = params as { input: string };
        return { success: true, message: `Processed: ${input}` };
      },
    },
  ],
};

export default myPlugin;
```

详见 [插件开发指南](docs/PLUGIN-GUIDE.md) 和 [插件权限系统](docs/PLUGIN-PERMISSIONS.md)。

---

## 🌐 Python 引擎通信协议

Python 引擎通过 **JSON Line 协议** 与 Tauri 通信，支持：

- **浏览器自动化** — Playwright 全功能，Chrome 扩展 WebSocket 通信 (port 19840)
- **网络搜索** — DuckDuckGo 搜索 + Playwright/httpx 双策略抓取（自动反检测）
- **脚本沙箱** — LLM 生成 Python 代码 → 沙箱执行 → 返回结果（`run_playwright_script`）
- **Office 文档** — python-docx/openpyxl/python-pptx 生成 + pywin32 COM 实时编辑已打开文档
- **OCR 识别** — 截图文字识别与区域定位
- **全局监听** — 鼠标/键盘全局输入钩子

---

## 🎯 坐标变换流水线

桌面自动化中的坐标处理：

```
LLM 输出坐标（压缩截图空间，窗口相对）
  ↓
① 压缩比例还原 → applyCoordinateScale()
  ↓
② 窗口偏移 → addWindowOffset()
  ↓
执行工具（鼠标点击/拖拽等）
  ↓
区域验证截图 → captureRegionAround() → LLM 视觉确认
```

---

## 📖 文档

| 文档 | 说明 |
|------|------|
| [快速开始](docs/QUICK-START.md) | 一分钟上手指南 |
| [开发文档](docs/DEVELOPMENT.md) | 完整架构和 API 参考 |
| [插件指南](docs/PLUGIN-GUIDE.md) | 如何开发自定义插件 |
| [插件权限](docs/PLUGIN-PERMISSIONS.md) | 插件权限系统 |
| [多 Agent 协作](docs/MULTI_AGENT_COLLABORATION.md) | 多 Agent 编排设计 |
| [代码生成设计](docs/CODE_GENERATION_DESIGN.md) | 代码生成与沙箱执行 |
| [通用原语设计](docs/GENERAL_PRIMITIVES_DESIGN.md) | Shell/文件工具设计 |
| [项目目录树](src/docs/PROJECT_TREE.md) | 完整文件说明 |

---

## 📄 许可证

MIT License
