---
id: app_builder
name: App Builder
name_cn: 应用构建器
category: Application
category_cn: 应用程序
description: Save, list, update, and delete generated applications. Generated apps run in a WebView with access to native device capabilities via the window.Handy.call() JavaScript API.
description_cn: 保存、列出、更新和删除生成的应用。生成的应用在 WebView 中运行，可通过 window.Handy.call() JavaScript API 访问原生设备能力。
usage: |
  ## Quick Start

  1. **Generate an app**: Use AI chat to describe the app you want — the LLM will generate HTML/CSS/JS code
  2. **Save**: save_app({name, code}) — persists the generated code
  3. **List**: list_apps — see all saved apps
  4. **Edit**: get_app({id}) → update_app({id, code}) — modify existing apps
  5. **Delete**: delete_app({id}) — remove unwanted apps

  ## Generated App Capabilities

  - Runs in a WebView sandbox
  - Access native APIs via `window.Handy.call(method, params)`
  - Supports multi-page apps
  - Persistent storage per app
usage_cn: |
  ## 快速开始

  1. **生成应用**：在 AI 对话中描述你想要的应用 — LLM 将生成 HTML/CSS/JS 代码
  2. **保存**：save_app({name, code}) — 持久化生成的代码
  3. **列表**：list_apps — 查看所有已保存的应用
  4. **编辑**：get_app({id}) → update_app({id, code}) — 修改已有应用
  5. **删除**：delete_app({id}) — 移除不需要的应用

  ## 生成应用的能力

  - 在 WebView 沙箱中运行
  - 通过 `window.Handy.call(method, params)` 访问原生 API
  - 支持多页面应用
  - 每个应用独立持久化存储
---

Save, list, update, and delete generated applications.
Generated apps run in a WebView with access to native device capabilities via the window.Handy.call() JavaScript API.
Match the app complexity to what the user asks for.

## Tools

```json
[
  {
    "name": "save_app",
    "description": "Save a complete HTML/CSS/JS application to the app library so the user can launch it from the Apps page. Use this for finished, user-facing web apps — NOT for project source files (use write_file for those). The code should be a complete, standalone HTML document. Do NOT call write_file before or after save_app for the same content.",
    "name_cn": "保存应用",
    "description_cn": "将完整的 HTML/CSS/JS 应用保存到应用库，用户可在 Apps 页面启动。用于成品 Web 应用，不要用此工具保存项目源文件（用 write_file）。代码应为完整的独立 HTML 文档。不要对同一内容既调 write_file 又调 save_app。",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "App name" },
        "code": { "type": "string", "description": "HTML/CSS/JS source code" },
        "description": { "type": "string", "description": "Brief description" }
      },
      "required": ["name", "code"]
    },
    "returns": "{\"id\":\"app-uuid\",\"name\":\"app name\",\"description\":\"description\",\"code\":\"HTML source\",\"created_at\":\"ISO timestamp\"}"
  },
  {
    "name": "list_apps",
    "description": "List all saved applications. Returns app metadata (id, name, description, creation date).",
    "name_cn": "构建列出应用",
    "description_cn": "列出所有已保存的应用，返回应用元数据（ID、名称、描述、创建日期）。",
    "parameters": { "type": "object", "properties": {} },
    "returns": "{\"apps\":[{\"id\":\"uuid\",\"name\":\"app name\",\"description\":\"description\",\"project_type\":\"single/multi\",\"entry_file\":\"index.html\",\"created_at\":\"ISO timestamp\"}],\"count\":number}"
  },
  {
    "name": "get_app",
    "description": "Get a saved application by ID. Returns full app data including the source code.",
    "name_cn": "获取应用",
    "description_cn": "通过 ID 获取已保存的应用，返回完整应用数据（含源代码）。",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "App ID" }
      },
      "required": ["id"]
    },
    "returns": "{\"id\":\"uuid\",\"name\":\"app name\",\"description\":\"description\",\"code\":\"full HTML source\",\"project_type\":\"single/multi\",\"files\":{...},\"entry_file\":\"index.html\",\"created_at\":\"ISO timestamp\"}"
  },
  {
    "name": "update_app",
    "description": "Update an existing application's code and/or name.",
    "name_cn": "更新应用",
    "description_cn": "更新已有应用的代码和/或名称。",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "App ID" },
        "code": { "type": "string", "description": "New HTML/CSS/JS source code (optional, keeps existing if omitted)" },
        "name": { "type": "string", "description": "New app name (optional, keeps existing if omitted)" }
      },
      "required": ["id"]
    },
    "returns": "{\"id\":\"uuid\",\"name\":\"app name\",\"description\":\"description\",\"code\":\"updated HTML source\",\"project_type\":\"single/multi\",\"updated_at\":\"ISO timestamp\"}"
  },
  {
    "name": "delete_app",
    "description": "Delete an application by ID.",
    "name_cn": "删除应用",
    "description_cn": "通过 ID 删除应用。",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "App ID" }
      },
      "required": ["id"]
    },
    "returns": "{\"success\":true,\"id\":\"deleted app id\",\"message\":\"deletion confirmation\"}"
  }
]
```
