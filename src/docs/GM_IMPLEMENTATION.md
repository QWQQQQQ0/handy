# AI GM (Game Master) Agent 实施方案

## 目标

在 OpenPaw 系统内内置一个 GM 角色 AI，负责：
- **监控**整个项目的进展
- **拆解**用户模糊目标为可执行子任务
- **调度**现有自动化 agent（Desktop/Web）执行具体操作
- **追踪**任务状态，处理阻塞，汇报结果

---

## 架构定位

GM Agent 是现有 agent 体系的**上层编排器**，不直接操控设备，而是调度底层 agent：

```
用户目标 → GM Agent
              ├─ 任务拆解
              ├─ 进度追踪
              └─ 子任务调度 → DesktopAutomationAgent / WebAutomationAgent
                                  └─ DesktopScreenSkill / WebScreenSkill
```

---

## 实施步骤

### 第一步：数据层

#### 1.1 数据库表

在 `src/db/index.ts` 的 DDL 中新增 tasks 表：

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  parent_id TEXT,
  agent_type TEXT,
  goal TEXT,
  result_summary TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

status 取值：`pending | in_progress | completed | blocked | failed`

#### 1.2 Task Store

新建 `src/stores/task-store.ts`（Zustand + immer）：

```typescript
interface Task {
  id: string;
  title: string;
  description?: string;
  status: 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed';
  parentId?: string;
  agentType?: 'desktop' | 'web' | 'manual';
  goal?: string;
  resultSummary?: string;
  createdAt: string;
  updatedAt: string;
}

interface TaskState {
  tasks: Task[];
  loading: boolean;
  error: string | null;
  load: () => Promise<void>;
  create: (task: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  update: (id: string, patch: Partial<Task>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  childrenOf: (parentId?: string) => Task[];
  rootTasks: () => Task[];
}
```

---

### 第二步：GM Skill

新建 `src/skills/gm.ts`，实现 `Skill` 接口，提供以下工具：

| 工具名 | 用途 | 参数 |
|---|---|---|
| `gm_create_task` | 创建子任务 | title, description?, parentId? |
| `gm_list_tasks` | 列出所有任务及状态 | status? (筛选) |
| `gm_update_task` | 更新任务状态 | taskId, status?, resultSummary? |
| `gm_delegate` | 委托子 agent 执行 | taskId, agentType, goal |
| `gm_summarize` | 生成项目进度摘要 | — |
| `gm_ask_user` | 向用户提问/确认 | question |
| `gm_done` | 标记目标完成 | message |

**关键设计：** `gm_delegate` 内部调用 `DesktopAutomationAgent` 或 `WebAutomationAgent`，将执行结果写回对应 task。

---

### 第三步：GM Agent

新建 `src/services/gm-agent.ts`，复用现有 agent 循环模式：

```typescript
class GMAgent {
  executeCommand(params: {
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    maxTurns?: number;
    onStep?: AgentStepCallback;
  }): Promise<AgentTurn[] | null>;
}
```

**循环逻辑：**
1. 收到用户目标 → 调用 LLM 拆解为子任务列表
2. 逐个执行子任务（遇到 `gm_delegate` 时调用子 agent）
3. 每轮汇报进度
4. 所有子任务完成或阻塞 → 调用 `gm_summarize` 生成摘要

#### 3.1 新增场景

在 `src/adapters/model-call-service.ts` 中：
- `ModelScenario` 枚举加 `gm = 'gm'`
- `MAX_TOKENS_PER_SCENARIO` 加 gm: 32000（长上下文）

#### 3.2 System Prompt

在 `src/config/system-prompts.json` 中新增 `gm` 条目：

```
You are an AI project manager (GM) for the OpenPaw automation system.
Your goal is: {goal}

You have access to these tools:
- gm_create_task: break down the goal into subtasks
- gm_list_tasks: check current task status
- gm_update_task: update task progress
- gm_delegate: assign a subtask to a desktop/web automation agent
- gm_summarize: produce a progress summary
- gm_ask_user: ask the user for clarification
- gm_done: mark the overall goal as complete

Workflow:
1. Analyze the goal and create a task breakdown with gm_create_task
2. For each actionable subtask, use gm_delegate to execute it
3. Track progress with gm_list_tasks and gm_update_task
4. If blocked or unclear, use gm_ask_user
5. When all tasks are done, use gm_summarize and gm_done
```

---

### 第四步：GM 页面 UI

新建 `src/pages/gm.tsx`，参考 `src/pages/desktop.tsx` 的布局模式：

```
┌──────────────────────────────────────────┐
│  ← GM 面板                    [刷新]     │
├──────────────────────────────────────────┤
│  ┌─ 任务树 ─────────────────────────┐    │
│  │  ├ 目标: xxx          [done]     │    │
│  │  │  ├ 子任务1          [done]    │    │
│  │  │  ├ 子任务2        [in_prog]   │    │
│  │  │  └ 子任务3         [pending]  │    │
│  └──────────────────────────────────┘    │
│                                          │
│  ┌─ 操作日志 ─────────────────────────┐  │
│  │  ✓ gm_create_task("子任务1")       │  │
│  │  ✓ gm_delegate(子任务1)            │  │
│  │  ✓ desktop_click(100, 200)        │  │
│  └──────────────────────────────────┘    │
├──────────────────────────────────────────┤
│  [目标输入框________________] [Go] [Stop]│
└──────────────────────────────────────────┘
```

核心交互：
- 输入目标 → 点击 Go → GM Agent 开始执行
- 任务树实时更新状态
- 操作日志展示每一步 action
- Stop 按钮中断执行

---

### 第五步：集成

#### 5.1 路由

在 `src/router.tsx` 中：
- 新增 lazy import: `const GMPage = lazy(() => import('@/pages/gm'));`
- 新增路由: `{ path: '/gm', element: <GMPage /> }`

#### 5.2 侧边栏

在 `src/components/app-shell.tsx` 的 `navItems` 中添加：
```typescript
{ icon: <Gamepad2 size={20} />, label: 'GM', to: '/gm', show: isDesktopLike },
```

---

## 文件清单

| 操作 | 文件 | 说明 |
|---|---|---|
| 新增 | `src/stores/task-store.ts` | 任务持久化 store |
| 新增 | `src/skills/gm.ts` | GM 技能 + 工具实现 |
| 新增 | `src/services/gm-agent.ts` | GM agent 循环 |
| 新增 | `src/pages/gm.tsx` | GM 页面 UI |
| 修改 | `src/db/index.ts` | DDL 加 tasks 表 + TaskRow 类型 |
| 修改 | `src/db/types.ts` | 加 TaskRow 类型 |
| 修改 | `src/adapters/model-call-service.ts` | 加 gm 场景 |
| 修改 | `src/config/system-prompts.json` | 加 gm prompt |
| 修改 | `src/router.tsx` | 注册 /gm 路由 |
| 修改 | `src/components/app-shell.tsx` | 侧边栏加 GM 入口 |

---

## 验证方式

1. 启动 dev server，侧边栏出现 GM 入口
2. 点击进入 GM 页面，输入目标 "检查桌面是否有未读消息"
3. GM agent 拆解任务 → 创建子任务树 → 委托 desktop agent 截图/点击
4. 操作日志和任务树实时更新
5. 最终生成摘要并标记完成
