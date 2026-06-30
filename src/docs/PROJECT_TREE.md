# Handy 项目目录树

> 每个文件一行说明，排除 node_modules/.next/out/dist/.git/target 等自动生成目录

---

## 项目概述

Handy 是一个 **AI 驱动的桌面自动化助手**，通过自然语言指令控制桌面应用、浏览器和手机。

**技术栈**：
- 前端：React + Vite SPA + TypeScript + Zustand + Tailwind
- 桌面端：Tauri (Rust) + Windows UIA
- 自动化后端：Python + Playwright
- LLM：OpenAI / Anthropic / Google Gemini (可切换)

**核心能力**：
1. 自然语言理解用户意图
2. 截图 + 视觉分析定位 UI 元素
3. 自动化执行鼠标/键盘操作
4. 屏幕监控和定时任务
5. 学习应用 UI 能力并复用
6. 网络搜索与网页抓取 (DuckDuckGo + Playwright/httpx 双策略)
7. Playwright 脚本沙箱执行 (LLM 生成 Python 代码 → 沙箱执行 → 返回结果)
8. 文档自动化 Agent (Word/Excel/PPT 读取、编辑、生成，与桌面自动化 Agent 同级)

---

## 根目录配置
、
```
handy/
├── package.json                  -- 项目依赖与脚本
├── package-lock.json             -- 依赖锁文件
├── vite.config.ts                -- Vite 构建配置
├── tsconfig.json                 -- TypeScript 配置
├── tsconfig.tsbuildinfo          -- TS 构建缓存
├── index.html                    -- SPA 入口
├── eslint.config.mjs             -- ESLint 配置
├── next.config.ts                -- Next.js 配置 (逐步废弃)
├── next-env.d.ts                 -- Next.js 类型声明
├── .gitignore                    -- Git 忽略配置
├── README.md                     -- 项目说明
├── AGENTS.md / CLAUDE.md         -- AI Agent 规则
├── 系统修复进度.md               -- 系统修复记录
```

---

## src/ -- 前端源码

### 入口

```
src/
├── main.tsx                      -- React 入口，初始化全局状态
├── router.tsx                    -- 路由表 (React Router)
├── index.css                     -- 全局 CSS
```

### src/app/ -- Next.js App Router 页面 (逐步迁移到 Vite SPA)

```
src/app/
├── favicon.ico                   -- 网站图标
├── layout.tsx                    -- 根布局
├── page.tsx                      -- 主聊天页面
├── loading.tsx                   -- 路由切换加载动画
├── globals.css                   -- 全局样式: Tailwind, 亮暗主题变量
├── desktop/page.tsx              -- 桌面自动化页面
├── float/page.tsx                -- 浮动助手窗口
├── models/page.tsx               -- 模型提供商配置
├── settings/page.tsx             -- 设置页面
├── skills/page.tsx               -- 技能浏览页面
├── web/page.tsx                  -- Web 自动化页面
```

### src/pages/ -- Vite SPA 页面

```
src/pages/
├── chat.tsx                      -- 聊天页：LLM 流式对话，支持工具调用 + knowledge_skill 路由 ★
├── desktop.tsx                   -- 桌面自动化页：截图、目标输入、执行
├── float/                        -- 浮窗模块 (Tauri 悬浮窗口，核心交互入口)
│   ├── index.tsx                 -- 主壳：标题栏、tab 栏、模式路由
│   ├── utils.ts                  -- localStorage 工具函数
│   ├── types.ts                  -- 浮窗类型定义 (FloatMode, ActionLog)
│   ├── chat-mode.tsx             -- Chat 模式：LLM 流式对话，命令确认 + knowledge_skill 路由 ★
│   ├── task-mode.tsx             -- Task 模式：桌面自动化执行，实时日志
│   ├── watcher-mode.tsx          -- 后台任务模式：定时/监控管理
│   └── learn-mode.tsx            -- Learn 模式：UI 能力学习 (半自动/级联/受控浏览)
├── web.tsx                       -- Web 自动化页：Playwright 浏览器控制
├── phone.tsx                     -- 手机控制页 (占位)
├── models.tsx                    -- 模型配置管理：Provider CRUD
├── skills.tsx                    -- 技能管理：创建、编辑、删除技能
├── settings.tsx                  -- 设置页：主题、语言、工具偏好
├── apps.tsx                      -- 项目页：项目列表、文件树、代码编辑器、HTML 预览、内嵌 Chat (多轮工具调用)
├── watchers.tsx                  -- 后台任务管理页 (/scheduled-tasks)：查看、编辑、删除
├── knowledge.tsx                 -- 页面知识库：存储页面元素信息
├── agents.tsx                    -- Agent 管理页
├── tasks.tsx                     -- 任务管理页：查看、编辑、删除任务
├── free-agent.tsx                  -- FreeAgent 页：全能力 AI 开发者，左侧对话 + 右侧预览
```

### src/types/ -- 类型定义

```
src/types/
├── index.ts                      -- Barrel 导出
├── message.ts                    -- 消息类型 (角色、内容、状态)
├── provider.ts                   -- LLM Provider 类型 (OpenAI, Anthropic, Google)
├── skill.ts                      -- 技能类型 (工具、步骤、配置)
├── events.ts                     -- 事件总线类型 (agent, app, watcher 事件)
├── goal.ts                       -- 目标解析类型 (once/timer/screen_change)
├── cache.ts                      -- 缓存类型 (UI缓存/子目标缓存/技能模板)
├── scheduler.ts                  -- 调度器类型
├── watcher.ts                    -- 监控共享类型 (差异策略/工作流/区域/聊天上下文)
├── automation-template.ts        -- 自动化模板类型
├── recording-session.ts          -- 录制会话类型
├── semantic-event.ts             -- 语义事件类型
├── unified-action.ts             -- 统一动作类型 (click, type, drag 等)
├── unified-data.ts               -- 统一数据类型
├── unified-element.ts            -- 统一元素类型 (视觉/UIA/DOM 元素)
├── page-component.ts             -- 页面组件类型
```

