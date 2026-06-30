---
name: web-screen
description: >-
  Launch and control a web browser via Playwright. Smart browser detection:
  connects to user's running browser first (with login state), then launches
  system Chrome/Edge with stealth extension, then bundled Chromium. This skill
  should be used when the user needs to browse the web, navigate to URLs,
  interact with web pages, fill forms, or execute custom Playwright scripts.
license: MIT
compatibility: Requires Tauri v2+, Python engine
usage: |-
  ## Quick Start

  1. **Launch browser**: web_launch — auto-detects running browser or launches Chrome/Edge
  2. **Navigate**: web_navigate({url:"https://example.com"})
  3. **Discover elements**: web_get_interactive — returns DOM nodes with selectors
  4. **Interact**: web_click({selector:"..."}) / web_fill({selector:"...", text:"..."})
  5. **Close**: web_close

  ## Smart Browser Detection

  web_launch uses this priority:
  1. Connect to running browser (keeps login state!)
  2. System Chrome/Edge + stealth extension
  3. System Chrome/Edge without extension
  4. Bundled Chromium

  ## Two tool layers work together

  | Layer | Tools | For |
  |-------|-------|-----|
  | Web | web_launch, web_navigate, web_get_interactive, web_click, web_fill, web_close | DOM-based operations |
  | Desktop | desktop_screenshot, desktop_type, desktop_press_key | OS-level operations |

  ## Tips

  - Call web_launch FIRST before any other web tool.
  - Use web_get_interactive to discover elements before clicking.
  - To reuse login state: start Chrome with --remote-debugging-port=9222 first.

tools:
  - name: web_launch
    description: >-
      Launch a browser for web automation. Smart detection: first tries to
      connect to user's already-open browser, then launches system Chrome/Edge
      with stealth extension.
    parameters:
      type: object
      properties:
        headless:
          type: boolean
          description: Run in headless mode (default false).
        channel:
          type: string
          description: Browser channel — 'chrome' (system Chrome), 'msedge' (system Edge). Omit to auto-detect.
        cdp_url:
          type: string
          description: CDP endpoint URL to connect to an existing browser.
        connect_existing:
          type: boolean
          description: If true (default), auto-detect and connect to user's running browser.
    returns: '{"success":true/false,"browser":"chrome/msedge/...","connected":true/false,"message":"status"}'

  - name: web_navigate
    description: Navigate the browser. Use url for goto, or action for back/forward.
    parameters:
      type: object
      properties:
        url:
          type: string
          description: URL to navigate to
        action:
          type: string
          description: Navigation action — 'goto' (default), 'back', 'forward'
    returns: '{"success":true/false,"url":"current page URL","title":"page title"}'

  - name: web_get_interactive
    description: >-
      Get all interactive elements from the current page via Playwright
      accessibility tree. Use this BEFORE web_click/web_fill to discover elements.
    parameters:
      type: object
      properties: {}
    returns: '{"nodes":[{"role":"button/textbox/link/...","name":"accessible name","selector":"CSS selector","clickable":true/false}],"interactiveCount":number}'

  - name: web_click
    description: Click an element by CSS selector or ARIA role+name. Use web_get_interactive first to find selectors.
    parameters:
      type: object
      properties:
        selector:
          type: string
          description: CSS selector (e.g. '#submit-btn', '.login-link')
        role:
          type: string
          description: ARIA role (e.g. 'button', 'link'). Use with 'name'.
        name:
          type: string
          description: Accessible name, used with 'role' (partial match)
    returns: '{"success":true/false,"info":"click result info"}'

  - name: web_fill
    description: Fill an input field by CSS selector.
    parameters:
      type: object
      properties:
        selector:
          type: string
          description: CSS selector for the input field
        text:
          type: string
          description: Text to fill
      required: [selector, text]
    returns: '{"success":true/false,"info":"fill result info"}'

  - name: web_close
    description: Close the browser instance.
    parameters:
      type: object
      properties: {}
    returns: '{"success":true/false,"message":"closed"}'

  - name: web_wait
    description: Wait for a specified duration.
    parameters:
      type: object
      properties:
        durationMs:
          type: integer
          description: Wait duration in milliseconds
      required: [durationMs]
    returns: '{"action":"wait","durationMs":number}'

  - name: web_done
    description: Mark the web automation task as complete.
    parameters:
      type: object
      properties:
        summary:
          type: string
          description: Summary of what was accomplished
      required: [summary]
    returns: '{"action":"done","message":"task summary"}'

  - name: run_playwright_script
    description: >-
      Execute a Python script in a sandboxed Playwright environment. Available
      functions: navigate(url), click(selector), fill(selector, value),
      scroll(direction, amount), get_interactive(), get_content(text_only),
      evaluate(js), wait_for(selector), screenshot_b64(), close_browser().
      Set a `result` variable to return data.
    parameters:
      type: object
      properties:
        code:
          type: string
          description: Python code to execute
        timeout_sec:
          type: integer
          description: Execution timeout in seconds (default 60)
      required: [code]
    returns: '{"success":true/false,"output":"stdout text","result":"returned value","error":"error message if failed"}'

x-i18n:
  name_cn: 网页浏览器控制
  description_cn: 通过 Playwright 启动和控制浏览器。智能检测：优先连接用户已打开的浏览器，其次启动系统 Chrome/Edge。
  category_cn: 设备自动化
  usage_cn: |-
    ## 快速开始

    1. **启动浏览器**：web_launch
    2. **导航**：web_navigate({url:"https://example.com"})
    3. **发现元素**：web_get_interactive
    4. **交互**：web_click / web_fill
    5. **关闭**：web_close

    ## 智能浏览器检测

    web_launch 使用以下优先级：
    1. 连接已打开的浏览器（保持登录态！）
    2. 系统 Chrome/Edge + 隐身扩展
    3. 系统 Chrome/Edge（无扩展）
    4. 内置 Chromium

    ## 两层工具配合使用

    | 层级 | 工具 | 用途 |
    |------|------|------|
    | Web | web_launch, web_navigate, web_get_interactive, web_click, web_fill | DOM 操作 |
    | 桌面 | desktop_screenshot, desktop_type, desktop_press_key | 系统级操作 |
  tools:
    web_launch:
      name_cn: 启动浏览器
      description_cn: 启动浏览器进行网页自动化，智能检测可用浏览器。
    web_navigate:
      name_cn: 浏览器导航
      description_cn: 浏览器导航。用 url 跳转页面，用 action 前进/后退。
    web_get_interactive:
      name_cn: 获取可交互元素
      description_cn: 通过 Playwright 无障碍树获取当前页面所有可交互元素。
    web_click:
      name_cn: 点击元素
      description_cn: 通过 CSS 选择器或 ARIA 角色+名称点击元素。
    web_fill:
      name_cn: 填写输入框
      description_cn: 通过 CSS 选择器填写输入框。
    web_close:
      name_cn: 关闭浏览器
      description_cn: 关闭浏览器实例。
    web_wait:
      name_cn: 等待
      description_cn: 等待指定时长。
    web_done:
      name_cn: 完成任务
      description_cn: 标记网页自动化任务已完成。
    run_playwright_script:
      name_cn: 执行 Playwright 脚本
      description_cn: 在沙箱中执行 Python 脚本操作浏览器。
---
