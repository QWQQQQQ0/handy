# Chat 路由重构 + CodeAgent 实现计划

## Context

当前 Chat LLM 身兼两职：直接执行工具（web_search、run_command 等）+ 路由到 Agent。导致 LLM 不知道何时该自己干、何时该委托。目标是让 Chat 成为轻量路由器，将文件/代码/Shell 工具移到新建的 CodeAgent，web_search/web_fetch 移到 WebGateway。

## 改动清单

### 1. 新建 CodeGateway（参照 WebGateway 模式）

**新建文件**: `src/services/code-agent/code-gateway.ts`

- 复制 `web-gateway.ts` 结构
- toolFilter: `run_command`, `read_file`, `write_file`, `glob`, `search_files`, `generate_code`, `generate_project`, `execute_code`, `iterate_code`, `save_code`, `list_code`, `think`, `request_user_input`, `code_done`, `finalize`
- agentType: `'code'`
- 不需要 browser status check

**新建文件**: `src/services/code-agent/index.ts`

- barrel export

### 2. 添加 codeAgent 后端端点

**修改**: `src/api/types.ts`
- AgentEndpoint 新增 `codeAgent = '/api/agent/code-agent'`

**修改**: `src/backend/handlers.ts`
- 新增 `handleCodeAgent` — streaming，用 `executeStream` + `ModelScenario.codeAgent`

**修改**: `src/backend/middleware.ts`
- routes 表新增 codeAgent 条目

### 3. 添加 ModelScenario.codeAgent

**修改**: `src/services/llm-gateway/gateway.ts`
- enum 新增 `codeAgent = 'codeAgent'`
- MAX_TOKENS 新增 `[ModelScenario.codeAgent]: 32000`
- buildSystemPrompt 新增 case，读取 `systemPrompts.codeAgent`

### 4. 添加系统提示

**修改**: `src/config/system-prompts.json`
- 新增 `codeAgent` key，内容类似：
  > "你是代码助手，能帮助用户完成文件操作、代码生成、Shell 命令执行等任务。使用可用工具完成任务，调用 code_done 报告完成。run_command 执行前先说明命令的作用。"

### 5. 更新 TaskAgentType 和 runner

**修改**: `src/services/multi-agent/types.ts`
- TaskAgentType 新增 `'code'`

**修改**: `src/services/task-agent/runner.ts`
- endpoint 映射新增 `agentType === 'code'` → `AgentEndpoint.codeAgent`
- base tools 新增 code: `think`, `request_user_input`, `code_done`, `finalize`

**修改**: `src/services/task-agent/tools.ts`
- TASK_TOOLS 新增 `code_done` 定义
- TASK_AGENT_TOOLS 新增 `code` 条目

### 6. 更新 Chat 路由

**修改**: `src/stores/chat-store.ts`
- `DESKTOP_CHAT_TOOLS` 移除: `run_command`, `read_file`, `write_file`, `glob`, `search_files`, `web_search`, `web_fetch`, `generate_code`, `generate_project`
- 保留: `list_skills`, `toggle_skill`, `list_models`, `switch_model`, `add_model`, `update_model`, `get_settings`, `update_settings`, `list_watchers`
- `request_agent` enum 从 `['document', 'desktop', 'web']` 改为 `['document', 'desktop', 'web', 'code']`
- description 更新，明确每个 agent 的职责
- routing 新增 `selectedAgent === 'code'` → CodeGateway dispatch

### 7. WebGateway 工具集扩展

**修改**: `src/services/web-agent/web-gateway.ts`
- toolFilter 新增 `web_search`, `web_fetch`, `web_get_interactive`, `web_navigate`, `web_click`, `web_fill`, `web_scroll`, `web_close`

## 文件变更汇总

| 文件 | 操作 |
|------|------|
| `src/services/code-agent/code-gateway.ts` | 新建 |
| `src/services/code-agent/index.ts` | 新建 |
| `src/api/types.ts` | 修改 (新增 endpoint) |
| `src/backend/handlers.ts` | 修改 (新增 handler) |
| `src/backend/middleware.ts` | 修改 (新增 route) |
| `src/services/llm-gateway/gateway.ts` | 修改 (新增 scenario) |
| `src/config/system-prompts.json` | 修改 (新增 prompt) |
| `src/services/multi-agent/types.ts` | 修改 (新增 type) |
| `src/services/task-agent/runner.ts` | 修改 (新增 endpoint + base tools) |
| `src/services/task-agent/tools.ts` | 修改 (新增 code_done + agent tools) |
| `src/stores/chat-store.ts` | 修改 (精简工具 + 新增路由) |
| `src/services/web-agent/web-gateway.ts` | 修改 (扩展工具集) |

## 验证

1. Chat 页面发送"帮我读一下 config.json" → 应路由到 CodeAgent
2. Chat 页面发送"搜一下 TypeScript 教程" → 应路由到 WebGateway
3. Chat 页面发送"你好" → Chat 直接回复，不经过 Agent
4. Chat 页面发送"切换模型" → Chat 直接用系统配置工具处理
5. 确认 Chat 的工具列表不再包含 file/code/web 工具
