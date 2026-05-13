// 来源: lib/services/model_call_service.dart

import type { LLMMessage, ToolCallResult } from '@/types/message';
import type { ProviderConfig } from '@/types/provider';
import { OpenAIAdapter } from './openai';
import { AnthropicAdapter } from './anthropic';
import { GoogleAdapter } from './google';
import type { LLMAdapter } from './types';
import systemPrompts from '@/config/system-prompts.json';

export enum ModelScenario {
  chat = 'chat',
  desktopAutomation = 'desktopAutomation',
  webAutomation = 'webAutomation',
  phoneAutomation = 'phoneAutomation',
}

export interface LengthCheckResult {
  ok: boolean;
  estimatedTokens: number;
  maxTokens: number;
  warning?: string;
}

const MAX_TOKENS_PER_SCENARIO: Record<ModelScenario, number> = {
  [ModelScenario.desktopAutomation]: 16000,
  [ModelScenario.webAutomation]: 16000,
  [ModelScenario.phoneAutomation]: 16000,
  [ModelScenario.chat]: 96000,
};

export class ModelCallService {
  private _adapters: Record<string, LLMAdapter>;

  constructor() {
    this._adapters = {
      openai: new OpenAIAdapter(),
      anthropic: new AnthropicAdapter(),
      google: new GoogleAdapter(),
    };
  }

  estimateTokens(messages: LLMMessage[]): number {
    let chars = 0;
    for (const m of messages) {
      const c = m.content;
      if (typeof c === 'string') {
        chars += c.length > 8000 ? 8000 : c.length;
      } else if (Array.isArray(c)) {
        const s = JSON.stringify(c);
        chars += s.length > 8000 ? 8000 : s.length;
      }
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
    }
    return Math.floor(chars / 2);
  }

  checkLength(scenario: ModelScenario, messages: LLMMessage[]): LengthCheckResult {
    const maxTokens = MAX_TOKENS_PER_SCENARIO[scenario] ?? 32000;
    const estimated = this.estimateTokens(messages);

    if (estimated > maxTokens) {
      return {
        ok: false,
        estimatedTokens: estimated,
        maxTokens,
        warning: `内容过长：预估 ${estimated} tokens，上限 ${maxTokens} tokens。`,
      };
    }
    return { ok: true, estimatedTokens: estimated, maxTokens };
  }

  buildSystemPrompt(scenario: ModelScenario, goal = '', extra?: string, requiredTool = false): string {
    let base: string;
    switch (scenario) {
      case ModelScenario.chat:
        base = extra ? `${systemPrompts.chat}\n\n${extra}` : systemPrompts.chat;
        break;
      case ModelScenario.desktopAutomation:
        base = systemPrompts.desktopAutomation.replaceAll('{goal}', goal);
        break;
      case ModelScenario.webAutomation:
        base = systemPrompts.webAutomation.replaceAll('{goal}', goal);
        break;
      case ModelScenario.phoneAutomation:
        base = systemPrompts.phoneAutomation.replaceAll('{goal}', goal);
        break;
    }

    if (requiredTool) {
      return `${base}\n\nYou MUST respond ONLY with function calls — do not output any text. Select the most appropriate tool(s) from the available tools and use them.`;
    }
    return base;
  }

  withSystemPrompt(messages: LLMMessage[], systemPrompt: string): LLMMessage[] {
    if (systemPrompt.length === 0) return messages;
    if (messages.length > 0 && messages[0].role === 'system') {
      return [{ role: 'system', content: systemPrompt }, ...messages.slice(1)];
    }
    return [{ role: 'system', content: systemPrompt }, ...messages];
  }

  async *chatStream(params: {
    scenario: ModelScenario;
    messages: LLMMessage[];
    provider: ProviderConfig;
    apiKey: string;
    tools?: Record<string, unknown>[];
    goal?: string;
  }): AsyncGenerator<string> {
    const { scenario, messages, provider, apiKey, tools, goal = '' } = params;

    // 1. Build system prompt
    let systemPrompt = this.buildSystemPrompt(scenario, goal);
    // If model does NOT support native tools, embed tools in system prompt
    const supportsTools = provider.supportsTools !== false;
    const adapterTools = supportsTools ? tools : undefined;
    if (!supportsTools && tools && tools.length > 0) {
      systemPrompt += formatToolsForPrompt(tools);
    }
    // 2. Insert system prompt
    const fullMessages = this.withSystemPrompt(messages, systemPrompt);

    // 3. Length check
    const check = this.checkLength(scenario, fullMessages);
    console.debug('[model-call-service] lengthCheck ok=', check.ok, 'estimated=', check.estimatedTokens, 'max=', check.maxTokens);
    if (!check.ok) {
      yield `__ERROR__:${check.warning}`;
      return;
    }

    // 4. Get adapter
    const adapter = this._adapters[provider.type];
    if (!adapter) {
      yield `__ERROR__:Unknown provider type: ${provider.type}`;
      return;
    }

    // 5. Stream through adapter
    const stream = adapter.chat({
      messages: fullMessages,
      model: provider.model,
      apiKey,
      baseUrl: provider.baseUrl,
      tools: adapterTools,
    });

    for await (const chunk of stream) {
      yield chunk;
    }
  }

  async callWithTools(params: {
    scenario: ModelScenario;
    messages: LLMMessage[];
    provider: ProviderConfig;
    apiKey: string;
    tools: Record<string, unknown>[];
    goal?: string;
    requiredTool?: boolean;
    maxTurns?: number;
  }): Promise<ToolCallResult[]> {
    const { scenario, messages, provider, apiKey, tools, goal = '', requiredTool = false } = params;

    const stream = this.chatStream({
      scenario,
      messages,
      provider,
      apiKey,
      tools,
      goal,
    });

    let toolJson: string | undefined;
    for await (const chunk of stream) {
      if (chunk.startsWith('__TOOLS__:')) {
        toolJson = chunk.substring(10);
      } else if (chunk.startsWith('__ERROR__:')) {
        throw new Error(chunk.substring(10));
      }
    }

    if (toolJson == null) {
      if (requiredTool) throw new Error('No tool calls in response');
      return [];
    }

    const list = JSON.parse(toolJson) as Array<Record<string, unknown>>;
    return list.map((tc) => {
      const func = tc['function'] as Record<string, unknown>;
      return {
        id: tc['id'] as string,
        name: func['name'] as string,
        arguments: JSON.parse(func['arguments'] as string),
      } as ToolCallResult;
    });
  }

  async dispose(): Promise<void> {
    // No explicit cleanup needed for fetch-based adapters
  }
}

// ── Tools formatting ──

function formatToolsForPrompt(tools: Record<string, unknown>[]): string {
  const toolDescs = tools.map((t) => {
    const func = t['function'] as Record<string, unknown>;
    return {
      name: func['name'],
      description: func['description'],
      parameters: func['parameters'],
    };
  });

  return (
    '\n\n## Available Tools\n\n' +
    'You have access to the following tools. To use a tool, you MUST respond with ONLY a tool call in this format:\n\n' +
    '<tool_call>\n' +
    '{"name": "<tool_name>", "arguments": {<params>}}\n' +
    '</tool_call>\n\n' +
    'Do NOT output any text before or after the tool call block.\n\n' +
    JSON.stringify(toolDescs, null, 2)
  );
}
