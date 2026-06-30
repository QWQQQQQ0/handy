// ChatPanel — 通用对话组件
// 通过 props 控制功能开关，适配所有对话入口（主Chat、浮窗、项目页、FreeAgent、录制微调）
import { useEffect, useRef, useMemo, useState, type ReactNode } from 'react';
import { Send, LoaderCircle, Wrench, CheckCircle, XCircle } from 'lucide-react';
import type { ChatPanelProps, DisplayMessage } from '@/types/chat';
import { ThinkingInline } from './thinking-block';
import { AgentLogGroup } from './agent-log-group';
import { MarkdownBody } from './markdown-body';
import { StreamingText } from './streaming-text';
import { MessageInput } from './message-input';
import type { MessageContent } from '@/types/message';

// ── Sub-components ──

/** Single message bubble */
function MessageBubble({
  msg,
  features,
  onDelete,
}: {
  msg: DisplayMessage;
  features: { allowEdit: boolean; allowDelete: boolean; showReasoning: boolean };
  onDelete?: (id: string) => void;
}) {
  if (msg.role === 'user') {
    return (
      <div className="flex justify-end group relative">
        <div className="max-w-[85%] rounded-xl px-4 py-2.5 bg-blue-600 text-white text-[13px]">
          <div className="whitespace-pre-wrap break-words">{msg.content ?? ''}</div>
          {features.allowDelete && onDelete && (
            <button
              onClick={() => onDelete(msg.id)}
              className="absolute -top-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-full bg-red-500 text-white"
              title="删除消息"
            >
              <XCircle size={14} />
            </button>
          )}
        </div>
      </div>
    );
  }

  // Assistant or tool message
  return (
    <div className="flex justify-start">
      <div className={`max-w-[85%] rounded-xl px-4 py-2.5 text-[13px] ${
        msg.role === 'tool'
          ? 'bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700'
          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
      }`}>
        {/* Reasoning */}
        {features.showReasoning && msg.reasoning_content && (
          <ThinkingInline content={msg.reasoning_content} />
        )}

        {/* Tool calls */}
        {msg.toolCalls && msg.toolCalls.length > 0 && (
          <div className="mb-2">
            {msg.toolCalls.map((tc) => (
              <div key={tc.id} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                {tc.status === 'running' ? (
                  <LoaderCircle size={10} className="text-blue-500 animate-spin" />
                ) : tc.success ? (
                  <CheckCircle size={10} className="text-green-500" />
                ) : tc.success === false ? (
                  <XCircle size={10} className="text-red-500" />
                ) : null}
                <Wrench size={10} className="text-zinc-400" />
                <span className="font-medium text-zinc-600 dark:text-zinc-400">{tc.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Content */}
        {msg.content && (
          <div className="whitespace-pre-wrap break-words">
            {msg.status === 'streaming' ? (
              <StreamingText text={typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content)} isStreaming />
            ) : msg.role === 'tool' ? (
              <span className="text-zinc-500 dark:text-zinc-400 text-[12px]">{msg.content}</span>
            ) : (
              <MarkdownBody content={typeof msg.content === 'string' ? msg.content : ''} />
            )}
          </div>
        )}

        {/* Tool result (role=tool) */}
        {msg.role === 'tool' && msg.toolCallId && (
          <div className="mt-1 text-[10px] text-zinc-400">
            id: {msg.toolCallId.substring(0, 12)}...
          </div>
        )}
      </div>
    </div>
  );
}

/** Empty state */
function EmptyState({ title, description, icon }: { title?: string; description?: string; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 gap-3">
      {icon ?? <Send size={40} className="opacity-30" />}
      <div className="text-center">
        <p className="text-[14px] font-medium">{title ?? '开始对话'}</p>
        {description && <p className="text-[12px] mt-1 max-w-md">{description}</p>}
      </div>
    </div>
  );
}

// ── Group messages: normal vs agent internal ──

interface MessageGroup {
  type: 'normal' | 'agent';
  messages: DisplayMessage[];
}

function groupMessages(msgs: DisplayMessage[]): MessageGroup[] {
  const groups: MessageGroup[] = [];
  let i = 0;
  while (i < msgs.length) {
    const m = msgs[i];
    if (m._agentInternal || m._isAgentStart) {
      const agentMsgs: DisplayMessage[] = [];
      while (i < msgs.length && (msgs[i]._agentInternal || msgs[i]._isAgentStart)) {
        agentMsgs.push(msgs[i]);
        i++;
      }
      groups.push({ type: 'agent', messages: agentMsgs });
    } else {
      groups.push({ type: 'normal', messages: [m] });
      i++;
    }
  }
  return groups;
}

// ═══════════════════════════════════════════════════════════════
// Main ChatPanel
// ═══════════════════════════════════════════════════════════════

export function ChatPanel({
  messages,
  onSend,
  isStreaming,
  error,
  streamingContent,
  streamingReasoning,
  streamingToolCalls,
  onStop,
  onDismissError,
  onDeleteMessage,
  onEditMessage,
  // Feature flags
  showReasoning = false,
  showAgentGroups = false,
  showStreaming = false,
  allowImagePaste = false,
  allowFileUpload = false,
  allowEdit = false,
  allowDelete = false,
  allowStop = false,
  agentTypes,
  // Modules
  confirmationState,
  userInputForm,
  conversationConfig,
  // Layout
  layout = 'full',
  maxHeight,
  className,
  style,
  inputPlaceholder,
  emptyTitle,
  emptyDescription,
  emptyIcon,
  // Slots
  header,
  emptyState,
  previewPanel,
  modelSwitcher,
  debugMessages,
}: ChatPanelProps) {
  const [showDebug, setShowDebug] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll
  useEffect(() => {
    const el = scrollRef.current;
    if (el) requestAnimationFrame(() => el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' }));
  }, [messages, streamingContent, streamingReasoning, streamingToolCalls]);

  // Group messages for display
  const groups = useMemo(() => groupMessages(messages), [messages]);

  const isCompact = layout === 'compact' || layout === 'panel';

  const handleSend = (content: MessageContent, agentContext?: string) => {
    onSend(content, agentContext);
  };

  return (
    <div className={`flex h-full ${className ?? ''}`} style={style}>
      {/* ── Conversation sidebar ── */}
      {conversationConfig && showConversations && (
        <div className="fixed inset-0 z-50 bg-black/40" onClick={() => setShowConversations(false)}>
          <div className="absolute left-0 top-0 bottom-0 w-72 bg-white dark:bg-zinc-950 shadow-xl border-r border-zinc-200 dark:border-zinc-800 p-4 overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <span className="font-semibold text-[14px] text-zinc-900 dark:text-zinc-100">对话列表</span>
              <button
                onClick={() => setShowConversations(false)}
                className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                <XCircle size={16} />
              </button>
            </div>
            <button
              onClick={() => { conversationConfig.onNew(); setShowConversations(false); }}
              className="w-full mb-3 px-3 py-2 rounded-lg bg-blue-600 text-white text-[13px] font-medium hover:bg-blue-700 flex items-center justify-center gap-1"
            >
              + 新建对话
            </button>
            <div className="space-y-1">
              {conversationConfig.conversations.map((c) => (
                <button
                  key={c.id}
                  onClick={() => { conversationConfig.onSwitch(c.id); setShowConversations(false); }}
                  className={`w-full text-left px-3 py-2 rounded-lg text-[13px] truncate transition-colors ${
                    c.id === conversationConfig.activeId
                      ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-zinc-100 dark:hover:bg-zinc-900 text-zinc-700 dark:text-zinc-300'
                  }`}
                >
                  <div className="truncate">{c.title}</div>
                  <div className="text-[10px] text-zinc-400 mt-0.5">{c.updatedAt ? new Date(c.updatedAt).toLocaleDateString() : ''}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Main chat area ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        {header ?? (
          <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
            <div className="flex items-center gap-2">
              {isCompact && conversationConfig && (
                <button
                  onClick={() => setShowConversations(true)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 text-[13px]"
                >
                  对话
                </button>
              )}
              {modelSwitcher}
            </div>
            <div className="flex items-center gap-1">
              {debugMessages && debugMessages.length > 0 && (
                <button
                  onClick={() => setShowDebug(!showDebug)}
                  className={`p-1 rounded text-[11px] ${showDebug ? 'bg-blue-100 dark:bg-blue-900 text-blue-600' : 'text-zinc-400'}`}
                >
                  🐛
                </button>
              )}
              {!isCompact && conversationConfig && (
                <button
                  onClick={() => setShowConversations(true)}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
                >
                  ☰
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div className="shrink-0 mx-3 mt-2 px-3 py-2 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800 rounded-lg text-[13px] text-red-700 dark:text-red-300 flex items-center justify-between">
            <span className="truncate">{error}</span>
            {onDismissError && (
              <button onClick={onDismissError} className="ml-2 text-red-400 hover:text-red-600 shrink-0">
                <XCircle size={14} />
              </button>
            )}
          </div>
        )}

        {/* Messages */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-4 py-3 space-y-3"
          style={maxHeight ? { maxHeight } : undefined}
        >
          {groups.length === 0 && !streamingContent && !streamingReasoning && !streamingToolCalls?.length ? (
            emptyState ?? <EmptyState title={emptyTitle} description={emptyDescription} icon={emptyIcon} />
          ) : (
            groups.map((group, gi) => {
              if (group.type === 'agent' && showAgentGroups) {
                return <AgentLogGroup key={`agent-${gi}`} messages={group.messages} />;
              }
              return group.messages.map((msg) => (
                <MessageBubble
                  key={msg.id}
                  msg={msg}
                  features={{ allowEdit, allowDelete, showReasoning }}
                  onDelete={onDeleteMessage}
                />
              ));
            })
          )}

          {/* Streaming display */}
          {(streamingContent || streamingReasoning || (streamingToolCalls && streamingToolCalls.length > 0)) && (
            <div className="flex justify-start">
              <div className="max-w-[85%] rounded-xl px-4 py-2.5 bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100">
                {streamingReasoning && showReasoning && (
                  <details className="mb-2" open>
                    <summary className="text-[11px] text-zinc-400 dark:text-zinc-500 cursor-pointer select-none hover:text-zinc-500">
                      💭 思考中...
                    </summary>
                    <div className="mt-1.5 p-2 rounded bg-zinc-200/50 dark:bg-zinc-900/50 text-[11px] text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap break-words border-l-2 border-zinc-300 dark:border-zinc-600 max-h-60 overflow-y-auto">
                      {streamingReasoning}
                    </div>
                  </details>
                )}
                {streamingToolCalls && streamingToolCalls.length > 0 && (
                  <div className="mb-2">
                    {streamingToolCalls.map((tc) => (
                      <div key={tc.id} className="flex items-center gap-1.5 py-0.5 text-[11px]">
                        {tc.status === 'running' ? (
                          <LoaderCircle size={10} className="text-blue-500 animate-spin" />
                        ) : tc.success ? (
                          <CheckCircle size={10} className="text-green-500" />
                        ) : tc.success === false ? (
                          <XCircle size={10} className="text-red-500" />
                        ) : null}
                        <Wrench size={10} className="text-zinc-400" />
                        <span className="text-zinc-600 dark:text-zinc-400">{tc.name}</span>
                      </div>
                    ))}
                  </div>
                )}
                {streamingContent && showStreaming && (
                  <StreamingText text={streamingContent} isStreaming />
                )}
              </div>
            </div>
          )}

          <div className="h-1" /> {/* scroll anchor */}
        </div>

        {/* Confirmation bar — between messages and input, near user's focus */}
        {confirmationState && (
          <div className="shrink-0 mx-3 mb-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 rounded-lg text-[13px]">
            <div className="font-medium text-amber-700 dark:text-amber-300 mb-1">⚠️ 确认执行命令：</div>
            <code className="text-[12px] text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/50 px-2 py-1 rounded block mb-2 max-h-20 overflow-y-auto">
              {confirmationState.command}
            </code>
            <div className="flex gap-2">
              <button onClick={confirmationState.onConfirm} className="px-3 py-1 rounded bg-amber-600 text-white text-[12px] hover:bg-amber-700">
                确认执行
              </button>
              <button onClick={confirmationState.onReject} className="px-3 py-1 rounded bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300 text-[12px] hover:bg-zinc-300">
                取消
              </button>
            </div>
          </div>
        )}

        {/* User input form — between messages and input */}
        {userInputForm && (
          <div className="shrink-0 mx-3 mb-2 px-3 py-2 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg text-[13px]">
            <div className="font-medium text-blue-700 dark:text-blue-300 mb-2">{userInputForm.message}</div>
            {userInputForm.fields.map((field) => (
              <input
                key={field.key}
                type={field.type ?? 'text'}
                placeholder={field.label}
                className="w-full mb-2 px-2 py-1 rounded border border-blue-200 dark:border-blue-700 bg-white dark:bg-zinc-900 text-[13px] outline-none focus:border-blue-500"
                id={`userinput-${field.key}`}
              />
            ))}
            <button
              onClick={() => {
                const values: Record<string, string> = {};
                for (const f of userInputForm.fields) {
                  const el = document.getElementById(`userinput-${f.key}`) as HTMLInputElement;
                  if (el) values[f.key] = el.value;
                }
                userInputForm.onSubmit(values);
              }}
              className="px-3 py-1 rounded bg-blue-600 text-white text-[12px] hover:bg-blue-700"
            >
              提交
            </button>
          </div>
        )}

        {/* Input area — delegates to MessageInput */}
        <MessageInput
          onSend={handleSend}
          enabled={!isStreaming}
          hintText={inputPlaceholder ?? '发送消息...'}
          allowImagePaste={allowImagePaste ?? false}
          allowFileUpload={allowFileUpload ?? false}
          compact={isCompact}
          onStop={allowStop && isStreaming ? onStop : undefined}
          agentTypes={agentTypes}
        />
      </div>

      {/* ── Preview panel (right side) ── */}
      {previewPanel}
    </div>
  );
}
