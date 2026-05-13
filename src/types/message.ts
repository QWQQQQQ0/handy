// 来源: lib/models/chat_message.dart (ChatMessage 类)
// 来源: lib/adapters/llm_adapter.dart (LLMMessage 类)

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export type TextContent = { type: 'text'; text: string };
export type ImageContent = { type: 'image_url'; image_url: { url: string } };
export type ContentPart = TextContent | ImageContent;
export type MessageContent = string | ContentPart[];

export interface ChatMessage {
  id: string;
  conversationId: string;
  role: ChatRole;
  content: MessageContent;
  timestamp: string;
  status: 'sending' | 'streaming' | 'done' | 'error';
  toolCalls?: ToolCall[];
}

export interface LLMMessage {
  role: ChatRole;
  content?: string | ContentPart[] | null;
  toolCallId?: string;
  toolCallName?: string;
  toolCalls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolCallResult {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
