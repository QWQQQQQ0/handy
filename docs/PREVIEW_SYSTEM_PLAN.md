# 项目预览系统 — 现状与改进方案

> 创建时间: 2026-06-25

---

## 一、当前状态

### 1.1 单页 HTML 预览

**流程**：原始 HTML → `codeSandboxService.execute('html')` → `sandbox-html.ts` 处理 → srcdoc iframe

**已修复的问题**：
- ~~IIFE 包裹导致函数声明不是全局的，inline onclick 找不到~~（`sandbox-html.ts` 改为全局作用域执行）
- ~~内联事件处理器被正则删除~~（去掉 `onclick` 等正则过滤）
- ~~iframe sandbox 缺少 `allow-same-origin`~~（`apps.tsx`：`HTMLPreview` iframe sandbox 已补全）

**当前限制**：
- srcdoc iframe 本质是**单文档**，没有路由
- 无法处理多页面跳转（`<a href="page2.html">` 会 404）
- origin 是 `about:srcdoc`，后端 API 交互受限
- 不支持 SSR / SPA 路由

### 1.2 沙箱处理模块

| 文件 | 作用 |
|------|------|
| `src/services/code-sandbox/sandbox-html.ts` | HTML 解析、脚本包裹、CSP 注入、生成 isolatedDocument |
| `src/services/code-sandbox/sandbox-types.ts` | SandboxConfig / SandboxResult 类型定义 |
| `src/pages/apps.tsx:HTMLPreview` | iframe 渲染组件 |

---

## 二、复杂项目预览方案

### 2.1 问题

Vue/React 项目需要：
- **构建工具链**：`npm install` → `npm run dev`
- **开发服务器**：Vite/Webpack dev server 提供 HMR、SPA fallback、API proxy
- **多页面路由**：`vue-router` / `react-router` 需要正确的 origin 和 history API
- **后端交互**：需要真实的 `localhost` origin，不能用 `about:srcdoc`

srcdoc iframe **无法满足以上任何一点**。

### 2.2 方案：本地 dev server 预览

```
Agent 生成项目 → 写入 workspace/ → npm install → npm run dev
                                                    ↓
检测 dev server 就绪 ──→ iframe src="http://localhost:{port}"
                                                    ↓
用户关闭预览 ──→ kill dev server 进程
```

### 2.3 实现要点

#### 自动检测项目类型

```typescript
// 读取 package.json 判断预览方式
function detectPreviewMode(project: SavedProject): 'static' | 'dev-server' {
  const pkg = project.files_json?.['package.json'];
  if (!pkg) return 'static';
  const { dependencies = {}, devDependencies = {} } = JSON.parse(pkg);
  const allDeps = { ...dependencies, ...devDependencies };
  if (allDeps.vue || allDeps.react || allDeps['@angular/core'] || allDeps.svelte) {
    return 'dev-server';
  }
  if (project.files_json?.['vite.config.js'] || project.files_json?.['vite.config.ts']) {
    return 'dev-server';
  }
  return 'static';
}
```

#### 端口管理

```typescript
// 固定端口或自动查找空闲端口
const DEV_SERVER_PORT = 5173; // 默认 Vite 端口
// 或使用 portfinder 自动找空闲端口
```

#### dev server 生命周期

```
启动: Tauri shell 子进程 → npm run dev → 轮询 localhost:{port} 直到可访问
关闭: 用户离开项目或关闭预览 → kill 子进程
超时: 60s 未就绪 → 提示用户检查项目
```

#### 预览组件

```tsx
// 两种模式共用一个预览区域
function ProjectPreview({ project }: { project: SavedProject }) {
  if (previewMode === 'dev-server') {
    return <iframe src={`http://localhost:${port}`} />;
  }
  // 单页 HTML：srcdoc（现有方案）
  return <iframe sandbox="..." srcDoc={isolatedDocument} />;
}
```

### 2.4 涉及改动

| 文件 | 改动 |
|------|------|
| `src/pages/apps.tsx` | 新增 dev server 预览逻辑、端口管理、项目类型检测 |
| `src-tauri/` | 可能需要 Tauri shell 插件来管理子进程（`npm run dev`） |
| `src/services/code-sandbox/` | 新增 `ProjectPreviewMode` 判断函数 |
| `src/components/` | 新增 `DevServerPreview` 组件或扩展现有 `HTMLPreview` |

### 2.5 安全考量

- dev server 仅监听 `localhost`，外部不可访问
- 进程在应用退出时自动清理
- 可加白名单/黑名单限制依赖安装

---

## 三、经验存储系统（已完成）

### 3.1 三种分类

| 类型 | 存储 type | 上限 | 注入方式 | 检索方式 |
|------|-----------|------|----------|----------|
| `agent_heuristic` | 行为准则 | ≤8 | System prompt 常驻 | 无需检索，全量注入 |
| `task_workflow` | 工作流 | ≤50 | 任务开始时按需注入 | 工具签名 Jaccard → 触发模式正则 → 关键词（三层） |
| `agent_artifact` | 执行产物 | 不限 | 走 `code_registry` | 已有机制 |

### 3.2 关键文件

| 文件 | 作用 |
|------|------|
| `src/services/task-memory.ts` | 核心存储+检索逻辑 |
| `src/services/memory-compressor.ts` | System prompt 注入（含 agent_heuristic 段） |
| `src/skills/chat-tools.ts` | `store_experience` 工具定义（FreeAgent 专属） |
| `src/config/system-prompts.json` | freeAgent prompt（精简版经验学习引导） |

### 3.3 工具调用规则

所有子 Agent（`freeAgent`、`codeAgent`、`docAgent`、`desktopAutomation`、`webAutomation`）prompt 已添加：`调用工具时必须关注参数定义，有必填字段时根据上下文填写，不能传空对象或乱猜参数。`

---

## 四、项目页面 Chat 布局（已完成）

Chat 面板从底部全宽 → 移入预览/编辑器下方同一列：
- 生成项目：Chat 在预览区下方
- 导入项目：Chat 在编辑器下方
- `maxHeight: 140px`，不影响主内容区
