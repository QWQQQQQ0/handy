import { useRef, useCallback, useEffect, useImperativeHandle, forwardRef, useState, useDeferredValue, useMemo } from 'react';
import { ChevronDown, ChevronUp, MessageSquarePlus, Trash2, MessageCircle, Terminal, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useChatStore } from '@/stores/chat-store';
import { extractBbox, BboxOverlay } from '@/components/bbox-overlay';
import { MessageInput } from '@/components/chat/message-input';
import { StreamingText } from '@/components/chat/streaming-text';
import { MarkdownBody } from '@/components/chat/markdown-body';
import { formatRelativeTime } from '@/i18n/strings';
import type { MessageContent, ChatMessage } from '@/types/message';

export interface ChatModeHandle {
  clearMessages: () => void;
}

interface Props {
  sendToModel: boolean;
  allowImagePaste: boolean;
  noSystemPrompt: boolean;
}

function ThinkingBlock({ content, streaming }: { content: string; streaming?: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [wasStreaming, setWasStreaming] = useState(false);
  if (streaming && !wasStreaming) setWasStreaming(true);
  if (!streaming && wasStreaming && expanded) {
    setTimeout(() => setExpanded(false), 1000);
    setWasStreaming(false);
  }
  return (
    <div className="mb-1.5 border-l-2 border-amber-300 dark:border-amber-600 pl-1.5">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-1 text-[11px] text-amber-600 dark:text-amber-400 hover:text-amber-700 dark:hover:text-amber-300"
      >
        <span className="font-medium">💭 思考</span>
        {expanded ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
      </button>
      {expanded && (
        <div className="mt-1 text-[11px] leading-relaxed text-zinc-500 dark:text-zinc-400 whitespace-pre-wrap font-mono max-h-[300px] overflow-y-auto">
          {content}
        </div>
      )}
    </div>
  );
}

/** Agent 内部日志折叠组 */
function AgentLogGroup({ messages: agentMessages }: { messages: ChatMessage[] }) {
  const [expanded, setExpanded] = useState(false);
  const startMsg = agentMessages.find((m) => m._isAgentStart);
  const isRunning = startMsg?.status === 'streaming';
  const agentType = startMsg?._agentType ?? 'computeruse';
  const label = { computeruse: '🖥️ 计算机操作', web: '🌐 浏览器', document: '📄 文档', code: '💻 代码' }[agentType] ?? agentType;

  // 统计工具调用
  const toolCalls = agentMessages.filter((m) => m._toolCallInfo);
  const toolResults = agentMessages.filter((m) => m.role === 'tool' && m._agentInternal);
  const successCount = toolResults.filter((m) => typeof m.content === 'string' && m.content.startsWith('✅')).length;
  const failCount = toolResults.filter((m) => typeof m.content === 'string' && m.content.startsWith('❌')).length;

  return (
    <div className="mx-1 my-1.5">
      {/* 折叠标题 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] font-medium transition-colors ${
          isRunning
            ? 'bg-blue-50 dark:bg-blue-950/30 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
            : failCount > 0
            ? 'bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
            : 'bg-zinc-50 dark:bg-zinc-900/50 text-zinc-600 dark:text-zinc-400 border border-zinc-200 dark:border-zinc-700'
        }`}
      >
        {isRunning ? (
          <Loader2 size={14} className="animate-spin" />
        ) : failCount > 0 ? (
          <XCircle size={14} />
        ) : (
          <CheckCircle size={14} />
        )}
        <span className="flex-1 text-left truncate">
          {(typeof startMsg?.content === 'string' ? startMsg.content : null) ?? `${label} Agent 执行中...`}
        </span>
        {toolCalls.length > 0 && (
          <span className="text-[10px] opacity-70">
            {successCount}✅ {failCount > 0 && `${failCount}❌`}
          </span>
        )}
        <ChevronDown size={12} className={`transition-transform ${expanded ? 'rotate-180' : ''}`} />
      </button>

      {/* 折叠内容 */}
      {expanded && (
        <div className="mt-1 ml-2 pl-2 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-1">
          {agentMessages.filter((m) => !m._isAgentStart).map((msg) => {
            const text = typeof msg.content === 'string' ? msg.content : '';

            // 工具调用信息
            if (msg._toolCallInfo) {
              const info = msg._toolCallInfo;
              return (
                <div key={msg.id} className="flex items-start gap-2 py-0.5">
                  <Terminal size={11} className="mt-0.5 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400">
                      {info.name}
                    </span>
                    {info.status === 'running' && (
                      <span className="ml-1 text-[10px] text-blue-500">运行中...</span>
                    )}
                  </div>
                </div>
              );
            }

            // 工具结果
            if (msg.role === 'tool') {
              return (
                <div key={msg.id} className="text-[11px] font-mono text-zinc-500 dark:text-zinc-400 truncate">
                  {text}
                </div>
              );
            }

            // LLM 思考
            if (msg.role === 'assistant') {
              return (
                <div key={msg.id} className="text-[11px] text-zinc-600 dark:text-zinc-400">
                  {msg.reasoning_content && (
                    <div className="mb-1 text-[10px] text-amber-600 dark:text-amber-400 italic">
                      💭 {msg.reasoning_content.substring(0, 100)}{msg.reasoning_content.length > 100 && '...'}
                    </div>
                  )}
                  {text && <div className="whitespace-pre-wrap">{text.substring(0, 200)}{text.length > 200 && '...'}</div>}
                </div>
              );
            }

            // 其他（轮次信息等）
            return (
              <div key={msg.id} className="text-[11px] text-zinc-400 dark:text-zinc-500">
                {text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Conversation list dropdown for the float window */
function ConversationDropdown({
  onClose,
  onSelect,
}: {
  onClose: () => void;
  onSelect: () => void;
}) {
  const {
    conversations,
    activeConversation,
    loadConversations,
    switchConversation,
    deleteConversation,
    newChat,
  } = useChatStore();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={dropdownRef}
      className="absolute right-0 top-full mt-1 z-50 w-64 max-h-[320px] overflow-y-auto rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg"
    >
      {/* New Chat */}
      <button
        onClick={() => { newChat(); onSelect(); }}
        className="flex items-center gap-2 w-full px-3 py-2 text-[12px] text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 border-b border-zinc-100 dark:border-zinc-800"
      >
        <MessageSquarePlus size={13} />
        新建对话
      </button>

      {/* Conversation list */}
      {conversations.length === 0 ? (
        <div className="px-3 py-6 text-center text-[11px] text-zinc-400 dark:text-zinc-500">
          暂无历史对话
        </div>
      ) : (
        conversations.map((conv) => {
          const isActive = conv.id === activeConversation?.id;
          const isConfirming = deletingId === conv.id;
          return (
            <div
              key={conv.id}
              className={`group flex items-center px-3 py-2 cursor-pointer transition-colors ${
                isActive
                  ? 'bg-blue-50 dark:bg-blue-950'
                  : 'hover:bg-zinc-50 dark:hover:bg-zinc-800'
              }`}
              onClick={async () => {
                if (isConfirming) return;
                if (!isActive) await switchConversation(conv);
                onSelect();
              }}
            >
              <div className="flex-1 min-w-0">
                <div className={`text-[12px] truncate ${
                  isActive
                    ? 'font-semibold text-blue-700 dark:text-blue-300'
                    : 'text-zinc-800 dark:text-zinc-200'
                }`}>
                  {conv.title}
                </div>
                <div className="text-[10px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                  {formatRelativeTime(conv.updatedAt)}
                </div>
              </div>
              {isConfirming ? (
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteConversation(conv.id); setDeletingId(null); }}
                    className="px-1.5 py-0.5 text-[10px] font-medium text-white bg-red-500 rounded hover:bg-red-600 transition-colors"
                  >
                    删除
                  </button>
                  <button
                    onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                    className="px-1.5 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={(e) => { e.stopPropagation(); setDeletingId(conv.id); }}
                  className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all shrink-0"
                  title="删除"
                >
                  <Trash2 size={12} />
                </button>
              )}
            </div>
          );
        })
      )}
    </div>
  );
}

const ChatMode = forwardRef<ChatModeHandle, Props>(function ChatMode({ sendToModel, allowImagePaste, noSystemPrompt }, ref) {
  const {
    messages,
    isStreaming,
    error,
    sendMessage,
    newChat,
    activeConversation,
    awaitingConfirmation,
    confirmToolCall,
    rejectToolCall,
    awaitingUserInput,
    submitUserInput,
  } = useChatStore();

  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [manualMode, setManualMode] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [showConvList, setShowConvList] = useState(false);

  // Load model config on mount
  useEffect(() => {
    (async () => {
      const { useModelConfigStore } = await import('@/stores/model-config-store');
      const store = useModelConfigStore.getState();
      if (store.providers.length === 0) {
        await store.load();
      }
      setReady(true);
    })();
  }, []);

  useImperativeHandle(ref, () => ({
    clearMessages: () => newChat(),
  }));

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setManualMode(false); setFormValues({}); }, [awaitingUserInput]);

  const handleSend = useCallback(async (content: MessageContent) => {
    if (!sendToModel) return;
    if (!ready) return;
    await sendMessage(content, '', { noSystemPrompt });
  }, [sendToModel, sendMessage, ready, noSystemPrompt]);

  // Use deferred value to avoid DOM race conditions during streaming
  const deferredMessages = useDeferredValue(messages);
  // Filter out system-injected internal messages, but keep agent internal messages for grouped display
  const visibleMessages = useMemo(
    () => deferredMessages.filter((m) => !(m as any)._internal),
    [deferredMessages],
  );

  return (
    <>
      {/* Conversation header */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-zinc-100 dark:border-zinc-800 shrink-0 relative">
        <div className="flex items-center gap-1.5 min-w-0">
          <MessageCircle size={11} className="text-zinc-400 shrink-0" />
          <span className="text-[11px] text-zinc-500 dark:text-zinc-400 truncate">
            {activeConversation?.title ?? '新对话'}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => newChat()}
            className="p-1 rounded text-zinc-400 hover:text-blue-500 transition-colors"
            title="新建对话"
          >
            <MessageSquarePlus size={12} />
          </button>
          <button
            onClick={() => setShowConvList(!showConvList)}
            className="p-1 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 transition-colors"
            title="历史对话"
          >
            <ChevronDown size={12} className={`transition-transform ${showConvList ? 'rotate-180' : ''}`} />
          </button>
        </div>
        {showConvList && (
          <ConversationDropdown
            onClose={() => setShowConvList(false)}
            onSelect={() => setShowConvList(false)}
          />
        )}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0 scrollbar-hide">
        {visibleMessages.length === 0 && (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-500 text-[13px]">
            {sendToModel ? 'Start a conversation' : 'Type to save locally'}
          </div>
        )}
        {(() => {
          // 将消息分组：连续的 Agent 内部消息分为一组
          const groups: Array<{ type: 'agent' | 'normal'; messages: ChatMessage[] }> = [];
          let currentGroup: ChatMessage[] = [];
          let currentType: 'agent' | 'normal' | null = null;

          for (const msg of visibleMessages) {
            const isAgentInternal = msg._agentInternal || msg._isAgentStart;
            const groupType = isAgentInternal ? 'agent' : 'normal';

            if (groupType !== currentType) {
              if (currentGroup.length > 0) {
                groups.push({ type: currentType!, messages: currentGroup });
              }
              currentGroup = [msg];
              currentType = groupType;
            } else {
              currentGroup.push(msg);
            }
          }
          if (currentGroup.length > 0 && currentType) {
            groups.push({ type: currentType, messages: currentGroup });
          }

          return groups.map((group, groupIdx) => {
            // Agent 内部消息组：折叠展示
            if (group.type === 'agent') {
              return <AgentLogGroup key={`agent-${groupIdx}`} messages={group.messages} />;
            }

            // 普通消息：逐条渲染
            return group.messages.map((msg, i) => {
              const prevMsg = i > 0 ? group.messages[i - 1] : undefined;
              const isStreaming = msg.status === 'streaming';
              const text = typeof msg.content === 'string' ? msg.content : '';
              const bbox = !isStreaming && prevMsg?.role === 'user' ? extractBbox(text) : null;
              const userImage = msg.role === 'assistant' && prevMsg?.role === 'user'
                ? (typeof prevMsg.content !== 'string'
                    ? (prevMsg.content.find((p) => 'type' in p && p.type === 'image_url') as { image_url?: { url: string } } | undefined)?.image_url?.url
                    : null)
                : null;

              return (
                <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : msg.status === 'error'
                      ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
                      : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
                  }`}>
                    {msg.role === 'user' && Array.isArray(msg.content) && (
                      <div className="flex gap-1 mb-1 flex-wrap">
                        {msg.content.filter((p) => 'type' in p && p.type === 'image_url').map((p, i) => (
                          <img key={i} src={(p as { image_url: { url: string } }).image_url.url} alt="" className="max-w-[120px] max-h-[80px] rounded object-cover" />
                        ))}
                      </div>
                    )}
                    {msg.role === 'assistant' && (
                      <>
                        {msg.reasoning_content && <ThinkingBlock content={msg.reasoning_content} streaming={isStreaming} />}
                        {isStreaming
                          ? <StreamingText text={text} isStreaming={isStreaming} />
                          : <MarkdownBody content={text} />
                        }
                      </>
                    )}
                    {msg.role === 'user' && typeof msg.content === 'string' && (
                      <div className="whitespace-pre-wrap break-words">{text}</div>
                    )}
                    {bbox && userImage && <BboxOverlay imageUrl={userImage} bbox={bbox} />}
                    {isStreaming && !text && (
                      <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse rounded-sm" />
                    )}
                  </div>
                </div>
              );
            });
          });
        })()}
        <div ref={chatEndRef} />
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-2 mb-1 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-3 py-2 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      {/* Command confirmation bar */}
      {awaitingConfirmation && (
        <div className="mx-2 mb-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-3 py-2">
          <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200 mb-1">
            请求执行命令
          </p>
          <pre className="text-[10px] font-mono text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 rounded px-2 py-1 whitespace-pre-wrap break-all">
            {awaitingConfirmation.command}
          </pre>
          <div className="flex justify-end gap-1.5 mt-2">
            <button
              onClick={() => rejectToolCall()}
              className="px-2 py-1 text-[11px] font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded hover:bg-zinc-50 dark:hover:bg-zinc-700"
            >
              拒绝
            </button>
            <button
              onClick={() => confirmToolCall()}
              className="px-2 py-1 text-[11px] font-medium text-white bg-amber-600 rounded hover:bg-amber-700"
            >
              允许执行
            </button>
          </div>
        </div>
      )}

      {/* User input form */}
      {awaitingUserInput && (
        <div className="mx-2 mb-1 rounded-lg border border-blue-300 dark:border-blue-700 bg-blue-50 dark:bg-blue-950/50 px-3 py-2">
          <p className="text-[11px] font-medium text-blue-800 dark:text-blue-200 mb-2">
            {awaitingUserInput.message}
          </p>

          {!manualMode ? (
            <>
              {awaitingUserInput.fields.map((field) => (
                <div key={field.key} className="mb-1.5">
                  <label className="block text-[10px] text-blue-700 dark:text-blue-300 mb-0.5">
                    {field.label}
                  </label>
                  <input
                    type={field.type === 'password' ? 'password' : 'text'}
                    value={formValues[field.key] ?? ''}
                    onChange={(e) => setFormValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                    className="w-full px-2 py-1 text-[11px] rounded border border-blue-300 dark:border-blue-600 bg-white dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    placeholder={field.label}
                  />
                </div>
              ))}
              <div className="flex justify-between items-center mt-2">
                <button
                  onClick={() => setManualMode(true)}
                  className="px-2 py-1 text-[11px] font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  我来手动操作
                </button>
                <button
                  onClick={() => { submitUserInput(formValues); setFormValues({}); }}
                  className="px-3 py-1 text-[11px] font-medium text-white bg-blue-600 rounded hover:bg-blue-700"
                >
                  提交
                </button>
              </div>
            </>
          ) : (
            <div className="flex justify-end">
              <button
                onClick={() => { submitUserInput({ __manual: 'true' }); setFormValues({}); setManualMode(false); }}
                className="px-3 py-1 text-[11px] font-medium text-white bg-green-600 rounded hover:bg-green-700"
              >
                已完成，继续执行
              </button>
            </div>
          )}
        </div>
      )}

      <MessageInput
        onSend={handleSend}
        enabled={!isStreaming}
        hintText={sendToModel ? 'Send message...' : 'Type to save locally...'}
        allowImagePaste={allowImagePaste}
        onStop={() => useChatStore.getState().stopChat()}
      />
    </>
  );
});

export default ChatMode;
