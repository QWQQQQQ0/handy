// Generic action executor — decoupled from screen diff specifics.
// Template variables are passed via ActionContext.variables map.
// Supports workflow template fast path: replay cached steps, only call LLM for dynamic parts.

import type { TaskActionConfig, AgentExecuteTaskAction } from '@/types/scheduler';
import type { TaskExecutionResult } from '@/types/scheduler';
import type { MonitorTarget, WorkflowStep, WorkflowTemplate } from '@/types/watcher';
import { appEventBus } from '@/services/event-bus';
import { loadProviderAndKey } from '@/services/watcher/watcher-utils';
import { ModelScenario } from '@/services/llm-gateway/gateway';

export interface ActionContext {
  taskId: string;
  taskName: string;
  goalTemplate?: string;
  notifyTemplate?: string;
  handler?: string;
  context?: string;
  variables: Record<string, string>;
  toolFilter?: Set<string>;
  currentState?: string;
  /** watcher 的监控目标，包含窗口信息 */
  monitorTarget?: MonitorTarget;
  /** 分解出的准备动作，注入 currentState 告诉 agent 前置准备已完成 */
  preparationGoal?: string;
  /** 分解出的详细动作描述，注入 goal 让 agent 有更具体的执行上下文 */
  actionGoal?: string;
  /** 取消信号，用于中断正在执行的 agent */
  signal?: AbortSignal;
  /** 已有的工作流模板（从 TaskActionConfig 传入） */
  workflowTemplate?: import('@/types/watcher').WorkflowTemplate;
  /** 上次执行的摘要（注入 currentState，帮助 Agent 了解历史） */
  lastExecutionSummary?: string;
  /** 聊天上下文：用于聊天回复场景 */
  chatContext?: import('@/types/watcher').ChatContext;
}

/** 动作执行结果，可选携带学到的工作流模板 */
export interface ActionResult extends TaskExecutionResult {
  /** 本次执行的简要摘要，调用方应持久化到 TaskConfig.lastExecution */
  executionSummary?: string;
  /** 首次执行成功后学到的工作流模板，调用方应持久化 */
  learnedWorkflow?: WorkflowStep[];
}

