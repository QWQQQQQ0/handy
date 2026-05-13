// 来源: lib/services/chat_service.dart

import { ModelCallService, ModelScenario } from '@/adapters/model-call-service';
import type { LLMMessage, ChatMessage, MessageContent, ToolCall, ToolCallResult } from '@/types/message';
import { serializeContent, deserializeContent } from '@/utils/content';
import { getDB } from '@/db';

export interface ChatStateUpdate {
  messages?: ChatMessage[];
  debugMessages?: ChatMessage[];
  isStreaming?: boolean;
  error?: string;
  logEntries?: Array<{ text: string }>;
}

export { ToolMode } from '@/stores/chat-store';

interface SendMessageParams {
  conversationId: string;
  messages: ChatMessage[];
  provider: {
    id: string;
    name: string;
    type: string;
    baseUrl: string;
    model: string;
    encryptedApiKey: string;
    supportsTools?: boolean;
  };
  tools?: Record<string, unknown>[];
}

type ToolExecutor = (toolName: string, params: Record<string, unknown>) => Promise<{
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}>;

let _skillExecutor: ToolExecutor | null = null;

export function setSkillExecutor(executor: ToolExecutor | null) {
  _skillExecutor = executor;
}

// Build LLMMessages from ChatMessages for sending to the model
function buildInternal(source: ChatMessage[]): LLMMessage[] {
  const result: LLMMessage[] = [];
  for (const m of source) {
    if ((m.role as string) === 'tool_call') continue;
    if (m.role === 'tool') {
      result.push({ role: 'tool', toolCallId: m.id, content: m.content });
    } else if (m.role === 'assistant') {
      const hasContent = typeof m.content === 'string' ? m.content.length > 0 : true;
      if (!hasContent && !m.toolCalls) continue;
      result.push({ role: 'assistant', content: m.content, toolCalls: m.toolCalls });
    } else {
      result.push({ role: m.role, content: m.content });
    }
  }
  return result;
}

// Filter only user + assistant messages for visible display
function buildVisible(source: ChatMessage[]): ChatMessage[] {
  return source.filter((m) => m.role === 'user' || m.role === 'assistant');
}

export async function* sendChatMessage(params: SendMessageParams): AsyncGenerator<ChatStateUpdate> {
  const { conversationId, messages, provider, tools } = params;
  const modelService = new ModelCallService();

  const visibleMessages = [...messages];
  const internalMessages: ChatMessage[] = [...messages];
  const debugMessages: ChatMessage[] = [];

  // Initial state
  yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: true };

  // Up to 5 turns of tool calling
  for (let turn = 0; turn < 5; turn++) {
    const assistantMsgId = crypto.randomUUID();
    const assistantMsg: ChatMessage = {
      id: assistantMsgId,
      conversationId,
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
      status: 'streaming',
    };
    visibleMessages.push(assistantMsg);
    internalMessages.push(assistantMsg);

    const llmMessages = buildInternal(internalMessages);
    let textBuffer = '';
    let toolCallJson: string | undefined;

    try {
      const stream = modelService.chatStream({
        scenario: ModelScenario.chat,
        messages: llmMessages,
        provider: {
          id: provider.id,
          name: provider.name,
          type: provider.type as 'openai' | 'anthropic' | 'google',
          baseUrl: provider.baseUrl,
          model: provider.model,
          encryptedApiKey: provider.encryptedApiKey,
          isDefault: false,
          supportsTools: provider.supportsTools ?? true,
          createdAt: '',
        },
        apiKey: provider.encryptedApiKey,
        tools,
      });

      for await (const chunk of stream) {
        if (chunk.startsWith('__ERROR__:')) {
          const errMsg = chunk.substring(10);
          visibleMessages[visibleMessages.length - 1] = {
            ...assistantMsg, content: errMsg, status: 'error',
          };
          yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: false, error: errMsg };
          return;
        } else if (chunk.startsWith('__TOOLS__:')) {
          toolCallJson = chunk.substring(10);
        } else {
          textBuffer += chunk;
          visibleMessages[visibleMessages.length - 1] = {
            ...assistantMsg, content: textBuffer,
          };
          internalMessages[internalMessages.length - 1] = {
            ...assistantMsg, content: textBuffer,
          };
          yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: true };
        }
      }
    } catch (e) {
      visibleMessages[visibleMessages.length - 1] = {
        ...assistantMsg,
        content: textBuffer ? textBuffer : `Error: ${e}`,
        status: 'error',
      };
      yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: false, error: String(e) };
      return;
    }

    const rawResponse = textBuffer;

    // ── Handle tool calls ──
    if (toolCallJson && _skillExecutor) {
      try {
        const toolCalls = JSON.parse(toolCallJson) as Array<Record<string, unknown>>;

        // Update assistant message with tool_calls
        if (rawResponse.length > 0) {
          visibleMessages[visibleMessages.length - 1] = {
            ...assistantMsg, content: rawResponse, status: 'done',
            toolCalls: toolCalls as unknown as ToolCall[],
          };
          internalMessages[internalMessages.length - 1] = {
            ...assistantMsg, content: rawResponse, status: 'done',
            toolCalls: toolCalls as unknown as ToolCall[],
          };
        } else {
          visibleMessages.pop();
          internalMessages[internalMessages.length - 1] = {
            ...assistantMsg, content: '', status: 'done',
            toolCalls: toolCalls as unknown as ToolCall[],
          };
        }

        for (const tc of toolCalls) {
          const tcId = tc['id'] as string;
          const func = tc['function'] as Record<string, unknown>;
          const funcName = func['name'] as string;
          const funcArgs = func['arguments'] as string;

          let args: Record<string, unknown>;
          try {
            args = JSON.parse(funcArgs);
          } catch {
            args = {};
          }

          debugMessages.push({
            id: crypto.randomUUID(),
            conversationId,
            role: 'tool_call' as ChatMessage['role'],
            content: JSON.stringify({ function: funcName, arguments: args }),
            timestamp: new Date().toISOString(),
            status: 'done',
          });

          const result = await _skillExecutor(funcName, args);

          debugMessages.push({
            id: tcId,
            conversationId,
            role: 'tool',
            content: JSON.stringify(result),
            timestamp: new Date().toISOString(),
            status: 'done',
          });

          internalMessages.push({
            id: tcId,
            conversationId,
            role: 'tool',
            content: JSON.stringify(result),
            timestamp: new Date().toISOString(),
            status: 'done',
          });
        }

        yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: true };
        continue; // Next turn
      } catch (e) {
        debugMessages.push({
          id: crypto.randomUUID(),
          conversationId,
          role: 'tool_call' as ChatMessage['role'],
          content: `Tool error: ${e}`,
          timestamp: new Date().toISOString(),
          status: 'error',
        });
      }
    }

    // ── No tool calls → conversation turn complete ──
    const db = await getDB();
    if (rawResponse.length > 0) {
      visibleMessages[visibleMessages.length - 1] = {
        ...assistantMsg, content: rawResponse, status: 'done',
      };
      internalMessages[internalMessages.length - 1] = {
        ...assistantMsg, content: rawResponse, status: 'done',
      };
      await db.execute(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
        [assistantMsgId, conversationId, 'assistant', rawResponse, new Date().toISOString()]
      );
    } else {
      visibleMessages.pop();
      internalMessages.pop();
    }

    yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: false };
    return;
  }

  // Exceeded max turns
  yield { messages: buildVisible(visibleMessages), debugMessages: [...debugMessages], isStreaming: false, error: 'Max iterations reached' };
}
