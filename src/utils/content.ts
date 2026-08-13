// 来源: lib/models/chat_message.dart (serializeContent / deserializeContent)

import type { MessageContent } from '@/types/message';

export function serializeContent(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return JSON.stringify(content);
}

export function deserializeContent(raw: string): MessageContent {
  if (raw.startsWith('[{')) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    } catch { /* fall through */ }
  }
  return raw;
}

export function hasImages(content: MessageContent): boolean {
  if (typeof content === 'string') return false;
  return content.some(
    (part) => 'type' in part && part.type === 'image_url'
  );
}

export function extractText(content: MessageContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter((part) => 'type' in part && part.type === 'text')
    .map((part) => 'text' in part ? part.text : '')
    .join('\n');
}

// ── Tool 结果截断 ──
// 当工具返回内容过大时，LLM 可能直接不回复（尤其 MiMo 等模型）。
// 超长时截断 tool 消息，引导 LLM 用专门工具获取完整数据。
//
// 注意：不再使用独立的 user 消息兜底完整内容——这会在 Anthropic 适配器中
// 产生连续 user(tool_result) + user(文本) 的非法消息序列。

const DEFAULT_TOOL_RESULT_MAX_LEN = 8000;

export interface TruncatedToolResult {
  /** 放入 role:'tool' 的内容（截断后） */
  toolContent: string;
  /** @deprecated 不再使用——保留字段避免编译错误，始终为 undefined */
  fullUserMessage?: string;
}

export function truncateToolResult(
  toolName: string,
  rawContent: string,
  maxLen: number = DEFAULT_TOOL_RESULT_MAX_LEN,
): TruncatedToolResult {
  if (rawContent.length <= maxLen) {
    return { toolContent: rawContent };
  }
  const truncated = rawContent.substring(0, maxLen)
    + `\n\n...[截断] 完整结果共 ${rawContent.length} 字符。`
    + `如需完整数据，请使用合适的工具直接读取（如 read_file、execute_code 等）`;
  return { toolContent: truncated };
}
