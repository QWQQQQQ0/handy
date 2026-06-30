// SchedulerToolsSkill — Agent-driven scheduled task management.
// Allows any agent (desktop/web/code/doc) to create/cancel/list scheduled tasks.
// Tools appear via SkillExecutor → TaskAgentRunner → LLM.

import type { Skill, SkillTool, SkillResult } from './skill';
import type { TaskActionConfig } from '@/types/scheduler';
import type { ScreenRegion, DiffStrategyType } from '@/types/watcher';
import { SkillOk, SkillFail } from './skill';

export class SchedulerToolsSkill implements Skill {
  id = 'scheduler_tools';
  name = 'Scheduler Tools';
  nameCn = '任务调度工具';
  category = 'System';
  categoryCn = '系统';
  description = 'Create and manage scheduled tasks (timer, screen monitoring, event listening)';
  descriptionCn = '创建和管理定时任务、屏幕监控、事件监听等后台任务';

  tools: SkillTool[] = [
    {
      name: 'create_timer_task',
      description:
        'Create a persistent timer task that will automatically wake up and execute after a specified interval. ' +
        'The task is saved to the database and survives app restarts. ' +
        'Use this when: (1) the user explicitly asks to repeat something on a schedule ("check every 5 minutes", "remind me hourly"), ' +
        'or (2) you determine the current task needs periodic follow-up that you cannot do in the current session. ' +
        'Do NOT use this for one-time immediate actions — just execute those directly. ' +
        'The created task will invoke a new agent session each time it fires, with the goal_template as its instruction.',
      nameCn: '创建定时任务',
      descriptionCn:
        '创建一个持久化的定时任务，按固定间隔自动唤醒并执行。任务会存入数据库，应用重启后仍在。' +
        '适用场景：(1) 用户明确要求周期性执行（"每5分钟检查"），' +
        '(2) 当前任务需要后续跟进但你无法在当前会话中完成。' +
        '不要用于一次性即时操作——直接执行即可。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short descriptive name for the task (e.g., "检查邮件", "每小时备份")' },
          interval_ms: { type: 'number', description: 'Interval between executions in milliseconds. Examples: 60000 = 1 minute, 300000 = 5 minutes, 3600000 = 1 hour.' },
          cooldown_ms: { type: 'number', description: 'Minimum cooldown after each execution before the next fire (default: 0).' },
          action_type: {
            type: 'string',
            enum: ['agent_execute', 'workflow', 'script', 'notify'],
            description:
              'What to do when the timer fires:\n' +
              '- "agent_execute": Start a new AI agent session to execute a goal (provide goal_template). Default.\n' +
              '- "workflow": Replay a recorded automation template from the list_recorded_workflows. Provide workflow_from_task_id. ONLY use when the user explicitly references a previously recorded template. You MUST call list_recorded_workflows first to get the template ID.\n' +
              '- "script": Run a sandboxed script (provide script_language + script_code).\n' +
              '- "notify": Send a browser notification (provide notify_template).',
          },
          goal_template: { type: 'string', description: '[Required for action_type=agent_execute] The complete goal. Write as if giving a new instruction — include all context since each execution is a fresh session with no memory.' },
          custom_tools: {
            type: 'array',
            items: { type: 'string' },
            description:
              '[Optional for action_type=agent_execute] List of tool names the agent needs. ' +
              'ONLY include tools required for this task to reduce token usage and prevent context overflow. ' +
              'Example: ["desktop_close_app", "desktop_list_windows"] for closing an app. ' +
              'If omitted, all available tools are sent (NOT recommended for simple tasks).',
          },
          workflow_from_task_id: { type: 'string', description: '[Required for action_type=workflow] The ID of a recorded workflow template from list_recorded_workflows. NOT a scheduled task ID — it must come from the list_recorded_workflows.' },
          script_language: { type: 'string', enum: ['javascript', 'python'], description: '[Required for action_type=script] The programming language of the script.' },
          script_code: { type: 'string', description: '[Required for action_type=script] The source code to execute in the sandbox.' },
          notify_template: { type: 'string', description: '[Required for action_type=notify] The notification text. Supports {variable} placeholders from trigger context.' },
        },
        required: ['name', 'interval_ms', 'action_type'],
      },
    },
    {
      name: 'create_screen_watcher',
      description:
        'Create a persistent screen-monitoring task that watches a desktop application window for visual changes. ' +
        'When a change is detected, a new agent session is triggered to analyze the screenshot and take action. ' +
        'Use this when: (1) the user wants to react to UI changes in a desktop app ("notify me when a download completes", "watch for price changes on a dashboard"), ' +
        'or (2) the user wants continuous monitoring of a specific window. ' +
        'This tool ONLY works for desktop applications — do NOT use it for web pages or file monitoring. ' +
        'The task survives app restarts and runs until cancelled.',
      nameCn: '创建屏幕监控',
      descriptionCn:
        '创建一个持久化的屏幕监控任务，监控桌面应用窗口的画面变化。检测到变化时自动触发 Agent 分析截图并执行操作。' +
        '适用场景：(1) 用户需要对桌面应用界面变化做出反应（"下载完成时通知我"、"数据看板变化时提醒"），' +
        '(2) 用户需要持续监控某个窗口。' +
        '仅适用于桌面应用，不要用于网页或文件监控。任务在应用重启后仍会运行，直到被取消。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Short descriptive name for the watcher (e.g., "下载完成监控", "价格变动监控")' },
          app_name: { type: 'string', description: 'Target application name to monitor, as it appears in the taskbar (e.g., "Chrome", "Excel", "记事本").' },
          window_title: { type: 'string', description: 'Specific window title to match (substring). Example: "季度报表" for an Excel spreadsheet window.' },
          region_description: { type: 'string', description: 'Natural language description of which screen region to monitor (e.g., "消息列表区域"). Auto-located via OCR. If omitted, entire window is monitored.' },
          poll_interval_ms: { type: 'number', description: 'How often to capture and check for changes (default: 2000ms = 2s).' },
          action_type: {
            type: 'string',
            enum: ['agent_execute', 'workflow', 'script', 'notify'],
            description:
              'What to do when screen changes are detected:\n' +
              '- "agent_execute": Start a new AI agent session to analyze the screenshot and take action (provide goal_template). Best for tasks requiring visual understanding.\n' +
              '- "workflow": Replay a recorded automation template from the list_recorded_workflows. Provide workflow_from_task_id. ONLY use when the user explicitly references a previously recorded template. You MUST call list_recorded_workflows first to get the template ID.\n' +
              '- "script": Run a sandboxed script (provide script_language + script_code).\n' +
              '- "notify": Send a browser notification (provide notify_template).',
          },
          goal_template: { type: 'string', description: '[Required for action_type=agent_execute] The complete goal. The agent will receive a fresh screenshot of the changed screen. Example: "检查下载进度弹窗，如果下载完成就关闭窗口并打开文件".' },
          custom_tools: {
            type: 'array',
            items: { type: 'string' },
            description:
              '[Optional for action_type=agent_execute] List of tool names the agent needs. ' +
              'ONLY include tools required for this task to reduce token usage and prevent context overflow. ' +
              'Example: ["desktop_close_app", "desktop_list_windows"] for closing an app. ' +
              'If omitted, all available tools are sent (NOT recommended for simple tasks).',
          },
          workflow_from_task_id: { type: 'string', description: '[Required for action_type=workflow] The ID of a recorded workflow template. Get this from the list_recorded_workflows tool — do NOT use a scheduled task ID from list_scheduled_tasks.' },
          script_language: { type: 'string', enum: ['javascript', 'python'], description: '[Required for action_type=script] The programming language.' },
          script_code: { type: 'string', description: '[Required for action_type=script] The source code to execute. Can access trigger variables like {snapshot}, {diff}.' },
          notify_template: { type: 'string', description: '[Required for action_type=notify] The notification text. Supports {diff} placeholder for the change description.' },
        },
        required: ['name', 'action_type'],
      },
    },
    {
      name: 'list_recorded_workflows',
      description:
        'List all recorded workflow templates from the list_recorded_workflows. Returns: id, name, description, step_count, created_at. ' +
        'These are precise action sequences recorded by the user — they contain exact coordinates and can be replayed deterministically. ' +
        'Use this BEFORE calling create_timer_task or create_screen_watcher with action_type="workflow" — you need the template ID from this list.',
      nameCn: '列出已录制的自动化任务模板',
      descriptionCn:
        '列出所有已录制的自动化任务模板（通过录制功能创建的动作序列）。返回：id、名称、描述、步骤数、创建时间。' +
        '这些是用户手动录制的精确动作序列，含坐标，可被确定性回放。' +
        '在调用 create_timer_task 或 create_screen_watcher 并设置 action_type="workflow" 之前，必须先调用此工具获取模板 ID。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'cancel_scheduled_task',
      description:
        'Cancel and permanently delete a scheduled task by its ID. ' +
        'Use this when: (1) the user asks to stop a recurring timer or watcher, ' +
        'or (2) a monitoring task is no longer needed. ' +
        'The task is removed from both memory and database — it will not survive a restart.',
      nameCn: '取消任务',
      descriptionCn:
        '按 ID 取消并永久删除一个后台任务。同时从内存和数据库中移除，重启后也不会恢复。' +
        '适用场景：用户要求停止某个定时/监控任务，或任务已不再需要。',
      parameters: {
        type: 'object',
        properties: {
          task_id: { type: 'string', description: 'The ID of the task to cancel. Get this from list_scheduled_tasks.' },
        },
        required: ['task_id'],
      },
    },
    {
      name: 'list_scheduled_tasks',
      description:
        'List all currently active scheduled tasks. Returns for each: id, name, type (timer/screen_change), action_type, has_workflow (true if the task has a recorded workflow that can be reused), enabled, status, trigger_count, last_trigger_at. ' +
        'Use this: (1) before creating a task to check for duplicates, ' +
        '(2) when asked "what tasks are running", ' +
        '(3) to find a task ID for cancel_scheduled_task.',
      nameCn: '列出任务',
      descriptionCn:
        '列出当前所有后台任务。每个任务包含：id、名称、类型、action_type、has_workflow（是否已有录制的工作流可复用）、启用状态、触发次数。' +
        '使用场景：(1) 创建新任务前检查重复，(2) 用户询问"有哪些任务在运行"，(3) 查找任务 ID 以便取消，(4) 查找 has_workflow=true 的任务，用其 ID 创建 workflow 类型的定时/监控任务。',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'wait_for_screen_change',
      description:
        'Block and wait until a screen region visually changes. Returns when a meaningful change is detected or timeout occurs. ' +
        'IMPORTANT: This tool does NOT auto-detect regions. You MUST provide explicit pixel coordinates (region). ' +
        'Use other tools (e.g. UIA inspection, OCR, desktop_list_windows) to determine the target region coordinates first, then call this tool. ' +
        'Use cases: wait for download completion, wait for new message, wait for UI state change.',
      nameCn: '等待屏幕变更',
      descriptionCn:
        '阻塞等待屏幕区域发生视觉变化。检测到有意义的变化或超时后返回。' +
        '重要：此工具不会自动识别区域，必须提供明确的像素坐标（region）。请先用其他工具（如 UIA 检查、OCR、desktop_list_windows）确定目标区域坐标，再调用此工具。' +
        '适用场景：等待下载完成、等待新消息、等待 UI 状态变化。',
      parameters: {
        type: 'object',
        properties: {
          region: {
            type: 'object',
            properties: {
              x: { type: 'number', description: 'Left edge X coordinate (screen absolute pixels)' },
              y: { type: 'number', description: 'Top edge Y coordinate (screen absolute pixels)' },
              width: { type: 'number', description: 'Region width in pixels' },
              height: { type: 'number', description: 'Region height in pixels' },
            },
            required: ['x', 'y', 'width', 'height'],
            description: 'Screen region to monitor (absolute pixel coordinates)',
          },
          hwnd: {
            type: 'number',
            description: 'Window handle for anti-occlusion capture using PrintWindow. Optional — if omitted, uses GDI screen capture.',
          },
          image: {
            type: 'string',
            description: 'Baseline image (base64 BMP). If omitted, auto-captures current screen at the specified region.',
          },
          diff_strategy: {
            type: 'string',
            enum: ['fast_visual', 'semantic_text'],
            description: 'Detection strategy. fast_visual: block-level comparison (<5ms, default). semantic_text: OCR text diff (~100ms).',
          },
          min_confidence: {
            type: 'number',
            description: 'Minimum confidence threshold 0-1 (default: 0.9). Changes below this threshold are ignored.',
          },
          poll_interval_ms: {
            type: 'number',
            description: 'Interval between checks in milliseconds (default: 1000).',
          },
          timeout_ms: {
            type: 'number',
            description: 'Max wait time in milliseconds (default: 300000 = 5 minutes). Returns changed=false on timeout.',
          },
        },
        required: ['region'],
      },
    },
  ];

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      switch (toolName) {
        case 'create_timer_task':
          return this.handleCreateTimer(params);
        case 'create_screen_watcher':
          return this.handleCreateScreenWatcher(params);
        case 'list_recorded_workflows':
          return this.handleListRecordedWorkflows();
        case 'cancel_scheduled_task':
          return this.handleCancelTask(params);
        case 'list_scheduled_tasks':
          return this.handleListTasks();
        case 'wait_for_screen_change':
          return this.handleWaitForScreenChange(params);
        default:
          return SkillFail(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return SkillFail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Handlers ──

  private async handleCreateTimer(params: Record<string, unknown>): Promise<SkillResult> {
    const { scheduledTaskManager } = await import('@/services/watcher');
    const name = String(params['name'] ?? '');
    const intervalMs = Number(params['interval_ms'] ?? 60000);
    const cooldownMs = Number(params['cooldown_ms'] ?? 0);
    const actionType = String(params['action_type'] ?? 'agent_execute') as 'agent_execute' | 'workflow' | 'script' | 'notify';

    if (!name) return SkillFail('name is required');

    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    const action = await buildAction(actionType, params);

    if (!action) return SkillFail(`Missing required parameters for action_type=${actionType}`);

    const config = {
      id, name, enabled: true,
      trigger: { type: 'timer' as const, intervalMs, cooldownMs },
      action,
      createdAt: now, updatedAt: now,
    };

    await scheduledTaskManager.create(config);
    return SkillOk(`定时任务已创建: "${name}" (id: ${id}, 间隔: ${intervalMs}ms, 动作: ${actionType})`, { task_id: id, name });
  }

  private async handleCreateScreenWatcher(params: Record<string, unknown>): Promise<SkillResult> {
    const { scheduledTaskManager } = await import('@/services/watcher');
    const name = String(params['name'] ?? '');
    const appName = params['app_name'] as string | undefined;
    const windowTitle = params['window_title'] as string | undefined;
    const regionDescription = params['region_description'] as string | undefined;
    const pollIntervalMs = Number(params['poll_interval_ms'] ?? 2000);
    const actionType = String(params['action_type'] ?? 'agent_execute') as 'agent_execute' | 'workflow' | 'script' | 'notify';

    if (!name) return SkillFail('name is required');

    const now = Math.floor(Date.now() / 1000);
    const id = crypto.randomUUID();
    const action = await buildAction(actionType, params);

    if (!action) return SkillFail(`Missing required parameters for action_type=${actionType}`);

    const config = {
      id, name, enabled: true,
      trigger: {
        type: 'screen_change' as const,
        pollIntervalMs, cooldownMs: 5000, debounceMs: 300, minConfidence: 0.9,
        monitorTarget: {
          type: 'window' as const,
          ...(appName ? { appName } : {}),
          ...(windowTitle ? { windowTitle } : {}),
        },
        region: { x: 0, y: 0, width: 1, height: 1 },
        diffStrategy: 'fast_visual' as const,
        regionMode: regionDescription ? ('auto' as const) : ('manual' as const),
        ...(regionDescription ? { regionDescription } : {}),
      },
      action,
      createdAt: now, updatedAt: now,
    };

    await scheduledTaskManager.create(config);
    return SkillOk(`屏幕监控已创建: "${name}" (id: ${id}, 动作: ${actionType})`, { task_id: id, name });
  }

  private async handleCancelTask(params: Record<string, unknown>): Promise<SkillResult> {
    const { scheduledTaskManager } = await import('@/services/watcher');
    const taskId = String(params['task_id'] ?? '');

    if (!taskId) {
      return SkillFail('task_id is required');
    }

    await scheduledTaskManager.remove(taskId);
    return SkillOk(`任务已取消: ${taskId}`);
  }

  private async handleListRecordedWorkflows(): Promise<SkillResult> {
    const { loadTemporaryTasks } = await import('@/services/temporary-task-store');
    const templates = loadTemporaryTasks();

    const workflows = templates.map((t) => ({
      id: t.id,
      name: t.name,
      description: t.description || '',
      step_count: t.steps.length,
      created_at: new Date(t.createdAt).toLocaleString(),
    }));

    return SkillOk(
      workflows.length === 0
        ? '没有已录制的 workflow 模板'
        : `共 ${workflows.length} 个已录制模板`,
      { workflows },
    );
  }

  private async handleListTasks(): Promise<SkillResult> {
    const { scheduledTaskManager } = await import('@/services/watcher');
    const states = scheduledTaskManager.getStates();

    const tasks = states.map(({ config, state }) => ({
      id: config.id,
      name: config.name,
      type: config.trigger.type,
      enabled: config.enabled,
      status: state.status,
      action_type: config.action.type,
      has_workflow: config.action.type === 'agent_execute' && !!config.action.workflowTemplate,
      trigger_count: state.triggerCount,
      last_trigger_at: state.lastTriggerAt,
    }));

    return SkillOk(
      tasks.length === 0
        ? '当前没有后台任务'
        : `共 ${tasks.length} 个后台任务`,
      { tasks },
    );
  }

  private async handleWaitForScreenChange(params: Record<string, unknown>): Promise<SkillResult> {
    const { getDetector } = await import('@/services/watcher/diff-detector');
    const { captureRegion } = await import('@/services/watcher/region-capture');

    console.log('[wait_for_screen_change] raw params:', JSON.stringify(params));

    // Parse region
    let regionParam = params['region'] as Record<string, unknown> | undefined;

    // Handle case where region is passed as JSON string
    if (typeof regionParam === 'string') {
      try {
        regionParam = JSON.parse(regionParam) as Record<string, unknown>;
      } catch {
        return SkillFail('region is not valid JSON');
      }
    }

    if (!regionParam || typeof regionParam !== 'object') {
      return SkillFail(`region is required (got: ${typeof regionParam})`);
    }

    console.log('[wait_for_screen_change] regionParam:', JSON.stringify(regionParam));

    const region: ScreenRegion = {
      x: Number(regionParam['x'] ?? 0),
      y: Number(regionParam['y'] ?? 0),
      width: Number(regionParam['width'] ?? 0),
      height: Number(regionParam['height'] ?? 0),
    };

    console.log('[wait_for_screen_change] parsed region:', JSON.stringify(region));

    if (region.width <= 0 || region.height <= 0) {
      return SkillFail(`region width and height must be > 0 (got: ${region.width}x${region.height})`);
    }

    // Parse optional params
    const hwnd = Number(params['hwnd'] ?? 0) || undefined;
    const image = params['image'] as string | undefined;
    const diffStrategy = (params['diff_strategy'] as DiffStrategyType) ?? 'fast_visual';
    const minConfidence = Number(params['min_confidence'] ?? 0.9);
    const pollIntervalMs = Number(params['poll_interval_ms'] ?? 1000);
    const timeoutMs = Number(params['timeout_ms'] ?? 300000);

    const detector = getDetector(diffStrategy);
    let baseline = image ?? await captureRegion(region, hwnd);

    const start = Date.now();
    const deadline = start + timeoutMs;
    let checks = 0;

    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, pollIntervalMs));
      checks++;

      const current = await captureRegion(region, hwnd);
      const diff = await detector.detect(baseline, current);

      if (diff.changed && diff.confidence >= minConfidence) {
        return SkillOk(
          `检测到变化 (${(diff.confidence * 100).toFixed(0)}%): ${diff.diffDetail ?? '视觉变化'}`,
          {
            changed: true,
            diff_detail: diff.diffDetail,
            diff_bbox: diff.diffBbox,
            confidence: diff.confidence,
            snapshot: current,
            elapsed_ms: Date.now() - start,
            checks,
            reason: 'detected',
          },
        );
      }

      baseline = current; // sliding window
    }

    return SkillOk(
      `超时 (${(timeoutMs / 1000).toFixed(0)}s)，未检测到变化`,
      {
        changed: false,
        confidence: 0,
        elapsed_ms: Date.now() - start,
        checks,
        reason: 'timeout',
      },
    );
  }
}

