// TaskGateway — 桌面自动化任务入口
// 替代 AgentTaskService：判断意图 → 筛选工具 → 判断复杂度 → 路由

import type { ProviderConfig } from '@/types/provider';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import type { ParsedGoal } from '@/types/goal';
import { IntentClassifierAgent } from '@/agents/intent-classifier-api';
import { TaskOrchestrator } from './orchestrator';
import { TaskAgentRunner, type AgentProgressEvent } from './runner';
import { appEventBus } from '@/services/event-bus';
import { scheduledTaskManager } from '@/services/watcher';
import type { TaskConfig } from '@/types/scheduler';
import { AgentEndpoint } from '@/api/types';
import { apiStreamCompat } from '@/api/client';

export interface TaskResult {
  taskId?: string;
  status: 'done' | 'scheduled' | 'error';
  error?: string;
  message?: string;
  /** Agent finalize/*_done 工具返回的 summary（任务完成时的总结） */
  summary?: string;
  /** 子 agent 执行链最后一条助手消息的文本内容（LLM 的自然语言结论） */
  lastMessage?: string;
}

export interface TaskGatewayResponse {
  message: string;
  tasks: TaskResult[];
}

export class TaskGateway {
  private skillExecutor: ISkillExecutor;

  constructor(skillExecutor: ISkillExecutor) {
    this.skillExecutor = skillExecutor;
  }

