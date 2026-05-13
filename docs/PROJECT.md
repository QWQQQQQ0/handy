# OpenPaw — Project Reference

AI-powered personal assistant desktop app. Built with Tauri v2 (Rust backend) + Vite React frontend. Cross-platform: Windows desktop via Tauri, web fallback via PWA.

## Quick Start

```bash
# Install dependencies
npm install

# Development (frontend only, port 3000)
npm run dev

# Development (Tauri desktop, starts Vite + Rust backend)
cd src-tauri && cargo build
# or use Tauri CLI from root
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop shell | Tauri v2.11 (Rust) |
| Frontend framework | React 19 + TypeScript 5 |
| Build tool | Vite v6 |
| CSS | Tailwind CSS v4 |
| Router | react-router-dom v7 (createBrowserRouter) |
| State | Zustand v5 + Immer v11 |
| Database | SQLite — dual adapter: Tauri native (`@tauri-apps/plugin-sql`) + WASM (`sql.js`) |
| LLM adapters | OpenAI, Anthropic, Google Gemini |
| i18n | i18next v26 + react-i18next |
| Icons | lucide-react |

## Architecture

```
[Browser / WebView]
  index.html → main.tsx → RouterProvider
    ├── /float       → FloatPage      (standalone, no AppShell — Tauri float window)
    └── AppShell (sidebar + nav)
         ├── /        → ChatPage       (main chat UI)
         ├── /desktop → DesktopPage    (desktop automation)
         ├── /web     → WebPage        (browser automation)
         ├── /phone   → PhonePage      (stub)
         ├── /models  → ModelsPage     (LLM provider CRUD)
         ├── /skills  → SkillsPage     (skill management)
         ├── /settings→ SettingsPage   (theme, language)
         └── /apps    → AppsPage       (stub)

[State Layer — Zustand stores]
  chat-store.ts     — conversations, messages, streaming, tool mode
  model-config-store.ts — LLM providers (API keys encrypted with AES-GCM)
  settings-store.ts — theme, locale, tool preferences (localStorage)
  skill-store.ts    — built-in + user-defined skills (DB-persisted)

[Database — SQLite]
  5 tables: modelProviders, conversations, messages, savedApps, skills
  Platform detection → Tauri native adapter or sql.js WASM

[LLM Layer — ModelCallService]
  OpenAIAdapter / AnthropicAdapter / GoogleAdapter
  Up to 5 tool-calling rounds per user message

[Skill System — SkillExecutor]
  Built-in: desktop, web, phone, app-builder
  User-defined: recorded steps or sandboxed JS (stored in DB)

[Tauri Backend — Rust]
  13 commands: screenshot, click/double/right, type, press_key, scroll,
              move_mouse, list_windows, focus_window, list_apps,
              open_app, refresh_apps
  System tray: toggle float window, quit
  App index: startup scan → disk cache (no PowerShell, pure Win32 API)
```

## Key File Map

### Frontend Entry
- `src/main.tsx` — React entry, mounts RouterProvider
- `src/router.tsx` — All routes (lazy-loaded pages)

### Core Services
- `src/services/chat-service.ts` — Chat loop: send → LLM → tool calls → repeat (5 rounds max)
- `src/services/desktop-service.ts` — Wrapper for Tauri invoke() calls
- `src/services/desktop-automation-agent.ts` — Screenshot → LLM → tool → repeat loop
- `src/services/web-automation-agent.ts` — Same pattern for browser automation
- `src/services/recorder.ts` — Records tool calls for skill generation

### Skill System
- `src/skills/skill.ts` — Skill interface + helper types
- `src/skills/executor.ts` — Skill registry + dispatch
- `src/skills/loader.ts` — Parse built-in skills from markdown
- `src/skills/desktop.ts` — Desktop control (13 tools → Tauri commands)
- `src/skills/user-defined.ts` — User skills: step replay or sandboxed JS

### State (Zustand)
- `src/stores/chat-store.ts` — Active conversation, messages, sendMessage()
- `src/stores/model-config-store.ts` — Provider CRUD, encrypted API keys
- `src/stores/settings-store.ts` — Theme, locale, tool prefs
- `src/stores/skill-store.ts` — Skill definitions, built-in seeding

### Database
- `src/db/index.ts` — Factory: detects platform, creates adapter + DDL
- `src/db/tauri.ts` — Tauri native SQLite adapter
- `src/db/wasm.ts` — sql.js WASM adapter (browser fallback)
- `src/db/types.ts` — Row types (snake_case matching SQLite columns)

### LLM Adapters
- `src/adapters/model-call-service.ts` — Orchestrator: provider selection, streaming, system prompts
- `src/adapters/openai.ts`, `anthropic.ts`, `google.ts` — Per-provider adapters

### Tauri Backend (Rust)
- `src-tauri/src/lib.rs` — App setup: plugins, commands, tray, background app-index
- `src-tauri/src/commands/screenshot.rs` — GDI screen capture → BMP base64
- `src-tauri/src/commands/input.rs` — SendInput (mouse/keyboard)
- `src-tauri/src/commands/window.rs` — EnumWindows, SetForegroundWindow
- `src-tauri/src/commands/app.rs` — list_apps, open_app (with existing-instance check), refresh_apps
- `src-tauri/src/commands/app_index.rs` — App scanner (COM shortcuts + winreg + std::fs), fuzzy match, aliases
- `src-tauri/capabilities/default.json` — Permissions for `main` and `float` windows

### Configuration
- `vite.config.ts` — Build config, aliases, code splitting
- `src-tauri/tauri.conf.json` — Tauri app metadata, window config, CSP
- `src/config/system-prompts.json` — LLM system prompt templates per scenario

## Database Schema

```sql
modelProviders(id, name, provider_type, base_url, model, encrypted_api_key, is_default, supports_tools, created_at)
conversations(id, title, model_provider_id, created_at, updated_at)
messages(id, conversation_id, role, content, timestamp)
  INDEX: idx_messages_conversation(conversation_id, timestamp)
