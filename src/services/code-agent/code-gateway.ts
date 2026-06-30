// CodeGateway — 代码/文件/Shell Agent 入口
// 处理文件操作、代码生成、Shell 命令执行等任务
// 类似 WebGateway/DocGateway，直接使用 TaskAgentRunner + code 工具集

import type { ProviderConfig } from '@/types/provider';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import { TaskAgentRunner, type AgentProgressEvent } from '@/services/task-agent/runner';
import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import type { TaskResult } from '@/services/task-agent/gateway';

export interface CodeGatewayResponse {
  message: string;
  tasks: TaskResult[];
}

// Code agent 允许使用的工具
const CODE_TOOL_FILTER = new Set([
  // 文件操作
  'read_file', 'write_file', 'glob_files', 'grep_files',
  // 代码生成 & 执行
  'generate_code', 'generate_project', 'execute_code',
  'save_code', 'list_code',
  // App 入库
  'save_app', 'save_project',
  // Shell
  'run_command',
  // 联网搜索
  'web_search', 'web_fetch',
  // 记忆
  'agent_memory_update',
  // 历史聊天搜索
  'search_chat_history',
  // 控制
  'think', 'request_user_input', 'code_done', 'finalize',
]);

export class CodeGateway {
  private skillExecutor: ISkillExecutor;

  constructor(skillExecutor: ISkillExecutor) {
    this.skillExecutor = skillExecutor;
  }

  async handleUserMessage(params: {
    content: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    signal?: AbortSignal;
    maxTurns?: number;
    messages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<CodeGatewayResponse> {
    const { content, provider, apiKey, password, signal, maxTurns, messages, onConfirm, onUserInput, onProgress } = params;

    console.log(`[CodeGateway] ▶ 代码任务: "${content.substring(0, 80)}"`);

    const runner = new TaskAgentRunner(this.skillExecutor);
    const agentId = runner.generateAgentId('code');

    const taskDB = new TaskTreeDB();
    const taskId = await taskDB.createRoot(content, agentId);

    console.log(`[CodeGateway] agentId=${agentId}, taskId=${taskId}`);

    const result = await runner.runAgent({
      taskId,
      agentType: 'code',
      goal: content,
      provider,
      apiKey,
      password,
      maxTurns: maxTurns ?? 20,
      signal,
      toolFilter: CODE_TOOL_FILTER,
      chatMessages: messages,
      onConfirm,
      onUserInput,
      onProgress,
    });

    console.log(`[CodeGateway] ✓ 完成: success=${result.success} error=${result.error ?? 'none'}`);

    const bestMessage = result.lastResponseText || result.lastSuccessfulToolResult || result.summary;
    return {
      message: result.success
        ? (bestMessage || '代码任务完成')
        : (bestMessage ? `${bestMessage}\n\n(后续出错: ${result.error})` : `代码任务失败: ${result.error}`),
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
