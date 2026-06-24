---
id: web_screen
name: Web Screen Control
name_cn: 网页浏览器控制
category: Device Automation
category_cn: 设备自动化
description: Launch and control a web browser via Playwright. Smart browser detection: connects to user's running browser first (with login state), then launches system Chrome/Edge with stealth extension, then bundled Chromium. Use web tools for DOM-based interactions (click by selector, fill forms), and desktop tools for OS-level actions (screenshot, type text, press keys).
description_cn: 通过 Playwright 启动和控制浏览器。智能检测：优先连接用户已打开的浏览器（保持登录态），其次启动系统 Chrome/Edge 隐身扩展，最后内置 Chromium。用 web 工具做 DOM 操作（选择器点击、填表），用桌面工具做系统级操作（截图、输入、按键）。
usage: |
  ## Quick Start

  1. **Launch browser**: web_launch — auto-detects running browser or launches Chrome/Edge
  2. **Navigate**: web_navigate({url:"https://example.com"})
  3. **Discover elements**: web_get_interactive — returns DOM nodes with selectors
  4. **Interact**: web_click({selector:"..."}) / web_fill({selector:"...", text:"..."})
  5. **Close**: web_close

  ## Smart Browser Detection

  web_launch uses this priority:
  1. **Connect to running browser** — If Chrome/Edge is open with `--remote-debugging-port`, connects directly (keeps login state!)
  2. **System Chrome/Edge + stealth extension** — Best anti-bot detection bypass
  3. **System Chrome/Edge without extension**
  4. **Bundled Chromium** — Last resort

  Set `connect_existing: false` to skip detection and always launch new.

  ## Two tool layers work together

  | Layer | Tools | For |
  |-------|-------|-----|
  | Web (this skill) | web_launch, web_navigate, web_get_interactive, web_click, web_fill, web_close | DOM-based: selectors, forms, page navigation |
  | Desktop | desktop_screenshot, desktop_type, desktop_press_key, desktop_scroll | OS-level: screenshots, keyboard, scrolling |

  ## Tips

  - Call web_launch FIRST before any other web tool.
  - Use web_get_interactive to discover elements — it returns CSS selectors you can pass to web_click/web_fill.
  - After web_navigate, wait briefly for page load.
  - For screenshots of the browser window, use desktop_screenshot({hwnd}).
  - For typing into focused inputs, use desktop_type({text}).
  - To reuse login state: start Chrome with `chrome.exe --remote-debugging-port=9222`, then web_launch will auto-connect.
usage_cn: |
  ## 快速开始

  1. **启动浏览器**：web_launch — 自动检测已打开的浏览器或启动 Chrome/Edge
  2. **导航**：web_navigate({url:"https://example.com"})
  3. **发现元素**：web_get_interactive — 返回带选择器的 DOM 节点
  4. **交互**：web_click({selector:"..."}) / web_fill({selector:"...", text:"..."})
  5. **关闭**：web_close

  ## 智能浏览器检测

  web_launch 使用以下优先级：
  1. **连接已打开的浏览器** — 如果 Chrome/Edge 已打开且带 `--remote-debugging-port`，直接连接（保持登录态！）
  2. **系统 Chrome/Edge + 隐身扩展** — 最佳反爬虫绕过
  3. **系统 Chrome/Edge（无扩展）**
  4. **内置 Chromium** — 最后手段

  设置 `connect_existing: false` 跳过检测，直接启动新浏览器。

  ## 两层工具配合使用

  | 层级 | 工具 | 用途 |
  |------|------|------|
  | Web（本技能） | web_launch, web_navigate, web_get_interactive, web_click, web_fill, web_close | DOM 操作：选择器点击、填表、页面导航 |
  | 桌面 | desktop_screenshot, desktop_type, desktop_press_key, desktop_scroll | 系统级：截图、键盘输入、滚动 |

  ## 使用技巧

  - 使用任何 web 工具前，必须先调用 web_launch。
  - 用 web_get_interactive 发现元素 — 返回的 CSS 选择器可传给 web_click/web_fill。
  - web_navigate 后等待页面加载完成。
  - 浏览器窗口截图用 desktop_screenshot({hwnd})。
  - 在已聚焦的输入框输入文字用 desktop_type({text})。
  - 复用登录态：先用 `chrome.exe --remote-debugging-port=9222` 启动 Chrome，web_launch 会自动连接。
---

Launch and control a web browser via Playwright.
Supports DOM inspection, element interaction, form filling, and navigation.
For OS-level actions (screenshot, keyboard, scroll), use desktop tools.

## Tools

