# OpenPaw React 性能优化实施方案

## 现状问题

当前项目从 Flutter 1:1 迁移到 Next.js，保留了 static export 架构。桌面端（Tauri WebView2）页面切换时出现明显黑屏（1-5 秒），体验远差于原生 Flutter。

### 根因分析

1. **`output: "export"` 导致路由跳转为全量页面加载** — 每个路由是独立 HTML，`<Link>` 跳转需要加载新 HTML + JS chunk，没有 SPA 的客户端路由切换
2. **`body{visibility:hidden}` 脚本隐藏整个页面** — `layout.tsx` 内联脚本在每次页面加载时隐藏 body，等 React 挂载后才显示，最长 5 秒
3. **skill 全量静态 import** — `chat-store.ts` 顶部静态导入了所有 skill 模块，主 bundle 体积膨胀
4. **无页面过渡动画** — chunk 加载期间无任何视觉反馈
5. **Zustand store 过于集中** — 单一巨型 store 导致无关状态变化触发全局重渲染
6. **WebView2 禁用了 GPU 加速** — `tauri.conf.json` 中 `--disable-gpu` 已修复但需验证

---

## 实施方案

### P0-1：切换到 SPA 模式（React Router）

**目标**：所有路由在同一个 JS runtime 内切换，跳转耗时为 React 渲染时间（<50ms），不再是全量页面加载。

**方案**：Next.js `output: "export"` 改为用 Vite + React Router。

**推荐方案：Vite + React Router v7**

理由：
- Next.js 对纯 SPA 支持不友好，`output: "standalone"` 仍需 Node 服务端
- Vite 构建速度远快于 Next.js，HMR 即时生效
- React Router v7 支持 layout route、lazy loading、数据预加载
- 与 Tauri 集成成熟

**实施步骤**：

1. 初始化 Vite + React 项目骨架
   ```
   npm create vite@latest . -- --template react-ts
   ```

2. 安装依赖
   ```
   npm install react-router-dom@7 zustand immer i18next react-i18next
   npm install @tauri-apps/api @tauri-apps/plugin-shell @tauri-apps/plugin-sql
   npm install tailwindcss @tailwindcss/vite lucide-react
   ```

3. 路由结构设计
   ```
   /                    → ChatPage       (lazy)
   /desktop             → DesktopPage    (lazy)
   /float               → FloatPage      (lazy)
   /web                 → WebPage        (lazy)
   /models              → ModelsPage     (lazy)
   /skills              → SkillsPage     (lazy)
   /settings            → SettingsPage   (lazy)
   /apps                → AppsPage       (lazy)
   ```

4. 路由配置示例（`src/router.tsx`）
   ```tsx
   import { createBrowserRouter } from 'react-router-dom';
   import { AppShell } from '@/components/app-shell';
   import { lazy, Suspense } from 'react';

   const ChatPage = lazy(() => import('@/pages/chat'));
   const DesktopPage = lazy(() => import('@/pages/desktop'));
   const FloatPage = lazy(() => import('@/pages/float'));
   // ... 其他页面

   // 轻量骨架屏，路由切换时瞬时展示
   function PageSkeleton() {
     return (
       <div className="flex-1 flex items-center justify-center">
         <div className="w-6 h-6 border-2 border-zinc-300 border-t-blue-500 rounded-full animate-spin" />
       </div>
     );
   }

   export const router = createBrowserRouter([
     {
       element: <AppShell />,
       children: [
         {
           path: '/',
           element: <Suspense fallback={<PageSkeleton />}><ChatPage /></Suspense>,
         },
         {
           path: '/desktop',
           element: <Suspense fallback={<PageSkeleton />}><DesktopPage /></Suspense>,
         },
         {
           path: '/float',
           element: <Suspense fallback={<PageSkeleton />}><FloatPage /></Suspense>,
         },
         // ... 其他路由
       ],
     },
   ]);
   ```

5. `AppShell` 保持不变，侧边栏使用 React Router 的 `<NavLink>`
   ```tsx
   import { NavLink, Outlet } from 'react-router-dom';

   function Sidebar() {
     return (
       <aside>
         <NavLink to="/" className={({ isActive }) => isActive ? 'active' : ''}>
           <MessageSquare /> Chat
         </NavLink>
         <NavLink to="/desktop">
           <Monitor /> Desktop
         </NavLink>
         {/* ... */}
       </aside>
     );
   }

   export function AppShell() {
     return (
       <div className="flex h-full">
         <Sidebar />
         <main className="flex-1">
           <Outlet />  {/* 子路由在此渲染 */}
         </main>
       </div>
     );
   }
   ```