// ── Shared helper: build action from tool params ──

async function buildAction(
  actionType: string,
  params: Record<string, unknown>,
): Promise<TaskActionConfig | null> {
  switch (actionType) {
    case 'agent_execute': {
      const goalTemplate = String(params['goal_template'] ?? '');
      if (!goalTemplate) return null;
      const customTools = params['custom_tools'] as string[] | undefined;
      return {
        type: 'agent_execute',
        goalTemplate,
        ...(customTools && customTools.length > 0 ? { toolMode: 'custom' as const, customTools } : {}),
      } as TaskActionConfig;
    }
    case 'workflow': {
      const fromTemplateId = String(params['workflow_from_task_id'] ?? '');
      if (!fromTemplateId) return null;
      // 从已录制的模板中查找，拷贝其步骤
      const { loadTemporaryTasks } = await import('@/services/temporary-task-store');
      const templates = loadTemporaryTasks();
      const template = templates.find(t => t.id === fromTemplateId);
      if (!template) return null;
      // 将 TemplateStep[] 转换为 WorkflowStepV2[] 供 workflow-executor-v2 回放
      const steps = template.steps.map(s => ({
        type: 'execute_action' as const,
        description: s.description,
        action: { action: s.action, target: s.target, params: s.params },
        params: s.params as Record<string, unknown> | undefined,
      }));
      return {
        type: 'workflow',
        steps,
        goalTemplate: template.description || template.name,
      } as unknown as TaskActionConfig;
    }
    case 'script': {
      const language = (String(params['script_language'] ?? 'javascript')) as 'javascript' | 'python';
      const code = String(params['script_code'] ?? '');
      if (!code) return null;
      return { type: 'script', language, code } as TaskActionConfig;
    }
    case 'notify': {
      const notifyTemplate = String(params['notify_template'] ?? '');
      if (!notifyTemplate) return null;
      return { type: 'notify', notifyTemplate } as TaskActionConfig;
    }
    default:
      return null;
  }
}
