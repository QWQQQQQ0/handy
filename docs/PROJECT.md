# OpenPaw JS - Project Architecture

## Overview

OpenPaw JS is a Tauri v2 desktop application that serves as an AI-powered personal assistant. It can control desktop, browser, and phone through natural language commands.

## Technology Stack

- **Frontend**: React 19 + TypeScript 5 + Vite 6
- **Backend**: Rust (Tauri v2)
- **Python Engine**: Sidecar process for UIA, browser automation, OCR, and office document generation

## Project Structure

```
openpaw-js/
├── src/                    # Frontend (React/TypeScript)
│   ├── adapters/          # LLM provider adapters (OpenAI, Anthropic, Google)
│   ├── agents/            # Agent API wrappers
│   ├── api/               # HTTP client and endpoint definitions
│   ├── backend/           # Vite middleware backend
│   ├── components/        # UI components
│   ├── config/            # System prompts JSON
│   ├── core/              # Skill learner/resolver
│   ├── db/                # SQLite adapter
│   ├── i18n/              # Internationalization (zh/en)
│   ├── interfaces/        # TypeScript interfaces
│   ├── pages/             # Route pages
│   ├── services/          # Core business logic
│   ├── skills/            # Skill system
│   ├── stores/            # Zustand state stores
│   ├── types/             # TypeScript type definitions
│   └── utils/             # Utility functions
├── src-tauri/             # Tauri Rust backend
│   └── src/
│       ├── commands/      # Native command handlers
│       └── lib.rs         # App entry point
└── python-engine/         # Python sidecar
    ├── main.py            # JSON-line dispatcher
    └── engine/            # UIA, browser, OCR engines
```

## Key Features

### 1. Code Generation System

The project includes a sophisticated code generation system with multiple layers:

- **CodeGateway**: Routes requests based on complexity (simple vs complex)
- **Multi-Agent Orchestrator**: 4-phase pipeline for complex projects
  - Architect: Task decomposition
  - Developer: Parallel code generation
  - Reviewer: Quality review
  - Integrator: Final assembly

- **CodeToolsSkill**: Primary code generation tool with 14 tools including:
  - `generate_code`: LLM-based code generation
  - `execute_code`: Sandbox execution (JS, Python, SQL, HTML)
  - `iterate_code`: Execute-fix loop
  - `generate_project`: Multi-agent pipeline

### 2. Real-Time App Preview System (New)

Added in this update, the real-time preview system allows:

- **HTML Sandbox**: Safe HTML rendering in isolated iframe
- **Auto-Save**: Generated HTML code automatically saved to database
- **Live Preview**: Real-time preview updates when code is generated
- **App Management**: Full CRUD operations for saved applications

#### Architecture

```
Code Generation Flow:
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  LLM generates  │────▶│  CodeToolsSkill  │────▶│  SQLite DB      │
│  HTML code      │     │  auto-saves      │     │  (savedApps)    │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                              │
                              ▼
                        ┌──────────────────┐
                        │  AppEventBus     │
                        │  emits events    │
                        └──────────────────┘
                              │
                              ▼
                        ┌──────────────────┐
                        │  Apps Page       │
                        │  updates preview │
                        └──────────────────┘
```

#### Components

1. **HTML Sandbox** (`src/services/code-sandbox/sandbox-html.ts`)
   - Parses and sanitizes HTML code
   - Extracts CSS and JavaScript
   - Wraps scripts in sandboxed environment
   - Returns isolated document for iframe rendering

2. **App Events** (`src/services/app-events.ts`)
   - Event bus for real-time communication
   - Events: `APP_CREATED`, `APP_UPDATED`, `APP_DELETED`, `HTML_GENERATED`

3. **Apps Page** (`src/pages/apps.tsx`)
   - Lists all saved applications (single-file and multi-file projects)
   - Code editor with syntax highlighting
   - Real-time HTML preview in sandboxed iframe
   - File explorer for multi-file projects
   - Console output display

4. **Multi-File Project Support**
   - Orchestrator auto-saves completed projects to Apps database
   - File explorer component for browsing project files
   - Entry file detection (index.html or first HTML file)
   - Project type indicator in app list

### 3. Desktop Automation

- Screenshot capture (Win32 GDI)
- Mouse/keyboard simulation
- Window management
- Python sidecar for UIA and browser automation

### 4. Skill System

- Built-in skills for desktop, web, and office automation
- User-defined skills with custom tools
- Skill executor with coordinate scaling

## Database Schema

### savedApps Table

```sql
CREATE TABLE IF NOT EXISTS savedApps (
  id TEXT PRIMARY KEY,
  name TEXT,
  code TEXT,
  created_at TEXT,
  description TEXT DEFAULT '',
  project_type TEXT DEFAULT 'single',
  files_json TEXT DEFAULT '[]',
  entry_file TEXT DEFAULT '',
  updated_at TEXT
);
```

**Fields:**
- `project_type`: `'single'` for single HTML files, `'multi'` for multi-file projects
- `files_json`: JSON string containing project files (for multi-file projects)
- `entry_file`: Main entry file path (e.g., `index.html`)

## API Endpoints

### Backend Middleware Routes

- `/api/agent/code-generation` - Streaming code generation
- `/api/agent/code-iteration` - Code iteration with error fixing
- `/api/agent/chat` - Chat with tool support
- `/api/agent/desktop-automation` - Desktop automation commands

## Development Guidelines

1. **Static System Prompts**: Place in `src/config/system-prompts.json`
2. **Documentation**: Update `docs/PROJECT.md` when architecture changes
3. **Code Style**: Follow existing patterns in the codebase

## Plugin System

OpenPaw 支持通过插件机制扩展 Skill 系统。外部开发者可以按照接口规范编写自定义工具。

### 插件接口

```typescript
interface SkillPlugin {
  metadata: PluginMetadata;
  tools: PluginToolDefinition[];
  onInit?: (context: PluginContext) => Promise<void>;
  onDispose?: () => Promise<void>;
}
```

### 加载方式

1. **静态导入**：将插件放入 `src/skills/plugins/` 目录
2. **动态加载**：使用 `loadPluginFromPath()` 从文件路径加载
3. **配置加载**：使用 `loadPluginFromConfig()` 从配置对象加载

### 示例插件

参考 `src/skills/plugins/example-plugin.ts` 和 `docs/PLUGIN-GUIDE.md`

## Recent Changes

### Skill Plugin System

- Added `PluginLoader` for loading external skill plugins
- Created `PluginAdapter` to convert plugins to internal Skill interface
- Added `PluginRegistry` for static plugin registration
- Created example plugin with string/data utilities
- Added plugin loading API to `builtin-executor.ts`
- Created plugin development guide (`docs/PLUGIN-GUIDE.md`)

### Real-Time App Preview System

- Added HTML sandbox for safe code rendering
- Implemented auto-save for generated HTML applications
- Created event system for real-time updates

---

## 文档索引

| 文档 | 说明 |
|------|------|
| [DEVELOPMENT.md](DEVELOPMENT.md) | 完整开发文档（架构、API、指南） |
| [PLUGIN-GUIDE.md](PLUGIN-GUIDE.md) | 插件开发指南 |
| [PLUGIN-PERMISSIONS.md](PLUGIN-PERMISSIONS.md) | 插件权限详细说明 |
| [PLUGIN-PERMISSIONS-CHEATSHEET.md](PLUGIN-PERMISSIONS-CHEATSHEET.md) | 插件权限速查表 |
| [QUICK-START.md](QUICK-START.md) | 快速开始指南 |
- Built Apps page with code editor and preview
- Added console output display for debugging
