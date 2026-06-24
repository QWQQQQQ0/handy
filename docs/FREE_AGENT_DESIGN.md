# 通用 AI 开发者 Agent（FreeAgent）设计文档

> 状态：设计阶段，未实现

## 一、概述

FreeAgent 是一个**了解完整执行环境、能自主利用所有工具完成任务**的通用 AI。用户通过独立页面与之对话，Agent 根据任务自主选择语言、沙箱、包管理策略，一气呵成完成复杂需求。

### 与现有 Agent 的区别

| Agent | 定位 | 入口 |
|-------|------|------|
| Chat Agent | 被动聊天，按需委托子 Agent（`request_agent`） | 主聊天页 |
| CodeAgent | 文件操作 + 项目脚手架，偏向代码项目开发 | Chat 委托 |
| DesktopAgent | 桌面 UI 自动化（截图→定位→操作） | Chat 委托 |
| WebAgent | 浏览器操作 | Chat 委托 |
| DocAgent | Word/Excel/PPT 文档读写 | Chat 委托 |
| **FreeAgent** | **全能力自主决策**：沙箱执行 + 装包 + 文件 + 网络 + 数据库 + 前端生成 | **独立页面** |

---

## 二、入口设计

新建独立页面 `src/pages/free-agent.tsx`，有自己的聊天框 + 输出预览区。

布局参照 Apps 页面的聊天集成模式：
- 左侧：对话区（消息气泡、工具调用折叠展示）
- 右侧：预览区（HTML 实时渲染、代码高亮、图片展示）

**不经过** Chat 的 `request_agent` 路由。页面直接调用 `runAgentLoop(AgentEndpoint.freeAgent, ...)`。

---

## 三、核心能力

### 3.1 Python 沙箱：完全访问模式

FreeAgent 启动时，`CodeSandboxService` 设为完全访问模式。Agent 调用 `execute_code(language='python', code=...)` 时自动跳过 `SAFE_MODULES` 白名单。

```
CodeSandboxService.setPythonFullAccess(true)
  → executePython() 检测 flag
    → bridgeExecPython({allowAllImports: true})
      → Tauri invoke('exec_python', {allow_all_imports: true})
        → Python _handle_exec_python: __builtins__.__import__ = __import__
```

**仍保留的安全限制**：
- `os`、`subprocess`、`ctypes` 模块不在 builtins 中，无法直接调用
- 如需文件操作，用 `write_file`/`read_file` 工具
- 如需网络请求，用 `web_fetch` 工具或用 `requests` 库（pip install 后可用）

**装包流程**：
```
1. Agent 判断需要某个库（如 pandas）
2. 调用 run_command("pip install pandas")
3. 用户在确认栏点"允许"
4. pip 安装到 python-engine 的 Python 环境
5. Agent 调用 execute_code(python, "import pandas; ...")
6. 导入成功，正常使用
```

### 3.2 JavaScript 沙箱

- 执行方式：`new Function()`，无 Node.js 运行时
- 无 `require`、`import()`、`process`、`fs`、`child_process`
- 可用：`Array`、`Math`、`JSON`、`Date`、`Map`、`Set`、`Promise`、`RegExp`、`BigInt` 等标准内置对象
- **依赖策略**：无法装 npm 包。需要外部库时，改用 Python 处理数据逻辑 + HTML 做前端展示（CDN 引库）

### 3.3 HTML/CSS 沙箱

- 渲染方式：iframe `srcdoc`，带 CSP 隔离
- CSS/JS 库：通过 CDN 引入
  ```html
  <script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
  <link href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap.min.css" rel="stylesheet">
  ```
- 外部资源默认关闭，需要时传 `allow_external_resources: true`
- 危险操作剥离：`onclick`、`javascript:` URL、`data:text/html` 被正则清除
- Console 输出：捕获到 `window.__sandboxLogs`
- 交付方式：`save_app` 存入数据库，用户在「项目」页查看和预览

### 3.4 SQL 沙箱

- 数据库：应用自身的 SQLite（通过 `getDB()` 适配器）
- DDL 默认禁止（`CREATE`/`DROP`/`ALTER`），传 `allowDDL: true` 可放开
- 查询行数限制：默认 1000 行
- 支持多语句（`;` 分隔），逐条执行，遇错即停
- ⚠️ 直接操作应用数据库，`INSERT`/`UPDATE`/`DELETE` 会影响真实数据

### 3.5 Shell 命令

- 系统：Windows，Shell = `cmd.exe`
- 安全黑名单（正则拦截）：`rm -rf`、`format`、`shutdown`、`taskkill`、`reg delete`、`C:\Windows`、管道注入等
- 用户确认：每条 `run_command` 执行前弹出确认栏
- 工作目录：默认项目根目录，可用 `cwd` 指定
- 超时：默认 30 秒
- 常用场景：`pip install`、`python script.py`、`git status`、`npm --version` 等

### 3.6 网络

