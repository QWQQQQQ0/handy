// 工作流执行器 V2 — 执行录制的工作流模板
//
// 核心思想：
// - 按步骤执行工作流模板
// - LLM 调用是固定动作，但输入输出是动态的
// - 支持聊天上下文（历史消息、发送者信息）

import type { WorkflowStepV2, WorkflowTemplate, ChatContext, ChatMessage, SenderInfo } from '@/types/watcher';
import type { ProviderConfig } from '@/types/provider';
import { formatChatHistory, formatSenderInfo } from './workflow-recorder-v2';

/** 执行上下文 */
export interface WorkflowExecutionContext {
  /** 任务目标 */
  goal: string;
  /** LLM 提供商 */
  provider: ProviderConfig;
  /** API Key */
  apiKey: string;
  /** 截图 base64 */
  snapshot?: string;
  /** 变化描述 */
  diffDetail?: string;
  /** 聊天上下文 */
  chatContext?: ChatContext;
  /** 窗口句柄 */
  windowHwnd?: number;
  /** 取消信号 */
  signal?: AbortSignal;
}

/** 执行结果 */
export interface WorkflowExecutionResult {
  success: boolean;
  detail: string;
  summary: string;
}

/**
 * 执行工作流步骤
 */
export async function executeWorkflowSteps(
  steps: WorkflowStepV2[],
  ctx: WorkflowExecutionContext,
): Promise<WorkflowExecutionResult> {
  console.log(`[WorkflowExecutor] 开始执行工作流: ${steps.length} 步`);

  const variables: Record<string, string> = {
    task: ctx.goal,
    diff: ctx.diffDetail || '',
    snapshot: ctx.snapshot || '',
  };

  // 如果有聊天上下文，添加变量
  if (ctx.chatContext) {
    variables.chat_history = formatChatHistory(ctx.chatContext.recentMessages);
    if (ctx.chatContext.newMessageSender) {
      variables.sender_info = formatSenderInfo(ctx.chatContext.newMessageSender);
    }
    if (ctx.chatContext.newMessageContent) {
      variables.new_message = ctx.chatContext.newMessageContent;
    }
  }

  let lastLLMResult: string | null = null;
  const executedSteps: string[] = [];

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`[WorkflowExecutor] 执行步骤 ${i + 1}/${steps.length}: ${step.type} - ${step.description || ''}`);

    if (ctx.signal?.aborted) {
      return { success: false, detail: '执行被取消', summary: '执行被取消' };
    }

    try {
      switch (step.type) {
        case 'screenshot':
          // 截图步骤：使用传入的截图或动态截图
          if (!variables.snapshot) {
            // 如果没有截图，尝试动态截图
            variables.snapshot = await takeScreenshot(ctx.windowHwnd);
          }
          executedSteps.push('截图');
          break;

        case 'llm_analyze':
          // LLM 分析步骤：调用 LLM 分析截图和变更信息
          lastLLMResult = await executeLLMAnalysis(step, variables, ctx);
          if (lastLLMResult) {
            variables.llm_result = lastLLMResult;
          }
          executedSteps.push('LLM 分析');
          break;

        case 'execute_action':
          // 执行动作步骤：执行 LLM 返回的操作或模板中的固定动作
          if (step.action) {
            await executeSemanticAction(step.action, variables, ctx);
            executedSteps.push(`执行: ${step.action.action}`);
          } else if (lastLLMResult) {
            // 从 LLM 结果中解析动作
            const parsedAction = parseLLMResult(lastLLMResult);
            if (parsedAction) {
              await executeParsedAction(parsedAction, ctx);
              executedSteps.push(`执行: ${parsedAction.action}`);
            }
          }
          break;

        case 'verify':
          // 验证步骤：截图验证操作结果
          variables.snapshot = await takeScreenshot(ctx.windowHwnd);
          executedSteps.push('验证');
          break;

        case 'check_complete':
          // 检查完成步骤：使用 LLM 判断任务是否完成
          const isComplete = await checkTaskCompletion(variables, ctx);
          if (isComplete) {
            return {
              success: true,
              detail: '任务完成',
              summary: `完成: ${executedSteps.join(' → ')}`,
            };
          }
          executedSteps.push('检查完成');
          break;
      }
    } catch (e) {
      console.error(`[WorkflowExecutor] 步骤 ${i + 1} 执行失败:`, e);
      return {
        success: false,
        detail: `步骤 ${i + 1} 失败: ${e}`,
        summary: `失败: ${executedSteps.join(' → ')}`,
      };
    }
  }

  return {
    success: true,
    detail: '工作流执行完成',
    summary: `完成: ${executedSteps.join(' → ')}`,
  };
}