6. 入口文件 `src/main.tsx`
   ```tsx
   import { RouterProvider } from 'react-router-dom';
   import { router } from './router';
   import './index.css';

   ReactDOM.createRoot(document.getElementById('root')!).render(
     <RouterProvider router={router} />
   );
   ```

**预期效果**：
- 路由切换变为 React 组件替换，16ms 级别
- `<Suspense>` 提供骨架屏过渡（< 200ms 的 spinner），无黑屏
- Link 组件 hover 时自动预加载目标页 chunk

---

### P0-2：去掉 `visibility:hidden`，换骨架屏

**目标**：首屏不隐藏 body，HTML 立即可见。

**方案**：删除 `layout.tsx` 中的内联脚本，改用 CSS 动画骨架屏。

**实施**：

1. 删除 `layout.tsx` 中 `<script dangerouslySetInnerHTML={{ __html: `...` }} />` 整个块
2. 删除 `AppInit` 中 `window.__mark_react_ready?.()` 调用
3. 在 `AppShell` 或页面组件中添加骨架屏状态

```tsx
// src/components/page-skeleton.tsx
export function PageSkeleton() {
  return (
    <div className="flex-1 flex items-center justify-center min-h-0 animate-in fade-in duration-300">
      <div className="flex flex-col items-center gap-4">
        <div className="w-10 h-10 border-[3px] border-zinc-200 border-t-blue-500 rounded-full animate-spin" />
        <span className="text-sm text-zinc-400">Loading...</span>
      </div>
    </div>
  );
}
```

4. Tailwind 需配置 `animate-in` 或在 `index.css` 中添加：
   ```css
   @keyframes fade-in {
     from { opacity: 0; }
     to { opacity: 1; }
   }
   .animate-in { animation: fade-in 0.3s ease-out; }
   ```

**预期效果**：
- 首次加载立即可见内容（静态 HTML + 骨架屏）
- React 挂载后无缝替换为真实内容
- 不再有"最长 5 秒黑屏"

---

### P1-1：路由级懒加载 + 预加载

**目标**：主 bundle 只包含核心框架代码，各页面 skill 按需加载。侧边栏 hover 时预加载目标页。

**方案**：React Router 的 `lazy()` + `Link` 的 `prefetch` 属性。

**实施**：

1. 所有页面组件用 `React.lazy()` 包装（见 P0-1 路由配置）
2. 将 skill 导入从 store 顶层移到页面组件内的动态 import

**改前**（`stores/chat-store.ts` 顶部）：
```ts
import { DesktopScreenSkill } from '@/skills/desktop';
import { WebScreenSkill } from '@/skills/web';
import { PhoneScreenSkill } from '@/skills/phone';
import { AppBuilderSkill } from '@/skills/app-builder';
```

**改后**：skill 只在对应 handler 中按需加载
```ts
// chat-service.ts — 仅在执行 automation 时才加载 skill
async function getSkillExecutor() {
  const { DesktopScreenSkill } = await import('@/skills/desktop');
  return new DesktopScreenSkill();
}
```

3. 侧边栏 Link 开启预加载
   ```tsx
   <NavLink
     to="/desktop"
     prefetch="intent"    // hover 或 focus 时预加载
     onMouseEnter={() => {
       // 预加载目标页 chunk
       import('@/pages/desktop');
     }}
   >
   ```

4. Vite 构建配置（`vite.config.ts`）手动分包
   ```ts
   export default defineConfig({
     build: {
       rollupOptions: {
         output: {
           manualChunks: {
             'vendor-react': ['react', 'react-dom', 'react-router-dom'],
             'vendor-state': ['zustand', 'immer'],
             'vendor-tauri': ['@tauri-apps/api'],
             'page-chat': ['@/pages/chat'],
             'page-desktop': ['@/pages/desktop'],
             'page-float': ['@/pages/float'],
             'skill-desktop': ['@/skills/desktop'],
             'skill-web': ['@/skills/web'],
           },
         },
       },
     },
   });
   ```

**预期效果**：
- 主 bundle 从 ~500KB 降到 ~150KB（仅框架 + 公共组件）
- 首屏 JS 解析时间从 ~500ms 降到 ~100ms
- hover 预加载使跳转感知延迟接近 0

---

### P1-2：页面过渡动画

**目标**：路由切换时有平滑的视觉过渡，没有"闪一下"的感觉。

**方案**：CSS transition 或 framer-motion 做 `opacity` + `transform` 过渡（仅触发 GPU 合成层，不触发重排）。

**实施**（CSS 方案，零依赖）：

`src/index.css`:
```css
.page-transition {
  animation: page-enter 200ms ease-out;
}

@keyframes page-enter {
  from {
    opacity: 0;
    transform: translateY(8px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
```

