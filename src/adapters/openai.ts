// 来源: lib/adapters/openai_adapter.dart

import type { LLMMessage } from '@/types/message';
import type { LLMAdapter } from './types';

export class OpenAIAdapter implements LLMAdapter {
  readonly adapterId = 'openai';
  readonly displayName = 'OpenAI / 兼容接口';
  readonly defaultBaseUrl = 'https://api.openai.com/v1';

  async *chat({ messages, model, apiKey, baseUrl, tools, thinkingMode }: {
    messages: LLMMessage[];
    model: string;
    apiKey: string;
    baseUrl?: string;
    tools?: Record<string, unknown>[];
    thinkingMode?: boolean;
  }): AsyncGenerator<string> {
    const url = `${baseUrl ?? this.defaultBaseUrl}/chat/completions`;

    // Use the standard OpenAI role:'tool' format for tool results.
    // The old role:'user' workaround (for Zhipu etc.) caused tool-calling
    // loops — the LLM sees role:'user' and interprets the tool result as
    // a new user message, triggering the same tool call again.
    const bodyMessages = messages.map((m) => {
      if (m.role === 'tool') {
        const msg: Record<string, unknown> = {
          role: 'tool',
          content: typeof m.content === 'string' ? m.content : m.content?.toString() ?? '',
        };
        if (m.toolCallId != null) msg['tool_call_id'] = m.toolCallId;
        return msg;
      }
      return toJson(m);
    });

    const body: Record<string, unknown> = {
      model,
      messages: bodyMessages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
      console.log(`[openai] Sending ${tools.length} tool definitions, first:`, JSON.stringify(tools[0]).substring(0, 200));
    }

    // MiMo thinking models: enable thinking mode
    if (thinkingMode) {
      body['thinking'] = { type: 'enabled' };
    }

    const bodyJson = JSON.stringify(body);

    // Debug: log full message summary for troubleshooting
    console.log('[openai] ▶ Request:', JSON.stringify(bodyMessages.map((m: Record<string, unknown>, i: number) => {
      const info: Record<string, unknown> = { idx: i, role: m.role };
      if (m.tool_calls) info.toolCalls = (m.tool_calls as Array<Record<string, unknown>>).map(tc => ({ id: tc.id, name: (tc.function as Record<string, unknown>)?.name }));
      if (m.tool_call_id) info.toolCallId = m.tool_call_id;
      // Log content type and size for debugging
      if (Array.isArray(m.content)) {
        info.contentType = 'array';
        info.contentParts = m.content.length;
        info.contentSummary = (m.content as Array<Record<string, unknown>>).map((p: Record<string, unknown>) => {
          if (p.type === 'text') return { type: 'text', length: (p.text as string)?.length };
          if (p.type === 'image_url') return { type: 'image', urlLength: ((p.image_url as Record<string, unknown>)?.url as string)?.length };
          return { type: p.type };
        });
      } else if (typeof m.content === 'string') {
        info.contentType = 'string';
        info.contentLength = m.content.length;
      }
      return info;
    })));

    // Debug: 检查发给 MiMo API 的消息中 reasoning_content 和 role:'tool' 是否正确
    if (thinkingMode) {
      const debugMsgs = bodyMessages.map((m: Record<string, unknown>, i: number) => {
        const info: Record<string, unknown> = { idx: i, role: m.role };
        if (m.reasoning_content) info.hasRC = true;
        if (m.tool_calls) info.toolCalls = (m.tool_calls as Array<{ function: { name: string } }>).map(tc => tc.function.name);
        if (m.tool_call_id) info.toolCallId = m.tool_call_id;
        if (m.role === 'tool') info.contentPreview = (m.content as string)?.substring(0, 80);
        return info;
      });
      console.log('[MiMo DEBUG] request messages:', JSON.stringify(debugMsgs, null, 2));
    }

    // Abort after 120s to prevent infinite hang (e.g. large image payloads)
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      console.log('[openai] Sending request:', {
        url,
        bodySize: bodyJson.length,
        bodySizeKB: Math.round(bodyJson.length / 1024),
        model,
        messageCount: bodyMessages.length,
      });
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: bodyJson,
        signal: controller.signal,
      });
      console.log('[openai] Response received:', {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });
    } catch (e) {
      clearTimeout(timeout);
      console.error('[openai] Fetch error:', e);
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error('LLM API request timed out (120s). The request body may be too large (e.g. images).');
      }
      throw e;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '(no body)');
      console.error('[openai] API ERROR RESPONSE:', {
        status: response.status,
        statusText: response.statusText,
        body: errBody.substring(0, 500),
      });
      throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
    }

    if (!response.body) {
      throw new Error('OpenAI API response has no body');
    }

    const toolCalls = new Map<number, Record<string, unknown>>();
    let fullText = '';
    let chunkCount = 0;
    let errorCount = 0;

    console.log('[openai] Starting to read SSE stream...');
    for await (const line of decodeStreamToLines(response.body)) {
      if (!line.startsWith('data: ')) continue;
      const data = line.substring(6).trim();
      if (data === '[DONE]') {
        console.log('[openai] SSE stream ended with [DONE]');
        break;
      }

      try {
        const json = JSON.parse(data);
        chunkCount++;

        // Log first few chunks for debugging
        if (chunkCount <= 3) {
          console.log(`[openai] SSE chunk ${chunkCount}:`, {
            hasChoices: !!json['choices'],
            choicesLength: json['choices']?.length,
            hasDelta: !!json['choices']?.[0]?.delta,
            deltaKeys: json['choices']?.[0]?.delta ? Object.keys(json['choices'][0].delta) : [],
          });
        }

        const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
        if (!choices || choices.length === 0) continue;

        const delta = choices[0]['delta'] as Record<string, unknown> | undefined;
        if (!delta) continue;

        // 0. Reasoning content (MiMo thinking models) — 实时流式输出，不缓冲
        const rc = delta['reasoning_content'] as string | undefined;
        if (rc && rc.length > 0) {
          yield `__REASONING__:${rc}`;
        }

        // 1. Text content
        const content = delta['content'] as string | undefined;
        if (content && content.length > 0) {
          fullText += content;
          yield content;
        }

        // 2. Tool call deltas (streaming chunks — need to stitch)
        const toolCallDeltas = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const index = tc['index'] as number;
            if (!toolCalls.has(index)) {
              toolCalls.set(index, {
                id: '',
                type: 'function',
                function: { name: '', arguments: '' },
              });
            }
            const entry = toolCalls.get(index)!;
            if (tc['id'] != null) entry['id'] = tc['id'];
            const func = tc['function'] as Record<string, unknown> | undefined;
            if (func) {
              if (func['name'] != null) {
                (entry['function'] as Record<string, unknown>)['name'] = func['name'];
              }
              if (func['arguments'] != null) {
                const curr = (entry['function'] as Record<string, string>)['arguments'];
                (entry['function'] as Record<string, string>)['arguments'] = curr + (func['arguments'] as string);
              }
            }
          }
        }
      } catch (e) {
        // Skip malformed SSE chunks
        errorCount++;
        if (errorCount <= 3) {
          console.warn('[openai] Failed to parse SSE chunk:', {
            data: data.substring(0, 100),
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    // Emit tool calls (critical — must not be preceded by other markers)
    if (toolCalls.size > 0) {
      const calls = Array.from(toolCalls.values());
      console.log('[openai] Tool calls found:', {
        count: toolCalls.size,
        names: calls.map(c => (c.function as Record<string, unknown>)?.name),
      });
      yield `__TOOLS__:${JSON.stringify(calls)}`;
    }

    console.log('[openai] SSE stream processing complete:', {
      chunkCount,
      errorCount,
      fullTextLength: fullText.length,
      toolCallsCount: toolCalls.size,
    });

    // Log warning if response is empty
    if (fullText.length === 0 && toolCalls.size === 0) {
      console.warn('[openai] ⚠ Empty response from LLM! This may indicate:');
      console.warn('  1. Request body too large (images)');
      console.warn('  2. Message format not supported by model');
      console.warn('  3. API rate limit or quota exceeded');
      console.warn('  4. Model returned empty content');
    }

    if (toolCalls.size > 0) return;

    // Fallback: extract text-based <tool_call> blocks from response text
    const extracted = extractTextToolCalls(fullText);
    if (extracted.length > 0) {
      yield `__TOOLS__:${JSON.stringify(extracted)}`;
    }
  }
}

function toJson(m: LLMMessage): Record<string, unknown> {
  const json: Record<string, unknown> = { role: m.role };
  if (m.content != null) {
    json['content'] = m.content;
  } else if (m.role === 'assistant') {
    // Some APIs (MiMo) require content to be present even when empty
    json['content'] = '';
  }
  if (m.toolCallId != null) json['tool_call_id'] = m.toolCallId;
  if (m.toolCallName != null) json['name'] = m.toolCallName;
  if (m.toolCalls != null) json['tool_calls'] = m.toolCalls;
  // MiMo 等思考模型：多轮工具调用场景必须回传 reasoning_content
  if (m.reasoning_content != null && m.reasoning_content.length > 0) {
    json['reasoning_content'] = m.reasoning_content;
  }
  // Debug: log reasoning_content presence for MiMo troubleshooting
  if (m.role === 'assistant' && m.toolCalls) {
    console.debug(`[openai:toJson] assistant+tools: hasRC=${!!json['reasoning_content']}, rcLen=${(m.reasoning_content ?? '').length}, content=${json['content'] ?? 'null'}, toolCalls=${m.toolCalls.length}`);
  }
  return json;
}

// Replicate LLMAdapter.decodeStreamToLines from Dart
async function* decodeStreamToLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      yield line;
    }
    if (done) {
      if (buffer.length > 0) yield buffer;
      break;
    }
  }
}

