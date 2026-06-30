---
name: desktop-screen
description: >-
  Control the Windows desktop via keyboard/mouse simulation, window management,
  screenshot OCR, clipboard, and application launching. This skill should be
  used when the user needs to take screenshots, click on screen coordinates,
  type text, press keys, manage windows, or launch applications.
license: MIT
compatibility: Requires Tauri v2+, Windows
usage: |-
  ## Screenshot Usage

  Only use desktop_screenshot when you need to see the screen to understand
  user intent or locate UI elements. Do NOT use it when user sends you images
  or asks about content in their message.

  ## Tool Categories

  | Priority | Tools | When |
  |----------|-------|------|
  | 1. Visual | desktop_screenshot, desktop_ocr | Need to see screen state |
  | 2. Input | desktop_click, desktop_type, desktop_press_key, desktop_drag, desktop_move_cursor, desktop_scroll | Mouse & keyboard |
  | 3. Window | desktop_list_windows, desktop_focus_window, desktop_minimize_window, desktop_maximize_window, desktop_close_window, desktop_resize_window | Multi-window workflows |
  | 4. Clipboard | desktop_get_clipboard, desktop_set_clipboard | Copy/paste |
  | 5. Apps | desktop_open_app, desktop_list_apps | Starting / discovering apps |
  | 6. Utilities | desktop_wait, desktop_done | Flow control |
  | 7. Code | code_exec | Data transformation, calculations |

  ## Tips

  - For standard Windows apps, prefer the desktop_uia skill.
  - desktop_open_app supports Chinese aliases: "浏览器"→Chrome, "微信"→WeChat, etc.
  - Always desktop_wait(500) after actions that trigger UI changes.
  - If stuck after 3 similar failed attempts, try visual fallback.

