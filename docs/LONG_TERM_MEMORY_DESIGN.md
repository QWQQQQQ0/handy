# 自动长期记忆压缩机制 — 设计文档

> 创建时间: 2026-06-23

## 背景

原有记忆系统存在以下问题：
1. **localStorage 存储** — 容量受限，清浏览器数据即丢失
2. **无压缩机制** — 20 条硬上限，旧记忆直接丢弃，无 LLM 总结
3. **无时间衰减** — 所有记忆同等重要，无遗忘机制
4. **无自动触发** — 完全依赖 LLM 主动调用 `agent_memory_update`，LLM 经常忘记

## 架构设计

### 三层记忆模型

```
Layer 0: 原始对话 (messages 表 — 已有)
  新增字段 is_summarized INTEGER DEFAULT 0 标记是否已参与过压缩

Layer 1: 每日记忆快照 (新表 daily_memory_snapshots)
  - 每天首次打开 → LLM 压缩未归纳对话 + 前一天摘要 → 存入
  - 每条约 800 字

Layer 2: 活跃记忆 (新表 long_term_memory)
  - 用户画像 (type='user_profile'): 持久保留，importance 高
  - 任务历史 (type='task_history'): 自然衰减，有限条数
  - 注入 system prompt，分段上限：
    · 用户画像 ≤ 1000 字（约 350 tokens）
    · 任务历史 ≤ 3000 字（约 1000 tokens）
    · 合计 ≤ 4000 字（约 1500 tokens）

  分类表:
  ├── user_profile     — 长期稳定（用户名、语言偏好、工作目录、常用应用、偏好工具）
  └── task_history     — 衰减记忆（近期项目、完成的任务、经验教训）
```

### 压缩流程

```
App 启动
  ↓
检查 daily_memory_snapshots → 今天是否已有快照？
  ↓ 无
查询 messages 表 → is_summarized=0 的消息（min 3条）
  ↓
查询 daily_memory_snapshots → 最近 1 条 (昨天的摘要)
  ↓
构建压缩 prompt → LLM 调用
  ↓
解析 JSON 结果 → 写入 daily_memory_snapshots
  ↓
标记 messages.is_summarized=1
  ↓
更新 long_term_memory (合并 user_profile + 更新 task_history)
  ↓
清除 system prompt 缓存 → 下次请求立即生效
```

### System Prompt 注入

```
buildSystemPromptMemory() → 从 long_term_memory 表读取:
  1. "## 用户画像" (type=user_profile 条目) — ≤ 1000 字
  2. "## 近期活动摘要" (type=task_history，按 importance 排序，含时间衰减) — ≤ 3000 字
  合计 ≤ 4000 字
```

5 分钟内存缓存，避免每次消息都查询 DB。压缩或画像更新后自动失效。

## 遗忘机制

1. **递归压缩自然衰减**: 每天的 daily_summary 参与下一天压缩 → 旧信息逐步被新信息稀释
2. **importance 时间衰减**: 超过 7 天未提及 → importance -2; 超过 30 天 → importance -5
3. **硬上限淘汰**: task_history 超过 20 条 → 删除最低 importance 的最旧条目
4. **用户画像保护**: user_profile 不参与时间衰减，除非 LLM 在压缩时判断已失效

## 压缩 Prompt

LLM 收到以下 prompt 进行每日压缩：

```
你是一个记忆压缩器。请将输入内容压缩成结构化摘要。

## 输入
1. 用户画像（来自 agent_memory_update，只读，不要修改）
2. 昨天的记忆摘要
3. 今天的新对话（未归纳）

## 输出格式（严格 JSON）
{
  "user_profile": [
    {"content": "用户偏好中文交流", "importance": 9},
    {"content": "工作目录是 D:/projects", "importance": 8}
  ],
  "task_history": [
    {"date": "2026-06-21", "importance": 7, "content": "修复了桌面自动化截图颜色问题"},
    {"date": "2026-06-20", "importance": 3, "content": "测试了 Web Agent 功能"}
  ],
  "daily_summary": "今天用户主要做了..."
}

## 压缩规则
- user_profile: 只记录长期有效的用户偏好/事实。已失效要删除。最多 10 条（注入上限 1000 字）。
- task_history: 每条必须有 date 和 importance(1-10)。同类话题合并。最多 20 条（注入上限 3000 字）。
  * importance 1-3: 琐碎信息，可以丢弃
  * importance 4-7: 值得记录，但可被更新的信息替换
  * importance 8-10: 重要信息，长期保留
- daily_summary: 不超过 800 字。用于明天输入。
- 丢弃: 调试失败、工具报错、重复操作、空泛对话
```