### src/adapters/ -- LLM 适配器 + 平台适配器

```
src/adapters/
├── types.ts                      -- LLMAdapter 接口 (统一的 LLM 调用规范)
├── openai.ts                     -- OpenAI 适配器
├── anthropic.ts                  -- Anthropic 适配器
├── google.ts                     -- Google Gemini 适配器
├── model-call-service.ts         -- 向后兼容层 (委托到 LlmGateway)
├── platform-adapter.ts           -- 平台适配器接口 + 注册中心
├── dom-adapter.ts                -- 浏览器 DOM 适配器
├── uia-adapter.ts                -- Windows UIA 适配器
├── index.ts                      -- 桶文件
```

### src/agents/ -- Agent API

> 各 Agent 独立接口，前端直接调用后端 `/api/agent/{endpoint}`

```
src/agents/
├── index.ts                      -- Barrel 导出
├── intent-classifier-api.ts      -- IntentClassifierAgent：意图分类 (once/timer/screen_change)
├── verification-api.ts           -- VerificationAgent：任务完成验证 (纯文本 YES/NO)
├── chat-api.ts                   -- ChatAgent：流式聊天 (SSE)
├── code-generation-api.ts        -- CodeGenerationAgent：代码生成/迭代修复 (SSE)
├── ui-vision-api.ts              -- UIVisionAgent：截图视觉分析、语义标注、OCR 分类
├── screen-analysis-api.ts        -- ScreenAnalysisAgent：差异检测、区域发现、工作流分析
```

### src/api/ -- 前端 API Client

```
src/api/
├── index.ts                      -- Barrel 导出
├── types.ts                      -- 共享协议类型：AgentEndpoint 枚举、请求/响应/SSE 类型
├── client.ts                     -- fetch 封装：apiPost(非流式)、apiStream(SSE 事件)
```

### src/backend/ -- 后端 API Server (Vite 中间件)

```
src/backend/
├── index.ts                      -- Barrel 导出
├── vite-plugin.ts                -- Vite 插件：configureServer 挂载中间件
├── middleware.ts                  -- 请求路由：URL → handler 分发 + JSON/SSE 响应
├── handlers.ts                   -- 16 个 Handler：每个 /api/agent/{name} 一个处理函数
├── llm-executor.ts               -- 统一 LLM 调用：executeCall(非流式) / executeStream(流式)
```

### src/db/ -- 数据库层 (双 SQLite 适配器)

```
src/db/
├── adapter.ts                    -- SQLiteAdapter 接口
├── types.ts                      -- DB 行类型
├── tauri.ts                      -- Tauri 原生 SQLite 适配器
├── wasm.ts                       -- Web SQLite 适配器 (sql.js WASM)
├── index.ts                      -- DB 工厂：平台检测、DDL、迁移
```

### src/stores/ -- Zustand 状态管理

```
src/stores/
├── chat-store.ts                 -- 聊天状态：会话、消息、流式、工具模式
├── settings-store.ts             -- 设置状态：主题、语言、工具偏好
├── model-config-store.ts         -- 模型配置状态：Provider CRUD、API Key 加密
├── skill-store.ts                -- 技能状态：DB CRUD、SkillRegistry 集成、知识型技能管理 ★
├── project-store.ts              -- 项目状态：当前选中项目 (项目页内部使用)
```

### src/skills/ -- 技能系统 (AgentSkills 标准兼容)

> Skill 定义采用 AgentSkills 开放标准（SKILL.md 格式），含 Handy 扩展（tools 工具定义 + x-i18n 国际化）。
> 内置 Skill 以目录形式存放于 public/skills/<name>/SKILL.md。
> 外部知识型 Skill 从 .handy/skills/（项目级）和 ~/.handy/skills/（用户级）运行时扫描加载。
> 支持 .redirect 文件：指向任意外部 skill 目录。


> 技能是 LLM 可调用的工具，每个技能包含多个工具定义

```
src/skills/
├── skill.ts                      -- Skill 接口 + 工具格式化辅助 (toolToOpenAI)
├── executor.ts                   -- SkillExecutor：注册、分发、构建 LLM 工具列表 + LEGACY_MAP 向后兼容
├── loader.ts                     -- 技能加载器：import.meta.glob 扫描 public/skills/*/SKILL.md → 标准解析
├── standard-md-parser.ts         -- AgentSkills 标准 SKILL.md 解析/生成 (js-yaml, 含 Handy 扩展 tools + x-i18n)
├── skill-md-adapter.ts           -- SkillMdAdapter：将标准 SKILL.md 目录适配为 Skill 接口 (三级渐进加载)
├── builtin-executor.ts           -- 内置执行器工厂 + getKnowledgeSkillBody() 知识型skill查询 + CodeTools workspace 注入 ★
├── tool-disclosure.ts            -- ToolDisclosure：渐进式工具披露 (菜单→门卫→按需加载完整定义)
├── desktop.ts                    -- 桌面视觉技能：截图、点击、拖拽、键盘、OCR、窗口管理
├── desktop_uia.ts                -- 桌面 UIA 技能：语义元素操作
├── web.ts                        -- Web 自动化技能 (含 run_playwright_script 脚本沙箱)
├── phone.ts                      -- 手机控制技能
├── app-builder.ts                -- 应用构建器技能
├── office-doc.ts                 -- Office 文档生成技能
├── code-tools.ts                 -- 代码工具技能 Barrel 导出 (详见 code-tools/ 子目录)
├── system-config.ts              -- 系统配置技能：技能管理、模型管理、设置管理、后台任务管理 (Chat Agent 自配置)
├── scheduler-tools.ts            -- 任务调度技能：create_timer_task / create_screen_watcher / cancel / list (Agent 自主调度)
├── chat-tools.ts                 -- 对话+控制工具：agent_memory_update / search_chat_history / recall_memory / think / request_user_input / finalize
├── user-defined.ts               -- 用户自定义技能 (沙盒 JS / 步骤回放)
├── plugin-loader.ts              -- 插件加载器 (动态加载第三方技能插件)
├── plugins/                      -- 插件目录
│   └── example-plugin.ts         -- 示例插件
├── sources/                      -- 多源技能加载 ★
│   ├── index.ts                  -- Barrel 导出
│   ├── types.ts                  -- SkillSource 接口 + SkillManifest + KnowledgeSkillInfo
│   ├── registry.ts               -- SkillRegistry 统一注册表 (多源聚合、优先级仲裁)
│   ├── builtin-source.ts         -- BuiltinSource 包装 import.meta.glob
│   └── directory-source.ts       -- DirectorySource 运行时目录扫描 + .redirect
```