- `web_search`：DuckDuckGo 搜索，返回标题 + URL + 摘要
- `web_fetch`：Playwright/httpx 双策略抓取网页全文，最多 50000 字符

### 3.7 文件

- `write_file`：写入 `workspace/` 目录
- `read_file`：读取文件，大文件支持分页（offset/limit）
- `glob`：按模式查找文件
- `search_files`：正则搜索文件内容（ripgrep → findstr/grep → JS fallback）

---

## 四、记忆与历史

### 4.1 长期记忆

Agent 通过以下工具自主管理记忆：

| 工具 | 用途 | 示例 |
|------|------|------|
| `agent_memory_update` | 记录重要事实、偏好、决策 | "创建了 users 表，包含 id/name/email 字段，用于存储用户数据" |
| `recall_memory` | 搜索之前的记忆 | 下次用户说"查用户数据"，Agent 先搜有没有 users 表的记忆 |
| `search_chat_history` | 搜索历史对话 | 查找之前做过的类似任务 |

**关键原则**：
- 创建数据库/表/文件后，**立即**用 `agent_memory_update` 记录名称、用途、结构
- 每次新任务开始，用 `recall_memory` 搜索相关记忆，避免重复创建资源
- 脏数据防控：Agent 承担"了解自己的历史"的责任

### 4.2 对话历史

页面和 Chat 共享 conversation 机制：
- 新建对话时自动创建 conversation 记录
- 每条消息持久化到 DB
- 页面加载时从 DB 恢复历史对话列表
- 支持切换/删除历史对话

---

## 五、工具集

全部开放，不做过滤。Agent 根据任务自主选择：

| 类别 | 工具 |
|------|------|
| 沙箱 | `execute_code` (js/py/sql/html) |
| Shell | `run_command` |
| 文件 | `read_file` `write_file` `glob` `search_files` |
| 网络 | `web_search` `web_fetch` |
| 交付 | `save_app` `save_code` |
| 生成 | `generate_code` `generate_project` |
| 记忆 | `agent_memory_update` `recall_memory` `search_chat_history` |
| 控制 | `think` `request_user_input` `code_done` |

---

## 六、系统提示设计

System prompt 要详细描述整个执行环境，让 Agent 明确知道自己的边界和能力。核心结构：

```
你是 Handy 的通用 AI 开发者，你有完整的代码执行环境。

## 你的执行环境
[Python / JavaScript / HTML/CSS / SQL / Shell / 文件 / 网络 / 记忆] 各节详细说明

## 工具选择指南
[常见场景 → 推荐工具和语言] 的映射表

## 核心原则
- 创建资源后立即记录记忆
- 先搜索记忆再行动，避免重复
- 选对语言和工具：数据处理→Python，前端→HTML+CDN，查询→SQL
- 装包一步到位：先 pip install 再 import
- 错误自修复：执行报错后分析原因，调整代码重试
```

详细 prompt 内容见 `src/config/system-prompts.json` 的 `freeAgent` 字段（待实现）。

---

## 七、技术实现

### 7.1 改动文件清单

| 操作 | 文件 | 说明 |
|------|------|------|
| 修改 | `python-engine/main.py` | `_handle_exec_python` 增加 `allow_all_imports` 参数 |
| 修改 | `src/services/code-sandbox/sandbox-types.ts` | `SandboxConfig` 加 `allowAllImports` |
| 修改 | `src/services/code-sandbox/python-bridge.ts` | `PythonExecParams` 加 `allowAllImports`，透传 Tauri |
| 修改 | `src/services/code-sandbox/sandbox-python.ts` | 读取 config，传给 bridge |
| 修改 | `src/services/code-sandbox/index.ts` | `CodeSandboxService` 加 `setPythonFullAccess()` |
| 新增 | `src/services/free-agent/free-gateway.ts` | FreeAgentGateway（参照 CodeGateway） |
| 新增 | `src/services/free-agent/index.ts` | Barrel 导出 |
| 新增 | `src/pages/free-agent.tsx` | 独立页面：聊天 + 预览 |
| 修改 | `src/api/types.ts` | 新增 `AgentEndpoint.freeAgent` |
| 修改 | `src/backend/handlers.ts` | 新增 `handleFreeAgent` |
| 修改 | `src/backend/middleware.ts` | 路由注册 |
| 修改 | `src/config/system-prompts.json` | 新增 `freeAgent` 系统提示 |
| 修改 | `src/api/client.ts` | `ENDPOINT_PROMPT_KEY` 映射 |
| 修改 | `src/router.tsx` | `/free-agent` 路由 |
| 修改 | `src/components/app-shell.tsx` | 导航栏入口 |
| 修改 | `src/docs/PROJECT_TREE.md` | 文档更新 |

### 7.2 Python 沙箱改动（核心）

