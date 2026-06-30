// Shared agent chat loop — stream LLM response + execute tools + multi-turn.
// Extracted from chat-store.ts so the Projects page chat can reuse it.

import type { LLMMessage, ToolCall } from '@/types/message';
import type { ProviderConfig } from '@/types/provider';
import { AgentEndpoint } from '@/api/types';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import { apiStreamCompat } from '@/api/client';
import { truncateToolResult } from '@/utils/content';

export interface AgentLoopOptions {
  endpoint: AgentEndpoint;
  provider: ProviderConfig;
  apiKey: string;
  executor: ISkillExecutor;
  /** Tool names to include. Defaults to all enabled tools. */
  toolFilter?: Set<string>;
  maxRounds?: number;
  /** Called on every text chunk — first arg is cumulative, second is this round. */
  onText?: (cumulative: string, roundDelta: string) => void;
  /** Called when a tool call is about to be executed. */
  onToolCall?: (name: string, args: Record<string, unknown>) => void;
  /** Called after a tool finishes executing. */
  onToolResult?: (name: string, success: boolean, message: string) => void;
  abortSignal?: AbortSignal;
  noSystemPrompt?: boolean;
  /** 命令确认：run_command / execute_code / doc_code_exec 执行前回调。返回 false 则拒绝执行。 */
  onConfirm?: (command: string) => Promise<boolean>;
}

export interface AgentLoopResult {
  responseText: string;
  rounds: number;
}

/**
 * Run a multi-turn agent loop: stream → parse tool calls → execute → repeat.
 * The caller manages the LLMMessage array and can inspect it after the loop
 * for the full conversation history (including tool calls and tool results).
 */
export async function runAgentLoop(
  messages: LLMMessage[],
  options: AgentLoopOptions,
): Promise<AgentLoopResult> {
  const {
    endpoint,
    provider,
    apiKey,
    executor,
    maxRounds = 50,
    onText,
    onToolCall,
    onToolResult,
    abortSignal,
    noSystemPrompt = false,
  } = options;

  const toolNames = options.toolFilter ?? new Set(executor.enabledToolNames);
  const allTools = executor.buildToolsForLLM(toolNames);

  let responseText = '';
  let completedRounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    if (abortSignal?.aborted) break;

    const stream = apiStreamCompat(endpoint, provider, apiKey, {
      messages: [...messages],
      tools: allTools,
      noSystemPrompt,
    });

    let roundText = '';
    let roundReasoning = '';
    let toolCallJson = '';

    for await (const chunk of stream) {
      if (abortSignal?.aborted) break;
      if (chunk.startsWith('__ERROR__:')) {
        roundText = `❌ ${chunk.substring(10)}`;
        break;
      }
      if (chunk.startsWith('__REASONING__:')) {
        roundReasoning += chunk.substring(14);
        continue;
      }
      if (chunk.startsWith('__TOOLS__:')) {
        toolCallJson = chunk.substring(10);
        continue;
      }
      roundText += chunk;
      onText?.(responseText + roundText, roundText);
    }

    // No tool calls → final answer, done
    if (!toolCallJson) {
      responseText += roundText;
      completedRounds = round + 1;
      break;
    }

    // Parse tool calls
    let calls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = [];
    try {
      calls = JSON.parse(toolCallJson);
    } catch {
      responseText += roundText;
      completedRounds = round + 1;
      break;
    }

    if (calls.length === 0) {
      responseText += roundText;
      completedRounds = round + 1;
      break;
    }

    // Accumulate text from this round
    responseText += roundText;

    // Add assistant message with tool_calls to LLM history
    messages.push({
      role: 'assistant',
      content: roundText || null,
      reasoning_content: roundReasoning || undefined,
      toolCalls: calls.map(
        (c): ToolCall => ({
          id: c.id || `call_${crypto.randomUUID().substring(0, 8)}`,
          function: {
            name: c.function?.name || 'unknown',
            arguments: c.function?.arguments || '{}',
          },
        }),
      ),
    });

    // Execute each tool and add results to history
    for (const call of calls) {
      const fnName = call.function?.name || 'unknown';
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(call.function?.arguments || '{}');
      } catch {/* use empty */}

      onToolCall?.(fnName, args);

      let result: { success: boolean; message: string; data?: Record<string, unknown> };

      // ── 安全确认：run_command / execute_code / doc_code_exec 需要用户同意 ──
      if (fnName === 'run_command' || fnName === 'execute_code' || fnName === 'doc_code_exec') {
        const displayCmd = fnName === 'run_command'
          ? String(args['command'] ?? '')
          : String(args['code'] ?? '').substring(0, 300);
        if (options.onConfirm) {
          const confirmed = await options.onConfirm(displayCmd);
          if (!confirmed) {
            result = { success: false, message: `用户拒绝执行: ${displayCmd}` };
            messages.push({
              role: 'tool',
              toolCallId: call.id || `call_${crypto.randomUUID().substring(0, 8)}`,
              content: JSON.stringify(result),
            });
            onToolResult?.(fnName, false, result.message);
            continue;
          }
        }
      }

      try {
        result = await executor.executeToolCall(fnName, args);
      } catch (e) {
        result = { success: false, message: String(e) };
      }

      onToolResult?.(fnName, result.success, result.message);

      // 工具结果超长截断：tool 消息保留截断版，完整内容以 user 消息兜底
      const rawToolContent = JSON.stringify(result);
      const { toolContent, fullUserMessage } = truncateToolResult(fnName, rawToolContent);
      messages.push({
        role: 'tool',
        toolCallId: call.id || `call_${crypto.randomUUID().substring(0, 8)}`,
        content: toolContent,
      });
      if (fullUserMessage) {
        messages.push({ role: 'user', content: fullUserMessage });
      }
    }

    completedRounds = round + 1;
  }

  return { responseText, rounds: completedRounds };
}
