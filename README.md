# Handy (OpenPaw JS)

> 🤖 AI 驱动的桌面助手 — 通过自然语言控制桌面、浏览器和手机

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue)](https://tauri.app)
[![React](https://img.shields.io/badge/React-19-61dafb)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6)](https://www.typescriptlang.org)

---

## ✨ 特性

- 🖥️ **桌面自动化** — 截图、鼠标点击、键盘输入、窗口管理
- 🌐 **浏览器控制** — 网页截图、元素交互、数据提取
- 📱 **手机操控** — Android 设备远程控制
- 💻 **代码生成** — AI 驱动的代码生成与执行
- 👁️ **实时预览** — 生成的应用即时预览
- 🔌 **插件系统** — 开放的 Skill 扩展机制
- 🎯 **多 LLM 支持** — OpenAI、Anthropic、Google Gemini
- 🌍 **国际化** — 中文 / 英文

---

## 🚀 快速开始

### 环境要求

- Node.js 18+
- Rust 1.70+
- Python 3.10+ (可选，用于 Python 引擎)

### 安装

```bash
# 克隆项目
git clone <repo-url>
cd openpaw-js

# 安装依赖
npm install

# 启动开发服务器
npm run dev
```

### Tauri 桌面构建

```bash
cd src-tauri && cargo build
```

---

## 📖 文档

| 文档 | 说明 |
|------|------|
| [快速开始](docs/QUICK-START.md) | 一分钟上手指南 |
| [开发文档](docs/DEVELOPMENT.md) | 完整架构和 API 参考 |
| [插件指南](docs/PLUGIN-GUIDE.md) | 如何开发自定义插件 |
| [项目架构](docs/PROJECT.md) | 项目结构说明 |

---

## 🔌 插件开发

OpenPaw 支持通过插件扩展功能：

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
        return {
          success: true,
          message: `Processed: ${input}`,
        };
      },
    },
  ],
};

export default myPlugin;
```

详见 [插件开发指南](docs/PLUGIN-GUIDE.md)

---

## 🛠️ 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 5 + Vite 6 |
| 后端 | Rust (Tauri v2) |
| 数据库 | SQLite (Tauri native + WASM fallback) |
| 状态管理 | Zustand v5 + Immer |
| CSS | Tailwind CSS v4 |
| 路由 | react-router-dom v7 |
| LLM | OpenAI / Anthropic / Google Gemini |
| 国际化 | i18next v26 |

---

## 📁 项目结构

```
openpaw-js/
├── src/                    # 前端源码
│   ├── skills/             # Skill 系统
│   │   ├── plugins/        # 插件目录
│   │   ├── skill.ts        # Skill 接口
│   │   └── plugin-loader.ts # 插件加载器
│   ├── services/           # 核心服务
│   │   ├── code-sandbox/   # 代码沙箱
│   │   └── multi-agent/    # 多 Agent 编排
│   └── pages/              # 页面
│       └── apps.tsx        # Apps 预览页
├── src-tauri/              # Tauri Rust 后端
├── python-engine/          # Python 引擎
└── docs/                   # 文档
```

---

## 🏗️ 架构概览

```
[index.html → main.tsx → RouterProvider]
  ├── /float     → FloatPage (standalone, Tauri float window)
  └── AppShell
       ├── /        → ChatPage (AI 聊天)
       ├── /desktop → Desktop automation (桌面自动化)
       ├── /web     → Browser automation (浏览器自动化)
       ├── /phone   → Phone automation (手机自动化)
       ├── /models  → LLM provider config (模型配置)
       ├── /skills  → Skill management (技能管理)
       ├── /settings→ Theme, language (设置)
       └── /apps    → App preview (应用预览)

[State]   Zustand stores (chat, model-config, settings, skill)
[DB]      SQLite — 多表结构
[LLM]     ModelCallService → OpenAI/Anthropic/Google adapters
[Skills]  SkillExecutor — 内置 + 用户自定义 + 插件
[Tauri]   80+ Rust commands for desktop control
```

---

## 🤝 贡献

欢迎贡献代码！请查看 [开发文档](docs/DEVELOPMENT.md) 了解如何参与。

---

## 📄 许可证

MIT License

---

## 🔗 链接

- [Tauri 文档](https://tauri.app/v2/react/)
- [React 文档](https://react.dev)
- [TypeScript 文档](https://www.typescriptlang.org)
- [Vite 文档](https://vitejs.dev)
