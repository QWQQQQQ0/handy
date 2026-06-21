// 来源: lib/adapters/google_adapter.dart

import type { LLMMessage } from '@/types/message';
import type { LLMAdapter } from './types';

export class GoogleAdapter implements LLMAdapter {
  readonly adapterId = 'google';
  readonly displayName = 'Google Gemini';
  readonly defaultBaseUrl = 'https://generativelanguage.googleapis.com';

  async *chat({ messages, model, apiKey, baseUrl, tools }: {
    messages: LLMMessage[];
    model: string;
    apiKey: string;
    baseUrl?: string;
    tools?: Record<string, unknown>[];
  }): AsyncGenerator<string> {
    console.debug('[google] POST msgs=', messages.length, 'tools=', tools?.length ?? 0, 'model=', model);
    const url = `${baseUrl ?? this.defaultBaseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;

    const [contents, systemInstruction] = convertMessagesForGemini(messages);

    const body: Record<string, unknown> = { contents };
    if (systemInstruction != null) {
      body['systemInstruction'] = {
        parts: [{ text: systemInstruction }],
      };
    }
    if (tools && tools.length > 0) {
      body['tools'] = [{ functionDeclarations: convertTools(tools) }];
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof DOMException && e.name === 'AbortError') {
        throw new Error('Gemini API request timed out (120s).');
      }
      throw e;
    }
    clearTimeout(timeout);

    if (!response.ok) {
      const errBody = await response.text().catch(() => '(no body)');
      throw new Error(`Gemini API error ${response.status}: ${errBody}`);
    }
    if (!response.body) throw new Error('Gemini API response has no body');

    const functionCalls = new Map<number, Record<string, unknown>>();

    for await (const line of decodeStreamToLines(response.body)) {
      if (line.trim().length === 0) continue;
      try {
        const json = JSON.parse(line);
        const candidates = json['candidates'] as Array<Record<string, unknown>> | undefined;
        if (!candidates || candidates.length === 0) continue;
        const content = candidates[0]['content'] as Record<string, unknown> | undefined;
        const parts = content?.['parts'] as Array<Record<string, unknown>> | undefined;
        if (!parts || parts.length === 0) continue;

        for (const part of parts) {
          const funcCall = part['functionCall'] as Record<string, unknown> | undefined;
          if (funcCall) {
            const idx = functionCalls.size;
            functionCalls.set(idx, {
              id: `call_${idx}`,
              function: {
                name: funcCall['name'],
                arguments: JSON.stringify(funcCall['args']),
              },
            });
          }
          const text = part['text'] as string | undefined;
          if (text && text.length > 0) {
            yield text;
          }
        }
      } catch {
        // Skip malformed chunks
      }
    }

    if (functionCalls.size > 0) {
      yield `__TOOLS__:${JSON.stringify(Array.from(functionCalls.values()))}`;
    }
  }
}

// Convert OpenAI-format tools to Gemini functionDeclarations format
function convertTools(tools: Record<string, unknown>[]): Record<string, unknown>[] {
  return tools.map((t) => {
    const func = t['function'] as Record<string, unknown>;
    return {
      name: func['name'],
      description: func['description'],
      parameters: func['parameters'],
    };
  });
}

// Convert LLMMessages to Gemini contents format
// Returns [contents, optional systemInstruction]
function convertMessagesForGemini(messages: LLMMessage[]): [Array<Record<string, unknown>>, string | null] {
  const contents: Array<Record<string, unknown>> = [];
  let systemInstruction: string | null = null;

  for (const msg of messages) {
    const content = msg.content;

    if (msg.role === 'system') {
      systemInstruction = content?.toString() ?? '';
      continue;
    }

    let role: string;
    switch (msg.role) {
      case 'assistant':
        role = 'model';
        break;
      case 'tool':
        role = 'function';
        break;
      default:
        role = 'user';
    }

    const parts: Array<Record<string, unknown>> = [];

    // Tool result with multimodal content (images + audio + video + text)
    if (msg.role === 'tool' && Array.isArray(content)) {
      const textParts: string[] = [];
      for (const part of content) {
        const p = part as Record<string, unknown>;
        if (p['type'] === 'image_url' || p['type'] === 'input_audio') {
          const srcKey = p['type'] === 'image_url' ? 'image_url' : 'input_audio';
          const src = p[srcKey] as Record<string, unknown>;
          let url = (src['url'] ?? src['data']) as string;
          let mimeType: string | undefined;
          let data: string;
          if (url.startsWith('data:')) {
            const comma = url.indexOf(',');
            if (comma >= 0) {
              const header = url.substring(5, comma);
              const semicolon = header.indexOf(';');
              mimeType = semicolon >= 0 ? header.substring(0, semicolon) : header;
              data = url.substring(comma + 1);
            } else {
              data = url.substring(5);
            }
          } else {
            data = url;
          }
          parts.push({
            inlineData: {
              mimeType: mimeType ?? (p['type'] === 'input_audio' ? 'audio/wav' : 'image/png'),
              data,
            },
          });
        } else if (p['type'] === 'video_url') {
          const vu = p['video_url'] as Record<string, unknown>;
          textParts.push(`[Video: ${vu['url'] ?? ''}]`);
        } else if (p['type'] === 'text') {
          textParts.push(p['text'] as string);
        }
      }
      parts.push({
        functionResponse: {
          name: msg.toolCallName ?? '',
          response: { output: textParts.join('\n') },
        },
      });
    }
    // Multimodal user message (images + audio + video + text)
    else if (Array.isArray(content)) {
      for (const part of content) {
        const p = part as Record<string, unknown>;
        if (p['type'] === 'image_url' || p['type'] === 'input_audio') {
          const srcKey = p['type'] === 'image_url' ? 'image_url' : 'input_audio';
          const src = p[srcKey] as Record<string, unknown>;
          let url = (src['url'] ?? src['data']) as string;
          let mimeType: string | undefined;
          let data: string;
          if (url.startsWith('data:')) {
            const comma = url.indexOf(',');
            if (comma >= 0) {
              const header = url.substring(5, comma);
              const semicolon = header.indexOf(';');
              mimeType = semicolon >= 0 ? header.substring(0, semicolon) : header;
              data = url.substring(comma + 1);
            } else {
              data = url.substring(5);
            }
          } else {
            data = url;
          }
          parts.push({
            inlineData: {
              mimeType: mimeType ?? (p['type'] === 'input_audio' ? 'audio/wav' : 'image/png'),
              data,
            },
          });
        } else if (p['type'] === 'video_url') {
          const vu = p['video_url'] as Record<string, unknown>;
          parts.push({ text: `[Video URL: ${vu['url'] ?? ''}]` });
        } else if (p['type'] === 'text') {
          parts.push({ text: p['text'] });
        }
      }
    }
    // Assistant message with tool calls → functionCall parts
    else if (msg.toolCalls && msg.toolCalls.length > 0) {
      if (content != null && content.toString().length > 0) {
        parts.push({ text: content.toString() });
      }
      for (const tc of msg.toolCalls) {
        const func = tc['function'] as Record<string, unknown>;
        let args: Record<string, unknown>;
        try {
          args = JSON.parse(func['arguments'] as string);
        } catch {
          args = {};
        }
        parts.push({
          functionCall: {
            name: func['name'],
            args,
          },
        });
      }
    }
    // Tool result message → functionResponse part
    else if (msg.role === 'tool') {
      parts.push({
        functionResponse: {
          name: msg.toolCallName ?? '',
          response: { output: content?.toString() ?? '' },
        },
      });
    }
    // Plain text message
    else {
      parts.push({ text: content?.toString() ?? '' });
    }

    contents.push({ role, parts });
  }

  return [contents, systemInstruction];
}

// Replicate LLMAdapter.decodeStreamToLines
async function* decodeStreamToLines(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) yield line;
    if (done) {
      if (buffer.length > 0) yield buffer;
      break;
    }
  }
}