### src/skills/code-tools/ -- 代码工具子模块

> code-tools.ts 的实现模块，每个处理器一个文件
> index.ts 新增 setWorkspacePath() 方法：注入工作区根目录到 write_file/run_command 工具描述

```
src/skills/code-tools/
├── index.ts                   -- CodeToolsSkill 主类 + 工具定义 + 执行分发 + setWorkspacePath
├── helpers.ts                 -- 共享辅助：文件 I/O、代码块提取、提示构建
├── shell-utils.ts             -- Shell 工具：命令安全、执行、目录列表、文件搜索、Glob
├── file-ops.ts                -- write_file / read_file 处理器
├── code-gen.ts                -- generate_code / execute_code 处理器
├── registry.ts                -- save_code / list_code / generate_project 处理器
├── shell-cmd.ts               -- run_command 处理器
├── file-search.ts             -- grep_files / glob_files 处理器
├── web-tools.ts               -- web_search / web_fetch 处理器
└── memory.ts                  -- agent_memory_update 处理器
```

### src/services/ -- 核心服务

> 核心业务逻辑层，包含 Agent、调度、监控等关键服务

```
src/services/
├── chat-service.ts               -- 聊天服务：LLM 流式编排、工具调用分发
├── agent-loop.ts                 -- 共享 Agent 循环：流式→工具调用→执行→多轮 (chat-store 和项目 Chat 共用)
├── desktop-service.ts            -- 桌面服务：Tauri API 封装
├── extension-bridge.ts           -- 浏览器扩展桥：Chrome 扩展通信
├── web-screen-service.ts         -- Web 屏幕服务
├── model-service-singleton.ts    -- 模型服务单例 (LlmGateway)
├── cache-service.ts              -- 缓存服务：L1(UI指纹)/L2(动作序列)/L3(技能模板)
├── cache-service-singleton.ts    -- 缓存服务单例
├── intent-classifier.ts          -- 意图分类器：向后兼容层
├── task-builder.ts               -- 任务构建器
├── agent-task-service.ts         -- Agent 任务服务：顶层编排，分发给 Agent 或调度器
├── desktop-automation-agent.ts   -- 桌面自动化 Agent：三级流水线 (L3→Plan→PerTurn)
├── web-automation-agent.ts       -- Web 自动化 Agent
├── semantic-annotation-service.ts -- 语义标注服务
├── global-state.ts               -- 全局状态管理器 (用户操作上下文、任务状态、环境感知)
├── event-bus.ts                  -- 全局事件总线 (agent/app/watcher 事件)
├── app-logger.ts                 -- 应用日志器
├── global-listener.ts            -- 全局输入监听服务
├── unified-analyzer.ts           -- 统一分析器 Barrel 导出 (详见 analyzer/ 子目录)
├── unified-executor.ts           -- 统一执行引擎
├── unified-recorder.ts           -- 统一录制器 Barrel 导出 (详见 recorder/ 子目录)
├── web-recorder.ts               -- Web 录制器 (Playwright DOM 采集)
├── page-knowledge.ts             -- 页面知识库服务
├── code-gateway.ts               -- 代码生成入口 (独立文件，CodeAgent 子目录外的旧入口)
├── recorder.ts                   -- 自动化录制器
├── state-machine.ts              -- Agent 状态机
├── recovery-chain.ts             -- 失败恢复链
├── action-memory.ts              -- 动作记忆
├── agent-memory.ts               -- Agent 记忆服务 (长期记忆存储)
├── app-events.ts                 -- 应用事件服务
├── clipboard-capture.ts          -- 剪贴板捕获服务
├── temporary-task-store.ts       -- 临时任务存储
```

### src/services/recorder/ -- 统一录制器

> 多源事件采集、手势分类、去重合并、会话管理

```
src/services/recorder/
├── index.ts                   -- UnifiedRecorder 主类 + 单例导出
└── gesture-classifier.ts      -- GestureClassifier (手势分类器)
```

### src/services/analyzer/ -- 统一分析器

> 从录制会话中提取数据流、检测坐标规律、调用 LLM 生成通用自动化模板

```
src/services/analyzer/
├── index.ts                   -- UnifiedAnalyzer 主类 (组合) + 单例导出
├── types.ts                   -- LLMAnalysisResult, CoordinatePattern 类型
├── utils.ts                   -- median, variance, diffs, getScreenCoord
├── data-flow.ts               -- extractDataFlow + 辅助函数
├── coord-patterns.ts          -- 坐标模式检测、摘要、应用 + 冗余点击清理
├── prompt-builder.ts          -- LLM 提示构建 (分析/微调)
├── template-generator.ts      -- 本地模板生成 + 模式检测
└── llm-client.ts              -- LLM 调用 + JSON 解析/修复
```

### src/services/llm-gateway/ -- 统一 LLM 调用入口

```
src/services/llm-gateway/
├── gateway.ts                    -- LlmGateway：适配器管理、提示构建、缓存、长度检查
```

### src/services/capability-learner/ -- 能力学习器

> 自动探索应用 UI 能力，支持半自动、级联、受控浏览三种学习模式

