# 后端生产化进度

## 已完成

### 1. 文件上传能力（主应用 / 浮窗 / FreeAgent）
- `message-input.tsx`：新增 `FileAttachment` 类型、📎 按钮、`processFiles()`、`FilePreview` 组件、`compact` 模式
- `chat-panel.tsx`：内部改用 `<MessageInput>` 替代 ad-hoc 输入区域
- `types/chat.ts`：`onSend` 签名统一为 `(content: MessageContent)`
- `free-agent.tsx` / `apps.tsx` / `refine-panel.tsx`：适配新签名
- `chat-mode.tsx`：浮窗启用 `compact` + `allowFileUpload`
- Tauri 环境：📎 按钮 → 原生文件对话框 → 获取完整路径 → 传给 LLM
- LLM 通过 `read_file` 工具按需读取文件

### 2. grep_files 增强
- `path` 支持直接传文件路径（有扩展名自动走单文件模式）
- 返回 `block: { start_line, end_line }` — 匹配行所在段落/代码块边界
- `context_lines` 默认值 2（之前 0）
- 每层策略失败原因详细输出（ok / exit / stderr）

### 3. glob_files 增强
- 默认搜索根目录改为用户 home（不再是无用的项目目录）
- `dir` 策略：提取文件名过滤传给 `dir` 命令，支持中文
- 策略 0：`es.exe`（Everything Search，毫秒级，需安装）
- 删除了策略 3（JS 全量递归扫描，太慢）

### 4. 中文编码修复（根因）
- **根因**：`middleware.ts` 的 `parseBody` 使用 `toString('utf-8')` 硬编码
- Windows 的 fetch/curl 发 GBK body → 被当 UTF-8 解码 → 中文全烂
- **修复**：先 UTF-8 解码并 `JSON.parse`，失败则 GBK 解码再 `JSON.parse`
- 这条修好了 dev 和 prod 的中文搜索问题

### 5. 生产后端 standalone 服务器
- 新增 `src/backend/server-entry.ts` — 独立后端入口（含 CORS 头）
- 新增 `scripts/build-backend.cjs` — esbuild 打包后端为单文件
- 输出：`dist-backend/server.cjs`（构建时自动复制到 exe 同目录）
- `handleRunCommand` 改为 `encoding: 'buffer'` + `TextDecoder('gbk')` 解码
- 移除了 `chcp 65001` 前缀（buffer 模式不需要）

### 6. Tauri 集成
- `lib.rs`：启动时 spawn `node dist-backend/server.cjs`
- `tauri.conf.json`：`beforeBuildCommand` 含后端构建
- `app-init-wrapper.tsx`：生产环境设 `setApiBaseUrl('http://localhost:5174')`
- `Cargo.toml`：`log` crate 记录后端启动日志

## 当前问题（待修复，下次窗口）

### P0：点击 exe 弹出 cmd 窗口
- 现象：启动 app.exe 时附带弹出一个 cmd 窗口
- 原因：Rust 的 `Command::new("node.exe")` 在 Windows GUI 应用下默认创建控制台窗口
- 修复方向：`creation_flags(CREATE_NO_WINDOW)` 或使用 `std::process::Stdio::null()`

### P1：后端服务被测试请求打挂
- 现象：前端 `glob_files` 成功后，后端 node.exe 进程退出
- 待排查：服务端有没有 crash 日志、是否是 OOM 或未捕获异常

### P2：Tauri 日志文件未生成
- 现象：`%APPDATA%/com.handy.app/` 下没有 .log 文件
- `tauri-plugin-log` 已配置 `level: Info`，但似乎没写文件
- 待查：是否需要额外配置日志文件路径

### P3：Vite dev 模式下 dir 命令超时（已知限制）
- 生产无影响，dev 环境特性

### P4：生产环境保留 devtools 能力
- 需求：特殊按键组合（如 Ctrl+Shift+F12）打开 WebView 控制台
- 方向：Tauri 窗口配置 `devtools: true`（当前）仅在 dev 生效
- 生产需要监听全局快捷键 → `window.open_devtools()`
- 独立后端 `node dist-backend/server.cjs`：7.6 秒完成
- Vite dev server 内：30 秒超时
- 根因：Vite 事件循环阻塞 `exec` 的 pipe 消费
- 生产无影响

## 关键文件清单

| 文件 | 改动性质 |
|---|---|
| `src/components/chat/message-input.tsx` | 新增文件上传 + compact |
| `src/components/chat/chat-panel.tsx` | 改用 MessageInput |
| `src/types/chat.ts` | onSend 签名统一 |
| `src/pages/free-agent.tsx` | 适配 MessageContent |
| `src/pages/apps.tsx` | 适配 MessageContent |
| `src/pages/float/chat-mode.tsx` | compact + allowFileUpload |
| `src/components/recorder/refine-panel.tsx` | 适配新签名 |
| `src/backend/middleware.ts` | parseBody GBK fallback（根因修复）|
| `src/backend/handlers.ts` | encoding=buffer + GBK decode |
| `src/backend/server-entry.ts` | **新增** 生产后端入口 + CORS |
| `src/backend/standalone-server.ts` | **新增** 独立服务器（测试用，可删）|
| `scripts/build-backend.cjs` | **新增** 后端打包脚本 |
| `scripts/server.cjs` | **新增** 开发用的 backend 启动器 |
| `src/skills/code-tools/shell-utils.ts` | shell search 优化、错误日志 |
| `src/skills/code-tools/file-search.ts` | context_lines 默认值 |
| `src/skills/code-tools/index.ts` | grep_files 描述更新、returns 字段 |
| `src/components/app-init-wrapper.tsx` | 生产 API base URL |
| `src-tauri/src/lib.rs` | 启动时 spawn backend |
| `src-tauri/Cargo.toml` | log crate |
| `src-tauri/tauri.conf.json` | beforeBuildCommand 含后端 |

## 测试验证

```bash
# 独立后端测试（应 7-8 秒完成）
node dist-backend/server.cjs
curl -X POST http://localhost:5174/api/agent/run-command -H "Content-Type: application/json" \
  -d '{"provider":{},"apiKey":"","params":{"command":"dir /s /b 固定资产.xlsx 2>nul","cwd":"C:\\Users\\吴清","timeout_ms":30000}}'

# 生产 exe
D:\software\vscodeFiles\selfTool\openpaw-js\src-tauri\target\release\app.exe
# 检查后端：netstat -ano | grep 5174
# 检查进程：Get-Process node
```
