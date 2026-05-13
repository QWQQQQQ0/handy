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
