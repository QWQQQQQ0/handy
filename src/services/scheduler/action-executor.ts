// Generic action executor — pure dispatcher, decoupled from any specific agent.
// Routes to TaskAgentRunner (LLM loop), workflow-executor-v2 (replay),
// CodeSandboxService (scripts), or Notification API.

import type { TaskActionConfig, TaskExecutionResult } from '@/types/scheduler';
import { appEventBus } from '@/services/event-bus';

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
  /** 取消信号，用于中断正在执行的 agent */
  signal?: AbortSignal;
  /** LLM provider 配置（agent_execute 需要） */
  provider?: { provider: import('@/types/provider').ProviderConfig; apiKey: string };
}

/** 动作执行结果 */
export interface ActionResult extends TaskExecutionResult {
  /** 本次执行的简要摘要 */
  executionSummary?: string;
}

export async function executeAction(
  action: TaskActionConfig,
  ctx: ActionContext,
): Promise<ActionResult> {
  const start = Date.now();

  try {
    switch (action.type) {
      // ── 路径 1: LLM Agent 执行 ──
      case 'agent_execute': {
        const goal = buildGoal(action.goalTemplate, ctx);
        const { TaskAgentRunner } = await import('@/services/task-agent/runner');
        const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
        const { TaskTreeDB } = await import('@/services/multi-agent/task-tree-db');

        const provider = ctx.provider ?? await loadProviderAndKey();
        const skillExecutor = getBuiltinExecutor();
        const runner = new TaskAgentRunner(skillExecutor);
        const taskDB = new TaskTreeDB();
        const taskId = await taskDB.createRoot(goal, runner.generateAgentId('executor'));

        console.log(`[scheduler:action] agent_execute taskId=${taskId} goal="${goal.substring(0, 80)}"`);

        const result = await runner.runAgent({
          taskId,
          agentType: 'executor',
          goal,
          provider: provider.provider,
          apiKey: provider.apiKey,
          maxTurns: action.workflowTemplate ? 3 : 8,
          signal: ctx.signal,
          toolFilter: ctx.toolFilter,
        });

        const summary = result.success
          ? `完成: ${goal.substring(0, 80)}`
          : `失败: ${result.error ?? '未知错误'}`;

        return { success: result.success, duration: Date.now() - start, detail: goal, executionSummary: summary };
      }

      // ── 路径 2: 工作流回放 ──
      case 'workflow': {
        console.log(`[scheduler:action] workflow 回放 (${action.steps.length} 步骤)`);
        const { executeWorkflowSteps } = await import('@/services/watcher/workflow-executor-v2');
        const provider = await loadProviderAndKey();

        const result = await executeWorkflowSteps(action.steps as any, {
          goal: action.goalTemplate ?? ctx.goalTemplate ?? '',
          provider: provider.provider,
          apiKey: provider.apiKey,
          snapshot: ctx.variables['snapshot'],
          diffDetail: ctx.variables['diff'],
          signal: ctx.signal,
        });

        return {
          success: result.success,
          duration: Date.now() - start,
          detail: result.detail,
          executionSummary: result.summary,
        };
      }

      // ── 路径 3: 脚本沙箱执行 ──
      case 'script': {
        console.log(`[scheduler:action] script (${action.language})`);
        const { codeSandboxService } = await import('@/services/code-sandbox');
        const sandboxResult = await codeSandboxService.execute(
          action.language as 'javascript' | 'python',
          action.code,
          { variables: ctx.variables },
          { timeoutMs: action.timeoutMs ?? 60_000 },
        );
        return {
          success: sandboxResult.success,
          duration: Date.now() - start,
          detail: sandboxResult.success ? sandboxResult.output : sandboxResult.error,
        };
      }

      // ── 路径 4: 浏览器通知 ──
      case 'notify': {
        const msg = fillTemplate(action.notifyTemplate, ctx);
        if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
          new Notification('Handy Task', { body: msg });
        }
        return { success: true, duration: Date.now() - start, detail: msg };
      }

      // ── 自定义处理器 ──
      case 'custom': {
        return { success: true, duration: Date.now() - start, detail: 'custom handler invoked' };
      }

      default:
        throw new Error(`Unknown action type: ${(action as any).type}`);
    }
  } catch (e) {
    const err = String(e);
    appEventBus.emit({
      source: 'scheduler', type: 'action_error', level: 'error',
      message: `动作执行失败: ${err}`, sourceId: ctx.taskId, sourceName: ctx.taskName, timestamp: Date.now(),
    });
    return { success: false, duration: Date.now() - start, detail: err };
  }
}

// ── Helpers ──

function fillTemplate(template: string | undefined, ctx: ActionContext): string {
  let result = template ?? '';
  for (const [key, value] of Object.entries(ctx.variables)) {
    result = result.replaceAll(`{${key}}`, value);
  }
  return result;
}

function buildGoal(goalTemplate: string | undefined, ctx: ActionContext): string {
  const parts: string[] = [];
  if (ctx.currentState) parts.push(`当前状态: ${ctx.currentState}`);
  if (ctx.context) parts.push(`任务上下文: ${ctx.context}`);
  if (goalTemplate) parts.push(fillTemplate(goalTemplate, ctx));
  return parts.join('\n');
}

async function loadProviderAndKey(): Promise<{ provider: import('@/types/provider').ProviderConfig; apiKey: string }> {
  const { loadProviderAndKey: load } = await import('@/services/watcher/watcher-utils');
  return load();
}
