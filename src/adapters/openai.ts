// 来源: lib/adapters/openai_adapter.dart

import type { LLMMessage } from '@/types/message';
import type { LLMAdapter } from './types';

export class OpenAIAdapter implements LLMAdapter {
  readonly adapterId = 'openai';
  readonly displayName = 'OpenAI / 兼容接口';
  readonly defaultBaseUrl = 'https://api.openai.com/v1';

  async *chat({ messages, model, apiKey, baseUrl, tools }: {
    messages: LLMMessage[];
    model: string;
    apiKey: string;
    baseUrl?: string;
    tools?: Record<string, unknown>[];
  }): AsyncGenerator<string> {
    const url = `${baseUrl ?? this.defaultBaseUrl}/chat/completions`;

    // OpenAI-compatible APIs (Zhipu, etc.) often reject role:'tool'.
    // Convert all tool-result messages to user role for compatibility.
    const bodyMessages = messages.map((m) => {
      if (m.role === 'tool') {
        const msg: Record<string, unknown> = {
          role: 'user',
          content: typeof m.content === 'string' ? m.content : m.content?.toString() ?? '',
        };
        if (m.toolCallId != null) msg['tool_call_id'] = m.toolCallId;
        if (m.toolCallName != null) msg['name'] = m.toolCallName;
        return msg;
      }
      console.log(m);
      return toJson(m);
    });

    const body: Record<string, unknown> = {
      model,
      messages: bodyMessages,
      stream: true,
    };

    if (tools && tools.length > 0) {
      body['tools'] = tools;
    }

    const bodyJson = JSON.stringify(body);
    console.debug('[openai] POST', url, 'model=', model, 'msgs=', messages.length, 'tools=', tools?.length ?? 0);

    // [TEMP TRACE] log complete request structure
    debugLogRequest(body, bodyMessages, model);

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: bodyJson,
    });

    if (!response.ok) {
      const errBody = await response.text().catch(() => '(no body)');
      console.debug('[openai] API ERROR RESPONSE BODY:', errBody);
      throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
    }

    if (!response.body) {
      throw new Error('OpenAI API response has no body');
    }

    const toolCalls = new Map<number, Record<string, unknown>>();
    let fullText = '';

    for await (const line of decodeStreamToLines(response.body)) {
      if (!line.startsWith('data: ')) continue;
      const data = line.substring(6).trim();
      if (data === '[DONE]') break;

      try {
        const json = JSON.parse(data);
        const choices = json['choices'] as Array<Record<string, unknown>> | undefined;
        if (!choices || choices.length === 0) continue;

        const delta = choices[0]['delta'] as Record<string, unknown> | undefined;
        if (!delta) continue;

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
      } catch {
        // Skip malformed SSE chunks
      }
    }

    // Emit tool calls if any were accumulated (native function calling)
    if (toolCalls.size > 0) {
      const calls = Array.from(toolCalls.values());
      yield `__TOOLS__:${JSON.stringify(calls)}`;
      return;
    }

    // Fallback: extract text-based <tool_call> blocks from response text
    const extracted = extractTextToolCalls(fullText);
    if (extracted.length > 0) {
      yield `__TOOLS__:${JSON.stringify(extracted)}`;
    }
  }
}

