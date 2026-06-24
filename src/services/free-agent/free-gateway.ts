// FreeAgentGateway — 通用 AI 开发者 Agent 入口
// 全工具开放 + Python 完全访问 + ToolDisclosure 渐进式披露
//
// 与 CodeGateway 的区别：
//   - 无 toolFilter（全部工具可用）
//   - ToolDisclosure 菜单注入 system prompt，指导 LLM 按需了解工具
//   - Python 沙箱完全访问（可 pip install 任意包）
//   - 独立页面，不经过 Chat 的 request_agent 路由

import type { ProviderConfig } from '@/types/provider';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import { TaskAgentRunner, type AgentProgressEvent } from '@/services/task-agent/runner';
import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import type { TaskResult } from '@/services/task-agent/gateway';
import { codeSandboxService } from '@/services/code-sandbox';
import { FREE_AGENT_TOOLS } from '@/skills/tool-disclosure';

export interface FreeAgentResponse {
  message: string;
  tasks: TaskResult[];
}

export class FreeAgentGateway {
  private skillExecutor: ISkillExecutor;

  constructor(skillExecutor: ISkillExecutor) {
    this.skillExecutor = skillExecutor;
  }

  async handleUserGoal(params: {
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    signal?: AbortSignal;
    maxTurns?: number;
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<FreeAgentResponse> {
    const { goal, provider, apiKey, password, signal, maxTurns, onConfirm, onUserInput, onProgress } = params;

    console.log(`[FreeAgent] ▶ "${goal.substring(0, 80)}"`);

    // ── 启用 Python 完全访问 ──
    codeSandboxService.setPythonFullAccess(true);

    // ── 菜单文本由 client.ts 的 injectSystemPrompt 动态注入到 system prompt ──

    try {
      const runner = new TaskAgentRunner(this.skillExecutor);
      const agentId = runner.generateAgentId('free');
      const taskDB = new TaskTreeDB();
      const taskId = await taskDB.createRoot(goal, agentId);

      console.log(`[FreeAgent] agentId=${agentId}, taskId=${taskId}`);

      const result = await runner.runAgent({
        taskId,
        agentType: 'free',
        goal,
        provider,
        apiKey,
        password,
        maxTurns: maxTurns ?? 30,
        signal,
        toolFilter: FREE_AGENT_TOOLS,
        onConfirm,
        onUserInput,
        onProgress,
      });

      console.log(`[FreeAgent] ✓ success=${result.success} error=${result.error ?? 'none'}`);

      return {
        message: result.success
          ? (result.summary || '任务完成')
          : `任务失败: ${result.error}`,
        tasks: [{
          taskId,
          status: result.success ? 'done' : 'error',
          error: result.error,
          message: result.summary,
        }],
      };
    } finally {
      codeSandboxService.setPythonFullAccess(false);
    }
  }
}