export async function executeAction(
  action: TaskActionConfig,
  ctx: ActionContext,
): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.type) {
      case 'agent_execute': {
        const executionCount = action.executionCount ?? 0;
        const workflowTemplate = ctx.workflowTemplate ?? action.workflowTemplate;

        // ── 路径 1：有工作流模板 → 回放模板 ──
        if (workflowTemplate && workflowTemplate.steps.length > 0 && executionCount > 0) {
          console.log(`[scheduler:action] 回放工作流模板 (executionCount=${executionCount})`);
          return await executeWorkflowTemplate(action, ctx, workflowTemplate, start);
        }

        // ── 路径 2：首次执行 → 录制模式 ──
        console.log(`[scheduler:action] 首次执行，启用录制模式 (executionCount=${executionCount})`);

        // 构建 goal
        let goal = fillTemplate(action.goalTemplate, ctx);
        if (ctx.actionGoal) {
          goal = `${goal}\n\n详细动作要求：${ctx.actionGoal}`;
        }

        // 使用原有的 DesktopAutomationAgent 执行
        const { DesktopAutomationAgent } = await import('@/services/desktop-automation-agent');
        const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
        const { getCacheService } = await import('@/services/cache-service-singleton');
        const { provider, apiKey } = await loadProviderAndKey();

        const skillExecutor = getBuiltinExecutor();
        const cacheService = getCacheService();
        if (!cacheService) throw new Error('getCacheService() returned undefined');

        const agent = new DesktopAutomationAgent(
          skillExecutor as unknown as import('@/interfaces/skill-executor').ISkillExecutor,
          cacheService,
        );

        // 截图：按需传入（默认 true，纯文本任务可设为 false）
        const needsScreenshot = action.requiresScreenshot !== false;
        const screenshotBase64 = needsScreenshot ? (ctx.variables['snapshot'] || undefined) : undefined;
        console.log(`[scheduler:action] requiresScreenshot=${needsScreenshot}, hasSnapshot=${!!ctx.variables['snapshot']}`);

        // 窗口信息：直接从 watcher 的 monitorTarget 构建，无需额外调用
        const windows = await buildWindowsFromMonitorTarget(ctx.monitorTarget);

        // 丰富上下文：合并 currentState 和窗口信息
        const enrichedState = buildEnrichedState(ctx);

        const turns = await agent.executeCommand({
          goal, provider, apiKey,
          screenshotBase64,
          windows,
          targetWindowHwnd: ctx.monitorTarget?.windowHwnd,
          toolFilter: ctx.toolFilter,
          context: ctx.variables['diff'] || ctx.variables['ocr'],
          currentState: enrichedState,
          signal: ctx.signal,
          scenario: ModelScenario.watcherResponse,
          // 首次执行（无模板）：跳过缓存/规划，强制逐轮 LLM 决策+验证
          skipPlanning: !workflowTemplate,
          // 首次执行需要更多轮次：每步 LLM 观察截图后决策
          maxTurns: workflowTemplate ? 3 : 8,
        });

        // 首次执行成功且无模板 → 提取工作流模板供后续回放
        let learnedWorkflow: WorkflowStep[] | undefined;
        if (!workflowTemplate && turns && turns.length > 0) {
          const { extractWorkflowFromTurns } = await import('@/services/watcher/workflow-recorder');
          learnedWorkflow = extractWorkflowFromTurns(turns, action.goalTemplate, ctx.context);
          if (learnedWorkflow.length > 0) {
            // workflow learned
          } else {
            learnedWorkflow = undefined;
          }
        }

        // 生成执行摘要（供下次调度时注入上下文）
        const toolNames = turns?.flatMap(t => t.toolCalls.map(tc => tc.name)) ?? [];
        const uniqueActions = [...new Set(toolNames)].slice(0, 5).join(', ');
        const executionSummary = turns && turns.length > 0
          ? `完成"${goal.substring(0, 60)}"(${turns.length}轮, 操作: ${uniqueActions || '无'})`
          : `完成"${goal.substring(0, 60)}"`;

        return { success: true, duration: Date.now() - start, detail: goal, learnedWorkflow, executionSummary };
      }

      case 'notify': {
        const msg = fillTemplate(action.notifyTemplate, ctx);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Handy Task', { body: msg });
        }
        return { success: true, duration: Date.now() - start, detail: msg };
      }

      case 'custom': {
        return { success: true, duration: Date.now() - start, detail: 'custom handler invoked' };
      }

      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }
  } catch (e) {
    const err = String(e);
    appEventBus.emit({
      source: 'watcher', type: 'action_error', level: 'error',
      message: `动作执行失败: ${err}`, sourceId: ctx.taskId, sourceName: ctx.taskName, timestamp: Date.now(),
    });
    return { success: false, duration: Date.now() - start, detail: err };
  }
}