```
src/services/capability-learner/
├── index.ts                      -- 主入口：生命周期管理
├── types.ts                      -- 类型定义
├── state.ts                      -- 单例状态
├── detection.ts                  -- UIA 差异检测
├── semi-auto.ts                  -- 半自动学习：截屏 + LLM 视觉分析
├── browser-learn.ts              -- 受控浏览学习：Playwright + DOM 分析
├── cascade.ts                    -- 级联学习：自动探索子组件
├── browser.ts                    -- 浏览器检测
├── vision.ts                     -- 视觉分析
├── inference.ts                  -- 能力推断
├── storage.ts                    -- 存储操作
└── classification.ts             -- LLM 分类
```

### src/services/skill-agents/ -- Skill-Agent 模块

```
src/services/skill-agents/
├── index.ts                      -- Barrel 导出
├── types.ts                      -- 接口定义
└── chatbot-agent.ts              -- 聊天机器人
```

### src/services/agent/ -- Agent 子模块

```
src/services/agent/
├── index.ts                      -- Barrel 导出
├── agent-types.ts                -- AgentContext、AgentDeps 等共享类型
├── goal-decomposer.ts            -- 目标分解器 (子目标拆分)
├── plan-executor.ts              -- 计划执行器：LLM 规划 + 验证循环
├── cache-replayer.ts             -- 缓存回放器
├── skill-matcher.ts              -- 技能匹配器 (L3 模板匹配)
├── agent-cache.ts                -- Agent 缓存辅助
├── subgoal-executor.ts           -- 子目标执行器
```

### src/services/scheduler/ -- 任务调度器

> 1s TickLoop 通用调度，支持定时任务、屏幕变化、事件监听
> action-executor 四路分发：agent_execute → TaskAgentRunner / workflow → executor-v2 / script → 沙箱 / notify → 通知

```
src/services/scheduler/
├── scheduler.ts                  -- TickLoop：1s 通用 tick 循环
├── trigger.ts                    -- Trigger 接口
├── base-watcher.ts               -- BaseWatcher 基类 (tick 生命周期)
├── screen-change-watcher.ts      -- 屏幕变化 Watcher
├── screen-change-trigger.ts      -- 屏幕变化触发器
├── timer-watcher.ts              -- 定时 Watcher
├── task-factory.ts               -- 任务工厂：TriggerConfig → Tickable
├── screen-change-source.ts       -- 屏幕变化事件源
├── action-executor.ts            -- 动作执行器 (纯分发：agent_execute / workflow / script / notify)
└── watcher-runtime-state.ts      -- Watcher 运行时状态
```

### src/services/watcher/ -- 后台任务管理与监控

```
src/services/watcher/
├── index.ts                      -- Barrel 导出
├── watcher-manager.ts            -- ScheduledTaskManager 单例 (原 WatcherManager)
├── diff-detector.ts              -- 多阶段差异检测器
├── region-capture.ts             -- 区域截图
├── region-discovery.ts           -- 自动区域发现
├── region-from-ocr.ts            -- OCR 区域发现
├── region-quality.ts             -- 区域质量追踪
├── uia-compressor.ts             -- UIA 树压缩
├── workflow-recorder.ts          -- 工作流录制器
├── workflow-executor.ts          -- 工作流回放执行器
├── workflow-executor-v2.ts       -- 工作流回放执行器 v2
├── workflow-recorder-v2.ts       -- 工作流录制器 v2
├── watcher-utils.ts              -- 工具函数
├── logger.ts                     -- 日志
```

### src/services/code-sandbox/ -- 代码沙箱

```
src/services/code-sandbox/
├── sandbox-types.ts              -- 沙箱类型
├── sandbox-js.ts                 -- JS 沙箱
├── sandbox-html.ts               -- HTML 沙箱 (iframe 沙箱执行)
├── sandbox-sql.ts                -- SQL 沙箱
├── sandbox-python.ts             -- Python 沙箱
├── python-bridge.ts              -- Python 桥接
├── index.ts                      -- 桶文件
```

### src/services/code-registry/ -- 代码注册表

```
src/services/code-registry/
├── code-registry-types.ts        -- 类型
├── code-registry-db.ts           -- DB 操作
├── index.ts                      -- 桶文件
```

### src/services/multi-agent/ -- 多 Agent 协作

```
src/services/multi-agent/
├── types.ts                      -- 共享类型 (含 TaskAgentType、TaskSplitDecision)
├── task-tree-db.ts               -- 任务树 DB
├── process-log-db.ts             -- 过程日志 DB
├── agent-message-db.ts           -- Agent 消息 DB
├── package-registry-db.ts        -- 包注册表 DB
├── recovery.ts                   -- 断点恢复
├── context-builder.ts            -- 上下文构建器
├── agent-runner.ts               -- Agent 运行器
├── orchestrator.ts               -- 编排器
├── index.ts                      -- 桶文件
```

### src/services/task-agent/ -- 桌面自动化 Task 架构

> 替代 AgentTaskService，采用 Orchestrator 模式：意图分类 → 工具筛选 → 拆分 → 执行 → 验证

```
src/services/task-agent/
├── gateway.ts                    -- TaskGateway 入口：意图分类 + 复杂度判断 + 工具筛选 + 路由
├── orchestrator.ts               -- TaskOrchestrator：4 阶段编排 (Decompose → Execute → Verify)
├── runner.ts                     -- TaskAgentRunner：LLM 工具调用循环 + SkillExecutor 委托
├── context-builder.ts            -- 上下文构建器 (user 消息构建，项目上下文由调用方注入)
├── tools.ts                      -- Task 工具集定义 (decomposer/verifier 静态，executor/doc 动态)
├── index.ts                      -- Barrel 导出
```

### src/services/doc-agent/ -- 文档自动化 Agent

> 与 task-agent 同级，专注于 Word/Excel/PPT 文档操作：读取 → LLM 处理 → 写回

