// DocGateway — 文档自动化 agent 入口
// 比 TaskGateway 简单：无意图分类、无复杂度判断、无 Orchestrator
// 直接用 TaskAgentRunner 执行多轮 LLM 工具循环

import type { ProviderConfig } from '@/types/provider';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import { TaskAgentRunner, type AgentProgressEvent } from '@/services/task-agent/runner';
import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import type { TaskResult } from '@/services/task-agent/gateway';

export interface DocGatewayResponse {
  message: string;
  tasks: TaskResult[];
}

/** 文档 agent 工具过滤器：只保留文档相关工具 + 控制工具 */
const DOC_TOOL_FILTER = new Set([
  // 文档工具（从 SkillExecutor 动态获取）
  'office_detect', 'com_read', 'com_edit', 'generate_doc', 'doc_code_exec',
  // 旧名兼容
  'generate_word', 'generate_excel', 'generate_ppt',
  'word_com_read', 'word_com_edit', 'excel_com_read', 'excel_com_edit',
  'ppt_com_read', 'ppt_com_edit',
  // 文件系统工具（验证路径、搜索文档、导出结果）
  'read_file', 'glob', 'write_file',
  // 控制工具（静态定义在 tools.ts）
  'think', 'request_user_input', 'doc_done', 'finalize',
]);

export class DocGateway {
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
  }): Promise<DocGatewayResponse> {
    const { content, provider, apiKey, password, signal, maxTurns, messages, onConfirm, onUserInput, onProgress } = params;

    console.log(`[DocGateway] ▶ 文档任务: "${content.substring(0, 80)}"`);

    // 创建 TaskAgentRunner
    const runner = new TaskAgentRunner(this.skillExecutor);
    const agentId = runner.generateAgentId('doc');

    // 创建任务树节点
    const taskDB = new TaskTreeDB();
    const taskId = await taskDB.createRoot(content, agentId);

    console.log(`[DocGateway] agentId=${agentId}, taskId=${taskId}`);

    // 执行多轮 LLM 工具循环
    const result = await runner.runAgent({
      taskId,
      agentType: 'doc',
      goal: content,
      provider,
      apiKey,
      password,
      maxTurns: maxTurns ?? 20,
      signal,
      toolFilter: DOC_TOOL_FILTER,
      onConfirm,
      onUserInput,
      onProgress,
    });

    console.log(`[DocGateway] ✓ 完成: success=${result.success} error=${result.error ?? 'none'}`);

    return {
      message: result.success
        ? (result.summary || '文档任务完成')
        : `文档任务失败: ${result.error}`,
      tasks: [{
        taskId,
        status: result.success ? 'done' : 'error',
        error: result.error,
        message: result.summary,
      }],
    };
  }
}
