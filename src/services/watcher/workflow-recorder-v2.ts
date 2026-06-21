// 工作流录制器 V2 — 录制可复用的执行流程
//
// 核心思想：
// - 首次执行时录制每一步（包括 LLM 调用）
// - LLM 调用是固定动作，但输入输出是动态的
// - 录制完成后生成可复用的工作流模板
//
// 步骤类型：
// 1. screenshot — 截图
// 2. llm_analyze — 调用 LLM 分析（固定动作，动态内容）
// 3. execute_action — 执行 LLM 返回的操作
// 4. verify — 验证操作结果
// 5. check_complete — 检查任务是否完成

import type { WorkflowStepV2, WorkflowTemplate, WorkflowStepTypeV2, ChatContext, ChatMessage, SenderInfo } from '@/types/watcher';
import type { SemanticAction } from '@/types/cache';

/** 录制的步骤 */
export interface RecordedStep {
  type: WorkflowStepTypeV2;
  description: string;
  /** 截图 base64（screenshot 步骤） */
  screenshot?: string;
  /** LLM 分析的输入（llm_analyze 步骤） */
  llmInput?: {
    prompt: string;
    screenshot?: string;
    diffDetail?: string;
    chatHistory?: ChatMessage[];
    senderInfo?: SenderInfo;
  };
  /** LLM 分析的输出（llm_analyze 步骤） */
  llmOutput?: {
    action: string;
    target?: string;
    content?: string;
    reasoning?: string;
  };
  /** 执行的动作（execute_action 步骤） */
  executedAction?: SemanticAction;
  /** 动作执行结果 */
  actionResult?: {
    success: boolean;
    message?: string;
  };
  /** 验证结果（verify 步骤） */
  verifyResult?: {
    success: boolean;
    message?: string;
  };
  /** 步骤时间戳 */
  timestamp: number;
}

/** 录制器状态 */
export interface RecorderState {
  isRecording: boolean;
  steps: RecordedStep[];
  startTime: number;
  scenario: string;
}

/**
 * 工作流录制器
 */
export class WorkflowRecorderV2 {
  private state: RecorderState = {
    isRecording: false,
    steps: [],
    startTime: 0,
    scenario: '',
  };

  /** 开始录制 */
  startRecording(scenario: string): void {
    this.state = {
      isRecording: true,
      steps: [],
      startTime: Date.now(),
      scenario,
    };
    console.log(`[WorkflowRecorder] 开始录制: ${scenario}`);
  }

  /** 停止录制 */
  stopRecording(): RecordedStep[] {
    this.state.isRecording = false;
    console.log(`[WorkflowRecorder] 停止录制: ${this.state.steps.length} 步`);
    return [...this.state.steps];
  }

  /** 是否正在录制 */
  isRecording(): boolean {
    return this.state.isRecording;
  }

  /** 录制截图步骤 */
  recordScreenshot(screenshot: string): void {
    if (!this.state.isRecording) return;
    this.state.steps.push({
      type: 'screenshot',
      description: '截图',
      screenshot,
      timestamp: Date.now(),
    });
  }

  /** 录制 LLM 分析步骤 */
  recordLLMAnalysis(input: {
    prompt: string;
    screenshot?: string;
    diffDetail?: string;
    chatHistory?: ChatMessage[];
    senderInfo?: SenderInfo;
  }, output: {
    action: string;
    target?: string;
    content?: string;
    reasoning?: string;
  }): void {
    if (!this.state.isRecording) return;
    this.state.steps.push({
      type: 'llm_analyze',
      description: `LLM 分析: ${output.action}`,
      llmInput: input,
      llmOutput: output,
      timestamp: Date.now(),
    });
  }

  /** 录制执行动作步骤 */
  recordActionExecution(action: SemanticAction, result: { success: boolean; message?: string }): void {
    if (!this.state.isRecording) return;
    this.state.steps.push({
      type: 'execute_action',
      description: `执行动作: ${action.action}`,
      executedAction: action,
      actionResult: result,
      timestamp: Date.now(),
    });
  }

