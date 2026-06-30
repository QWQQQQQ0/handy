// Shared thinking/reasoning block — used by ChatPanel for all chat implementations
import { useState, useEffect, useRef } from 'react';

interface ThinkingBlockProps {
  content: string;
  streaming?: boolean;
  /** Auto-collapse after streaming ends (default true) */
  autoCollapse?: boolean;
  /** Label text (default "💭 思考") */
  label?: string;
  /** Whether to default to open when not streaming (default false) */
  defaultOpen?: boolean;
}

export function ThinkingBlock({
  content,
  streaming,
  autoCollapse = true,
  label = '💭 思考',
  defaultOpen = false,
}: ThinkingBlockProps) {
  const [expanded, setExpanded] = useState(defaultOpen || !!streaming);
  const wasStreaming = useRef(false);

  if (streaming) wasStreaming.current = true;

  useEffect(() => {
    if (streaming) {
      setExpanded(true);
    }
  }, [streaming]);

  useEffect(() => {
    // Auto-collapse ~1s after streaming stops
    if (!streaming && wasStreaming.current && autoCollapse && expanded) {
      const timer = setTimeout(() => setExpanded(false), 1000);
      wasStreaming.current = false;
      return () => clearTimeout(timer);
    }
  }, [streaming, autoCollapse, expanded]);

  if (!content) return null;

  const summaryLabel = streaming ? `${label}中...` : `${label}过程`;

  return (
    <div className="mb-1.5 border-l-2 border-amber-300 dark:border-amber-600 pl-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300 cursor-pointer select-none"
      >
        <span className="font-medium">{summaryLabel}</span>
        <span className="text-[9px]">{expanded ? '▾' : '▸'}</span>
      </button>
      {expanded && (
        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-words max-h-60 overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

/** Compact variant — simple collapsible details for panel mode */
export function ThinkingInline({ content, streaming }: { content: string; streaming?: boolean }) {
  if (!content) return null;

  return (
    <details className="mb-2" open={streaming}>
      <summary className="text-[11px] text-zinc-400 dark:text-zinc-500 cursor-pointer select-none hover:text-zinc-500">
        {streaming ? '💭 思考中...' : '💭 思考过程'}
      </summary>
      <div className="mt-1.5 p-2 rounded bg-zinc-200/50 dark:bg-zinc-900/50 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-words border-l-2 border-zinc-300 dark:border-zinc-600">
        {content}
      </div>
    </details>
  );
}