## 工具设计

### agent_memory_update（改造）

原有工具写入 localStorage，现在改为写入 `long_term_memory` 表 (type='user_profile')。LLM 在对话中识别到用户偏好信息时调用此工具。

参数: content, reason, importance(1-10, 默认8), action('update'|'delete')

### recall_memory（新增）

让 LLM 主动搜索长期记忆。参数设计参考 `search_chat_history` 保持一致：

| 参数 | 类型 | 说明 |
|------|------|------|
| keyword | string | 搜索关键词（模糊匹配） |
| type | enum | user_profile / task_history / all |
| days | number | 最近 N 天 |
| limit | number | 返回条数（默认 10，最大 30） |

## 关键文件清单

| 文件 | 操作 | 说明 |
|------|------|------|
| `src/db/index.ts` | 修改 | 新增 DDL + 迁移 (is_summarized) |
| `src/services/memory-compressor.ts` | **新建** | 核心压缩服务 (单例) |
| `src/skills/code-tools/memory.ts` | 重写 | 从 localStorage 切换到 DB |
| `src/skills/code-tools/memory-recall.ts` | **新建** | recall_memory 工具处理器 |
| `src/skills/code-tools/index.ts` | 修改 | 注册 recall_memory 工具 + 分发 |
| `src/stores/chat-store.ts` | 修改 | 工具集中添加 recall_memory |
| `src/api/client.ts` | 修改 | injectSystemPrompt 改为 async，注入长期记忆 |
| `src/components/app-init-wrapper.tsx` | 修改 | 每日压缩触发（延迟 3s 后台执行） |
| `src/config/system-prompts.json` | 修改 | Chat prompt 增加记忆管理指令 |
| `src/services/agent-memory.ts` | 保留 | 旧 localStorage 代码保留作为兜底 |

## DB 表结构

### daily_memory_snapshots

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| date | TEXT UNIQUE | "2026-06-22" |
| summary_json | TEXT | LLM 输出的完整 JSON |
| compressed_text | TEXT | 用于下次压缩的纯文本摘要 |
| model | TEXT | 使用的模型名 |
| token_count | INTEGER | 估算 token 数 |
| conversation_count | INTEGER | 压缩了多少条对话 |
| created_at | TEXT | 创建时间 |

### long_term_memory

| 列 | 类型 | 说明 |
|----|------|------|
| id | TEXT PK | UUID |
| type | TEXT | 'user_profile' or 'task_history' |
| content | TEXT | 记忆内容 |
| importance | INTEGER | 1-10 重要性评分 |
| source_date | TEXT | 来源日期 |
| hit_count | INTEGER | 被引用次数 |
| last_updated_at | TEXT | 最后更新时间 |
| created_at | TEXT | 创建时间 |

## 验证方案

1. **DB 迁移**: 启动应用，检查 SQLite 中 `daily_memory_snapshots` 和 `long_term_memory` 表
2. **压缩流程**: 确保有 ≥3 条未归纳消息 → 重启应用 → 等 3 秒 → 检查 `daily_memory_snapshots` 新记录
3. **System prompt 注入**: 发送消息，检查网络请求中 system prompt 是否包含 "## 用户画像" 或 "## 近期活动摘要"
4. **recall_memory 工具**: 对话中问 "我之前有什么偏好" → LLM 应调用 recall_memory
5. **agent_memory_update 兼容**: 对话中说 "记住我喜欢用暗色主题" → LLM 调用 agent_memory_update → 检查 `long_term_memory` 表
6. **localStorage 迁移**: 手动往 localStorage 写 `handy_agent_memories` → 启动 → 检查数据是否迁移到 `long_term_memory`
