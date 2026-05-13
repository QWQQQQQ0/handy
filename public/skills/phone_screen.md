---
id: phone_screen
name: Phone Screen Control
category: Device Automation
---

View and control the Android phone screen via accessibility service.
Supports tapping, swiping, typing, scrolling, and AI-driven automation.
Also provides event polling for screen change monitoring and notification listening.

## Tools

```json
[
  {
    "name": "phone_screenshot",
    "description": "Capture a screenshot of the phone screen along with the current UI tree",
    "parameters": {
      "type": "object",
      "properties": {
        "quality": { "type": "integer", "description": "JPEG quality 1-100, default 60" }
      }
    }
  },
  {
    "name": "phone_tap",
    "description": "Tap at screen coordinates",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "number", "description": "X coordinate on screen" },
        "y": { "type": "number", "description": "Y coordinate on screen" }
      },
      "required": ["x", "y"]
    }
  },
  {
    "name": "phone_tap_element",
    "description": "Tap an element by its resource ID from the UI tree",
    "parameters": {
      "type": "object",
      "properties": {
        "nodeId": { "type": "string", "description": "Resource ID of the element to tap" }
      },
      "required": ["nodeId"]
    }
  },
  {
    "name": "phone_swipe",
    "description": "Swipe from one point to another on screen",
    "parameters": {
      "type": "object",
      "properties": {
        "x1": { "type": "number" },
        "y1": { "type": "number" },
        "x2": { "type": "number" },
        "y2": { "type": "number" },
        "duration": { "type": "integer", "description": "Duration in ms, default 300" }
      },
      "required": ["x1", "y1", "x2", "y2"]
    }
  },
  {
    "name": "phone_type",
    "description": "Type text into the currently focused input field",
    "parameters": {
      "type": "object",
      "properties": {
        "text": { "type": "string", "description": "Text to type" }
      },
      "required": ["text"]
    }
  },
  {
    "name": "phone_scroll",
    "description": "Perform a scroll gesture at a position",
    "parameters": {
      "type": "object",
      "properties": {
        "x": { "type": "number" },
        "y": { "type": "number" },
        "dx": { "type": "number", "description": "Horizontal scroll amount" },
        "dy": { "type": "number", "description": "Vertical scroll amount" }
      },
      "required": ["x", "y", "dx", "dy"]
    }
  },
  {
    "name": "phone_back",
    "description": "Press the Android back button",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "phone_home",
    "description": "Press the Android home button",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "phone_get_ui",
    "description": "Get the current UI tree of visible elements on screen",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "phone_poll_events",
    "description": "Get buffered accessibility events since last poll. Returns screen changes, window switches, and notifications. Call repeatedly (e.g. every 500ms) for monitoring. Returns JSON array of events, each with: time, eventType, eventTypeName, packageName, className, text, contentDescription.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "phone_wait",
    "description": "Wait for a specified duration to allow the system to respond.",
    "parameters": {
      "type": "object",
      "properties": {
        "durationMs": { "type": "integer", "description": "Time to wait in milliseconds, default 1000" }
      },
      "required": ["durationMs"]
    }
  },
  {
    "name": "phone_done",
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
