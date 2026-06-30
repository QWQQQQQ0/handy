---
name: desktop-uia
description: >-
  Access and manipulate Windows UI elements semantically via UI Automation — no
  coordinates needed. This skill should be used as the primary interaction method
  for standard Windows applications (Office, browsers, settings, file dialogs).
  If UIA returns empty for custom-drawn UIs, fall back to desktop-screen skill.
license: MIT
compatibility: Requires Tauri v2+, Windows
usage: |-
  ## Quick Start

  **Discover elements**: uia_get_interactive → see all buttons/inputs/links.
  **Click a button**: uia_click({role: "Button", name: "搜索"}).
  **Type into a field**: uia_type({text: "hello", role: "Edit"}).
  **Find element details**: uia_find_element → get position, size, state.
  **Read a property**: uia_get_property({role: "Edit", property: "Value"}).
  **Structural overview**: uia_fingerprint → compact hierarchy of the UI tree.

  ## When to use

  Use UIA tools FIRST for standard Windows apps.
  If UIA returns empty (custom-drawn UIs like QQ音乐 or games), fall back to
  desktop_screen tools (screenshot + coordinate clicks).

  ## Tips

  - Always uia_get_interactive first — it shows what's available.
  - Use role and name filters to narrow results.
  - After a UIA type, wait with desktop_wait for the UI to update.

tools:
  - name: uia_get_interactive
    description: >-
      Get all interactive UI elements from a window via UI Automation. Returns
      element roles, names, and properties. Use this FIRST before uia_click/uia_type.
      NOTE: UIA only works with standard Win32/WPF/WinUI controls. Custom-drawn
      UIs return 0 elements — fall back to desktop_screenshot + desktop_click.
    parameters:
      type: object
      properties:
        window_hwnd:
          type: integer
          description: Optional window handle to scope the search
        roles:
          type: array
          items:
            type: string
          description: Filter by element roles (e.g. ["Button", "Edit"])
        name_keyword:
          type: string
          description: Filter by element name keyword (partial match)
        onscreen_only:
          type: boolean
          description: Only return elements visible on screen (default true)
        limit:
          type: integer
          description: Max number of elements to return
    returns: '{"nodes":[{"role":"Button/Edit/...","name":"element name","bounds":{...},"aid":"automation id"}],"count":number,"window_hwnd":number}'

  - name: uia_click
    description: Click a UI element by its role and name using UI Automation. No coordinates needed.
    parameters:
      type: object
      properties:
        role:
          type: string
          description: Element role (e.g., Button, Edit, Link, CheckBox)
        name:
          type: string
          description: Element name/label (partial match)
        window_hwnd:
          type: integer
          description: Optional window handle
      required: [role]
    returns: '{"success":true/false,"element":{"role":"...","name":"...","bounds":{...}},"message":"execution result"}'

  - name: uia_type
    description: Type text into a UI element found by role/name using UI Automation. No coordinates needed.
    parameters:
      type: object
      properties:
        text:
          type: string
          description: Text to type
        role:
          type: string
          description: Target element role (e.g., Edit, ComboBox)
        name:
          type: string
          description: Target element name/label
        window_hwnd:
          type: integer
          description: Optional window handle
      required: [text]
    returns: '{"success":true/false,"message":"typed text info"}'

  - name: uia_find_element
    description: Find a specific UI element by role and name. Returns detailed element info including bounding rectangle.
    parameters:
      type: object
      properties:
        role:
          type: string
          description: Element role to find
        name:
          type: string
          description: Element name/label
        window_hwnd:
          type: integer
          description: Optional window handle
      required: [role]
    returns: '{"success":true/false,"element":{"role":"...","name":"...","bounds":{...},"isEnabled":true/false,"controlType":number}}'

  - name: uia_get_property
    description: Get a specific property value of a UI element (e.g., Value, Name, BoundingRectangle, IsEnabled).
    parameters:
      type: object
      properties:
        role:
          type: string
          description: Element role
        name:
          type: string
          description: Element name/label
        property:
          type: string
          description: Property name to retrieve
        window_hwnd:
          type: integer
          description: Optional window handle
      required: [role, property]
    returns: '{"success":true/false,"property":"the property name","value":"the property value","element":{"role":"...","name":"..."}}'

  - name: uia_fingerprint
    description: Get a structural fingerprint of a window's UI tree. Returns a compact summary of element hierarchy and types.
    parameters:
      type: object
      properties:
        window_hwnd:
          type: integer
          description: Optional window handle
    returns: '{"fingerprint":"compact UI tree structure string","nodeCount":number,"depth":number}'

x-i18n:
  name_cn: 桌面 UI 自动化
  description_cn: 通过 UI Automation 语义操作 Windows UI 元素 — 无需坐标。对标准 Windows 应用优先使用此技能。
  category_cn: 设备自动化
  usage_cn: |-
    ## 快速开始

    **发现元素**：uia_get_interactive → 查看所有按钮/输入框/链接。
    **点击按钮**：uia_click({role: "Button", name: "搜索"})。
    **输入文字**：uia_type({text: "你好", role: "Edit"})。
    **查找元素详情**：uia_find_element → 获取位置、大小、状态。
    **读取属性**：uia_get_property({role: "Edit", property: "Value"})。
    **结构概览**：uia_fingerprint → UI 树的紧凑层级摘要。

    ## 使用时机

    对标准 Windows 应用优先使用 UIA 工具。
    如果 UIA 返回空（自定义绘制的 UI），回退到 desktop_screen 工具。

    ## 使用技巧

    - 总是先调用 uia_get_interactive
    - 使用 role 和 name 过滤缩小结果范围
    - UIA 输入后调用 desktop_wait 等待界面更新
  tools:
    uia_get_interactive:
      name_cn: 桌面获取可交互元素
      description_cn: 通过 UI Automation 获取窗口中所有可交互的 UI 元素。
    uia_click:
      name_cn: 语义点击
      description_cn: 通过 UI Automation 按角色和名称点击 UI 元素，无需坐标。
    uia_type:
      name_cn: 语义输入
      description_cn: 通过 UI Automation 按角色和名称找到元素并输入文字，无需坐标。
    uia_find_element:
      name_cn: 查找元素
      description_cn: 通过角色和名称查找特定 UI 元素，返回详细信息。
    uia_get_property:
      name_cn: 获取元素属性
      description_cn: 获取 UI 元素的特定属性值。
    uia_fingerprint:
      name_cn: UI 指纹
      description_cn: 获取窗口 UI 树的结构指纹。
---