tools:
  - name: desktop_screenshot
    description: >-
      Take a screenshot. ALWAYS prefer hwnd (window-only capture = smaller
      image, faster LLM analysis, less noise). Only use fullscreen when you
      have no target window. Use region for sub-area capture.
    parameters:
      type: object
      properties:
        hwnd:
          type: integer
          description: Target window handle — ALWAYS pass this when you have a target window.
        region:
          type: object
          properties:
            left: { type: integer }
            top: { type: integer }
            width: { type: integer }
            height: { type: integer }
          description: Sub-region to capture {left, top, width, height}
    returns: The screenshot is injected as a multimodal image message directly into the conversation.

  - name: desktop_list_windows
    description: List all visible windows with their titles, handles, and positions.
    parameters:
      type: object
      properties: {}
    returns: '{"windows":[{"hwnd":number,"title":"string","x":number,"y":number,"width":number,"height":number}],"count":number}'

  - name: desktop_focus_window
    description: Bring a window to the foreground by its handle (hwnd).
    parameters:
      type: object
      properties:
        hwnd:
          type: integer
          description: Window handle
      required: [hwnd]
    returns: '{"success":true/false,"hwnd":number,"windowTitle":"string"}'

  - name: desktop_minimize_window
    description: Minimize a window by its handle.
    parameters:
      type: object
      properties:
        hwnd:
          type: integer
          description: Window handle
      required: [hwnd]

  - name: desktop_maximize_window
    description: Maximize a window by its handle.
    parameters:
      type: object
      properties:
        hwnd:
          type: integer
          description: Window handle
      required: [hwnd]

  - name: desktop_close_window
    description: Close a window by sending WM_CLOSE.
    parameters:
      type: object
      properties:
        hwnd:
          type: integer
          description: Window handle
      required: [hwnd]
    returns: '{"success":true/false,"hwnd":number}'

  - name: desktop_resize_window
    description: Resize a window to the specified width and height.
    parameters:
      type: object
      properties:
        hwnd:
          type: integer
          description: Window handle
        width:
          type: integer
          description: New width in pixels
        height:
          type: integer
          description: New height in pixels
      required: [hwnd, width, height]
    returns: '{"success":true/false,"hwnd":number}'

  - name: desktop_get_clipboard
    description: Get the current text content of the system clipboard.
    parameters:
      type: object
      properties: {}
    returns: '{"text":"clipboard text content (string)"}'

  - name: desktop_set_clipboard
    description: Set text content to the system clipboard.
    parameters:
      type: object
      properties:
        text:
          type: string
          description: Text to copy to clipboard
      required: [text]
    returns: '{"success":true,"text":"the text that was set"}'

  - name: desktop_ocr
    description: >-
      Recognize text from an image using OCR. If no image is provided,
      captures the full screen.
    parameters:
      type: object
      properties:
        image_base64:
          type: string
          description: Base64-encoded image (optional, screenshots full screen if omitted)
    returns: '{"texts":[{"text":"recognized text","bbox":{"left":number,"top":number,"width":number,"height":number},"confidence":number}],"raw":"full OCR result"}'

  - name: desktop_click
    description: >-
      Click the mouse at screen coordinates. Default: left-click once. Use
      button='right' for right-click (context menus). Use clicks=2 for double-click.
      Prefer uia_click for standard Windows UI elements.
    parameters:
      type: object
      properties:
        x:
          type: integer
          description: X coordinate on screen
        y:
          type: integer
          description: Y coordinate on screen
        button:
          type: string
          description: Which mouse button — 'left' (default), 'right', or 'middle'
        clicks:
          type: integer
          description: Click count — 1 (default) or 2 (double-click)
        window_hwnd:
          type: integer
          description: Optional window handle — x,y treated as offsets from window top-left
      required: [x, y]
    returns: '{"action":"desktop_click","x":number,"y":number,"button":"left/right/middle","clicks":1/2,"region_screenshot":"base64 data URL"}'

  - name: desktop_drag
    description: >-
      Drag from one position to another. Moves cursor to start, holds mouse
      button, moves to end, releases.
    parameters:
      type: object
      properties:
        start_x: { type: integer, description: Start X coordinate }
        start_y: { type: integer, description: Start Y coordinate }
        end_x: { type: integer, description: End X coordinate }
        end_y: { type: integer, description: End Y coordinate }
        duration_ms: { type: integer, description: Drag duration in ms (default 300) }
        button: { type: string, description: Mouse button — left (default), right, middle }
      required: [start_x, start_y, end_x, end_y]
    returns: '{"action":"desktop_drag","from":{"x":number,"y":number},"to":{"x":number,"y":number},"region_screenshot":"base64 data URL"}'

  - name: desktop_move_cursor
    description: >-
      Move the mouse smoothly along a curved or straight path defined by an
      SVG path string. Use this instead of desktop_drag for smooth/curved movement.
    parameters:
      type: object
      properties:
        path:
          type: string
          description: SVG path string defining the movement trajectory
        hold_button:
          type: string
          description: Mouse button to hold during movement — 'left', 'right', or 'middle'
        duration_ms:
          type: integer
          description: Total movement duration in ms
        window_hwnd:
          type: integer
          description: Optional window handle for coordinate adjustment
      required: [path]
    returns: '{"action":"desktop_move_cursor","path":"the SVG path used","waypoints":number,"durationMs":number}'

  - name: desktop_type
    description: >-
      Type text using keyboard simulation (low-level). Use uia_type instead
      when possible.
    parameters:
      type: object
      properties:
        text:
          type: string
          description: Text to type
      required: [text]
    returns: '{"action":"desktop_type","text":"the text typed"}'

  - name: desktop_press_key
    description: >-
      Press a keyboard key or key combo. Supports combos like 'Ctrl+A',
      'Ctrl+Shift+S', 'Alt+F4'. Single keys: Enter, Escape, Tab, F1-F12, arrows.
    parameters:
      type: object
      properties:
        key:
          type: string
          description: Key name or combo (e.g. 'Enter', 'Ctrl+A', 'Alt+Tab')
      required: [key]
    returns: '{"action":"desktop_press_key","key":"the key/combo pressed"}'

  - name: desktop_key_down
    description: Press and hold a keyboard key without releasing.
    parameters:
      type: object
      properties:
        key:
          type: string
          description: Key name (e.g. 'Shift', 'Ctrl', 'a')
      required: [key]

  - name: desktop_key_up
    description: Release a keyboard key. Use with desktop_key_down for long presses.
    parameters:
      type: object
      properties:
        key:
          type: string
          description: Key name (e.g. 'Shift', 'Ctrl', 'a')
      required: [key]

  - name: desktop_scroll
    description: Scroll the mouse wheel at coordinates.
    parameters:
      type: object
      properties:
        x: { type: integer }
        y: { type: integer }
        delta:
          type: integer
          description: Scroll amount, 120 = one notch
      required: [x, y, delta]
    returns: '{"action":"desktop_scroll","x":number,"y":number,"delta":number}'

  - name: desktop_wait
    description: Wait for a specified number of milliseconds.
    parameters:
      type: object
      properties:
        milliseconds:
          type: integer
          description: Number of milliseconds to wait
      required: [milliseconds]
    returns: '{"action":"desktop_wait","milliseconds":number}'

  - name: desktop_done
    description: Signal that the automation task is complete.
    parameters:
      type: object
      properties:
        message:
          type: string
          description: Summary of what was accomplished
      required: [message]
    returns: '{"action":"desktop_done","message":"the completion message"}'

  - name: desktop_list_apps
    description: List all installed applications on this computer. Use ONLY for exploration.
    parameters:
      type: object
      properties: {}
    returns: '{"apps":[{"name":"app name","path":"executable path","icon":"base64"}],"count":number}'

  - name: desktop_open_app
    description: >-
      Launch or focus an application. First checks running windows by title,
      then installed app cache.
    parameters:
      type: object
      properties:
        name:
          type: string
          description: App name (e.g., chrome, notepad, wechat) or Chinese alias
        windowTitle:
          type: string
          description: Known window title to look up the app
        hwnd:
          type: number
          description: If you already know the window handle, pass it directly
    returns: '{"action":"desktop_open_app","name":"app name","success":true/false,"hwnd":number}'

  - name: code_exec
    description: >-
      Execute JavaScript code in a sandboxed environment. Use for data
      transformation, calculations, or combining results from multiple tools.
    parameters:
      type: object
      properties:
        code:
          type: string
          description: JavaScript code to execute
        context:
          type: object
          description: Optional context variables to inject into vars
      required: [code]