  /** 录制验证步骤 */
  recordVerification(success: boolean, message?: string): void {
    if (!this.state.isRecording) return;
    this.state.steps.push({
      type: 'verify',
      description: `验证: ${success ? '成功' : '失败'}`,
      verifyResult: { success, message },
      timestamp: Date.now(),
    });
  }

  /** 录制任务完成检查 */
  recordCompletionCheck(completed: boolean): void {
    if (!this.state.isRecording) return;
    this.state.steps.push({
      type: 'check_complete',
      description: `任务${completed ? '已完成' : '未完成'}`,
      verifyResult: { success: completed },
      timestamp: Date.now(),
    });
  }

  /**
   * 从录制步骤生成可复用的工作流模板
   */
  generateTemplate(): WorkflowTemplate {
    const steps: WorkflowStepV2[] = [];

    for (const recorded of this.state.steps) {
      const step: WorkflowStepV2 = {
        type: recorded.type,
        description: recorded.description,
      };

      switch (recorded.type) {
        case 'screenshot':
          // 截图步骤：无特殊参数，每次执行时动态截图
          break;

        case 'llm_analyze':
          // LLM 分析步骤：生成 prompt 模板
          step.promptTemplate = this.buildLLMPromptTemplate(recorded);
          step.outputParam = 'llm_result';
          break;

        case 'execute_action':
          // 执行动作步骤：记录语义动作
          if (recorded.executedAction) {
            step.action = recorded.executedAction;
          }
          break;

        case 'verify':
        case 'check_complete':
          // 验证步骤：无特殊参数
          break;
      }

      steps.push(step);
    }

    return {
      id: crypto.randomUUID(),
      name: `工作流_${this.state.scenario}`,
      scenario: this.state.scenario,
      steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      successCount: 0,
    };
  }

  /**
   * 构建 LLM prompt 模板
   * 模板支持变量占位符，执行时动态替换
   */
  private buildLLMPromptTemplate(step: RecordedStep): string {
    const parts: string[] = [];

    // 基础任务描述
    parts.push('## 任务');
    parts.push('{task}');
    parts.push('');

    // 如果有聊天上下文，添加聊天历史
    if (step.llmInput?.chatHistory && step.llmInput.chatHistory.length > 0) {
      parts.push('## 最近聊天记录');
      parts.push('{chat_history}');
      parts.push('');
    }

    // 如果有发送者信息
    if (step.llmInput?.senderInfo) {
      parts.push('## 新消息发送者');
      parts.push('{sender_info}');
      parts.push('');
    }

    // 变更信息
    parts.push('## 检测到的变化');
    parts.push('{diff}');
    parts.push('');

    // 截图说明
    parts.push('## 当前屏幕截图');
    parts.push('请分析截图中的内容，确定需要执行的操作。');
    parts.push('');

    // 输出要求
    parts.push('## 请返回 JSON 格式');
    parts.push('```json');
    parts.push('{');
    parts.push('  "action": "click|type|scroll|press_key",');
    parts.push('  "target": "操作目标描述",');
    parts.push('  "content": "输入内容（如果是 type 动作）",');
    parts.push('  "reasoning": "你的分析推理过程"');
    parts.push('}');
    parts.push('```');

    return parts.join('\n');
  }
}

/**
 * 格式化聊天历史为可读文本
 */
export function formatChatHistory(messages: ChatMessage[]): string {
  return messages.map(msg => {
    const time = new Date(msg.timestamp).toLocaleTimeString();
    const prefix = msg.isNew ? '🆕 ' : '';
    return `${prefix}[${time}] ${msg.senderName}: ${msg.content}`;
  }).join('\n');
}

/**
 * 格式化发送者信息为可读文本
 */
export function formatSenderInfo(sender: SenderInfo): string {
  const parts = [`姓名: ${sender.name}`];
  if (sender.mentions && sender.mentions.length > 0) {
    parts.push(`提及: ${sender.mentions.join(', ')}`);
  }
  return parts.join('\n');
}