```json
[
  {
    "name": "web_launch",
    "description": "Launch a browser for web automation. Smart detection: first tries to connect to user's already-open browser (Chrome/Edge with debug port), then launches system Chrome/Edge with stealth extension (anti-bot bypass), then plain Chrome/Edge, then bundled Chromium. Set connect_existing=false to skip detection and always launch new.",
    "name_cn": "启动浏览器",
    "description_cn": "启动浏览器进行网页自动化。智能检测：优先连接用户已打开的浏览器（Chrome/Edge 调试端口），其次启动带隐身扩展的 Chrome/Edge（绕过反爬），再启动普通 Chrome/Edge，最后内置 Chromium。设置 connect_existing=false 跳过检测直接启动新浏览器。",
    "parameters": {
      "type": "object",
      "properties": {
        "headless": { "type": "boolean", "description": "Run in headless mode (default false). Extension mode requires headless=false." },
        "channel": { "type": "string", "description": "Browser channel: 'chrome' (system Chrome), 'msedge' (system Edge). Omit to auto-detect." },
        "cdp_url": { "type": "string", "description": "CDP endpoint URL to connect to an existing browser (e.g. 'http://localhost:9222'). When set, connects directly via CDP. Use for login state." },
        "connect_existing": { "type": "boolean", "description": "If true (default), auto-detect and connect to user's running browser. Set false to always launch new browser." }
      }
    },
    "returns": "{\"success\":true/false,\"browser\":\"chrome/msedge/...\",\"connected\":true/false,\"message\":\"status description\",\"debugPort\":number (if available)}"
  },
  {
    "name": "web_navigate",
    "description": "Navigate the browser. Use url for goto, or action for back/forward.",
    "name_cn": "浏览器导航",
    "description_cn": "浏览器导航。用 url 跳转页面，用 action 前进/后退。",
    "parameters": {
      "type": "object",
      "properties": {
        "url": { "type": "string", "description": "URL to navigate to (required when action is 'goto')" },
        "action": { "type": "string", "description": "Navigation action: 'goto' (default, requires url), 'back', 'forward'" }
      }
    },
    "returns": "{\"success\":true/false,\"url\":\"current page URL\",\"title\":\"page title\"}"
  },
  {
    "name": "web_get_interactive",
    "description": "Get all interactive elements from the current page via Playwright accessibility tree. Returns DOM nodes with roles, names, and CSS selectors. Use this BEFORE web_click/web_fill to discover available elements.",
    "name_cn": "获取可交互元素",
    "description_cn": "通过 Playwright 无障碍树获取当前页面所有可交互元素，返回角色、名称和 CSS 选择器。在 web_click/web_fill 前优先调用此工具发现元素。",
    "parameters": { "type": "object", "properties": {} },
    "returns": "{\"nodes\":[{\"role\":\"button/textbox/link/...\",\"name\":\"accessible name\",\"selector\":\"CSS selector\",\"clickable\":true/false}],\"interactiveCount\":number}"
  },
  {
    "name": "web_click",
    "description": "Click an element by CSS selector or ARIA role+name. Use web_get_interactive first to find selectors.",
    "name_cn": "点击元素",
    "description_cn": "通过 CSS 选择器或 ARIA 角色+名称点击元素。先用 web_get_interactive 获取选择器。",
    "parameters": {
      "type": "object",
      "properties": {
        "selector": { "type": "string", "description": "CSS selector (e.g. '#submit-btn', '.login-link')" },
        "role": { "type": "string", "description": "ARIA role (e.g. 'button', 'link'). Use with 'name' instead of selector." },
        "name": { "type": "string", "description": "Accessible name, used with 'role' (partial match)" }
      }
    },
    "returns": "{\"success\":true/false,\"info\":\"click result info\"}"
  },
  {
    "name": "web_fill",
    "description": "Fill an input field by CSS selector. Sets the value directly (triggers input/change events).",
    "name_cn": "填写输入框",
    "description_cn": "通过 CSS 选择器填写输入框。直接设置值（触发 input/change 事件）。",
    "parameters": {
      "type": "object",
      "properties": {
        "selector": { "type": "string", "description": "CSS selector for the input field" },
        "text": { "type": "string", "description": "Text to fill" }
      },
      "required": ["selector", "text"]
    },
    "returns": "{\"success\":true/false,\"info\":\"fill result info\"}"
  },
  {
    "name": "web_close",
    "description": "Close the browser instance.",
    "name_cn": "关闭浏览器",
    "description_desc": "关闭浏览器实例。",
    "parameters": { "type": "object", "properties": {} },
    "returns": "{\"success\":true/false,\"message\":\"closed\"}"
  },
  {
    "name": "web_wait",
    "description": "Wait for a specified duration.",
    "name_cn": "等待",
    "description_cn": "等待指定时长。",
    "parameters": {
      "type": "object",
      "properties": {
        "durationMs": { "type": "integer", "description": "Wait duration in milliseconds" }
      },
      "required": ["durationMs"]
    },
    "returns": "{\"action\":\"wait\",\"durationMs\":number}"
  },
  {
    "name": "web_done",
    "description": "Mark the web automation task as complete.",
    "name_cn": "完成任务",
    "description_cn": "标记网页自动化任务已完成。",
    "parameters": {
      "type": "object",
      "properties": {
        "summary": { "type": "string", "description": "Summary of what was accomplished" }
      },
      "required": ["summary"]
    },
    "returns": "{\"action\":\"done\",\"message\":\"task summary\"}"
  },
  {
    "name": "run_playwright_script",
    "description": "Execute a Python script in a sandboxed Playwright environment. Available functions: navigate(url), click(selector), fill(selector, value), scroll(direction, amount), get_interactive(), get_content(text_only), evaluate(js), wait_for(selector), screenshot_b64(), close_browser(). Also available: page (Playwright Page object), browser (Browser object). Set a `result` variable to return data. Allowed imports: time, json, re, base64, math.",
    "name_cn": "执行 Playwright 脚本",
    "description_cn": "在沙箱中执行 Python 脚本。可用函数：navigate(url), click(selector), fill(selector, value), scroll(direction, amount), get_interactive(), get_content(text_only), evaluate(js), wait_for(selector), screenshot_b64(), close_browser()。还有 page（Page 对象）、browser（Browser 对象）可直接使用。设置 result 变量返回数据。允许导入：time, json, re, base64, math。",
    "parameters": {
      "type": "object",
      "properties": {
        "code": { "type": "string", "description": "Python code to execute. Use navigate/click/fill/scroll/get_interactive/get_content/evaluate for web operations. Set `result` variable to return data." },
        "timeout_sec": { "type": "integer", "description": "Execution timeout in seconds (default 60)" }
      },
      "required": ["code"]
    },
    "returns": "{\"success\":true/false,\"output\":\"stdout text\",\"result\":\"returned value\",\"error\":\"error message if failed\"}"
  }
]
```
