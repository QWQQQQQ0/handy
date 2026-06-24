/**
 * 模板微调对话面板 — 多轮对话修改模板
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { Loader2, MessageSquare, Send } from 'lucide-react';

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
  const [input, setInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // 消息变化时自动滚动到底部
  useEffect(() => {
    const el = scrollRef.current;
    if (el) {
      // 延迟一帧等渲染完成
      requestAnimationFrame(() => {
        el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
      });
    }
  }, [messages, reasoning]);

  const handleSend = useCallback(() => {
    const msg = input.trim();
    if (!msg || loading) return;
    onSend(msg);
    setInput('');
  }, [input, loading, onSend]);

  return (
    <div className="mx-2 mt-2 mb-2 border border-zinc-200 dark:border-zinc-700 rounded-lg overflow-hidden shrink-0 flex flex-col" style={{ maxHeight: `${maxHeight + 80}px` }}>
      {/* 标题 */}
      <div className="flex items-center gap-1.5 px-3 py-1.5 border-b border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900 shrink-0">
        <MessageSquare size={12} className="text-blue-500" />
        <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-400">微调对话</span>
        {loading && <Loader2 size={10} className="animate-spin text-blue-500 ml-1" />}
      </div>

      {/* 消息列表 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto min-h-0 px-2 py-1.5 space-y-1.5"
        style={{ maxHeight }}
      >
        {messages.map((m, i) => (
          <div
            key={i}
            className={`text-[11px] leading-relaxed rounded-lg px-2 py-1.5 ${
              m.role === 'user'
                ? 'bg-blue-50 dark:bg-blue-950 text-blue-700 dark:text-blue-300 ml-4'
                : 'bg-zinc-50 dark:bg-zinc-900 text-zinc-600 dark:text-zinc-400 mr-4'
            }`}
          >
            <div className="text-[10px] text-zinc-400 mb-0.5 font-medium">
              {m.role === 'user' ? '你' : 'AI'}
            </div>
            <div className="whitespace-pre-wrap break-words">{m.content}</div>
          </div>
        ))}
        {loading && (
          <div className="text-[11px] text-zinc-400 italic px-2">思考中...</div>
        )}
        {reasoning && loading && (
          <div className="text-[10px] text-zinc-400 italic px-2 bg-zinc-50 dark:bg-zinc-900 rounded py-1 whitespace-pre-wrap break-words max-h-20 overflow-y-auto">
            {reasoning}
          </div>
        )}
      </div>

      {/* 输入区 */}
      <div className="flex items-center gap-1.5 px-2 py-1.5 border-t border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }}}
          placeholder={placeholder || '微调模板，如：把第3步改为语义定位...'}
          disabled={loading}
          className="flex-1 px-2 py-1 text-[11px] rounded border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 outline-none focus:border-blue-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || loading}
          className="p-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40 shrink-0 transition-colors"
        >
          <Send size={12} />
        </button>
      </div>
    </div>
  );
}