// Parse tool calls from model text output.
// Supports: <tool_call>JSON</tool_call>, ```json ... ```, and bare JSON objects.
function extractTextToolCalls(text: string): Array<Record<string, unknown>> {
  const calls: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  let idx = 0;

  const addCall = (parsed: Record<string, unknown>) => {
    const name = parsed['name'] as string | undefined;
    if (!name) return;
    const key = `${name}:${JSON.stringify(parsed['arguments'] ?? {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({
      id: `call_text_${idx++}`,
      type: 'function',
      function: {
        name,
        arguments: JSON.stringify(parsed['arguments'] ?? {}),
      },
    });
  };

  // 1. Extract from <tool_call>...</tool_call> blocks
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match: RegExpExecArray | null;
  while ((match = toolCallRegex.exec(text)) !== null) {
    try { addCall(JSON.parse(match[1])); } catch { /* skip */ }
  }

  // 2. Extract from ```json ... ``` fenced code blocks
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
  while ((match = fenceRegex.exec(text)) !== null) {
    try {
      const block = match[1].trim();
      // Try single object
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) {
        for (const item of parsed) addCall(item as Record<string, unknown>);
      } else {
        addCall(parsed as Record<string, unknown>);
      }
    } catch {
      // Try JSONL (one object per line) inside code fence
      for (const line of match[1].split('\n')) {
        try { addCall(JSON.parse(line.trim())); } catch { /* skip */ }
      }
    }
  }

  // 3. Extract bare JSON objects that look like tool calls (have "name" + "arguments")
  if (calls.length === 0) {
    const jsonRegex = /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    while ((match = jsonRegex.exec(text)) !== null) {
      try { addCall(JSON.parse(match[0])); } catch { /* skip */ }
    }
  }

  return calls;
}
