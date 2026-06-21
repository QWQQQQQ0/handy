// Shared types for the multi-agent collaboration system

export type AgentType = 'orchestrator' | 'architect' | 'developer' | 'reviewer' | 'integrator';

/** Task 专用 agent 类型 */
export type TaskAgentType = 'decomposer' | 'executor' | 'verifier' | 'assembler' | 'doc' | 'web' | 'code';

export type TaskStatus = 'pending' | 'analyzing' | 'coding' | 'reviewing' | 'done' | 'failed';

/** Task 专用状态 */
export type TaskExecStatus = 'pending' | 'decomposing' | 'executing' | 'verifying' | 'done' | 'failed';

export type LogAction = 'analyze' | 'decide_split' | 'code' | 'write_file' | 'read_file' | 'review' | 'fix' | 'negotiate' | 'shell_exec' | 'done';

/** Task 专用日志动作 */
export type TaskLogAction = 'decompose' | 'execute' | 'verify' | 'done' | 'error';

export interface SplitDecision {
  should_split: boolean;
  score: number;
  pros: string[];
  cons: string[];
  reason: string;
  sub_modules?: Array<{
    name: string;
    description: string;
    files_estimate: number;
  }>;
}

export interface ModuleContract {
  module: string;
  version: string;
  exports: {
    functions: Array<{
      name: string;
      params: Record<string, string>;
      returns: string;
      description: string;
    }>;
    types: Array<{
      name: string;
      fields: Array<{ name: string; type: string }>;
    }>;
  };
  imports: string[];
  db_tables?: string[];
}

/** Task 拆分决策（Decomposer agent 输出） */
export interface TaskSplitDecision {
  should_split: boolean;
  reason: string;
  sub_tasks?: Array<{
    name: string;
    description: string;
  }>;
}
