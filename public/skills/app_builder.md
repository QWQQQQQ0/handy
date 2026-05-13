---
id: app_builder
name: App Builder
category: Application
---

Save, list, update, and delete generated applications.
Generated apps run in a WebView with access to native device capabilities
via the window.OpenPaw.call() JavaScript API.
Match the app complexity to what the user asks for.

## Tools

```json
[
  {
    "name": "save_app",
    "description": "Save a complete, fully-functional HTML application. The app runs inside a mobile WebView and can optionally access native device controls.\n\nNATIVE BRIDGE API — Call Flutter tools from JavaScript:\n  const result = await window.OpenPaw.call(toolName, params);\n  // Returns: { success: true/false, message: \"...\", data: {...} }\n\nAVAILABLE TOOLS (callable from your app JS):\n  phone_screenshot({quality})  → { screenshot, uiNodes }  capture screen\n  phone_tap({x, y})            → tap at screen coordinates\n  phone_swipe({x1, y1, x2, y2, duration}) → swipe gesture\n  phone_type({text})           → type text into focused field\n  phone_scroll({x, y, dx, dy}) → scroll gesture\n  phone_back()                 → press Android back button\n  phone_home()                 → press Android home button\n  phone_get_ui()               → get visible UI element tree\n  phone_poll_events()          → get buffered screen changes & notifications since last poll\n\nSCREEN & NOTIFICATION MONITORING:\n  Call phone_poll_events() repeatedly (e.g. setInterval 500ms) to monitor:\n  - Screen content changes (TYPE_WINDOW_CONTENT_CHANGED)\n  - App/window switches (TYPE_WINDOW_STATE_CHANGED)\n  - Notifications (TYPE_NOTIFICATION_STATE_CHANGED)\n  Each event has: time, eventType, eventTypeName, packageName, className, text.\n  The buffer is cleared after each poll — call frequently to avoid missing events.\n\nIMPORTANT: All bridge calls are async Promises. Always use await or .then().\nHandle errors: if (result.success) { ... } else { console.error(result.message); }\n\nGENERAL REQUIREMENTS:\n- Single self-contained HTML file with inline CSS and JS (<style> and <script> tags)\n- Modern UI: rounded corners, shadows, gradients, smooth transitions\n- Mobile-first: max-width 480px baseline, touch-friendly tap targets (min 44px)\n- Full interactivity: every button, input, calculation MUST work with real data\n- Dark/light mode via CSS prefers-color-scheme, with manual toggle\n- Error handling, loading states, empty states for all data views\n- NO external CDN. No bootstrap, jquery, font-awesome. Pure HTML/CSS/JS.\n- Use system-ui font stack. Icons via emoji or inline SVG.\n\nDATA PERSISTENCE:\n- Use localStorage for saving user data\n- For demo purposes, pre-fill with sensible sample data\n\nNATIVE DEVICE FEATURES (optional — use only when the app needs them):\n- Call window.OpenPaw.call(toolName, params) for device automation\n- Always await the Promise and check result.success before acting on it\n- Handle bridge failures gracefully (show error message to user)\n\nMULTI-PAGE SUPPORT (optional — use when the app needs navigation):\n- Hash-based routing: #page1, #detail?id=123, #settings\n- Listen for hashchange event to handle back/forward navigation\n- Use URL hash params to pass data between pages\n- Add bottom tab bar or nav menu for page switching\n- Choose type=multi_page for multi-page apps, type=html for single-view apps",
    "parameters": {
      "type": "object",
      "properties": {
        "name": { "type": "string", "description": "App name (e.g. \"Expense Tracker\", \"Fitness Dashboard\", \"CRM Lite\")" },
        "description": { "type": "string", "description": "What the app does, its key features, and which native tools it uses" },
        "code": { "type": "string", "description": "The COMPLETE HTML document with ALL pages, styles, and logic inline. Every feature must be fully implemented — no stubs, no TODOs. If using multi-page: implement hash router with distinct page views. If using native features: call window.OpenPaw.call() with error handling." },
        "type": { "type": "string", "description": "'html' for single-view apps. 'multi_page' for apps with hash-based page navigation." }
      },
      "required": ["name", "code"]
    }
  },
  {
    "name": "list_apps",
    "description": "List all saved applications.",
    "parameters": {
      "type": "object",
      "properties": {}
    }
  },
  {
    "name": "get_app",
    "description": "Get a specific application by its ID.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "The app ID" }
      },
      "required": ["id"]
    }
  },
  {
    "name": "update_app",
    "description": "Update an existing app. ALWAYS call get_app first to read the current code, then modify it based on user requests, then call update_app with the FULL updated code. Do NOT send partial diffs — always send the complete updated HTML document.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "The app ID to update" },
        "name": { "type": "string", "description": "New name (omit to keep current)" },
        "description": { "type": "string", "description": "New description (omit to keep current)" },
        "code": { "type": "string", "description": "The COMPLETE updated HTML code (not a diff)" }
      },
      "required": ["id"]
    }
  },
  {
    "name": "delete_app",
    "description": "Delete a saved application by its ID.",
    "parameters": {
      "type": "object",
      "properties": {
        "id": { "type": "string", "description": "The app ID to delete" }
      },
      "required": ["id"]
    }
  }
]
```
