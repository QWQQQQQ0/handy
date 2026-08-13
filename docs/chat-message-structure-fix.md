# 对话消息结构修复

> 日期: 2026-07-02 | 关联 memory: [[chat-message-structure-fix]]

## 一句话

修复 Agent 多轮工具调用后 context 组装时 assistant/tool 消息结构错乱导致 Anthropic API 400 的问题。

## 核心思路

**问题本质**：Anthropic 适配器把 `role: 'tool'` 映射为 `role: 'user'`，多个连续 tool 消息 → 多个连续 user 消息 → 违反严格交替 → API 报错。

**修复策略**：
1. 源头消除：去掉 `truncateToolResult` 注入的额外 user 消息，截图合入 tool 消息
2. 适配器兜底：Anthropic 适配器合并连续 tool_result 到单个 user 消息

## 修改文件清单

| 文件 | 改动类型 | 关键行 |
|------|---------|--------|
| `src/utils/content.ts` | 去掉 fullUserMessage 生成逻辑 | 36-60 |
| `src/adapters/anthropic.ts` | 重写 convertMessagesForAnthropic，合并 tool_result + 校验 | 175-320 |
| `src/stores/chat-store.ts` | 清理 fullUserMessage（3处）+ 截图合入 tool 消息 | ~1190, ~1488, ~1687 |
| `src/services/chat-service.ts` | 修复 toolCallId 映射 + 清理 fullUserMessage | 66, 276 |
| `src/services/agent-loop.ts` | 清理 fullUserMessage | 179 |
| `src/services/desktop-automation-agent.ts` | 清理 fullUserMessage（2处） | 367, 522 |
| `src/services/task-agent/runner.ts` | 清理 fullUserMessage（2处） | 347, 401 |
| `src/services/web-automation-agent.ts` | 清理 fullUserMessage | 263 |
| `src/services/agent/plan-executor.ts` | 清理 fullUserMessage | 232 |

## Anthropic 适配器改动细节

```
旧逻辑:
  每个 role:'tool' → 独立 user(tool_result) → N个tool = N个连续user → 报错

新逻辑:
  tool 消息收集到 buffer → 遇非tool消息时 flush → 单个user(多个tool_result block)
  
示例: [assistant, tool(A), tool(B), assistant, tool(C)]
  → [assistant, user(tool_result:A + tool_result:B), assistant, user(tool_result:C)]
```

同时加了序列校验（console.warn 连续相同 role），方便排查。

## 如果要继续改

### 已知残留问题
1. `_internal` 标记不持久化 — `_saveMsgToDb` 只存 `agent_internal`，重启后标记丢失
2. 消息序列校验只在 Anthropic 适配器 — 可考虑在 chat-store 的 `historyMsgs` 构建时加通用校验
3. `chat-service.ts` 是老路径，可能需要对照主路径（chat-store.ts）同步更新

### 调试技巧
- Console 搜 `[anthropic] ⚠️` 看序列校验告警
- 搜 `[chat-store] Sending to LLM` 看实际发出的消息结构
- `historyMsgs` 构建在 `chat-store.ts:925-945`
