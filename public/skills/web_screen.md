---
id: web_screen
name: Web Screen Control
category: Device Automation
---

View and control web pages via browser extension or generated app iframe.
Supports DOM inspection, element interaction, form filling, navigation, and more.

## Tools

```json
[
  {
    "name": "web_get_ui",
    "description": "Get the DOM tree of the current page. Returns an array of interactive node objects with: tag, text, selector, bounds (x/y/width/height), clickable, inViewport, inputType, href. Use this before interacting to understand the page structure.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "web_screenshot",
    "description": "Take a screenshot of the current browser tab. Returns a base64-encoded JPEG image.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "web_click",
    "description": "Click at coordinates (x, y) on the page. Use web_get_ui first to find element coordinates.",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "number", "description": "X coordinate on the page" },
        "y": { "type": "number", "description": "Y coordinate on the page" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "web_click_element",
    "description": "Click an element by CSS selector. More reliable than coordinates. Example selectors: '#search', '.btn-primary', 'input[name=\"q\"]'.",
    "parameters": {
      "type": "object",
      "properties": {
        "selector": { "type": "string", "description": "CSS selector of the element to click" }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "web_type",
    "description": "Type text into the currently focused input field. Click the input first to focus it.",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string", "description": "Text to type" }
      },
      "required": ["text"]
    }
  },
  {
    "name": "web_fill",
    "description": "Fill a specific input field by CSS selector. Focuses the field and sets its value.",
    "parameters": {
      "type": "object",
      "properties": {
        "selector": { "type": "string", "description": "CSS selector of the input field" },
        "text": { "type": "string", "description": "Text to fill" }
      },
      "required": ["selector", "text"]
    }
  },
  {
    "name": "web_scroll",
    "description": "Scroll the page by (dx, dy) pixels. Positive dy scrolls down (300 ≈ one viewport).",
    "parameters": {
      "type": "object",
      "properties": {
        "dx": { "type": "number", "description": "Horizontal scroll in pixels" },
        "dy": { "type": "number", "description": "Vertical scroll in pixels" }
      },
      "required": ["dx", "dy"]
    }
  },
  {
    "name": "web_scroll_into_view",
    "description": "Scroll until an element identified by CSS selector is visible in the viewport.",
    "parameters": {
      "type": "object",
      "properties": {
        "selector": { "type": "string", "description": "CSS selector of the element to scroll to" }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "web_press_key",
    "description": "Press a keyboard key (e.g., 'Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp') on the active element.",
    "parameters": {
      "type": "object",
      "properties": {
        "key": { "type": "string", "description": "Key name to press" }
      },
      "required": ["key"]
    }
  },
  {
    "name": "web_navigate",
    "description": "Navigate the browser to a URL. Opens in the current tab.",
    "parameters": {
      "type": "object",
      "properties": {
        "url": { "type": "string", "description": "Full URL to navigate to" }
      },
      "required": ["url"]
    }
  },
  {
    "name": "web_extract",
    "description": "Extract text content from an element by CSS selector. Useful for reading results or verifying information.",
    "parameters": {
      "type": "object",
      "properties": {
        "selector": { "type": "string", "description": "CSS selector of the element to extract text from" }
      },
      "required": ["selector"]
    }
  },
  {
    "name": "web_list_tabs",
    "description": "List all open browser tabs with their IDs, titles, and URLs. Use before switching tabs.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "web_wait",
    "description": "Wait for a specified duration to allow the page to load or system to respond.",
    "parameters": {
      "type": "object",
      "properties": {
        "durationMs": { "type": "integer", "description": "Time to wait in milliseconds, default 1000" }
      },
      "required": ["durationMs"]
    }
  },
  {
    "name": "web_done",
    "description": "Signal that the automation task is complete. Call when the goal has been fully achieved.",
    "parameters": {
      "type": "object",
      "properties": {
        "summary": { "type": "string", "description": "Summary of what was accomplished" }
      },
      "required": ["summary"]
    }
  }
]
```
