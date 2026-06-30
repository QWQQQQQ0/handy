// Shared AgentLogGroup — collapsible agent execution log
// Works with both ChatMessage (@/types/message) and DisplayMessage (@/types/chat)
import { useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle, Wrench } from 'lucide-react';
import { ThinkingBlock } from './thinking-block';

/** Minimal message interface — enough for AgentLogGroup to render */
export interface AgentLogMessage {
  id?: string;
  role?: string;
  content?: unknown; // string | ContentPart[]
  status?: string;
  reasoning_content?: string;
  _agentInternal?: boolean;
  _agentType?: string;
  _isAgentStart?: boolean;
  _toolCallInfo?: {
    name: string;
    args?: Record<string, unknown>;
    status?: string;
  };
}

interface AgentLogGroupProps {
  messages: AgentLogMessage[];
  label?: string;
  defaultExpanded?: boolean;
}

const AGENT_LABELS: Record<string, string> = {
  computeruse: '🖥️ 计算机操作',
  web: '🌐 浏览器',
  document: '📄 文档',
  code: '💻 代码',
  free: '🤖 AI 开发者',
};

export function AgentLogGroup({ messages, label, defaultExpanded = false }: AgentLogGroupProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const startMsg = messages.find((m) => m._isAgentStart);
  const agentType = startMsg?._agentType ?? 'computeruse';
  const displayLabel = label ?? (AGENT_LABELS[agentType] ?? agentType);
  const isRunning = startMsg?.status === 'streaming';

  const toolCalls = messages.filter((m) => m._toolCallInfo);
  const toolResults = messages.filter((m) => m.role === 'tool' && m._agentInternal);
  const successCount = toolResults.filter((m) => {
    const c = typeof m.content === 'string' ? m.content : '';
    return c.startsWith('✅');
  }).length;
  const failCount = toolResults.filter((m) => {
    const c = typeof m.content === 'string' ? m.content : '';
    return c.startsWith('❌');
  }).length;

  const statusColor = isRunning
    ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
    : failCount > 0
    ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800'
    : 'bg-zinc-50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 border-zinc-200 dark:border-zinc-700';

  const startContent = typeof startMsg?.content === 'string' ? startMsg.content : null;

  return (
    <div className="mx-3 my-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors border ${statusColor}`}
      >
        {isRunning ? (
          <Loader2 size={14} className="animate-spin shrink-0" />
        ) : failCount > 0 ? (
          <XCircle size={14} className="shrink-0" />
        ) : (
          <CheckCircle size={14} className="shrink-0" />
        )}
        <span className="flex-1 text-left truncate">
          {startContent ?? `${displayLabel} Agent 执行中...`}
        </span>
        <span className="text-[11px] opacity-70 shrink-0">
          {toolCalls.length} 工具 · {successCount}✓ {failCount > 0 ? `${failCount}✗` : ''}
        </span>
        {expanded ? <ChevronUp size={14} className="shrink-0" /> : <ChevronDown size={14} className="shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-1.5 ml-2 pl-3 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-1">
          {messages
            .filter((m) => !m._isAgentStart)
            .map((m, i) => {
              const contentStr = typeof m.content === 'string' ? m.content : '';

              if (m.reasoning_content) {
                return (
                  <ThinkingBlock
                    key={m.id || i}
                    content={m.reasoning_content}
                    streaming={m.status === 'streaming'}
                    label="💭 Agent 思考"
                  />
                );
              }

              if (m._toolCallInfo) {
                const tc = m._toolCallInfo;
                return (
                  <div key={m.id || i} className="flex items-center gap-1.5 py-0.5 text-[12px]">
                    <Wrench size={12} className="text-zinc-400 shrink-0" />
                    <span className="font-medium text-zinc-600 dark:text-zinc-400">{tc.name}</span>
                    <span className="text-zinc-400 truncate">
                      {tc.args ? JSON.stringify(tc.args).substring(0, 80) : ''}
                    </span>
                  </div>
                );
              }

              if (m.role === 'tool' && m._agentInternal) {
                const isSuccess = contentStr.startsWith('✅');
                const shortContent = contentStr.length > 150
                  ? contentStr.substring(0, 150) + '...'
                  : contentStr;
                return (
                  <div key={m.id || i} className="text-[12px] py-0.5">
                    <span className={isSuccess ? 'text-green-600' : 'text-red-500'}>
                      {shortContent}
                    </span>
                  </div>
                );
              }

              if (contentStr.startsWith('🔄')) {
                return (
                  <div key={m.id || i} className="text-[11px] text-zinc-400 py-0.5">
                    {contentStr}
                  </div>
                );
              }

              return null;
            })}
        </div>
      )}
    </div>
  );
}
