---
id: desktop_screen
name: Desktop Screen Control
name_cn: 桌面屏幕控制
category: Device Automation
category_cn: 设备自动化
description: Control the Windows desktop via keyboard/mouse simulation, window management, screenshot OCR, clipboard, and application launching. For semantic UI element access (no coordinates), use the companion desktop_uia skill.
description_cn: 通过键鼠模拟、窗口管理、截图 OCR、剪贴板和应用启动控制 Windows 桌面。如需语义 UI 元素操作（无需坐标），请使用配套的 desktop_uia 技能。
usage: |
  ## Screenshot Usage

  Only use desktop_screenshot when you need to see the screen to understand user intent or locate UI elements. Do NOT use it when user sends you images or asks about content in their message.

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

  - For standard Windows apps, prefer the desktop_uia skill (semantic element access, no coordinates).
  - desktop_open_app supports Chinese aliases: "浏览器"→Chrome, "微信"→WeChat, "记事本"→Notepad, "计算器"→Calculator.
  - Always desktop_wait(500) after actions that trigger UI changes.
  - If stuck after 3 similar failed attempts, try visual fallback or desktop_done with explanation.
usage_cn: |
  ## 截图使用

  仅在需要查看屏幕来理解用户意图或定位 UI 元素时使用 desktop_screenshot。用户发送图片或询问消息中的内容时不要使用。

  ## 工具分类

  | 优先级 | 工具 | 适用场景 |
  |--------|------|----------|
  | 1. 视觉 | desktop_screenshot, desktop_screenshot_window, desktop_screenshot_region, desktop_ocr | 需要查看屏幕状态 |
  | 2. 输入 | desktop_click, desktop_type, desktop_press_key, desktop_drag, desktop_move_cursor, desktop_scroll | 鼠标键盘操作 |
  | 3. 窗口 | desktop_list_windows, desktop_focus_window, desktop_minimize_window, desktop_maximize_window, desktop_close_window, desktop_resize_window | 多窗口工作流 |
  | 4. 剪贴板 | desktop_get_clipboard, desktop_set_clipboard | 复制粘贴 |
  | 5. 应用 | desktop_open_app, desktop_list_apps | 启动 / 发现应用 |
  | 6. 辅助 | desktop_wait, desktop_done | 流程控制 |
  | 7. 代码 | code_exec | 数据转换、计算 |

  ## 使用技巧

  - 对标准 Windows 应用，优先使用 desktop_uia 技能（语义元素访问，无需坐标）。
  - desktop_open_app 支持中文别名："浏览器"→Chrome，"微信"→WeChat，"记事本"→Notepad，"计算器"→Calculator。
  - 每次触发 UI 变化的操作后，调用 desktop_wait(500) 等待界面响应。
  - 连续 3 次类似操作失败后，切换视觉兜底方案或调用 desktop_done 说明情况。
---

Control the Windows desktop via natural language.
Supports full desktop screenshot, window management, mouse/keyboard automation, and UI element detection.

## Tools

