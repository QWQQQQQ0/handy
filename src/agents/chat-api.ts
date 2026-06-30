// ChatAgent — 聊天 Agent API
// 前端调用：agent.chat({ messages, provider, apiKey }) → 流式文本
// 请求通过 Vite 中间件后端 → 统一 LlmExecutor → 外部 LLM

import type { ProviderConfig } from '@/types/provider';
import type { LLMMessage } from '@/types/message';
import { AgentEndpoint } from '@/api/types';
import { apiStreamCompat } from '@/api/client';

export class ChatAgent {
  /** 流式聊天，endpoint 默认 chat，@agent 时路由到对应后端 API */
  async *chat(params: {
    messages: LLMMessage[];
    provider: ProviderConfig;
    apiKey: string;
    tools?: Record<string, unknown>[];
    goal?: string;
    noSystemPrompt?: boolean;
    systemExtra?: string;
    endpoint?: AgentEndpoint;
  }): AsyncGenerator<string> {
    for await (const chunk of apiStreamCompat(
      params.endpoint ?? AgentEndpoint.chat,
      params.provider,
      params.apiKey,
      { messages: params.messages, tools: params.tools, goal: params.goal, noSystemPrompt: params.noSystemPrompt, systemPromptExtra: params.systemExtra },
    )) {
      yield chunk;
    }
  }
}