在 AppShell 中：
```tsx
import { useLocation, Outlet } from 'react-router-dom';

export function AppShell() {
  const location = useLocation();

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex-1" key={location.pathname}>
        <div className="page-transition h-full">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
```

**关键**：使用 `opacity` 和 `transform` 属性做动画，浏览器只在合成器线程处理，不触发主线程的 layout/paint，帧率稳定在 60fps。

**预期效果**：
- 路由切换有 200ms 淡入 + 微位移过渡
- 全程 GPU 合成，不丢帧

---

### P2-1：Zustand Store 拆分

**目标**：减少不相关状态变更导致的全局重渲染。

**当前问题**：`chat-store.ts` 一个 store 包含会话列表、消息、流式状态、debug 消息、工具模式等所有状态。任何字段变化都会触发所有 `useChatStore()` 订阅者检查更新。

**方案**：按职责拆分为独立 store。

**拆分方案**：

| Store | 职责 | 文件 |
|-------|------|------|
| `useConversationStore` | 会话列表 CRUD、activeConversation | `stores/conversation-store.ts` |
| `useMessageStore` | 消息列表、debug 消息、流式状态 | `stores/message-store.ts` |
| `useToolStore` | toolMode、customTools | `stores/tool-store.ts` |
| `useModelConfigStore` | 已有，保持 | `stores/model-config-store.ts` |
| `useSettingsStore` | 已有，保持 | `stores/settings-store.ts` |

**实施要点**：

1. 每个 store 独立 `create()`
2. `sendMessage` 跨 store 协调通过 service 层（`chat-service.ts`），不放在 store 里
3. 组件只订阅自己需要的 store

```tsx
// 改前：订阅整个 chat store
const { messages, isStreaming, error } = useChatStore();

// 改后：按需订阅
const messages = useMessageStore(s => s.messages);
const isStreaming = useMessageStore(s => s.isStreaming);
const error = useMessageStore(s => s.error);
```

**进一步优化**：使用 Zustand 的 `useShallow` 避免对象/数组引用变化导致的重渲染：

```tsx
import { useShallow } from 'zustand/react/shallow';

const { messages, debugMessages } = useMessageStore(
  useShallow(s => ({ messages: s.messages, debugMessages: s.debugMessages }))
);
```

**预期效果**：
- 流式消息更新时，侧边栏、工具栏等不会重渲染
- 切换 toolMode 时，消息列表不会重渲染

---

### P2-2：虚拟列表（长会话优化）

**目标**：几百条消息的会话滚动不卡顿。

**方案**：使用 `@tanstack/react-virtual` 只渲染可视区域的消息节点。

**实施**：

```bash
npm install @tanstack/react-virtual
```

```tsx
// components/chat/message-list.tsx
import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';

export function MessageList({ messages }: { messages: ChatMessage[] }) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80,    // 每条消息预估高度 80px
    overscan: 5,               // 上下各多渲染 5 条
  });

  return (
    <div ref={parentRef} className="flex-1 overflow-y-auto">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const msg = messages[virtualItem.index];
          return (
            <div
              key={msg.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualItem.start}px)`,
              }}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
            >
              <ChatBubble message={msg} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

**注意**：配合 `ChatBubble` 的 `React.memo`:
```tsx
export const ChatBubble = React.memo(function ChatBubble({ message }: Props) {
  // ...
}, (prev, next) => prev.message.id === next.message.id && prev.message.content === next.message.content);
```

**预期效果**：
- 500 条消息只渲染 ~15 个 DOM 节点（可视区域 10 条 + overscan 5 条）
- 内存占用降低 97%
- 初始渲染从 ~500ms 降到 ~50ms

---

### P3-1：Tauri 端用原生 SQLite

**目标**：去掉 WASM SQLite 初始化开销。

**当前状态**：代码已经同时支持 Tauri 原生 SQLite 和 Web WASM SQLite，通过 `isTauri()` 切换。但 WASM 初始化仍需加载 `sql.js`。

**方案**：确认 Tauri 端走原生 SQLite，Web 端保持 WASM。

**验证**：检查 `src/db/index.ts` 中 `isTauri()` 分支是否正确工作：

```ts
export async function getDB(): Promise<SQLiteAdapter> {
  if (_adapter) return _adapter;
  _adapter = isTauri() ? tauriSQLiteAdapter : wasmSQLiteAdapter;
  // ...
}
```

**额外优化**：首屏不等待 DB 初始化。`getDB()` 是懒初始化的（只在第一次调用时创建连接）。但 `AppInit` 中会调用 `loadSettings()` 和 `loadConfigs()`，触发 DB 初始化。可以考虑：

1. 页面先渲染骨架屏
2. DB 初始化 + 数据加载异步进行
3. 加载完成后填充数据