function toJson(m: LLMMessage): Record<string, unknown> {
  const json: Record<string, unknown> = { role: m.role };
  if (m.content != null && !(typeof m.content === 'string' && m.content.length === 0 && m.toolCalls != null)) {
    json['content'] = m.content;
  }
  if (m.toolCallId != null) json['tool_call_id'] = m.toolCallId;
  if (m.toolCallName != null) json['name'] = m.toolCallName;
  if (m.toolCalls != null) json['tool_calls'] = m.toolCalls;
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

// [TEMP TRACE] Log complete request body structure for debugging.
function debugLogRequest(
  body: Record<string, unknown>,
  bodyMessages: Array<Record<string, unknown>>,
  model: string,
) {
  try {
    const parts: string[] = [];
    parts.push('=== OPENAI REQUEST STRUCTURE ===');
    parts.push(`model: ${model}`);
    parts.push(`stream: ${body['stream']}`);
    parts.push(`tools: ${body['tools'] != null ? (body['tools'] as Array<unknown>).length : 0}`);
    parts.push(`messages count: ${bodyMessages.length}`);
    parts.push('');

    for (let i = 0; i < bodyMessages.length; i++) {
      const msg = bodyMessages[i];
      parts.push(`── msg[${i}] ──`);
      parts.push(`  role: ${msg['role']}`);
      if (msg['tool_call_id'] != null) parts.push(`  tool_call_id: ${msg['tool_call_id']}`);
      if (msg['name'] != null) parts.push(`  name: ${msg['name']}`);
      if (msg['tool_calls'] != null) {
        const tcs = msg['tool_calls'] as Array<Record<string, unknown>>;
        parts.push(`  tool_calls: ${tcs.length} calls`);
        for (const tc of tcs) {
          const fn = tc['function'] as Record<string, unknown> | undefined;
          const args = fn?.['arguments']?.toString() ?? '';
          parts.push(`    [${tc['id']}] ${fn?.['name']}(${args.length > 100 ? args.substring(0, 100) + '...' : args})`);
        }
      }
      const c = msg['content'];
      if (typeof c === 'string') {
        parts.push(`  content (String, len=${c.length}):`);
        parts.push(`    ${c.length > 500 ? c.substring(0, 500) + '...' : c}`);
      } else if (Array.isArray(c)) {
        parts.push(`  content (List, ${c.length} parts):`);
        for (let k = 0; k < c.length; k++) {
          const part = c[k] as Record<string, unknown>;
          const type = part['type']?.toString() ?? '?';
          if (type === 'image_url') {
            const iu = part['image_url'] as Record<string, unknown> | undefined;
            const url = iu?.['url']?.toString() ?? '';
            const comma = url.indexOf(',');
            const header = comma >= 0 ? url.substring(0, comma) : url.substring(0, 120);
            const dataLen = comma >= 0 ? url.length - comma - 1 : url.length;
            parts.push(`    part[${k}] type=image_url`);
            parts.push(`      header: ${header}`);
            parts.push(`      base64_data_len: ${dataLen}`);
          } else if (type === 'text') {
            const t = part['text']?.toString() ?? '';
            parts.push(`    part[${k}] type=text len=${t.length}`);
            parts.push(`      text: ${t.length > 300 ? t.substring(0, 300) + '...' : t}`);
          } else {
            parts.push(`    part[${k}] type=${type} keys=${Object.keys(part).join(',')}`);
          }
        }
      } else if (c == null) {
        parts.push('  content: null');
      } else {
        parts.push(`  content: type=${typeof c}`);
      }
    }

    // Full JSON body with truncated images
    parts.push('');
    parts.push('── FULL JSON BODY (images truncated) ──');
    parts.push(JSON.stringify(truncateBodyForLog(body), null, 2));

    console.debug(parts.join('\n'));
  } catch (e) {
    console.debug('[openai] ERROR in debugLogRequest:', e);
  }
}

function truncateBodyForLog(body: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'messages' && Array.isArray(value)) {
      copy[key] = value.map((m: Record<string, unknown>) => {
        const mc = { ...m };
        const c = mc['content'];
        if (Array.isArray(c)) {
          mc['content'] = c.map((part: Record<string, unknown>) => {
            if (part['type'] === 'image_url') {
              const iu = { ...(part['image_url'] as Record<string, unknown>) };
              const url = iu['url']?.toString() ?? '';
              const comma = url.indexOf(',');
              if (comma >= 0) {
                iu['url'] = `${url.substring(0, comma)},[BASE64_DATA:${url.length - comma - 1} chars]`;
              }
              return { type: 'image_url', image_url: iu };
            }
            return part;
          });
        }
        return mc;
      });
    } else {
      copy[key] = value;
    }
  }
  return copy;
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