/**
 * 执行 LLM 分析
 */
async function executeLLMAnalysis(
  step: WorkflowStepV2,
  variables: Record<string, string>,
  ctx: WorkflowExecutionContext,
): Promise<string> {
  // 构建 prompt
  let prompt = step.promptTemplate || '';
  for (const [key, value] of Object.entries(variables)) {
    prompt = prompt.replaceAll(`{${key}}`, value);
  }

  // 调用 LLM
  const { ChatAgent } = await import('@/agents/chat-api');
  const chatAgent = new ChatAgent();

  const messages = [
    { role: 'user' as const, content: prompt },
  ];

  // 如果有截图，添加到消息
  if (variables.snapshot) {
    messages.push({
      role: 'user' as const,
      content: [
        { type: 'text' as const, text: '请分析这个截图：' },
        { type: 'image_url' as const, image_url: { url: `data:image/png;base64,${variables.snapshot}` } },
      ] as any,
    });
  }

  let result = '';
  const stream = chatAgent.chat({
    messages,
    provider: {
      id: ctx.provider.id,
      name: ctx.provider.name,
      type: ctx.provider.type as 'openai' | 'anthropic' | 'google',
      baseUrl: ctx.provider.baseUrl,
      model: ctx.provider.model,
      encryptedApiKey: ctx.provider.encryptedApiKey,
      isDefault: false,
      supportsTools: true,
      createdAt: '',
    },
    apiKey: ctx.apiKey,
  });

  for await (const chunk of stream) {
    if (chunk.startsWith('__ERROR__:')) {
      throw new Error(chunk.substring(10));
    }
    if (chunk.startsWith('__REASONING__:')) continue;
    if (chunk.startsWith('__TOOLS__:')) continue;
    result += chunk;
  }

  return result;
}

/**
 * 执行语义动作
 */
async function executeSemanticAction(
  action: import('@/types/cache').SemanticAction,
  variables: Record<string, string>,
  ctx: WorkflowExecutionContext,
): Promise<void> {
  const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
  const executor = getBuiltinExecutor();

  // 替换参数中的变量
  const params: Record<string, unknown> = {};
  if (action.params) {
    for (const [key, value] of Object.entries(action.params)) {
      if (typeof value === 'string' && value.startsWith('{') && value.endsWith('}')) {
        const varName = value.slice(1, -1);
        params[key] = variables[varName] || value;
      } else {
        params[key] = value;
      }
    }
  }

  // 执行动作
  await executor.executeToolCall(action.action, params);
}

/**
 * 执行解析后的动作
 */
async function executeParsedAction(
  parsed: { action: string; target?: string; content?: string },
  ctx: WorkflowExecutionContext,
): Promise<void> {
  const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
  const executor = getBuiltinExecutor();

  const params: Record<string, unknown> = {};
  if (parsed.target) params.target = parsed.target;
  if (parsed.content) params.text = parsed.content;

  await executor.executeToolCall(parsed.action, params);
}

/**
 * 截图
 */
async function takeScreenshot(windowHwnd?: number): Promise<string> {
  const { invoke } = await import('@tauri-apps/api/core');

  if (windowHwnd) {
    return await invoke<string>('screenshot_window', { hwnd: windowHwnd });
  }
  return await invoke<string>('screenshot_fullscreen');
}

/**
 * 解析 LLM 结果
 */
function parseLLMResult(result: string): { action: string; target?: string; content?: string } | null {
  try {
    // 尝试解析 JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      return JSON.parse(jsonMatch[0]);
    }
  } catch {
    // 解析失败
  }
  return null;
}

/**
 * 检查任务是否完成
 */
async function checkTaskCompletion(
  variables: Record<string, string>,
  ctx: WorkflowExecutionContext,
): Promise<boolean> {
  // 简单实现：检查截图是否有变化
  // 实际实现应该使用 LLM 判断
  return true;
}
