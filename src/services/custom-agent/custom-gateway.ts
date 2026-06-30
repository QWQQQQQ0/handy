// CustomAgentGateway — 用户自定义 Agent 入口
// 复用 TaskAgentRunner + customSystemPrompt，与 FreeAgentGateway 同模式

import type { ProviderConfig } from '@/types/provider';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import { TaskAgentRunner, type AgentProgressEvent } from '@/services/task-agent/runner';
import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import type { TaskResult } from '@/services/task-agent/gateway';
import type { UserAgentConfig } from '@/types/agent';

export interface CustomAgentResponse {
  message: string;
  tasks: TaskResult[];
}

export class CustomAgentGateway {
  private skillExecutor: ISkillExecutor;
  private agentConfig: UserAgentConfig;

  constructor(skillExecutor: ISkillExecutor, agentConfig: UserAgentConfig) {
    this.skillExecutor = skillExecutor;
    this.agentConfig = agentConfig;
  }

  async handleUserGoal(params: {
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    signal?: AbortSignal;
    maxTurns?: number;
    chatMessages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<CustomAgentResponse> {
    const { goal, provider, apiKey, password, signal, maxTurns, chatMessages, onConfirm, onUserInput, onProgress } = params;

    console.log(`[CustomAgent:${this.agentConfig.name}] ▶ "${goal.substring(0, 80)}" tools=${this.agentConfig.toolNames.length}`);

    const runner = new TaskAgentRunner(this.skillExecutor);
    const agentId = runner.generateAgentId('code');
    const taskDB = new TaskTreeDB();
    const taskId = await taskDB.createRoot(goal, agentId);

    const result = await runner.runAgent({
      taskId,
      agentType: 'code',  // 复用 code endpoint（全工具能力）
      goal,
      provider,
      apiKey,
      password,
      maxTurns: maxTurns ?? 30,
      signal,
      toolFilter: new Set(this.agentConfig.toolNames),
      chatMessages,
      customSystemPrompt: this.agentConfig.systemPrompt,
      onConfirm,
      onUserInput,
      onProgress,
    });

    console.log(`[CustomAgent:${this.agentConfig.name}] ✓ success=${result.success}`);

    const bestMessage = result.lastResponseText || result.lastSuccessfulToolResult || result.summary;
    return {
      message: result.success
        ? (bestMessage || '任务完成')
        : (bestMessage ? `${bestMessage}\n\n(后续出错: ${result.error})` : `任务失败: ${result.error}`),
      tasks: [{
        taskId,
        status: result.success ? 'done' : 'error',
        error: result.error,
        message: result.summary,
        lastMessage: bestMessage || result.summary || result.error,
      }],
    };
  }
}