x-i18n:
  name_cn: 桌面屏幕控制
  description_cn: 通过键鼠模拟、窗口管理、截图 OCR、剪贴板和应用启动控制 Windows 桌面。
  category_cn: 设备自动化
  usage_cn: |-
    ## 截图使用

    仅在需要查看屏幕来理解用户意图或定位 UI 元素时使用 desktop_screenshot。

    ## 工具分类

    | 优先级 | 工具 | 适用场景 |
    |--------|------|----------|
    | 1. 视觉 | desktop_screenshot 等 | 需要查看屏幕状态 |
    | 2. 输入 | desktop_click 等 | 鼠标键盘操作 |
    | 3. 窗口 | desktop_list_windows 等 | 多窗口工作流 |
    | 4. 剪贴板 | desktop_get_clipboard 等 | 复制粘贴 |
    | 5. 应用 | desktop_open_app 等 | 启动 / 发现应用 |
    | 6. 辅助 | desktop_wait 等 | 流程控制 |
    | 7. 代码 | code_exec | 数据转换、计算 |

    ## 使用技巧

    - 对标准 Windows 应用，优先使用 desktop_uia 技能
    - desktop_open_app 支持中文别名
    - 每次触发 UI 变化的操作后，调用 desktop_wait(500)
    - 连续 3 次类似操作失败后，切换视觉兜底方案
  tools:
    desktop_screenshot:
      name_cn: 截图
      description_cn: 截取屏幕截图。强烈推荐传 hwnd 只截目标窗口。
    desktop_list_windows:
      name_cn: 列出窗口
      description_cn: 列出所有可见窗口的标题、句柄和位置。
    desktop_focus_window:
      name_cn: 聚焦窗口
      description_cn: 通过窗口句柄将窗口切换到前台。
    desktop_minimize_window:
      name_cn: 最小化窗口
      description_cn: 最小化指定窗口。
    desktop_maximize_window:
      name_cn: 最大化窗口
      description_cn: 最大化指定窗口。
    desktop_close_window:
      name_cn: 关闭窗口
      description_cn: 通过发送 WM_CLOSE 关闭指定窗口。
    desktop_resize_window:
      name_cn: 调整窗口大小
      description_cn: 将窗口调整为指定的宽度和高度。
    desktop_get_clipboard:
      name_cn: 获取剪贴板
      description_cn: 获取系统剪贴板当前的文本内容。
    desktop_set_clipboard:
      name_cn: 设置剪贴板
      description_cn: 将文本内容写入系统剪贴板。
    desktop_ocr:
      name_cn: 文字识别
      description_cn: 使用 OCR 识别图片中的文字。
    desktop_click:
      name_cn: 桌面点击
      description_cn: 在屏幕坐标处点击鼠标。标准 Windows UI 元素优先用 uia_click。
    desktop_drag:
      name_cn: 拖动
      description_cn: 从一个位置拖动到另一个位置。用于拖拽、滑块、绘图等。
    desktop_move_cursor:
      name_cn: 平滑移动光标
      description_cn: 沿 SVG path 定义的路径平滑移动鼠标。
    desktop_type:
      name_cn: 键盘输入
      description_cn: 通过键盘模拟输入文字。优先使用 uia_type。
    desktop_press_key:
      name_cn: 桌面按键
      description_cn: 按下键盘按键或组合键。
    desktop_key_down:
      name_cn: 键盘按下
      description_cn: 按住键盘按键不释放。
    desktop_key_up:
      name_cn: 键盘释放
      description_cn: 释放键盘按键。
    desktop_scroll:
      name_cn: 滚动
      description_cn: 在指定坐标处滚动鼠标滚轮。
    desktop_wait:
      name_cn: 桌面等待
      description_cn: 等待指定的毫秒数。
    desktop_done:
      name_cn: 桌面完成任务
      description_cn: 标记自动化任务已完成。
    desktop_list_apps:
      name_cn: 桌面列出应用
      description_cn: 列出电脑上所有已安装的应用。
    desktop_open_app:
      name_cn: 打开应用
      description_cn: 启动或激活应用。
    code_exec:
      name_cn: 执行代码
      description_cn: 在沙箱环境中执行 JavaScript 代码。
---
