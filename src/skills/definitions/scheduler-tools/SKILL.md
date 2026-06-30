---
name: scheduler-tools
description: >-
  Create and manage scheduled background tasks: timer tasks (periodic execution),
  screen watchers (visual change monitoring), and event listeners. This skill
  should be used when the agent needs to create recurring timers, monitor desktop
  windows for visual changes, list or cancel scheduled tasks, or find recorded
  workflow templates for scheduled replay.
license: MIT
compatibility: Requires Tauri v2+, Windows
usage: |-
  ## Quick Start

  - **Create timer**: create_timer_task({name, interval_ms, action_type, goal_template?})
  - **Create screen watcher**: create_screen_watcher({name, action_type, app_name?, window_title?})
  - **List tasks**: list_scheduled_tasks — all running background tasks
  - **List workflows**: list_recorded_workflows — recorded automation templates
  - **Cancel task**: cancel_scheduled_task({task_id}) — stop and delete a task

  ## Action Types

  | Type | Description |
  |------|-------------|
  | agent_execute | Start new AI agent session with goal_template |
  | workflow | Replay a recorded workflow template (must call list_recorded_workflows first) |
  | script | Run sandboxed script (script_language + script_code) |
  | notify | Send browser notification (notify_template) |

tools:
  - name: create_timer_task
    description: >-
      Create a persistent timer task that will automatically wake up and execute
      after a specified interval. Survives app restarts. Use when: (1) user asks
      to repeat something on a schedule, or (2) current task needs periodic
      follow-up.
    parameters:
      type: object
      properties:
        name:
          type: string
          description: Short descriptive name (e.g. "检查邮件", "每小时备份")
        interval_ms:
          type: number
          description: Interval between executions in milliseconds
        cooldown_ms:
          type: number
          description: Minimum cooldown after each execution (default 0)
        action_type:
          type: string
          enum: [agent_execute, workflow, script, notify]
          description: What to do when the timer fires
        goal_template:
          type: string
          description: '[Required for agent_execute] The complete goal for the agent session'
        workflow_from_task_id:
          type: string
          description: '[Required for workflow] Template ID from list_recorded_workflows'
        script_language:
          type: string
          enum: [javascript, python]
          description: '[Required for script] Programming language'
        script_code:
          type: string
          description: '[Required for script] Source code to execute'
        notify_template:
          type: string
          description: '[Required for notify] Notification text with {variable} placeholders'
      required: [name, interval_ms, action_type]

  - name: create_screen_watcher
    description: >-
      Create a persistent screen-monitoring task that watches a desktop
      application window for visual changes. When changes are detected, triggers
      an agent session. Use for desktop app monitoring — NOT for web pages or
      file monitoring.
    parameters:
      type: object
      properties:
        name:
          type: string
          description: Short descriptive name
        app_name:
          type: string
          description: Target app name as it appears in taskbar (e.g. "Chrome", "Excel")
        window_title:
          type: string
          description: Specific window title to match (substring)
        region_description:
          type: string
          description: Natural language description of which region to monitor
        poll_interval_ms:
          type: number
          description: How often to check for changes (default 2000ms)
        action_type:
          type: string
          enum: [agent_execute, workflow, script, notify]
          description: What to do when changes are detected
        goal_template:
          type: string
          description: '[Required for agent_execute] Goal for analyzing the screenshot'
        workflow_from_task_id:
          type: string
          description: '[Required for workflow] Template ID from list_recorded_workflows'
        script_language:
          type: string
          enum: [javascript, python]
          description: '[Required for script] Programming language'
        script_code:
          type: string
          description: '[Required for script] Source code with {snapshot}, {diff} variables'
        notify_template:
          type: string
          description: '[Required for notify] Notification text with {diff} placeholder'
      required: [name, action_type]

  - name: list_recorded_workflows
    description: >-
      List all recorded workflow templates. Returns id, name, description,
      step_count, created_at. Use BEFORE calling create_timer_task or
      create_screen_watcher with action_type="workflow" — you need the
      template ID from this list.
    parameters:
      type: object
      properties: {}
      required: []

  - name: cancel_scheduled_task
    description: >-
      Cancel and permanently delete a scheduled task by its ID. The task is
      removed from both memory and database — it will not survive a restart.
    parameters:
      type: object
      properties:
        task_id:
          type: string
          description: The ID of the task to cancel (get from list_scheduled_tasks)
      required: [task_id]

  - name: list_scheduled_tasks
    description: >-
      List all currently active scheduled tasks. Returns id, name, type,
      action_type, enabled, status, trigger_count. Use before creating tasks
      to check for duplicates, or to find a task ID for cancellation.
    parameters:
      type: object
      properties: {}
      required: []

x-i18n:
  name_cn: 任务调度工具
  description_cn: 创建和管理定时任务、屏幕监控、事件监听等后台任务。
  category_cn: 系统
  tools:
    create_timer_task:
      name_cn: 创建定时任务
      description_cn: 创建持久化定时任务，按固定间隔自动唤醒并执行。
    create_screen_watcher:
      name_cn: 创建屏幕监控
      description_cn: 创建屏幕监控任务，监控桌面应用窗口的画面变化。
    list_recorded_workflows:
      name_cn: 列出已录制的自动化任务模板
      description_cn: 列出所有已录制的自动化任务模板。
    cancel_scheduled_task:
      name_cn: 取消任务
      description_cn: 按 ID 取消并永久删除后台任务。
    list_scheduled_tasks:
      name_cn: 列出任务
      description_cn: 列出当前所有后台任务及其状态。
---
