# OpenPaw JS 开发文档

## 目录

1. [项目概述](#项目概述)
2. [技术栈](#技术栈)
3. [项目架构](#项目架构)
4. [核心功能](#核心功能)
   - [代码生成系统](#代码生成系统)
   - [实时预览系统](#实时预览系统)
   - [Skill 插件系统](#skill-插件系统)
5. [API 参考](#api-参考)
6. [开发指南](#开发指南)
7. [部署说明](#部署说明)

---

## 项目概述

OpenPaw JS 是一个基于 Tauri v2 的桌面 AI 助手应用，支持通过自然语言控制桌面、浏览器和手机。本项目实现了：

- **代码生成**：AI 驱动的代码生成能力，支持单文件和多文件项目
- **实时预览**：生成的 HTML 代码可在应用内实时预览
- **插件系统**：开放的 Skill 扩展机制，支持第三方开发者

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | React 19 + TypeScript 5 + Vite 6 |
| 后端 | Rust (Tauri v2) |
| 数据库 | SQLite (Tauri native + WASM fallback) |
| 状态管理 | Zustand |
| Python 引擎 | UIA、浏览器自动化、OCR、Office |

---

## 项目架构

```
openpaw-js/
├── src/                          # 前端源码
│   ├── adapters/                 # LLM 适配器 (OpenAI, Anthropic, Google)
│   ├── agents/                   # Agent API 封装
│   ├── api/                      # HTTP 客户端
│   ├── backend/                  # Vite 中间件后端
│   ├── components/               # UI 组件
│   ├── config/                   # 配置文件
│   ├── db/                       # 数据库适配器
│   ├── pages/                    # 页面路由
│   ├── services/                 # 核心业务逻辑
│   ├── skills/                   # Skill 系统
│   ├── stores/                   # Zustand 状态管理
│   └── utils/                    # 工具函数
├── src-tauri/                    # Tauri Rust 后端
│   └── src/
│       ├── commands/             # 原生命令处理
│       └── lib.rs                # 应用入口
├── python-engine/                # Python 引擎
│   ├── main.py                   # JSON-line 调度器
│   └── engine/                   # UIA、浏览器、OCR 引擎
└── docs/                         # 文档
```

---

## 核心功能

### 代码生成系统

#### 架构

```
用户请求 → CodeGateway → 复杂度判断
                          ├─ 简单 → 单 Agent 生成
                          └─ 复杂 → Orchestrator 4 阶段流水线
                                     ├─ Phase 1: Architect (任务分解)
                                     ├─ Phase 2: Developer (并行代码生成)
                                     ├─ Phase 3: Reviewer (质量审查)
                                     └─ Phase 4: Integrator (最终集成)
```

#### 关键文件

| 文件 | 说明 |
|------|------|
| `src/services/code-gateway.ts` | 代码生成入口，复杂度路由 |
| `src/services/multi-agent/orchestrator.ts` | 4 阶段流水线编排器 |
| `src/skills/code-tools.ts` | CodeToolsSkill，14 个工具 |
| `src/services/code-sandbox/` | 代码沙箱 (JS, Python, SQL, HTML) |
| `src/backend/handlers.ts` | 后端 API 处理器 |

#### 支持的语言

| 语言 | 沙箱 | 说明 |
|------|------|------|
| JavaScript | `sandbox-js.ts` | `new Function()` + Proxy 沙箱 |
| Python | `sandbox-python.ts` | Python 引擎桥接 |
| SQL | `sandbox-sql.ts` | SQLite 执行 |
| HTML | `sandbox-html.ts` | iframe 沙箱渲染 |

---

### 实时预览系统

#### 功能

- HTML 代码沙箱渲染
- 自动生成的应用自动保存
- 实时预览更新
- 多文件项目支持

#### 架构

```
代码生成 → 自动保存 → 事件通知 → 前端更新
    │           │           │           │
    ▼           ▼           ▼           ▼
CodeTools   SQLite DB   AppEvent    Apps Page
 Skill      (savedApps)   Bus      (实时预览)
```

#### 关键文件

| 文件 | 说明 |
|------|------|
| `src/services/code-sandbox/sandbox-html.ts` | HTML 沙箱实现 |
| `src/services/app-events.ts` | 事件总线 |
| `src/pages/apps.tsx` | Apps 页面（预览 + 编辑） |
| `src/skills/app-builder.ts` | 应用管理 Skill |

#### 数据库结构

```sql
CREATE TABLE IF NOT EXISTS savedApps (
  id TEXT PRIMARY KEY,
  name TEXT,
  code TEXT,
  created_at TEXT,
  description TEXT DEFAULT '',
  project_type TEXT DEFAULT 'single',  -- 'single' 或 'multi'
  files_json TEXT DEFAULT '[]',        -- 多文件项目文件列表
  entry_file TEXT DEFAULT '',           -- 入口文件
  updated_at TEXT
);
```

#### 使用方式

**单文件应用：**
```json
{
  "tool": "generate_code",
  "params": {
    "task": "创建一个待办事项应用",
    "language": "html",
    "app_name": "我的待办应用",
    "auto_save": true
  }
}
```

**多文件项目：**
```json
{
  "tool": "generate_project",
  "params": {
    "project_name": "我的网站",
    "requirement": "创建一个包含首页、关于页和联系页的网站"
  }
}
```

---

### Skill 插件系统

#### 架构

```
外部开发者 → 实现 SkillPlugin 接口
                │
                ▼
         PluginLoader 加载
                │
                ▼
         PluginAdapter 适配
                │
                ▼
         SkillExecutor 注册
                │
                ▼
         AI 调用工具
```

#### 接口定义

```typescript
interface SkillPlugin {
  metadata: {
    id: string;
    name: string;
    version: string;
    description: string;
    author?: string;
    category?: string;
    nameCn?: string;
    descriptionCn?: string;
  };
  tools: PluginToolDefinition[];
  onInit?: (context: PluginContext) => Promise<void>;
  onDispose?: () => Promise<void>;
}

interface PluginToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;  // JSON Schema
  nameCn?: string;
  descriptionCn?: string;
  execute: (params: Record<string, unknown>, context: PluginContext) => Promise<PluginResult>;
}

interface PluginContext {
  callTool(toolName: string, params: Record<string, unknown>): Promise<SkillResult>;
  log(message: string, level?: 'info' | 'warn' | 'error'): void;
  readFile?(path: string): Promise<string>;
  writeFile?(path: string, content: string): Promise<void>;
  execCommand?(command: string): Promise<string>;
}

interface PluginResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}
```

#### 关键文件

| 文件 | 说明 |
|------|------|
| `src/skills/plugin-loader.ts` | 插件加载器 |
| `src/skills/builtin-executor.ts` | 内置执行器（含插件加载） |
| `src/skills/plugins/example-plugin.ts` | 示例插件 |
| `docs/PLUGIN-GUIDE.md` | 插件开发指南 |

#### 加载方式

**1. 静态导入（内置插件）：**
```typescript
// src/skills/plugins/my-plugin.ts
import type { SkillPlugin } from '@/skills/plugin-loader';

const myPlugin: SkillPlugin = {
  metadata: { id: 'my_plugin', name: 'My Plugin', version: '1.0.0', description: '...' },
  tools: [/* ... */],
};

export default myPlugin;
```

**2. 动态加载（第三方插件）：**
```typescript
import { loadPluginFromPath } from '@/skills/builtin-executor';

const adapter = await loadPluginFromPath('/path/to/plugin.js');
```

**3. 配置加载（用户自定义）：**
```typescript
import { loadPluginFromConfig } from '@/skills/builtin-executor';

const adapter = await loadPluginFromConfig({
  id: 'my_custom',
  name: 'My Tools',
  tools: [{
    name: 'my_tool',
    description: 'Does something',
    parameters: { /* JSON Schema */ },
    implementation: 'return skill.ok("Done");'
  }]
});
```

#### 示例插件

`src/skills/plugins/example-plugin.ts` 包含：

| 工具 | 说明 |
|------|------|
| `string_case_convert` | 字符串格式转换 (camelCase, snake_case, kebab-case, PascalCase) |
| `json_format` | JSON 格式化/压缩/验证 |
| `markdown_to_html` | Markdown 转 HTML |
| `chain_tools_demo` | 工具链演示 |

---

## API 参考

### 后端 API 端点

| 端点 | 方法 | 说明 |
|------|------|------|
| `/api/agent/code-generation` | POST (SSE) | 代码生成 |
| `/api/agent/code-iteration` | POST (SSE) | 代码迭代修复 |
| `/api/agent/chat` | POST (SSE) | 聊天对话 |
| `/api/agent/desktop-automation` | POST (SSE) | 桌面自动化 |

### Skill 工具列表

#### CodeToolsSkill

| 工具 | 说明 |
|------|------|
| `generate_code` | LLM 代码生成 |
| `execute_code` | 沙箱执行 (JS/Python/SQL/HTML) |
| `iterate_code` | 执行-修复循环 |
| `generate_project` | 多 Agent 项目生成 |
| `write_file` / `read_file` | 文件读写 |
| `glob` / `search_files` | 文件搜索 |
| `run_command` | Shell 命令执行 |
| `save_code` / `list_code` | 代码注册表 |
| `web_search` / `web_fetch` | Web 搜索和获取 |

#### AppBuilderSkill

| 工具 | 说明 |
|------|------|
| `save_app` | 保存单文件应用 |
| `save_project` | 保存多文件项目 |
| `list_apps` | 列出所有应用 |
| `get_app` | 获取应用详情 |
| `update_app` | 更新应用 |
| `delete_app` | 删除应用 |

---

## 开发指南

### 环境要求

- Node.js 18+
- Rust 1.70+
- Python 3.10+ (可选，用于 Python 引擎)

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 添加新的内置 Skill

1. 在 `public/skills/` 创建 markdown 文件定义工具元数据
2. 在 `src/skills/` 创建 TypeScript 类实现 `Skill` 接口
3. 在 `loader.ts` 注册 markdown 文件名
4. 在 `builtin-executor.ts` 的 switch-case 中添加映射

### 创建插件

参考 `docs/PLUGIN-GUIDE.md` 和 `src/skills/plugins/example-plugin.ts`

---

## 部署说明

### Tauri 构建

```bash
npm run tauri build
```

### 产物位置

- Windows: `src-tauri/target/release/bundle/msi/`
- macOS: `src-tauri/target/release/bundle/dmg/`
- Linux: `src-tauri/target/release/bundle/deb/` 或 `appimage/`

---

## 更新日志

### 2024-06-16

#### 新增功能

- **实时预览系统**
  - HTML 代码沙箱渲染
  - 自动生成应用自动保存
  - 实时预览更新
  - 多文件项目支持
  - 文件浏览器组件

- **Skill 插件系统**
  - PluginLoader 插件加载器
  - PluginAdapter 适配器
  - 示例插件（4 个工具）
  - 插件开发指南

#### 改进

- 扩展 savedApps 数据库表结构
- 更新 Orchestrator 支持项目自动保存
- 更新 Apps 页面支持多文件项目
- 更新系统提示支持 auto_save 参数

---

## 相关文档

- [项目架构](PROJECT.md)
- [插件开发指南](PLUGIN-GUIDE.md)