  /**
   * Chat 统一入口：有工具走自动化，无工具走纯聊天。
   * @param messages 可选的消息历史，用于 agent 间通信（方案 A：共享上下文）
   */
  async handleUserMessage(params: {
    content: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    toolFilter?: Set<string>;
    signal?: AbortSignal;
    messages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<TaskGatewayResponse> {
    const { content, provider, apiKey, password, toolFilter, signal, messages, onConfirm, onUserInput, onProgress } = params;

    // Chat 派发来的任务 → 自动化流水线（工具由 Task 内部选择）
    return this.handleUserGoal({
      goal: content,
      provider,
      apiKey,
      password,
      toolFilter,
      signal,
      messages,
      onConfirm,
      onUserInput,
      onProgress,
    });
  }

  /** 纯聊天：直接调 LLM，不走自动化 */
  private async chat(
    userMessage: string,
    provider: ProviderConfig,
    apiKey: string,
  ): Promise<TaskGatewayResponse> {
    const { ChatAgent } = await import('@/agents/chat-api');
    const chatAgent = new ChatAgent();

    let response = '';
    const stream = chatAgent.chat({
      messages: [{ role: 'user', content: userMessage }],
      provider: {
        id: provider.id,
        name: provider.name,
        type: provider.type as 'openai' | 'anthropic' | 'google',
        baseUrl: provider.baseUrl,
        model: provider.model,
        encryptedApiKey: provider.encryptedApiKey,
        isDefault: false,
        supportsTools: false,
        createdAt: '',
      },
      apiKey,
    });

    for await (const chunk of stream) {
      if (chunk.startsWith('__ERROR__:')) {
        return { message: chunk.substring(10), tasks: [{ status: 'error', error: chunk.substring(10) }] };
      }
      if (chunk.startsWith('__REASONING__:')) continue;
      if (chunk.startsWith('__TOOLS__:')) continue;
      response += chunk;
    }

    return { message: response, tasks: [{ status: 'done', message: response }] };
  }

  async handleUserGoal(params: {
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    maxTurns?: number;
    signal?: AbortSignal;
    toolFilter?: Set<string>;
    messages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<TaskGatewayResponse> {
    const { goal, provider, apiKey, password, signal, onConfirm, onUserInput, onProgress } = params;

    // 1. 意图分类
    const classifier = new IntentClassifierAgent();
    const parsed: ParsedGoal = await classifier.classify(goal, provider, apiKey);
    console.log(`[TaskGateway] 意图分类完成: ${parsed.tasks.length} 个任务 — ${parsed.tasks.map(t => `${t.type}:${t.goal?.substring(0, 50)}`).join(' | ')}`);

    // 2. 确定工具范围
    //    toolFilter 有值 → 用户在 Task tab 直接执行，用用户选择
    //    toolFilter 无值 → Chat 分配的任务，Task 自己筛选
    let toolFilter = params.toolFilter;
    if (!toolFilter) {
      toolFilter = await this.classifyToolsForTask(goal, provider, apiKey);
    }
    console.log(`[TaskGateway] 工具筛选完成: ${toolFilter.size} 个工具 — [${[...toolFilter].join(', ')}]`);

    // 3. 任务合并优化：如果同时存在 screen_change 和 once 任务，将 once 合并到 Watcher 的 action 中
    let tasks = parsed.tasks;
    const hasScreenChange = tasks.some(t => t.type === 'screen_change');
    const hasOnce = tasks.some(t => t.type === 'once');
    if (hasScreenChange && hasOnce) {
      const watcherTask = tasks.find(t => t.type === 'screen_change')!;
      const onceTasks = tasks.filter(t => t.type === 'once');
      const onceGoals = onceTasks.map(t => t.goal).filter(Boolean).join('；');
      // 将 once 任务的目标合并到 Watcher 的 action.goalTemplate
      if (watcherTask.action.goalTemplate) {
        watcherTask.action.goalTemplate += '；' + onceGoals;
      } else {
        watcherTask.action.goalTemplate = onceGoals;
      }
      // 只保留 screen_change 任务
      tasks = tasks.filter(t => t.type !== 'once');
      console.log(`[TaskGateway] 任务合并: 将 ${onceTasks.length} 个 once 任务合并到 screen_change，合并后 goalTemplate="${watcherTask.action.goalTemplate?.substring(0, 100)}"`);
    }

    const results: TaskResult[] = [];

    for (const task of tasks) {
      try {
        if (task.type === 'once') {
          const isComplex = this.isComplexGoal(task.goal);
          console.log(`[TaskGateway] 任务类型=once 复杂度=${isComplex ? 'complex' : 'simple'} goal="${task.goal?.substring(0, 80)}"`);
          appEventBus.emit({
            source: 'app',
            type: 'task_execute_start',
            level: 'info',
            message: `${isComplex ? 'Complex' : 'Simple'}: ${task.goal}`,
            timestamp: Date.now(),
          });

          if (isComplex) {
            const orchestrator = new TaskOrchestrator(this.skillExecutor);
            const result = await orchestrator.execute({
              goal: task.goal,
              provider,
              apiKey,
              maxTurns: params.maxTurns,
              signal,
              toolFilter,
              messages: params.messages,
              onConfirm,
              onUserInput,
              onProgress,
            });
            results.push({
              status: result.success ? 'done' : 'error',
              message: result.message,
              error: result.success ? undefined : result.message,
              lastMessage: result.lastMessage || result.message,
            });
          } else {
            console.log(`[TaskGateway] 创建 TaskAgentRunner...`);
            const runner = new TaskAgentRunner(this.skillExecutor);
            const agentId = runner.generateAgentId('executor');
            console.log(`[TaskGateway] agentId=${agentId}, 加载 TaskTreeDB...`);
            const { TaskTreeDB } = await import('@/services/multi-agent/task-tree-db');
            const taskDB = new TaskTreeDB();
            // 获取当前活动窗口作为目标窗口
            console.log(`[TaskGateway] 获取活动窗口...`);
            const { globalState } = await import('@/services/global-state');
            const activeWindow = await globalState.getActiveWindow();
            console.log(`[TaskGateway] 活动窗口: hwnd=${activeWindow?.hwnd} title="${activeWindow?.title}"`);
            console.log(`[TaskGateway] 创建任务树... goal="${task.goal?.substring(0, 80)}"`);
            const taskId = await taskDB.createRoot(
              task.goal,
              agentId,
              activeWindow?.hwnd,
              activeWindow?.title,
            );

            console.log(`[TaskGateway] 开始执行 TaskAgentRunner taskId=${taskId}`);
            const result = await runner.runAgent({
              taskId,
              agentType: 'executor',
              goal: task.goal,
              provider,
              apiKey,
              password,
              maxTurns: params.maxTurns ?? 20,
              signal,
              toolFilter,
              chatMessages: params.messages,
              onConfirm,
              onUserInput,
              onProgress,
            });
            console.log(`[TaskGateway] TaskAgentRunner 完成: success=${result.success} error=${result.error ?? 'none'}`);
            results.push({
              taskId,
              status: result.success ? 'done' : 'error',
              error: result.error,
              summary: result.summary,
              lastMessage: result.lastResponseText || result.lastSuccessfulToolResult || result.summary || result.error,
            });
          }
        } else {
          // timer / screen_change → 直接创建后台任务
          const taskConfig = this.buildTaskConfig(task);
          await scheduledTaskManager.create(taskConfig);
          results.push({
            taskId: taskConfig.id,
            status: 'scheduled',
            message: `Scheduled: ${task.name} (${task.type})`,
          });
          appEventBus.emit({
            source: 'app',
            type: 'task_scheduled',
            level: 'info',
            message: `Scheduled: ${task.name}`,
            timestamp: Date.now(),
          });
        }
      } catch (e) {
        console.error(`[TaskGateway] ✗ 任务执行异常:`, e);
        results.push({
          status: 'error',
          error: String(e),
        });
      }
    }

    return { message: parsed.response, tasks: results };
  }

  /**
   * Chat 分配任务时：从全部工具名中筛选可能用到的工具。
   * 只给 LLM 工具名字列表，不给详细参数信息。
   */
  private async classifyToolsForTask(
    goal: string,
    provider: ProviderConfig,
    apiKey: string,
  ): Promise<Set<string>> {
    const allTools = this.skillExecutor.buildToolsForLLM();
    const toolNames = allTools
      .map((t) => (t['function'] as { name: string } | undefined)?.name ?? '')
      .filter(Boolean)
      .join(', ');

    const prompt = `用户任务：${goal.slice(0, 300)}\n\n可用工具：${toolNames}\n\n选择完成任务可能需要的工具名，返回 JSON 数组。只返回 JSON。`;

    try {
      const { default: prompts } = await import('@/config/system-prompts.json');
      const { ChatAgent } = await import('@/agents/chat-api');
      const chatAgent = new ChatAgent();

      let response = '';
      const stream = chatAgent.chat({
        messages: [
          { role: 'system', content: prompts.toolProbe },
          { role: 'user', content: prompt },
        ],
        provider: {
          id: provider.id,
          name: provider.name,
          type: provider.type as 'openai' | 'anthropic' | 'google',
          baseUrl: provider.baseUrl,
          model: provider.model,
          encryptedApiKey: provider.encryptedApiKey,
          isDefault: false,
          supportsTools: false,
          createdAt: '',
        },
        apiKey,
        noSystemPrompt: true,
      });

      for await (const chunk of stream) {
        if (chunk.startsWith('__ERROR__:')) break;
        if (chunk.startsWith('__REASONING__:')) continue;
        if (chunk.startsWith('__TOOLS__:')) continue;
        response += chunk;
      }

      const jsonMatch = response.match(/\[[\s\S]*?\]/);
      if (!jsonMatch) return new Set(allTools.map((t) => (t['function'] as { name: string }).name));

      const selectedNames = JSON.parse(jsonMatch[0]) as string[];
      if (!Array.isArray(selectedNames) || selectedNames.length === 0) return new Set();

      return new Set(selectedNames);
    } catch {
      // 筛选失败 → 返回全部工具
      return new Set(allTools.map((t) => (t['function'] as { name: string }).name));
    }
  }

  /** 简单启发式判断任务复杂度 */
  private isComplexGoal(goal: string): boolean {
    const stepKeywords = ['然后', '接着', '之后', '再', '最后', '第一步', '第二步', 'and then', 'then', 'after that', 'finally', 'step'];
    const lower = goal.toLowerCase();
    return stepKeywords.some((kw) => lower.includes(kw));
  }

  private buildTaskConfig(task: import('@/types/goal').ParsedTask): TaskConfig {
    const { buildTaskConfig } = require('@/services/task-builder');
    return buildTaskConfig(task);
  }
}