```python
# python-engine/main.py — _handle_exec_python

def _handle_exec_python(params: dict) -> dict:
    code = params.get("code", "")
    timeout_sec = params.get("timeout_sec", 30)
    input_vars = params.get("params", {})
    allow_all = params.get("allow_all_imports", False)  # 新增

    # ... stdout/stderr 捕获 ...

    SAFE_MODULES = { ... }  # 现有 22 个白名单

    def safe_import(name, *args):
        if name not in SAFE_MODULES:
            raise ImportError(f"Module '{name}' is not allowed")
        return __import__(name, *args)

    safe_globals = {
        "__builtins__": {
            # ... 现有 builtins ...
            "__import__": __import__ if allow_all else safe_import,  # 改动
        }
    }
    # ... 其余不变 ...
```

### 7.3 CodeSandboxService 改动

```typescript
// src/services/code-sandbox/index.ts

export class CodeSandboxService {
  private pythonFullAccess = false;

  setPythonFullAccess(enabled: boolean): void {
    this.pythonFullAccess = enabled;
  }

  async execute(language, code, context?, config?): Promise<SandboxResult> {
    const merged = { ...DEFAULT_CONFIG, ...config };
    // Python 时自动注入 allowAllImports
    if (language === 'python' && this.pythonFullAccess) {
      merged.allowAllImports = true;
    }
    // ... switch dispatch ...
  }
}
```

### 7.4 页面结构（参照 apps.tsx）

```typescript
// src/pages/free-agent.tsx

export default function FreeAgentPage() {
  const [messages, setMessages] = useState<LLMMessage[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const previewRef = useRef<HTMLIFrameElement>(null);

  useEffect(() => {
    // 启动时：放开 Python 沙箱
    codeSandboxService.setPythonFullAccess(true);
    return () => {
      codeSandboxService.setPythonFullAccess(false);
    };
  }, []);

  async function handleSend(userInput: string) {
    const executor = await getSkillExecutor();
    const msgs = buildMessages(userInput);

    await runAgentLoop(msgs, {
      endpoint: AgentEndpoint.freeAgent,
      provider, apiKey, executor,
      onText: (cumulative, delta) => { /* 更新 UI */ },
      onToolCall: (name, args) => { /* 折叠展示 */ },
      onToolResult: (name, success, msg) => { /* 结果展示 */ },
    });

    // HTML 输出 → 右侧预览
    // 图片输出 → 展示
    // 文本输出 → Markdown 渲染
  }

  return (
    <div className="flex h-full">
      <div className="w-1/2"><ChatPanel /></div>
      <div className="w-1/2"><PreviewPanel /></div>
    </div>
  );
}
```

---

## 八、使用场景示例

### 场景 1：数据分析
```
用户：分析这个 CSV 文件的销售数据，画出月度趋势图

Agent 思考：
1. read_file 读取 CSV → 了解结构
2. pip install pandas matplotlib
3. execute_code(python, allow_all_imports=true):
   import pandas as pd
   import matplotlib.pyplot as plt
   df = pd.read_csv("workspace/sales.csv")
   # ... 分析、聚合、画图 ...
   plt.savefig("workspace/chart.png")
4. 返回分析结果 + 图表路径
5. agent_memory_update("sales.csv 销售数据分析，包含月度趋势图")
```

### 场景 2：创建数据库应用
```
用户：建一个图书管理数据库，能增删改查

Agent 思考：
1. execute_code(sql, allowDDL=true):
   CREATE TABLE books (id TEXT PRIMARY KEY, title TEXT, author TEXT, year INT, status TEXT)
2. agent_memory_update("创建 books 表...用途=图书管理...字段=id/title/author/year/status")
3. 用 HTML+JS 写前端管理界面 → save_app
   - 使用 CDN 引入 Vue.js 或原生 JS
   - 通过 execute_code(sql) 操作数据库
4. agent_memory_update("图书管理应用已创建，app_id=xxx")
```

### 场景 3：网页数据抓取
```
用户：扒一下这个网站的文章列表

Agent 思考：
1. 检查 requests 是否已安装 → 没有 → pip install requests beautifulsoup4
2. web_fetch 获取页面内容（或用 execute_code python + requests）
3. execute_code(python, allow_all_imports=true):
   解析 HTML，提取文章标题和链接
4. 返回结构化结果
```

### 场景 4：前端小工具
```
用户：写一个番茄钟计时器

Agent 思考：
1. 纯前端任务 → HTML+CSS+JS
2. generate_code(language='html', task='番茄钟计时器')
3. 如果需要图标/字体 → CDN 引入
4. save_app → 用户在项目页预览
```

---

## 九、待实现

| 优先级 | 任务 |
|--------|------|
| P0 | Python 沙箱 `allow_all_imports` 支持 |
| P0 | CodeSandboxService `setPythonFullAccess()` |
| P0 | FreeAgentGateway + 端点注册 |
| P0 | 独立页面 `free-agent.tsx` |
| P0 | System prompt（环境清单） |
| P1 | 对话历史持久化 |
| P1 | 导航栏入口 |
| P2 | Python 预装包自动检测 |
| P2 | 输出自动识别（代码高亮 / HTML 预览 / 图片展示） |
