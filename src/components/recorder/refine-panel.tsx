/**
 * 模板微调对话面板 — 多轮对话修改模板
 * 使用通用 ChatPanel 组件
 */

import { useMemo } from 'react';
import { MessageSquare } from 'lucide-react';
import { ChatPanel } from '@/components/chat/chat-panel';
import type { DisplayMessage } from '@/types/chat';
import type { MessageContent } from '@/types/message';
import { extractText } from '@/utils/content';

interface RefineMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface RefinePanelProps {
  messages: RefineMessage[];
  loading: boolean;
  reasoning: string;
  onSend: (message: string) => void;
  placeholder?: string;
  maxHeight?: number;
}

export function RefinePanel({ messages, loading, reasoning, onSend, placeholder, maxHeight = 150 }: RefinePanelProps) {
  const displayMessages: DisplayMessage[] = useMemo(() =>
    messages.map((m, i) => ({
      id: `refine-${i}`,
      role: m.role,
      content: m.content,
      status: 'done' as const,
    })),
    [messages],
  );

  return (
    <div className="mx-2 mt-2 mb-2 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden shrink-0 flex flex-col" style={{ maxHeight: `${maxHeight + 80}px` }}>
      <ChatPanel
        messages={displayMessages}
        onSend={(content: MessageContent) => onSend(extractText(content))}
        isStreaming={loading}
        streamingReasoning={reasoning}
        showReasoning
        layout="panel"
        maxHeight={`${maxHeight}px`}
        inputPlaceholder={placeholder || '微调模板，如：把第3步改为语义定位...'}
        allowStop={false}
        header={
          <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
            <MessageSquare size={12} className="text-blue-500" />
            <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">微调对话</span>
            {loading && <span className="text-[10px] text-blue-500 animate-pulse ml-1">思考中...</span>}
          </div>
        }
      />
    </div>
  );
}