---

## 迁移步骤总览

按依赖关系和风险排序：

| 步骤 | 内容 | 预计工时 | 依赖 |
|------|------|----------|------|
| 1 | Vite + React Router 项目骨架搭建 | 2h | - |
| 2 | 路由配置 + 页面 lazy loading | 1h | 1 |
| 3 | AppShell + 侧边栏迁移 | 1h | 2 |
| 4 | 删除 `visibility:hidden` 脚本 + 骨架屏 | 0.5h | 3 |
| 5 | 页面过渡动画 | 0.5h | 3 |
| 6 | ChatPage 迁移 | 2h | 3 |
| 7 | DesktopPage 迁移 | 1.5h | 3 |
| 8 | FloatPage 迁移 | 1h | 3 |
| 9 | WebPage 迁移 | 1.5h | 3 |
| 10 | 其他页面迁移（models/settings/skills/apps） | 1.5h | 3 |
| 11 | Store 拆分 | 2h | 6 |
| 12 | Skill 懒加载 | 0.5h | 6-10 |
| 13 | 虚拟列表 | 1.5h | 6 |
| 14 | Vite manualChunks 分包配置 | 0.5h | 1-13 |
| 15 | 联调测试 + 修复 | 2h | 1-14 |

**总预计工时**：~18 小时

---

## 验收标准

1. **路由切换**：侧边栏点击到页面内容展示 < 200ms，无黑屏
2. **首屏加载**：首次打开到可交互 < 1.5s（Tauri release build）
3. **长会话**：500 条消息滚动 60fps，无掉帧
4. **内存**：页面切换不泄漏，长时间运行内存稳定
5. **Web 端兼容**：Web 浏览器中同样可用（WASM SQLite 路径保留）

---

## 文件结构（目标）

```
src/
├── main.tsx                    # 入口
├── index.css                   # 全局样式 + 动画
├── router.tsx                  # 路由配置
├── components/
│   ├── app-shell.tsx           # 布局壳（侧边栏 + Outlet）
│   ├── float-window-toggle.tsx # 浮窗开关
│   ├── page-skeleton.tsx       # 通用骨架屏
│   └── chat/
│       ├── chat-bubble.tsx      # 消息气泡
│       ├── message-input.tsx    # 输入框
│       ├── message-list.tsx     # 虚拟列表
│       ├── model-switcher.tsx   # 模型切换
│       └── tool-mode-bar.tsx    # 工具模式
├── pages/
│   ├── chat.tsx                # ChatPage (lazy)
│   ├── desktop.tsx             # DesktopPage (lazy)
│   ├── float.tsx               # FloatPage (lazy)
│   ├── web.tsx                 # WebPage (lazy)
│   ├── models.tsx              # ModelsPage (lazy)
│   ├── skills.tsx              # SkillsPage (lazy)
│   └── settings.tsx            # SettingsPage (lazy)
├── stores/
│   ├── conversation-store.ts   # 会话
│   ├── message-store.ts        # 消息 + 流式
│   ├── tool-store.ts           # 工具模式
│   ├── model-config-store.ts   # 已有
│   └── settings-store.ts       # 已有
├── services/
│   ├── chat-service.ts         # 核心聊天逻辑
│   ├── desktop-service.ts      # 已有
│   ├── desktop-automation-agent.ts
│   ├── web-automation-agent.ts
│   └── extension-bridge.ts
├── adapters/
│   ├── openai.ts
│   ├── anthropic.ts
│   ├── google.ts
│   ├── model-call-service.ts
│   └── types.ts
├── types/
│   ├── message.ts
│   ├── provider.ts
│   └── skill.ts
├── utils/
│   ├── content.ts
│   ├── image.ts
│   ├── platform.ts
│   └── crypto.ts
├── db/
│   ├── index.ts
│   ├── adapter.ts
│   ├── tauri.ts
│   └── wasm.ts
├── skills/
│   ├── desktop.ts
│   ├── web.ts
│   ├── phone.ts
│   └── app-builder.ts
└── i18n/
    └── strings.ts
```

---

## 注意事项

1. **不要一次性全部重写** — 按步骤逐步迁移，每一步验证后再进行下一步
2. **Tauri 兼容** — 所有 `@tauri-apps/api` 调用保留 `try/catch`，Web 端 graceful fallback
3. **CSS 方案优先** — 页面过渡动画用 CSS（GPU 合成），避免 JS 动画（主线程）
4. **保持 Web 端兼容** — 改动不应破坏浏览器端使用（WASM SQLite 路径保留）
5. **Float 窗口独立路由** — `/float` 保持为独立页面，通过 Tauri WebviewWindow 创建
