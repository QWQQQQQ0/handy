---
id: desktop_screen
name: Desktop Screen Control
category: Device Automation
---

Control the Windows desktop via win32 native APIs.
Supports full desktop screenshot, window management, mouse/keyboard automation, and UI element detection.

## Tools

```json
[
  {
    "name": "desktop_screenshot",
    "description": "Take a screenshot of the entire desktop. Returns a PNG image. Use this to see what's on screen before interacting.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "desktop_list_windows",
    "description": "List all visible windows with their titles, handles, and positions. Use this to find windows to focus or interact with.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "desktop_focus_window",
    "description": "Bring a window to the foreground by its handle (hwnd). Use desktop_list_windows first to get the handle.",
    "parameters": {
      "type": "object",
      "properties": {
        "hwnd": { "type": "integer", "description": "Window handle from desktop_list_windows" }
      },
      "required": ["hwnd"]
    }
  },
  {
    "name": "desktop_click",
    "description": "Click at absolute screen coordinates (x, y). Use desktop_screenshot first to see the screen and determine coordinates.",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer", "description": "X coordinate on screen" },
        "y": { "type": "integer", "description": "Y coordinate on screen" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "desktop_double_click",
    "description": "Double-click at absolute screen coordinates (x, y).",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer", "description": "X coordinate on screen" },
        "y": { "type": "integer", "description": "Y coordinate on screen" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "desktop_right_click",
    "description": "Right-click at absolute screen coordinates (x, y).",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer", "description": "X coordinate on screen" },
        "y": { "type": "integer", "description": "Y coordinate on screen" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "desktop_type",
    "description": "Type text using keyboard simulation. Works with any focused application.",
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
    "description": "Press a keyboard key. Common keys: Enter, Escape, Tab, Backspace, Delete, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, F1-F12.",
    "parameters": {
      "type": "object",
      "properties": {
        "key": { "type": "string", "description": "Key name to press (e.g., 'Enter', 'Ctrl+C', 'Alt+Tab')" }
      },
      "required": ["key"]
    }
  },
  {
    "name": "desktop_scroll",
    "description": "Scroll the mouse wheel at coordinates (x, y). Positive delta scrolls down.",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer", "description": "X coordinate" },
        "y": { "type": "integer", "description": "Y coordinate" },
        "delta": { "type": "integer", "description": "Scroll amount (positive=down, negative=up, 120=one notch)" }
      },
      "required": ["x", "y", "delta"]
    }
  },
  {
    "name": "desktop_move_mouse",
    "description": "Move the mouse cursor to coordinates (x, y) without clicking.",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "integer", "description": "X coordinate" },
        "y": { "type": "integer", "description": "Y coordinate" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "desktop_wait",
    "description": "Wait for a specified number of milliseconds before the next action. Use this to allow the system to respond to previous actions.",
    "parameters": {
      "type": "object",
      "properties": {
        "milliseconds": { "type": "integer", "description": "Time to wait in milliseconds" }
      },
      "required": ["milliseconds"]
    }
  },
  {
    "name": "desktop_done",
    "description": "Signal that the automation task is complete. Call this when the goal has been achieved.",
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
    "description": "List all installed applications on this computer. Returns app names, IDs, and source (Start Menu or Registry). Use this to find apps the user wants to open.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "desktop_open_app",
    "description": "Launch/open an application by name (e.g., 'Notepad', 'WeChat', 'Chrome') or full path to the executable. Use desktop_list_apps first to find the correct app name.",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "App name or full executable path" }
      },
      "required": ["name"]
    }
  }
]
```