```
src/services/doc-agent/
├── doc-gateway.ts                -- DocGateway 入口：工具筛选 + TaskAgentRunner 执行
├── index.ts                      -- Barrel 导出
```

### src/services/web-agent/ -- Web 浏览器 Agent

> 与 task-agent/doc-agent/code-agent 同级，处理所有浏览器相关任务：浏览、搜索、导航、元素交互、数据抓取等

```
src/services/web-agent/
├── web-gateway.ts                -- WebGateway 入口：工具筛选 + TaskAgentRunner 执行
├── index.ts                      -- Barrel 导出
```

### src/services/code-agent/ -- 代码/文件 Agent

> 与 task-agent/doc-agent/web-agent 同级，处理文件操作、代码生成、Shell 命令执行等任务
> 项目页内嵌 Chat 直接调用 AgentEndpoint.codeAgent + runAgentLoop，不经过 request_agent 路由

```
src/services/code-agent/
├── code-gateway.ts               -- CodeGateway 入口：工具筛选 + TaskAgentRunner 执行
├── index.ts                      -- Barrel 导出
```

### src/services/free-agent/ -- 全能力 AI 开发者 Agent

> 独立页面调用，全工具开放 + Python 完全访问 + ToolDisclosure 渐进式披露
> 不经过 Chat 的 request_agent 路由，页面直接调用 FreeAgentGateway

```
src/services/free-agent/
├── free-gateway.ts               -- FreeAgentGateway：全工具开放 + Python 完全访问 + 菜单注入
├── index.ts                      -- Barrel 导出
```

### src/interfaces/ -- 服务接口

```
src/interfaces/
├── cache-service.ts              -- ICacheService
├── desktop-service.ts            -- IDesktopService
├── extension-bridge.ts           -- IExtensionBridge
├── model-service.ts              -- IModelService
├── skill-executor.ts             -- ISkillExecutor
├── web-screen-service.ts         -- IWebScreenService
```

### src/core/ -- 核心智能

```
src/core/
├── skill-resolver.ts             -- 目标→技能解析器
├── skill-learner.ts              -- 技能学习器 (L2→L3 提升)
```

### src/utils/ -- 工具函数

```
src/utils/
├── platform.ts                   -- 平台检测 (Tauri/Web)
├── content.ts                    -- 消息内容序列化
├── crypto.ts                     -- AES-GCM 加密 (API Key)
├── image.ts                      -- 图片压缩 (CompressedImage)
├── coordinate-scale.ts           -- 坐标转换：压缩比例还原、窗口偏移
├── retry.ts                      -- 指数退避重试
├── save-images.ts                -- LLM 图片保存到磁盘
├── multimodal-provider.ts        -- 多模态自动切换
├── svg-path.ts                   -- SVG 路径生成
```

### src/i18n/ -- 国际化

```
src/i18n/
├── strings.ts                    -- 翻译字典 (en/zh)
```

### src/config/ -- 配置

```
src/config/
├── system-prompts.json           -- LLM 系统提示 (20 个场景)
```

### src/components/ -- React 组件

```
src/components/
├── app-shell.tsx                 -- 应用外壳：导航栏、侧边栏、内容区
├── app-init.tsx                  -- 应用初始化 (Next.js)
├── app-init-wrapper.tsx          -- 应用初始化 (Vite)
├── error-boundary.tsx            -- 错误边界
├── theme-provider.tsx            -- 主题提供者 (亮/暗)
├── page-skeleton.tsx             -- 页面骨架
├── model-config-form.tsx         -- 模型配置表单
├── float-window-toggle.tsx       -- 浮窗开关
├── region-selector.tsx           -- 区域选择器
├── watcher-dialog.tsx            -- 后台任务编辑对话框
├── bbox-overlay.tsx              -- 包围框叠加层
├── ui/switch.tsx                 -- Toggle 开关
├── chat/                         -- 聊天组件
│   ├── chat-bubble.tsx           -- 消息气泡
│   ├── markdown-body.tsx         -- Markdown 渲染
│   ├── message-input.tsx         -- 消息输入框 (@ Agent + 知识型 skill 分组选择) ★
│   ├── model-switcher.tsx        -- 模型切换
│   ├── streaming-text.tsx        -- 流式文本
│   ├── tool-mode-bar.tsx         -- 工具模式栏 (all/favorites/custom/none)
│   └── tool-selector-panel.tsx   -- 工具选择面板
├── recorder/                     -- 录制器组件
│   ├── index.tsx                 -- 桶文件
│   ├── recorder-mode.tsx         -- 录制流程控制 (主壳)
│   ├── recorder-panel.tsx        -- 录制面板
│   ├── event-list.tsx            -- 事件列表
│   ├── manual-recorder.tsx       -- 手动录制器
│   ├── template-preview.tsx      -- 模板预览
│   ├── insert-step-dialog.tsx    -- 插入步骤对话框
│   ├── param-dialog.tsx          -- 参数输入对话框
│   └── refine-panel.tsx          -- 模板微调对话面板
```

### src/docs/ -- 内部文档

```
src/docs/
├── PROJECT_TREE.md               -- 项目目录树 (本文件)
├── GM_IMPLEMENTATION.md          -- GM Agent 设计
├── PERFORMANCE_PLAN.md           -- 性能优化计划
```

---

## src-tauri/ -- Tauri 桌面端

```
src-tauri/
├── Cargo.toml                    -- Rust 依赖与项目元信息
├── Cargo.lock                    -- Rust 依赖锁
├── build.rs                      -- Tauri 构建脚本
├── tauri.conf.json               -- Tauri 窗口/插件/权限配置
├── index.html                    -- Tauri HTML 入口
├── package.json                  -- Tauri 前端包配置
├── vite.config.ts                -- Tauri Vite 配置
├── tsconfig.json                 -- Tauri TypeScript 配置
├── tsconfig.node.json            -- Tauri Node TypeScript 配置
├── list_d_drive_sizes.ps1        -- D 盘大小调试脚本
├── .gitignore                    -- Tauri Git 忽略配置
├── capabilities/
│   └── default.json              -- 权限能力声明 (IPC、文件系统等)
├── icons/                        -- 应用图标 (Tauri 自动生成的多尺寸 ico/png/icns)
```

