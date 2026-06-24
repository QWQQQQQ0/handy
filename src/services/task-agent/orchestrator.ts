// TaskOrchestrator — 桌面自动化任务编排器
// 4 阶段：Decomposer → Executor × N → Verifier → Assembler

import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import { TaskAgentRunner, type AgentProgressEvent } from './runner';
import type { TaskSplitDecision, TaskAgentType } from '@/services/multi-agent/types';
import type { TaskTreeRow } from '@/db/types';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import type { ProviderConfig } from '@/types/provider';
import type { SkillResult } from '@/types/skill';

export interface TaskOrchestratorResult {
  success: boolean;
  message: string;
}

export class TaskOrchestrator {
  private taskDB = new TaskTreeDB();
  private runner: TaskAgentRunner;
  private _chatMessages?: import('@/types/message').LLMMessage[];

  constructor(skillExecutor: ISkillExecutor) {
    this.runner = new TaskAgentRunner(skillExecutor);
  }

  async execute(params: {
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    maxTurns?: number;
    signal?: AbortSignal;
    toolFilter?: Set<string>;
    messages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<TaskOrchestratorResult> {
    const { goal, provider, apiKey, signal, toolFilter, messages, onConfirm, onUserInput, onProgress } = params;
    this._chatMessages = messages;

    // 创建根任务
    const agentId = this.runner.generateAgentId('decomposer');
    const rootTaskId = await this.taskDB.createRoot(goal, agentId);
    await this.taskDB.updateContract(rootTaskId, JSON.stringify({ goal }));

    // Phase 1: Decomposer — 判断是否拆分
    const decomposeResult = await this.runner.runAgent({
      taskId: rootTaskId,
      agentType: 'decomposer',
      goal,
      provider,
      apiKey,
      maxTurns: 5,
      signal,
      chatMessages: messages,
      onProgress,
    });

    if (!decomposeResult.success) {
      return { success: false, message: decomposeResult.error ?? 'Decomposition failed' };
    }

    // 读取拆分决策
    const updatedTask = await this.taskDB.getById(rootTaskId);
    let shouldSplit = false;
    let subTasks: Array<{ name: string; description: string }> = [];

    if (updatedTask?.decision_json) {
      try {
        const decision = JSON.parse(updatedTask.decision_json) as TaskSplitDecision;
        shouldSplit = decision.should_split && (decision.sub_tasks?.length ?? 0) > 0;
        subTasks = decision.sub_tasks ?? [];
      } catch { /* treat as no split */ }
    }

    if (!shouldSplit) {
      // 不拆分 → 直接执行
      return this.executeLeaf(rootTaskId, goal, goal, provider, apiKey, params.maxTurns, signal, toolFilter, onConfirm, onUserInput, onProgress);
    }

    // Phase 2: 创建子任务 + 执行
    const childTaskIds: string[] = [];
    for (const sub of subTasks) {
      const childId = await this.taskDB.createChild(
        rootTaskId,
        sub.name,
        sub.name,
        'executor' as TaskAgentType as never,
        1,
      );
      childTaskIds.push(childId);
    }

    // 顺序执行子任务（桌面自动化通常有顺序依赖）
    for (let i = 0; i < childTaskIds.length; i++) {
      if (signal?.aborted) break;
      const childId = childTaskIds[i];
      const sub = subTasks[i];

      const result = await this.executeLeaf(childId, goal, sub.description, provider, apiKey, params.maxTurns, signal, toolFilter, onConfirm, onUserInput, onProgress);
      if (!result.success) {
        return result;
      }
    }

    // Phase 3: Verifier — 验证最终结果
    const verifyTaskId = await this.taskDB.createChild(
      rootTaskId,
      'verify',
      'verify',
      'verifier' as TaskAgentType as never,
      1,
    );
    await this.runner.runAgent({
      taskId: verifyTaskId,
      agentType: 'verifier',
      goal,
      provider,
      apiKey,
      maxTurns: 5,
      signal,
      chatMessages: messages,
      onProgress,
    });

    await this.taskDB.updateStatus(rootTaskId, 'done');
    return { success: true, message: `Completed: ${goal}` };
  }

  private async executeLeaf(
    taskId: string,
    goal: string,
    subTaskDescription: string,
    provider: ProviderConfig,
    apiKey: string,
    maxTurns?: number,
    signal?: AbortSignal,
    toolFilter?: Set<string>,
    onConfirm?: (command: string) => Promise<boolean>,
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>,
    onProgress?: (event: AgentProgressEvent) => void,
  ): Promise<TaskOrchestratorResult> {
    const result = await this.runner.runAgent({
      taskId,
      agentType: 'executor',
      goal,
      provider,
      apiKey,
      maxTurns: maxTurns ?? 20,
      subTaskDescription,
      signal,
      toolFilter,
      chatMessages: this._chatMessages,
      onConfirm,
      onUserInput,
      onProgress,
    });

    if (!result.success) {
      return { success: false, message: result.error ?? 'Execution failed' };
    }
    return { success: true, message: subTaskDescription };
  }
}
