# OpenPaw

AI-powered personal assistant desktop app. Control your desktop, browser, and phone through natural language.

Built with **Tauri v2** (Rust) + **React 19** + **Vite 6**.

## Features

- **Desktop Automation** — Screenshot, click, type, scroll, focus windows, launch apps via Win32 API
- **Browser Automation** — Web page control with DOM interaction
- **Phone Automation** — Android device control via UI tree
- **Multi-LLM** — OpenAI, Anthropic, Google Gemini adapters with tool-calling
- **Skill System** — Built-in skills + user-defined skills (record steps or write JS)
- **Float Window** — System tray quick-access overlay
- **App Index** — Startup scan of installed Windows apps with Chinese alias support
- **i18n** — Chinese / English

## Quick Start

```bash
# Install dependencies
npm install

# Development (frontend only, port 3000)
npm run dev

# Build
npm run build
```

For Tauri desktop build:

```bash
cd src-tauri && cargo build
```

## Tech Stack

| Layer | Technology |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| Frontend | React 19 + TypeScript 5 |
| Build | Vite 6 |
| CSS | Tailwind CSS v4 |
| Router | react-router-dom v7 |
| State | Zustand v5 + Immer |
| Database | SQLite (Tauri native + WASM fallback) |
| LLM | OpenAI / Anthropic / Google Gemini |
| i18n | i18next v26 |

## Architecture

```
[index.html → main.tsx → RouterProvider]
  ├── /float     → FloatPage (standalone, Tauri float window)
  └── AppShell
       ├── /        → ChatPage
       ├── /desktop → Desktop automation
       ├── /web     → Browser automation
       ├── /phone   → Phone automation
       ├── /models  → LLM provider config
       ├── /skills  → Skill management
       ├── /settings→ Theme, language
       └── /apps    → Stub

[State]   Zustand stores (chat, model-config, settings, skill)
[DB]      SQLite — 5 tables, dual adapter
[LLM]     ModelCallService → OpenAI/Anthropic/Google adapters
[Skills]  SkillExecutor — built-in + user-defined (recorded or sandboxed JS)
[Tauri]   13 Rust commands for desktop control + system tray + app index
```

## Project Structure

See [`docs/PROJECT.md`](docs/PROJECT.md) for full architecture documentation.
