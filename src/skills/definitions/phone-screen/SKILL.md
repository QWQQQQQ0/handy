---
name: phone-screen
description: >-
  View and control an Android phone screen via accessibility service. Supports
  tapping, swiping, typing, scrolling, UI tree inspection, event polling, and
  AI-driven automation. This skill should be used when the user needs to
  interact with their Android phone from the desktop.
license: MIT
compatibility: Requires Tauri v2+, Android accessibility service
usage: |-
  ## Quick Start

  1. **See the screen**: phone_screenshot → view current phone state
  2. **Discover elements**: phone_get_ui → get UI tree with element positions
  3. **Tap**: phone_tap({x, y}) or phone_tap_element({selector})
  4. **Swipe**: phone_swipe({x1, y1, x2, y2})
  5. **Type**: phone_type({text})
  6. **Navigate**: phone_back / phone_home

  ## Tips

  - Phone features are stubs until native accessibility service is wired.
  - Use phone_get_ui to find element coordinates before tapping.
  - phone_poll_events monitors screen changes and notifications.
  - phone_wait after each interaction for UI to settle.

tools:
  - name: phone_screenshot
    description: Take a screenshot of the current phone screen. Use this FIRST to understand the current state.
    parameters:
      type: object
      properties:
        quality:
          type: integer
          description: JPEG quality (1–100)
    returns: '{"image_data":"base64 string","format":"bmp"}'

  - name: phone_tap
    description: Tap at screen coordinates (x, y). Use phone_get_ui first to find element positions.
    parameters:
      type: object
      properties:
        x: { type: integer, description: X coordinate }
        y: { type: integer, description: Y coordinate }
      required: [x, y]
    returns: '{"success":true/false,"x":number,"y":number}'

  - name: phone_tap_element
    description: Tap a UI element by its accessibility selector or text.
    parameters:
      type: object
      properties:
        selector:
          type: string
          description: Accessibility selector or text match
      required: [selector]
    returns: '{"success":true/false,"element":"matched element info"}'

  - name: phone_swipe
    description: Swipe from (x1, y1) to (x2, y2). Use for scrolling, swiping between screens.
    parameters:
      type: object
      properties:
        x1: { type: integer }
        y1: { type: integer }
        x2: { type: integer }
        y2: { type: integer }
        duration:
          type: integer
          description: Swipe duration in ms (default 300)
      required: [x1, y1, x2, y2]
    returns: '{"success":true/false,"from":{"x":number,"y":number},"to":{"x":number,"y":number}}'

  - name: phone_type
    description: Type text into the currently focused field.
    parameters:
      type: object
      properties:
        text:
          type: string
          description: Text to type
      required: [text]
    returns: '{"success":true/false,"text":"the text typed"}'

  - name: phone_scroll
    description: Scroll the screen by a delta amount.
    parameters:
      type: object
      properties:
        x: { type: integer }
        y: { type: integer }
        dx: { type: integer }
        dy: { type: integer }
        duration: { type: integer }
      required: [x, y, dx, dy]
    returns: '{"success":true/false,"direction":"up/down/left/right"}'

  - name: phone_back
    description: Press the Android back button.
    parameters:
      type: object
      properties: {}
    returns: '{"success":true/false}'

  - name: phone_home
    description: Press the Android home button.
    parameters:
      type: object
      properties: {}
    returns: '{"success":true/false}'

  - name: phone_get_ui
    description: Get the UI tree (accessibility hierarchy) of the current screen with element positions.
    parameters:
      type: object
      properties: {}
    returns: '{"nodes":[{"role":"...","text":"...","bounds":[x1,y1,x2,y2],"resource_id":"..."}],"count":number}'

  - name: phone_poll_events
    description: Poll for recent screen change events and notifications.
    parameters:
      type: object
      properties:
        since:
          type: string
          description: ISO timestamp to filter events from
    returns: '{"events":[{"type":"notification/toast","text":"...","package":"..."}],"count":number}'

  - name: phone_wait
    description: Wait for a specified duration for the UI to settle.
    parameters:
      type: object
      properties:
        durationMs:
          type: integer
          description: Wait duration in milliseconds
      required: [durationMs]
    returns: '{"action":"phone_wait","milliseconds":number}'

  - name: phone_done
    description: Mark the current automation task as complete.
    parameters:
      type: object
      properties:
        summary:
          type: string
          description: Summary of what was accomplished
      required: [summary]
    returns: '{"action":"phone_done","message":"completion message"}'

x-i18n:
  name_cn: 手机屏幕控制
  description_cn: 通过无障碍服务查看和控制 Android 手机屏幕。支持点击、滑动、输入、滚动、UI 树检查等。
  category_cn: 设备自动化
  usage_cn: |-
    ## 快速开始

    1. **查看屏幕**：phone_screenshot
    2. **发现元素**：phone_get_ui → 获取 UI 树及元素位置
    3. **点击**：phone_tap({x, y}) 或 phone_tap_element({selector})
    4. **滑动**：phone_swipe({x1, y1, x2, y2})
    5. **输入**：phone_type({text})
    6. **导航**：phone_back / phone_home

    ## 使用技巧

    - 手机功能需等待原生无障碍服务接入，当前为占位桩
    - 点击前先用 phone_get_ui 获取元素坐标
    - 每次交互后使用 phone_wait 等待界面稳定
  tools:
    phone_screenshot:
      name_cn: 手机截图
      description_cn: 截取当前手机屏幕截图，返回 PNG 图像。
    phone_tap:
      name_cn: 手机点击坐标
      description_cn: 在屏幕坐标处点击。先用 phone_get_ui 获取元素位置。
    phone_tap_element:
      name_cn: 手机点击元素
      description_cn: 通过无障碍选择器或文本匹配点击 UI 元素。
    phone_swipe:
      name_cn: 滑动
      description_cn: 从 (x1, y1) 滑动到 (x2, y2)。
    phone_type:
      name_cn: 手机输入文字
      description_cn: 在当前聚焦的输入框中输入文字。
    phone_scroll:
      name_cn: 滚动屏幕
      description_cn: 按指定偏移量滚动屏幕。
    phone_back:
      name_cn: 返回
      description_cn: 按下 Android 返回键。
    phone_home:
      name_cn: 回到主页
      description_cn: 按下 Android 主页键。
    phone_get_ui:
      name_cn: 获取 UI 树
      description_cn: 获取当前屏幕的 UI 树及元素位置。
    phone_poll_events:
      name_cn: 轮询事件
      description_cn: 轮询最近的屏幕变化事件和通知。
    phone_wait:
      name_cn: 手机等待
      description_cn: 等待指定时长，让 UI 稳定下来。
    phone_done:
      name_cn: 手机完成任务
      description_cn: 标记当前自动化任务已完成。
---