function fillTemplate(template: string | undefined, ctx: ActionContext): string {
  let result = template ?? '';
  for (const [key, value] of Object.entries(ctx.variables)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

/** 从 watcher 的 monitorTarget 构建窗口信息，实时获取窗口坐标 */
async function buildWindowsFromMonitorTarget(mt?: MonitorTarget): Promise<import('@/services/desktop-service').WindowInfo[] | undefined> {
  if (!mt || mt.type !== 'window' || !mt.windowHwnd) return undefined;
  // 实时获取窗口坐标
  let bounds = { x: 0, y: 0, width: 0, height: 0 };
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    bounds = await invoke<{ x: number; y: number; width: number; height: number }>('get_window_bounds', { hwnd: mt.windowHwnd });
  } catch { /* fallback to zeros */ }
  const w: import('@/services/desktop-service').WindowInfo = {
    hwnd: mt.windowHwnd,
    title: mt.windowTitle ?? '',
    class_name: '',
    is_visible: true,
    process_id: 0,
    app_name: mt.appName ?? '',
    left: bounds.x,
    top: bounds.y,
    right: bounds.x + bounds.width,
    bottom: bounds.y + bounds.height,
    width: bounds.width,
    height: bounds.height,
  };
  return [w];
}

/** 构建丰富的 currentState：合并 watcher 上下文信息 */
function buildEnrichedState(ctx: ActionContext): string | undefined {
  const parts: string[] = [];

  // watcher 的 monitorTarget 信息
  const mt = ctx.monitorTarget;
  if (mt?.type === 'window') {
    if (mt.appName) parts.push(`目标应用: ${mt.appName}`);
    if (mt.windowTitle) parts.push(`目标窗口: "${mt.windowTitle}"`);
    if (mt.windowHwnd) parts.push(`窗口已定位 (hwnd=${mt.windowHwnd})`);
  }

  // 原有的 currentState
  if (ctx.currentState) parts.push(ctx.currentState);

  // preparationGoal — 告诉 agent 前置准备已完成
  if (ctx.preparationGoal) {
    parts.push(`前置准备已完成: ${ctx.preparationGoal}`);
  }

  // task context（任务描述等）
  if (ctx.context) parts.push(`任务上下文: ${ctx.context}`);

  // 上次执行历史
  if (ctx.lastExecutionSummary) parts.push(`上次执行结果: ${ctx.lastExecutionSummary}`);

  return parts.length > 0 ? parts.join('\n') : undefined;
}

/**
 * 回放工作流模板
 * 执行已录制的工作流步骤，LLM 调用是固定动作但内容动态
 */
async function executeWorkflowTemplate(
  action: AgentExecuteTaskAction,
  ctx: ActionContext,
  template: WorkflowTemplate,
  startTime: number,
): Promise<ActionResult> {
  const { executeWorkflowSteps } = await import('@/services/watcher/workflow-executor-v2');
  const { provider, apiKey } = await loadProviderAndKey();

  try {
    const result = await executeWorkflowSteps(template.steps, {
      goal: action.goalTemplate,
      provider,
      apiKey,
      snapshot: ctx.variables['snapshot'],
      diffDetail: ctx.variables['diff'],
      chatContext: ctx.chatContext,
      windowHwnd: ctx.monitorTarget?.windowHwnd,
      signal: ctx.signal,
    });

    return {
      success: result.success,
      duration: Date.now() - startTime,
      detail: result.detail,
      executionSummary: result.summary,
    };
  } catch (e) {
    console.error(`[scheduler:action] 工作流回放失败，降级到录制模式:`, e);
    // 回放失败 → 降级到录制模式
    return await executeWithRecording(action, ctx, startTime);
  }
}

/**
 * 首次执行：录制模式
 * 逐步执行并录制每一步，最后生成工作流模板
 */
async function executeWithRecording(
  action: AgentExecuteTaskAction,
  ctx: ActionContext,
  startTime: number,
): Promise<ActionResult> {
  // 使用原有的 DesktopAutomationAgent 执行，但记录步骤
  const { DesktopAutomationAgent } = await import('@/services/desktop-automation-agent');
  const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
  const { getCacheService } = await import('@/services/cache-service-singleton');
  const { provider, apiKey } = await loadProviderAndKey();

  const skillExecutor = getBuiltinExecutor();
  const cacheService = getCacheService();
  if (!cacheService) throw new Error('getCacheService() returned undefined');

  // 构建 goal
  let goal = fillTemplate(action.goalTemplate, ctx);
  if (ctx.actionGoal) {
    goal = `${goal}\n\n详细动作要求：${ctx.actionGoal}`;
  }

  // 执行 Agent
  const agent = new DesktopAutomationAgent(
    skillExecutor as unknown as import('@/interfaces/skill-executor').ISkillExecutor,
    cacheService,
  );

  const windows = await buildWindowsFromMonitorTarget(ctx.monitorTarget);
  const enrichedState = buildEnrichedState(ctx);

  const turns = await agent.executeCommand({
    goal, provider, apiKey,
    screenshotBase64: ctx.variables['snapshot'],
    windows,
    targetWindowHwnd: ctx.monitorTarget?.windowHwnd,
    toolFilter: ctx.toolFilter,
    context: ctx.variables['diff'] || ctx.variables['ocr'],
    currentState: enrichedState,
    signal: ctx.signal,
    scenario: ModelScenario.watcherResponse,
    skipPlanning: true,
    maxTurns: 8,
  });

  // 从 Agent 执行中提取工作流模板（使用原有的提取逻辑）
  let learnedWorkflow: WorkflowStep[] | undefined;
  if (turns && turns.length > 0) {
    const { extractWorkflowFromTurns } = await import('@/services/watcher/workflow-recorder');
    learnedWorkflow = extractWorkflowFromTurns(turns, action.goalTemplate, ctx.context);
    if (learnedWorkflow.length === 0) {
      learnedWorkflow = undefined;
    }
  }

  // 生成执行摘要
  const toolNames = turns?.flatMap(t => t.toolCalls.map(tc => tc.name)) ?? [];
  const uniqueActions = [...new Set(toolNames)].slice(0, 5).join(', ');
  const executionSummary = turns && turns.length > 0
    ? `完成"${goal.substring(0, 60)}"(${turns.length}轮, 操作: ${uniqueActions || '无'})`
    : `完成"${goal.substring(0, 60)}"`;

  return {
    success: true,
    duration: Date.now() - startTime,
    detail: goal,
    learnedWorkflow,
    executionSummary,
  };
}