savedApps(id, name, code, created_at)
skills(id, name, description, category, schema_json, enabled, builtin, steps_json, implementation, created_at, updated_at)
```

## Tauri Commands

All Rust commands are synchronous (no async). Registered in `lib.rs`:

| Command | Params | Returns |
|---------|--------|---------|
| `desktop_screenshot` | — | BMP base64 data URI |
| `desktop_click` | x, y | void |
| `desktop_double_click` | x, y | void |
| `desktop_right_click` | x, y | void |
| `desktop_type_text` | text | void |
| `desktop_press_key` | key (enter/esc/tab/arrows/F1-F12…) | void |
| `desktop_scroll` | x, y, delta | void |
| `desktop_move_mouse` | x, y | void |
| `desktop_list_windows` | — | Vec\<WindowInfo\> |
| `desktop_focus_window` | hwnd | bool |
| `desktop_list_apps` | — | Vec\<AppInfo\> (from disk cache) |
| `desktop_open_app` | name | bool (launches or focuses existing) |
| `desktop_refresh_apps` | — | usize (count rescanned) |

## App Index System

At startup, a background thread (`std::thread::spawn` in `lib.rs`) scans the system:

1. **Shortcuts** — Walk Start Menu/Desktop dirs via `std::fs`, resolve `.lnk` targets via `IShellLinkW` COM
2. **Registry** — Read `DisplayName` from Uninstall keys via `winreg` crate
3. **Program Files** — Walk `C:\Program Files` via `std::fs`, find `<name>.exe` in each dir

Results deduplicated (shortcuts > program_files > registry), merged with Chinese aliases ("浏览器"→chrome, "微信"→wechat, etc.), persisted to `%APPDATA%/openpaw/app_cache.json`. In-memory only holds a tiny `name→path` + `alias→name` lookup map.

**`desktop_open_app`** fuzzy matches the name against the index, checks if the app is already running (ToolHelp snapshot → PID → EnumWindows → focus existing), or spawns a new process.

## Float Window

A separate Tauri `WebviewWindow` (label: `float`) created via frontend JS. The `/float` route renders without `AppShell` (no sidebar). Toggled by system tray icon or sidebar button. Persists across show/hide (never destroyed).

## Key Patterns

1. **Platform detection**: `isTauri()` checks `window.__TAURI_INTERNALS__`. Used to switch between native Tauri APIs and web fallbacks.
2. **Dual SQLite**: Same `SQLiteAdapter` interface, Tauri native or WASM at runtime.
3. **Encrypted API keys**: AES-GCM via Web Crypto API, PBKDF2 key derivation, stored in SQLite.
4. **Tool calling loop**: ChatService streams LLM response, parses tool calls, executes via SkillExecutor, feeds results back — up to 5 rounds.
5. **Skill extensibility**: Built-in skills have native bindings. User skills are JSON configs in the DB — can replay recorded steps or run sandboxed JS (`new Function('params', 'skill', 'executor', code)`).
6. **Chinese-first**: All UI strings in zh/en via i18next. App index has built-in Chinese aliases. Desktop PS replaced with Win32 API to avoid encoding issues.
