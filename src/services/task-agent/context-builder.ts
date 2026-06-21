// Task 上下文构建器
// 系统提示由后端 buildSystemPrompt(scenario) 统一注入，这里只构建 user 消息

import type { TaskAgentType } from '@/services/multi-agent/types';
import type { TaskTreeRow } from '@/db/types';

export interface TaskContextParams {
  agentType: TaskAgentType;
  task: TaskTreeRow;
  goal: string;
  subTaskDescription?: string;
}

export function buildTaskContext(params: TaskContextParams): { userPrompt: string } {
  const { agentType, goal, subTaskDescription } = params;

  switch (agentType) {
    case 'decomposer':
      return { userPrompt: subTaskDescription ?? goal };

    case 'executor':
      return { userPrompt: subTaskDescription ?? goal };

    case 'verifier':
      return { userPrompt: `验证以下任务是否完成：\n${subTaskDescription ?? goal}` };

    case 'assembler':
      return { userPrompt: subTaskDescription ?? goal };

    case 'doc':
      return { userPrompt: subTaskDescription ?? goal };

    case 'web':
      return { userPrompt: subTaskDescription ?? goal };

    case 'code':
      return { userPrompt: subTaskDescription ?? goal };
  }
}