```json
[
  {
    "name": "desktop_screenshot",
    "description": "Take a screenshot. ALWAYS prefer hwnd (window-only capture = smaller image, faster LLM analysis, less noise). Only use fullscreen (no hwnd) when you have no target window. Use region for sub-area capture. If user sent an image and just asks about it, analyze the image directly without screenshot. Screenshot is only needed when comparing with screen or verifying screen state.",
    "name_cn": "截图。强烈推荐传 hwnd 只截目标窗口（图片更小、LLM 分析更快、干扰更少）。只有在没有目标窗口时才全屏截图。region 用于截取局部区域。用户发图片且只是询问图片内容时，直接分析图片不需要截图。仅在需要与屏幕对比或验证屏幕状态时才截图。",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Target window handle — ALWAYS pass this when you have a target window. Smaller image, faster analysis." },
        "region": { "type": "object", "description": "Sub-region to capture {left, top, width, height}. Use when you only need part of the screen.", "properties": { "left": { "type": "integer" }, "top": { "type": "integer" }, "width": { "type": "integer" }, "height": { "type": "integer" } } }
      }
    }
  },
  {
    "name": "desktop_list_windows",
    "description": "List all visible windows with their titles, handles, and positions. Use this to find windows to focus or interact with.",
    "name_cn": "列出窗口",
    "description_cn": "列出所有可见窗口的标题、句柄和位置。用于查找需要聚焦或操作的窗口。",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "desktop_focus_window",
    "description": "Bring a window to the foreground by its handle (hwnd).",
    "name_cn": "聚焦窗口",
    "description_cn": "通过窗口句柄（hwnd）将窗口切换到前台。",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Window handle" }
      },
      "required": ["hwnd"]
    }
  },
  {
    "name": "desktop_minimize_window",
    "description": "Minimize a window by its handle.",
    "name_cn": "最小化窗口",
    "description_cn": "最小化指定窗口。",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Window handle" }
      },
      "required": ["hwnd"]
    }
  },
  {
    "name": "desktop_maximize_window",
    "description": "Maximize a window by its handle.",
    "name_cn": "最大化窗口",
    "description_cn": "最大化指定窗口。",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Window handle" }
      },
      "required": ["hwnd"]
    }
  },
  {
    "name": "desktop_close_window",
    "description": "Close a window by sending WM_CLOSE.",
    "name_cn": "关闭窗口",
    "description_cn": "通过发送 WM_CLOSE 关闭指定窗口。",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Window handle" }
      },
      "required": ["hwnd"]
    }
  },
  {
    "name": "desktop_resize_window",
    "description": "Resize a window to the specified width and height.",
    "name_cn": "调整窗口大小",
    "description_cn": "将窗口调整为指定的宽度和高度。",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Window handle" },
        "width": { "type": "integer", "description": "New width in pixels" },
        "height": { "type": "integer", "description": "New height in pixels" }
      },
      "required": ["hwnd", "width", "height"]
    }
  },
  {
    "name": "desktop_get_clipboard",
    "description": "Get the current text content of the system clipboard.",
    "name_cn": "获取剪贴板",
    "description_cn": "获取系统剪贴板当前的文本内容。",
    "parameters": { "type": "object", "properties": {} }
  },
  {
    "name": "desktop_set_clipboard",
    "description": "Set text content to the system clipboard.",
    "name_cn": "设置剪贴板",
    "description_cn": "将文本内容写入系统剪贴板。",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string", "description": "Text to copy to clipboard" }
      },
      "required": ["text"]
    }
  },
  {
    "name": "desktop_ocr",
    "description": "Recognize text from an image using OCR. If no image is provided, captures the full screen.",
    "name_cn": "文字识别",
    "description_cn": "使用 OCR 识别图片中的文字。不提供图片时截取全屏识别。",
    "parameters": {
      "type": "object",
      "properties": {
        "image_base64": { "type": "string", "description": "Base64-encoded image (optional, screenshots full screen if omitted)" }
      }
    }
  },
  {
    "name": "desktop_click",
    "description": "Click the mouse at screen coordinates. Default: left-click once. Use button='right' for right-click (context menus). Use button='middle' for middle-click (open in new tab, close tab). Use clicks=2 to double-click (open files/folders). Prefer uia_click for standard Windows UI elements.",
    "name_cn": "桌面点击",
    "description_cn": "在屏幕坐标处点击鼠标。默认左键单击。button='right' 为右键（上下文菜单）。button='middle' 为中键（新标签打开/关闭标签）。clicks=2 为双击（打开文件/文件夹）。标准 Windows UI 元素优先用 uia_click。",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer", "description": "X coordinate on screen" },
        "y": { "type": "integer", "description": "Y coordinate on screen" },
        "button": { "type": "string", "description": "Which mouse button: 'left' (default), 'right', or 'middle'. Omit for left-click." },
        "clicks": { "type": "integer", "description": "Click count: 1 (default) or 2 (double-click). Omit for single-click." },
        "window_hwnd": { "type": "integer", "description": "Optional window handle — x,y are treated as offsets from the window's top-left corner" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "desktop_drag",
    "description": "Drag from one position to another. Moves cursor to start, holds mouse button, moves to end, releases. Use for drag-and-drop, sliders, drawing, text selection by dragging.",
    "name_cn": "拖动",
    "description_cn": "从一个位置拖动到另一个位置。移动光标到起点，按住鼠标，移动到终点后释放。用于拖拽、滑块、绘图、拖选文本。",
    "parameters": {
      "type": "object",
      "properties": {
        "start_x": { "type": "integer", "description": "Start X coordinate" },
        "start_y": { "type": "integer", "description": "Start Y coordinate" },
        "end_x": { "type": "integer", "description": "End X coordinate" },
        "end_y": { "type": "integer", "description": "End Y coordinate" },
        "duration_ms": { "type": "integer", "description": "Drag duration in ms (default 300, controls speed)" },
        "button": { "type": "string", "description": "Mouse button: left (default), right, middle" }
      },
      "required": ["start_x", "start_y", "end_x", "end_y"]
    }
  },
  {
    "name": "desktop_move_cursor",
    "description": "Move the mouse smoothly along a curved or straight path defined by an SVG path string. Optionally hold a mouse button during movement to draw curves, drag items, or perform gestures. Use this instead of desktop_drag when you need smooth/curved movement — the path can include bezier curves (C, Q), lines (L), and arcs.",
    "name_cn": "平滑移动光标",
    "description_cn": "沿 SVG path 定义的路径平滑移动鼠标，可按住按键实现画曲线/拖拽/手势。需要画曲线或平滑移动时优先用此工具，避免使用 desktop_drag。",
    "parameters": {
      "type": "object",
      "properties": {
        "path": { "type": "string", "description": "SVG path string defining the movement trajectory (e.g. 'M 100 100 C 150 50, 250 50, 300 100')" },
        "hold_button": { "type": "string", "description": "Mouse button to hold during movement: 'left', 'right', or 'middle'. Omit for pure cursor movement (no clicking/dragging)." },
        "duration_ms": { "type": "integer", "description": "Total movement duration in ms (optional, auto-calculated from path length if omitted)" },
        "window_hwnd": { "type": "integer", "description": "Optional window handle to adjust path coordinates relative to the window" }
      },
      "required": ["path"]
    }
  },
  {
    "name": "desktop_type",
    "description": "Type text using keyboard simulation (low-level). Use uia_type instead when possible.",
    "name_cn": "键盘输入",
    "description_cn": "通过键盘模拟输入文字（底层操作）。优先使用 uia_type。",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string", "description": "Text to type" }
      },
      "required": ["text"]
    }
  },
  {
    "name": "desktop_press_key",
    "description": "Press a keyboard key or key combo. Supports combos like 'Ctrl+A', 'Ctrl+Shift+S', 'Alt+F4'. Single keys: Enter, Escape, Tab, F1-F12, arrows, etc.",
    "name_cn": "桌面按键",
    "description_cn": "按下键盘按键或组合键。支持 'Ctrl+A'、'Ctrl+Shift+S'、'Alt+F4' 等组合。单键：Enter、Escape、Tab、F1-F12、方向键等。",
    "parameters": {
      "type": "object",
      "properties": {
        "key": { "type": "string", "description": "Key name or combo (e.g. 'Enter', 'Ctrl+A', 'Alt+Tab')" }
      },
      "required": ["key"]
    }
  },
  {
    "name": "desktop_key_down",
    "description": "Press and hold a keyboard key without releasing. Use with desktop_key_up for long presses or manual key combo control.",
    "name_cn": "键盘按下",
    "description_cn": "按住键盘按键不释放。与 desktop_key_up 配合用于长按或手动组合键控制。",
    "parameters": {
      "type": "object",
      "properties": {
        "key": { "type": "string", "description": "Key name (e.g. 'Shift', 'Ctrl', 'a')" }
      },
      "required": ["key"]
    }
  },
  {
    "name": "desktop_key_up",
    "description": "Release a keyboard key. Use with desktop_key_down for long presses or manual key combo control.",
    "name_cn": "键盘释放",
    "description_cn": "释放键盘按键。与 desktop_key_down 配合用于长按或手动组合键控制。",
    "parameters": {
      "type": "object",
      "properties": {
        "key": { "type": "string", "description": "Key name (e.g. 'Shift', 'Ctrl', 'a')" }
      },
      "required": ["key"]
    }
  },
  {
    "name": "desktop_scroll",
    "description": "Scroll the mouse wheel at coordinates.",
    "name_cn": "滚动",
    "description_cn": "在指定坐标处滚动鼠标滚轮。",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer" },
        "y": { "type": "integer" },
        "delta": { "type": "integer", "description": "Scroll amount, 120 = one notch" }
      },
      "required": ["x", "y", "delta"]
    }
  },
  {
    "name": "desktop_wait",
    "description": "Wait for a specified number of milliseconds.",
    "name_cn": "桌面等待",
    "description_cn": "等待指定的毫秒数。",
    "parameters": {
      "type": "object",
      "properties": {
        "milliseconds": { "type": "integer" }
      },
      "required": ["milliseconds"]
    }
  },
  {
    "name": "desktop_done",
    "description": "Signal that the automation task is complete.",
    "name_cn": "桌面完成任务",
    "description_cn": "标记自动化任务已完成。",
    "parameters": {
      "type": "object",
      "properties": {
        "message": { "type": "string", "description": "Summary of what was accomplished" }
      },
      "required": ["message"]
    }
  },
  {
    "name": "desktop_list_apps",
    "description": "List all installed applications on this computer. Use ONLY for exploration (e.g., user asks \"what apps do I have\"). Do NOT call before desktop_open_app.",
    "name_cn": "桌面列出应用",
    "description_cn": "列出电脑上所有已安装的应用。仅用于探索（如用户问「我有什么应用」）。不要在调用 desktop_open_app 前调用此工具。",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "desktop_open_app",
    "description": "Launch or focus an application. First checks running windows by title, then installed app cache. Returns error if not found anywhere. Priority: windowTitle (running window title match) > name (installed app lookup) > hwnd (direct handle).",
    "name_cn": "打开应用",
    "description_cn": "启动或激活应用。先查运行中窗口标题匹配，再查已安装应用缓存，都找不到则返回错误。优先级：windowTitle（运行窗口标题匹配）> name（已安装应用查找）> hwnd（已知句柄兜底）。",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "App name (e.g., chrome, notepad, wechat) or Chinese alias (浏览器, 记事本)" },
        "windowTitle": { "type": "string", "description": "Known window title to look up the app (used as fallback when name is not provided)" },
        "hwnd": { "type": "number", "description": "If you already know the window handle, pass it to skip launching entirely" }
      }
    }
  },
  {
    "name": "code_exec",
    "description": "Execute JavaScript code in a sandboxed environment. Use for data transformation (parse, filter, format), calculations, conditional logic, or combining results from multiple tools. Available: vars (read/write context), params (tool params), standard JS APIs (JSON, Math, Date, RegExp, Array). Return values are captured as result.",
    "name_cn": "执行代码",
    "description_cn": "在沙箱环境中执行 JavaScript 代码。用于数据转换（解析、过滤、格式化）、计算、条件逻辑或组合多个工具的结果。可用：vars（读写上下文变量）、params（工具参数）、标准 JS API（JSON、Math、Date、RegExp、Array）。返回值会作为 result 捕获。",
    "parameters": {
      "type": "object",
      "properties": {
        "code": { "type": "string", "description": "JavaScript code to execute. Use vars.xxx to read/write context variables." },
        "context": { "type": "object", "description": "Optional context variables to inject into vars (e.g. {clipboard: text, ocr: result})" }
      },
      "required": ["code"]
    }
  }
]
```
