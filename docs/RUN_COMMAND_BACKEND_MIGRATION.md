# Plan: run_command 从 Tauri shell 插件迁移到 Node.js 后端

## Context

当前 `run_command` 工具通过 `@tauri-apps/plugin-shell` 在前端直接执行 shell 命令，但 Tauri capabilities 缺少 `shell:allow-execute` 权限导致全部失败。项目已有 Node.js 后端（Vite middleware），LLM 调用已走后端，shell 命令应保持一致。

## 改动范围

### 1. `src/api/types.ts` — 新增端点和参数类型

- `AgentEndpoint` 枚举新增 `runCommand = '/api/agent/run-command'`
- 新增 `RunCommandParams` 接口：`{ command: string; cwd?: string; timeout_ms?: number }`

### 2. `src/backend/middleware.ts` — 注册路由 + 可选鉴权

- `RouteEntry` 接口新增可选字段 `requiresProvider?: boolean`（默认 `true`）
- `handleRequest` 中将 provider/apiKey 检查包在 `if (route.requiresProvider !== false)` 里
- 导入 `handleRunCommand`，注册路由：`[AgentEndpoint.runCommand]: { handler, streaming: false, requiresProvider: false }`

### 3. `src/backend/handlers.ts` — 新增 handleRunCommand

非流式 handler，返回 `Promise<unknown>`：
- 从 params 解构 `command`, `cwd`, `timeout_ms`（默认 30s）
- 调用 `checkCommandSafety(command)` 拦截危险命令
- 用 `child_process.exec` 执行命令（Windows: `cmd /c`，其他: `sh -c`）
- Promise.race 超时控制
- 返回 `{ ok, stdout, stderr, exitCode, method: 'backend' }`
- `checkCommandSafety` 逻辑从 `src/skills/code-tools.ts` 复制到后端（DANGEROUS_PATTERNS 数组 + 检查函数）

### 4. `src/skills/code-tools.ts` — tryRunCommand 改走后端

- `tryRunCommand` 函数体替换为：`fetch` 调用 `/api/agent/run-command`
- 不需要 provider/apiKey，直接发 `{ provider: null, apiKey: null, params: { command, cwd, timeout_ms } }`
- 前端 `checkCommandSafety` 保留作为 UX 层（提前拦截，不发网络请求）
- 返回格式不变：`{ ok, stdout, stderr, exitCode, method }`

### 5. 不改动的文件

- `src/pages/float/chat-mode.tsx` — 浮窗会话管理，本次无关
- `src/stores/chat-store.ts` — 调用链不变
- `src/services/chat-service.ts` — `awaitingConfirmation` 确认弹窗不变

## 验证

1. TypeScript 编译无新错误
2. 浮窗发送需要 shell 命令的消息，确认不再报 `shell.execute not allowed`
3. 确认 `checkCommandSafety` 在后端生效（尝试 `rm -rf` 应被拦截）
4. 确认超时控制生效
