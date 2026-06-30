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
// 解决：超长时截断 tool 消息，完整内容以 user 消息兜底发送。

const DEFAULT_TOOL_RESULT_MAX_LEN = 8000;

export interface TruncatedToolResult {
  /** 放入 role:'tool' 的内容（截断后） */
  toolContent: string;
  /** 如果超长，完整的 user 消息文本；否则 undefined */
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
    + `\n\n...[截断] 完整结果共 ${rawContent.length} 字符，见下一条 user 消息`;
  const fullUserMessage = `[工具 "${toolName}" 的完整返回结果 (${rawContent.length} 字符)]:\n\n${rawContent}`;
  return { toolContent: truncated, fullUserMessage };
}