### src-tauri/src/ -- Rust 后端源码

```
src-tauri/src/
├── main.rs                       -- Tauri 入口
├── lib.rs                        -- 应用构建器：命令注册、插件(含 tauri-plugin-dialog)、托盘
├── commands/
│   ├── mod.rs                    -- 模块声明
│   ├── screenshot.rs             -- 截图：全屏、窗口、子区域
│   ├── capture.rs                -- 区域截图
│   ├── input.rs                  -- 输入模拟：鼠标、键盘
│   ├── window.rs                 -- 窗口管理
│   ├── app.rs                    -- 应用启动与管理
│   ├── app_index.rs              -- 应用索引 (开始菜单+注册表)
│   ├── bridge.rs                 -- Python 桥接 (含 web_code_exec 命令)
│   ├── gdi_utils.rs              -- GDI 工具
│   ├── image_process.rs          -- 图像处理
│   ├── file_util.rs              -- 文件工具
│   ├── global_listener.rs        -- 全局输入钩子
│   └── global_state.rs           -- 全局状态管理（后端存储）
```

---

## public/ -- 静态资源

```
public/
├── manifest.json                 -- PWA manifest
├── sw.js                         -- Service Worker
├── file.svg                      -- 文件图标
├── globe.svg                     -- 地球图标
├── next.svg                      -- Next.js 图标
├── vercel.svg                    -- Vercel 图标
├── window.svg                    -- 窗口图标
├── icons/                        -- PWA 图标
│   ├── icon-192.svg              -- 192px 图标
│   └── icon-512.svg              -- 512px 图标
├── skills/                       -- 技能定义 (AgentSkills 标准 SKILL.md 格式，每 Skill 一个目录)
│   ├── code-tools/SKILL.md       -- 代码工具：代码生成 + 文件 I/O + Shell + 搜索 (9 个工具)
│   ├── desktop-screen/SKILL.md   -- 桌面视觉控制：截图、键鼠、窗口、OCR (21 个工具)
│   ├── desktop-uia/SKILL.md      -- 桌面 UIA 控制：语义元素操作 (6 个工具)
│   ├── web-screen/SKILL.md       -- Web 浏览器控制 + Playwright 脚本沙箱 (9 个工具)
│   ├── phone-screen/SKILL.md     -- 手机屏幕控制 (12 个工具)
│   ├── app-builder/SKILL.md      -- 应用构建器：保存/列出/更新/删除应用 (5 个工具)
│   ├── office-doc/SKILL.md       -- Office 文档：生成/COM 读取/COM 编辑/代码执行 (5 个工具)
│   ├── system-config/SKILL.md    -- 系统配置：技能/模型/设置管理、后台任务 (8 个工具)
│   ├── chat-tools/SKILL.md       -- 对话工具：记忆/历史搜索/回忆/think/request_user_input (8 个工具)
│   └── scheduler-tools/SKILL.md  -- 任务调度：定时任务/屏幕监控/工作流/取消/列表 (5 个工具)
```

---

## docs/ -- 架构文档

```
docs/
├── PROJECT.md                    -- 项目架构文档 (核心)
├── DEVELOPMENT.md                -- 开发指南
├── QUICK-START.md                -- 快速开始
├── PLUGIN-GUIDE.md               -- 插件开发指南
├── PLUGIN-PERMISSIONS.md         -- 插件权限系统
├── PLUGIN-PERMISSIONS-CHEATSHEET.md -- 插件权限速查
├── GENERAL_PRIMITIVES_DESIGN.md  -- Shell/文件工具设计
├── CODE_GENERATION_DESIGN.md     -- 代码生成设计
├── MULTI_AGENT_COLLABORATION.md  -- 多 Agent 协作
├── RUN_COMMAND_BACKEND_MIGRATION.md -- run_command 后端迁移设计
├── WPS_COM_INVESTIGATION.md      -- WPS COM 自动化排查报告
```

---

## python-engine/ -- Python 自动化后端

> 通过 JSON Line 协议与 Tauri 通信，提供浏览器自动化、OCR、Office 文档生成

```
python-engine/
├── main.py                       -- 引擎入口 (JSON Line 协议 + WebSocket 扩展服务)
├── protocol.py                   -- 协议定义
├── requirements.txt              -- Python 依赖 (含 websockets 扩展通信)
├── test_com.py                   -- COM 接口测试
├── test_resolve.py               -- 解析器测试
├── extension/                    -- Chrome 扩展 (--load-extension 自动加载)
│   ├── manifest.json             -- Manifest V3 扩展清单
│   ├── background.js             -- 后台脚本：WebSocket ws://127.0.0.1:19840/extension
│   └── stealth.js                -- 内容脚本：反检测 (navigator.webdriver/plugins/languages)
├── scripts/                      -- 调查/测试脚本 (WPS COM 排查等临时脚本)
└── engine/
    ├── __init__.py                -- 包标记
    ├── screenshot.py             -- 截图
    ├── browser.py                -- Playwright 浏览器自动化 (--load-extension 自动加载扩展)
    ├── extension_ws.py           -- Chrome 扩展 WebSocket 服务端 (port 19840)
    ├── web_search.py             -- 网络搜索+网页抓取 (DuckDuckGo + Playwright/httpx 双策略，含 stealth 反检测)
    ├── desktop_uia.py            -- 桌面 UIA 自动化
    ├── ocr.py                    -- OCR 文字识别
    ├── global_listener.py        -- 全局输入监听
    ├── event_collector.py        -- 事件收集器
    └── office/                   -- Office 文档生成 + COM 实时编辑
        ├── __init__.py
        ├── word_doc.py           -- Word 文档生成 (python-docx)
        ├── excel_doc.py          -- Excel 文档生成 (openpyxl)
        ├── ppt_doc.py            -- PPT 文档生成 (python-pptx)
        ├── com_word.py           -- Word COM 自动化 (pywin32, 实时编辑已打开文档)
        ├── com_excel.py          -- Excel COM 自动化 (pywin32, 实时编辑已打开工作簿)
        ├── com_ppt.py            -- PPT COM 自动化 (pywin32, 实时编辑已打开演示文稿)
        └── com_resolver.py       -- COM 类型解析器
```

---

## 核心架构

### Chat → Agent 路由流水线

```
用户输入 (Chat)
  ↓
Chat LLM (系统配置工具 + request_agent)
  ├── 直接调用系统配置工具 (list_skills, switch_model, update_settings, ...)
  │   → 在 Chat 内直接执行，管理应用自身配置
  │
  └── 调用 request_agent(agent='desktop'|'web'|'document'|'code')
      ├── agent='desktop' → TaskGateway
      │   ├── 意图分类 → IntentClassifierAgent
      │   ├── 工具筛选 → classifyToolsForTask
      │   ├── simple → TaskAgentRunner (desktopAutomation 端点)
      │   └── complex → TaskOrchestrator
      │                   ├── Decomposer (/api/agent/task-decomposer)
      │                   ├── Executor × N (/api/agent/desktop-automation)
      │                   └── Verifier (/api/agent/task-verifier)
      │
      ├── agent='web' → WebGateway (轻量，无意图分类)
      │   └── TaskAgentRunner (webAgent 端点, Playwright 工具集)
      │       ├── web_search / web_fetch → 搜索和抓取
      │       ├── web_launch → 启动浏览器
      │       ├── web_navigate → 导航到 URL
      │       ├── web_get_interactive → 获取可交互元素
      │       ├── web_click / web_fill / web_scroll → 页面操作
      │       ├── run_playwright_script → 执行自定义脚本
      │       └── web_done → 完成
      │
      ├── agent='document' → DocGateway (轻量，无意图分类)
      │   └── TaskAgentRunner (docAgent 端点, 文档工具集)
      │       ├── office_detect → 检测文档
      │       ├── com_read → 读取内容
      │       ├── LLM 智能处理 (翻译/总结/分类/生成)
      │       ├── com_edit → 写回结果
      │       └── doc_done → 完成
      │
      └── agent='code' → CodeGateway (轻量，无意图分类)
          └── TaskAgentRunner (codeAgent 端点, 代码/文件工具集)
              ├── read_file / write_file → 文件读写
              ├── glob / search_files → 文件搜索
              ├── generate_code → 代码生成
              ├── run_command → Shell 命令执行
              ├── execute_code → 沙箱执行
              └── code_done → 完成

项目页 Chat (直达 code agent，不经 Chat LLM 路由)：
  用户输入 (项目页内嵌 Chat)
    ↓
  runAgentLoop(codeAgent 端点, 多轮工具调用循环)
    ├── 流式响应实时更新 UI
    ├── 工具调用 → SkillExecutor 执行 → 结果发回 LLM
    └── 用户可手动停止 (不限轮数)
```

坐标还原：executor 层自动处理（ToolContext + SkillExecutor.applyCoordinateScale）

### Agent API 架构

```
前端 Agent API (src/agents/)
    │
    │  fetch('/api/agent/{name}')
    ▼
┌─────────────────────────────────────────┐
│  Vite 中间件 (src/backend/)              │
│                                          │
│  /api/agent/intent-classifier           │
│  /api/agent/verification                │
│  /api/agent/chat               (SSE)    │
│  /api/agent/code-generation    (SSE)    │
│  /api/agent/ui-vision/*                 │
│  /api/agent/screen-analysis/*           │
│  /api/agent/desktop-automation (SSE)    │
│  /api/agent/task-decomposer    (SSE)    │
│  /api/agent/task-verifier      (SSE)    │
│  /api/agent/doc-agent          (SSE)    │ ← 文档 Agent
│  /api/agent/web-agent          (SSE)    │ ← Web Agent
│  /api/agent/code-agent         (SSE)    │ ← 代码 Agent
│         │                                │
│         ▼                                │
│  LlmExecutor (统一 LLM 入口)             │
│  └── LlmGateway → Adapter               │
│         │                                │
└─────────┼────────────────────────────────┘
          │
   ┌──────┼──────┐
   ▼      ▼      ▼
 OpenAI Anthropic Google
```

### 全局状态管理

```
架构：
  ┌─────────────────────────────────────────────────────────────┐
  │                    Tauri 后端 (Rust)                         │
  │  src-tauri/src/commands/global_state.rs                     │
  │                                                             │
  │  GlobalState (单一实例，所有窗口共享)                        │
  │  ├── last_user_action     -- 最后用户操作 (全局输入监听)    │
  │  ├── active_window        -- 活动窗口                       │
  │  ├── current_task         -- 当前 Agent 任务                │
  │  ├── recent_user_actions  -- 最近 50 条用户操作             │
  │  ├── recent_agent_actions -- 最近 100 条 Agent 操作         │
  │  └── last_screenshot      -- 最后截图                       │
  │                                                             │
  │  数据源：                                                   │
  │  ├── global_listener.rs   -- 全局鼠标/键盘钩子              │
  │  ├── 事件总线             -- Agent 执行事件                 │
  │  └── Tauri API            -- 活动窗口检测                   │
  └─────────────────────────────────────────────────────────────┘
          ↑ invoke                        ↓ emit 事件
          │                               │
  ┌───────┴───────┐               ┌───────┴───────┐
  │   主应用窗口  │               │   浮窗窗口    │
  │ global-state  │               │ global-state  │
  │   (前端代理)  │               │   (前端代理)  │
  └───────────────┘               └───────────────┘

前端代理 (src/services/global-state.ts)：
  - 调用后端 invoke 命令读取/更新状态
  - 监听 global-state-changed 事件
  - 监听 global-input-event 事件
  - 监听事件总线 Agent 事件
```

### 浮窗模块

```
src/pages/float/

5 种模式：
  ├── Chat      -- LLM 流式对话，支持图片、命令确认
  ├── Task      -- 桌面自动化执行，实时日志、录制功能
  ├── 后台任务  -- 定时任务/屏幕监控管理，差异检测、图片对比
  ├── Recorder  -- 操作录制 (RecorderMode 组件)
  └── Learn     -- UI 能力学习 (半自动/级联/受控浏览)

状态持久化：
  ├── float_mode           -- 当前模式
  ├── float_send_to_model  -- 是否发送到模型
  ├── float_allow_image_paste -- 是否允许图片粘贴
  ├── float_tool_mode      -- 工具模式
  └── float_custom_tools   -- 自定义工具列表
```

### 技能系统

```
10 个内置技能 (AgentSkills 标准 SKILL.md 格式，每 Skill 一个目录)：
  ├── code-tools       -- 代码工具 (代码生成、沙箱、Shell、代码搜索、联网搜索)
  ├── desktop-screen   -- 桌面视觉控制 (截图、点击、拖拽、键盘、OCR)
  ├── desktop-uia      -- 桌面 UIA 控制 (语义元素操作)
  ├── web-screen       -- Web 屏幕控制 + Playwright 脚本沙箱
  ├── phone-screen     -- 手机屏幕控制
  ├── app-builder      -- 应用构建器
  ├── office-doc       -- Office 文档生成 + COM 实时编辑
  ├── system-config    -- 系统配置 (技能/模型/设置/后台任务管理)
  ├── chat-tools       -- 对话工具 (记忆/历史/回忆/think/request_user_input)
  └── scheduler-tools  -- 任务调度 (定时/监控/工作流)

三级缓存：
  ├── L1 (UI 指纹)    -- 页面状态 → 动作映射
  ├── L2 (动作序列)   -- 目标 → 步骤序列
  └── L3 (技能模板)   -- 可复用的自动化模板
```

### 坐标变换流水线

```
LLM 输出坐标 (压缩截图空间, 窗口相对)
  │
  ├─① 压缩比例还原──→ applyCoordinateScale()
  │
  └─② 窗口偏移──────→ addWindowOffset()
      执行工具

返回值通过 snapshotCoords / restoreOriginalCoords 还原为 LLM 原始坐标
```

### 区域验证截图

```
执行坐标操作
  ↓
captureRegionAround(screenX, screenY, 150, scaleX, scaleY)
  抓取 150×scale × 150×scale 屏幕像素 → resize 到 150×150
  ↓
Agent 层剥离 region_screenshot → 转为多模态 user 消息
  → LLM 看到图片 + "中心即你的点击坐标"
```

### 网络搜索流水线

```
LLM 调用 web_search / web_fetch 工具
  ↓
CodeToolsSkill.handleWebSearch() / handleWebFetch()
  ↓
Tauri invoke('web_search' | 'web_fetch')
  ↓
Rust 命令层 (bridge.rs: web_search / web_fetch)
  ↓
Python 引擎 (main.py: TOOL_MAP 路由)
  ↓
WebSearchEngine (web_search.py)
  ├── search()  ── duckduckgo_search (DDGS) → [{title, url, snippet}]
  └── fetch()   ── 双策略抓取
       ├── 策略1: Playwright Chromium + stealth JS → 4 种内容提取 (容器选择器/body/visible text/content)
       └── 策略2: httpx HTTP 兜底 → HTML → 纯文本 (去除 script/style 等标签)
  ↓
结果通过 JSON 返回 → Rust → 前端 → 格式化输出给 LLM
```

**关键设计**：
- 抓取结果截断为 50000 字符
- Playwright 抓取拦截 image/font/media/websocket 请求以加速
- 自动滚动触发懒加载
- stealth.js 反检测脚本内联在 web_search.py 中
- 两个工具 (web_search/web_fetch) 通过 WebGateway 使用（agent='web' 路由）

### Web 代码执行流水线 (run_playwright_script)

```
LLM 调用 run_playwright_script({code: "..."})
  ↓
WebScreenSkill.runPlaywrightScript()
  ↓
Tauri invoke('web_code_exec', {code, timeout_sec})
  ↓
Rust bridge.rs: web_code_exec() → bridge_call_async()
  ↓
Python 引擎 (main.py: _handle_web_code_exec)
  ├── 注入 page, browser, wait_for(), screenshot_b64()
  ├── 危险操作拦截 (os.*, subprocess.*, ctypes.*)
  ├── 允许导入: time, json, re, base64, math
  ├── 线程执行 + 超时控制 (默认 60s)
  └── 返回 result 变量 + stdout 输出
  ↓
结果通过 JSON 返回 → Rust → 前端 → SkillOk/SkillFail → LLM
```

**预注入变量**：
- `page`: Playwright Page 对象（当前活动页面）
- `browser`: Playwright Browser 对象
- `wait_for(selector, timeout)`: 等待元素出现
- `screenshot_b64()`: 截图返回 base64 字符串

### Chrome 扩展 WebSocket 通信

```
Chrome 扩展 (background.js)
  ↓ WebSocket ws://127.0.0.1:19840/extension
Python 引擎 (engine/extension_ws.py)
  ├── 守护线程启动，监听 19840 端口
  ├── ext_get_tab_info → 获取当前标签页 URL/标题
  └── ext_execute_script → 注入执行 JS 代码
  ↓
BrowserEngine (browser.py) 提供 page/browser 实例
```

**浏览器启动自动加载扩展**：
- `_launch_with_debug_port()`: `--load-extension` + `--disable-extensions-except`
- Playwright `launch()`: 通过 `args` 参数注入
- 扩展目录：`python-engine/extension/`，自动检测是否存在
