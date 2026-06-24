import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Menu, Terminal, Bug, MessageSquarePlus, Trash2, Plus, MessageCircle, ShieldCheck, ShieldX, ChevronDown, ChevronUp, Loader2, CheckCircle, XCircle } from 'lucide-react';
import { useChatStore, ToolMode } from '@/stores/chat-store';
import { useT, formatRelativeTime } from '@/i18n/strings';
import { ChatBubble } from '@/components/chat/chat-bubble';
import { MessageInput } from '@/components/chat/message-input';
import { ModelSwitcher } from '@/components/chat/model-switcher';
import { ToolModeBar } from '@/components/chat/tool-mode-bar';
import { ToolSelectorPanel } from '@/components/chat/tool-selector-panel';
import { useSettingsStore } from '@/stores/settings-store';
import { getBuiltinExecutor, initBuiltinExecutor } from '@/skills/builtin-executor';
import type { MessageContent, ChatMessage } from '@/types/message';

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
    <div className="mx-3 my-2">
      {/* 折叠标题 */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[13px] font-medium transition-colors ${
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
          <span className="text-[11px] opacity-70">
            {successCount}✅ {failCount > 0 && `${failCount}❌`}
          </span>
        )}
        {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {/* 折叠内容 */}
      {expanded && (
        <div className="mt-1 ml-3 pl-3 border-l-2 border-zinc-200 dark:border-zinc-700 space-y-1.5 py-1">
          {agentMessages.filter((m) => !m._isAgentStart).map((msg) => {
            const text = typeof msg.content === 'string' ? msg.content : '';

            // 工具调用信息
            if (msg._toolCallInfo) {
              const info = msg._toolCallInfo;
              return (
                <div key={msg.id} className="flex items-start gap-2 py-0.5">
                  <Terminal size={12} className="mt-0.5 text-zinc-400 shrink-0" />
                  <div className="min-w-0">
                    <span className="text-[12px] font-mono text-zinc-500 dark:text-zinc-400">
                      {info.name}
                    </span>
                    {info.status === 'running' && (
                      <span className="ml-1 text-[11px] text-blue-500">运行中...</span>
                    )}
                  </div>
                </div>
              );
            }

            // 工具结果
            if (msg.role === 'tool') {
              return (
                <div key={msg.id} className="text-[12px] font-mono text-zinc-500 dark:text-zinc-400">
                  {text}
                </div>
              );
            }

            // LLM 思考
            if (msg.role === 'assistant') {
              return (
                <div key={msg.id} className="text-[12px] text-zinc-600 dark:text-zinc-400">
                  {msg.reasoning_content && (
                    <div className="mb-1 text-[11px] text-amber-600 dark:text-amber-400 italic">
                      💭 {msg.reasoning_content.substring(0, 150)}{msg.reasoning_content.length > 150 && '...'}
                    </div>
                  )}
                  {text && <div className="whitespace-pre-wrap">{text.substring(0, 300)}{text.length > 300 && '...'}</div>}
                </div>
              );
            }

            // 其他（轮次信息等）
            return (
              <div key={msg.id} className="text-[12px] text-zinc-400 dark:text-zinc-500">
                {text}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ConversationsPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    conversations,
    activeConversation,
    loadConversations,
    switchConversation,
    deleteConversation,
    newChat,
  } = useChatStore();
  const t = useT();

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  if (!open) return null;

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/50" onClick={onClose} />
      <div className="fixed left-0 top-0 bottom-0 z-50 w-72 bg-white dark:bg-zinc-950 border-r border-zinc-200 dark:border-zinc-800 flex flex-col shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-100 dark:border-zinc-800">
          <span className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">
            {t('chat.conversations')}
          </span>
          <button
            onClick={onClose}
            className="p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
          >
            ✕
          </button>
        </div>

        {/* New Chat button */}
        <button
          onClick={() => {
            newChat();
            onClose();
          }}
          className="flex items-center gap-3 px-4 py-3 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950 text-[14px] font-medium"
        >
          <MessageSquarePlus size={18} />
          {t('chat.newchat')}
        </button>
        <div className="border-t border-zinc-100 dark:border-zinc-800" />

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto">
          {conversations.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-4 text-zinc-400 dark:text-zinc-500">
              <MessageCircle size={40} className="mb-3 opacity-40" />
              <p className="text-[13px] text-center">{t('chat.conversations.empty')}</p>
            </div>
          ) : (
            conversations.map((conv) => {
              const isActive = conv.id === activeConversation?.id;
              return (
                <div
                  key={conv.id}
                  className={`group flex items-center px-4 py-2.5 cursor-pointer transition-colors ${
                    isActive
                      ? 'bg-blue-50 dark:bg-blue-950'
                      : 'hover:bg-zinc-50 dark:hover:bg-zinc-900'
                  }`}
                >
                  <div
                    className="flex-1 min-w-0"
                    onClick={async () => {
                      if (!isActive) {
                        await switchConversation(conv);
                      }
                      onClose();
                    }}
                  >
                    <div
                      className={`text-[13px] truncate ${
                        isActive
                          ? 'font-semibold text-blue-700 dark:text-blue-300'
                          : 'text-zinc-800 dark:text-zinc-200'
                      }`}
                    >
                      {conv.title}
                    </div>
                    <div className="text-[11px] text-zinc-400 dark:text-zinc-500 mt-0.5">
                      {formatRelativeTime(conv.updatedAt)}
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm(t('chat.delete.confirm', { title: conv.title }))) {
                        deleteConversation(conv.id);
                      }
                    }}
                    className="p-1 text-zinc-300 dark:text-zinc-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all"
                    title={t('common.delete')}
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              );
            })
          )}
        </div>

        {/* Footer links */}
        <div className="border-t border-zinc-100 dark:border-zinc-800">
          <Link
            to="/models"
            className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <Plus size={16} />
            {t('nav.models')}
          </Link>
          <Link
            to="/settings"
            className="flex items-center gap-3 px-4 py-2.5 text-[13px] text-zinc-600 dark:text-zinc-400 hover:bg-zinc-50 dark:hover:bg-zinc-900"
          >
            <Plus size={16} />
            {t('nav.settings')}
          </Link>
        </div>
      </div>
    </>
  );
}

function DebugPanel({
  messages,
  open,
}: {
  messages: ReturnType<typeof useChatStore.getState>['debugMessages'];
  open: boolean;
}) {
  const t = useT();

  if (!open || messages.length === 0) return null;

  return (
    <div className="border-t border-zinc-200 dark:border-zinc-700 bg-zinc-50 dark:bg-zinc-900/50">
      <div className="px-3 py-1 text-[11px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase bg-zinc-100 dark:bg-zinc-800/50">
        {t('chat.debug.title')}
      </div>
      <div className="max-h-48 overflow-y-auto px-2 py-1">
        {messages.map((msg) => {
          const isCall = (msg.role as string) === 'tool_call';
          const contentStr =
            typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
          let preview = contentStr.length > 80 ? `${contentStr.substring(0, 80)}...` : contentStr;
          try {
            const json = JSON.parse(contentStr);
            if (json && json['function']) {
              preview = `${json['function']}(${JSON.stringify(json['arguments'])})`;
            }
          } catch {
            /* use raw */
          }

          return (
            <div key={msg.id} className="flex items-start gap-2 py-0.5">
              <span className="text-[10px] mt-0.5 shrink-0">
                {isCall ? '▶' : '◀'}
              </span>
              <span className="text-[10px] font-mono text-zinc-500 dark:text-zinc-400 leading-relaxed break-all">
                {preview}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function ChatPage() {
  const t = useT();
  const {
    activeConversation,
    messages,
    debugMessages,
    isStreaming,
    error,
    toolMode,
    customTools,
    awaitingConfirmation,
    sendMessage,
    clearError,
    setToolMode,
    setCustomTools,
    toggleCustomTool,
    loadConversations,
    confirmToolCall,
    rejectToolCall,
    deleteMessage,
    editMessage,
  } = useChatStore();
  const { favoriteTools, setFavoriteTools } = useSettingsStore();

  const scrollRef = useRef<HTMLDivElement>(null);
  const [showLog, setShowLog] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  const [showConversations, setShowConversations] = useState(false);
  const [executorReady, setExecutorReady] = useState(false);
  const [showSelectorPanel, setShowSelectorPanel] = useState(false);

  // Auto-scroll when messages change
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: 'smooth',
      });
    }
  }, [messages]);

  // Load conversations and init executor on mount
  useEffect(() => {
    loadConversations();
    (async () => {
      try {
        const { useSkillStore } = await import('@/stores/skill-store');
        await useSkillStore.getState().initializeSkills();
        const configs = useSkillStore.getState().allConfigs;
        if (configs.length > 0) {
          await initBuiltinExecutor(configs);
          setExecutorReady(true);
        } else {
          console.warn('[chat] 技能配置为空，executor 未初始化');
        }
      } catch (err) {
        console.error('[chat] executor 初始化失败:', err);
      }
    })();
  }, [loadConversations]);

  const handleSend = useCallback(
    async (content: MessageContent, agentContext?: string) => {
      if (agentContext) {
        // 将 agent 上下文注入到消息前面
        const text = typeof content === 'string' ? content : content;
        if (typeof text === 'string') {
          await sendMessage(`[Agent Context]\n${agentContext}\n\n[User Request]\n${text}`, '');
        } else {
          // Multi-part content: prepend context to the first text part
          const parts = content as Array<{ type: string; text?: string }>;
          const modified = parts.map((p, i) => i === 0 && p.type === 'text' ? { ...p, text: `[Agent Context]\n${agentContext}\n\n[User Request]\n${p.text}` } : p);
          await sendMessage(modified as MessageContent, '');
        }
      } else {
        await sendMessage(content, '');
      }
    },
    [sendMessage],
  );

  const allTools = useMemo(() => executorReady ? getBuiltinExecutor().allTools : [], [executorReady]);

  const handleToolModeChange = useCallback(
    (mode: ToolMode) => {
      setToolMode(mode);
      if (mode === ToolMode.custom) {
        // Sync customTools with current executor: init if empty, prune stale names if not
        const currentTools = getBuiltinExecutor().allTools;
        const currentNames = new Set(currentTools.map((t) => t.name));
        if (customTools.size === 0) {
          setCustomTools(new Set(currentTools.map((t) => t.name)));
        } else {
          // Remove tool names that no longer exist in the executor
          const pruned = new Set([...customTools].filter((n) => currentNames.has(n)));
          if (pruned.size !== customTools.size) setCustomTools(pruned);
        }
        setShowSelectorPanel(true);
      } else {
        // Other modes: close selector panel
        setShowSelectorPanel(false);
      }
    },
    [setToolMode, setCustomTools, customTools.size],
  );

  const handleFavoritesDoubleClick = useCallback(() => {
    setToolMode(ToolMode.favorites);
    setShowSelectorPanel(true);
  }, [setToolMode]);

  const handleDismissError = useCallback(() => {
    clearError();
  }, [clearError]);

  const hasMessages = messages.length > 0;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative">
      {/* Top Bar */}
      <header className="flex items-center gap-2 px-3 h-12 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 shrink-0">
        {/* Mobile: conversations button */}
        <button
          onClick={() => setShowConversations(true)}
          className="lg:hidden p-1.5 text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-800 rounded-lg"
        >
          <Menu size={18} />
        </button>

        {/* Title */}
        <h1 className="flex-1 text-[14px] font-semibold text-zinc-800 dark:text-zinc-200 truncate">
          {activeConversation?.title ?? t('chat.title.new')}
        </h1>

        {/* Log toggle */}
        <button
          onClick={() => setShowLog(!showLog)}
          className={`p-1.5 rounded-lg transition-colors ${
            showLog
              ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
              : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
          }`}
          title="Execution Log"
        >
          <Terminal size={18} />
        </button>

        {/* Debug toggle */}
        {debugMessages.length > 0 && (
          <button
            onClick={() => setShowDebug(!showDebug)}
            className={`p-1.5 rounded-lg transition-colors ${
              showDebug
                ? 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300'
                : 'text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300'
            }`}
            title="Tool Debug Panel"
          >
            <Bug size={18} />
          </button>
        )}

        {/* Model switcher */}
        <ModelSwitcher />

        {/* Desktop: conversations button */}
        <button
          onClick={() => setShowConversations(true)}
          className="hidden lg:block p-1.5 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 rounded-lg"
          title="Conversations"
        >
          <Menu size={18} />
        </button>
      </header>

      {/* Conversations panel */}
      <ConversationsPanel open={showConversations} onClose={() => setShowConversations(false)} />

      {/* Error banner */}
      {error && (
        <div className="flex items-center gap-3 mx-3 mt-2 px-3 py-2 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg text-[13px] text-red-700 dark:text-red-300">
          <span className="flex-1">{error}</span>
          <button onClick={handleDismissError} className="font-medium hover:underline shrink-0">
            {t('common.dismiss')}
          </button>
        </div>
      )}

      {/* Messages area */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        {hasMessages ? (
          <div className="py-2">
            {(() => {
              // 过滤内部消息（截图等），但保留 Agent 内部消息
              const visibleMessages = messages.filter((m) => !(m as any)._internal);

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

                // 普通消息：用 ChatBubble 渲染
                return group.messages.map((msg, i) => {
                  const allIdx = visibleMessages.indexOf(msg);
                  return (
                    <ChatBubble
                      key={msg.id}
                      message={msg}
                      previousMessage={allIdx > 0 ? visibleMessages[allIdx - 1] : undefined}
                      onDelete={deleteMessage}
                      onEdit={editMessage}
                    />
                  );
                });
              });
            })()}
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center h-full text-zinc-400 dark:text-zinc-500 px-4">
            <MessageCircle size={56} className="mb-4 opacity-30" />
            <h2 className="text-lg font-semibold text-zinc-500 dark:text-zinc-400 mb-2">
              {t('chat.empty.title')}
            </h2>
            <p className="text-[13px] text-center max-w-xs whitespace-pre-line leading-relaxed">
              {t('chat.empty.subtitle')}
            </p>
            <Link
              to="/models?new=true"
              className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-full text-[14px] font-medium hover:bg-blue-700 transition-colors"
            >
              <Plus size={16} />
              {t('chat.empty.action')}
            </Link>
          </div>
        )}
      </div>

      {/* Execution log panel */}
      {showLog && (
        <div className="mx-2 mb-1 rounded-lg border border-zinc-200 dark:border-zinc-700 bg-zinc-50/50 dark:bg-zinc-900/50 h-36 overflow-y-auto">
          <div className="px-3 py-1.5 text-[11px] text-zinc-400 dark:text-zinc-500">
            Execution log — messages will appear here after sending
          </div>
        </div>
      )}

      {/* Tool mode bar */}
      <ToolModeBar
        mode={toolMode}
        selectedCount={customTools.size}
        onModeChanged={handleToolModeChange}
        onFavoritesDoubleClick={handleFavoritesDoubleClick}
      />

      {/* Tool selector panel — shown for favorites (double-click) or custom (single-click) */}
      {showSelectorPanel && (toolMode === ToolMode.favorites || toolMode === ToolMode.custom) && (
        <ToolSelectorPanel
          tools={allTools}
          selected={toolMode === ToolMode.favorites ? favoriteTools : customTools}
          setSelected={toolMode === ToolMode.favorites ? setFavoriteTools : setCustomTools}
          onClose={() => setShowSelectorPanel(false)}
        />
      )}

      {/* Command confirmation bar */}
      {awaitingConfirmation && (
        <div className="mx-3 mb-2 rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950/50 px-4 py-3">
          <div className="flex items-start gap-3">
            <ShieldCheck size={20} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-[13px] font-medium text-amber-800 dark:text-amber-200 mb-1">
                请求执行命令
              </p>
              <pre className="text-[12px] font-mono text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/50 rounded px-2 py-1.5 whitespace-pre-wrap break-all overflow-x-auto">
                {awaitingConfirmation.command}
              </pre>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={() => rejectToolCall()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-600 rounded-lg hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors"
            >
              <ShieldX size={14} />
              拒绝
            </button>
            <button
              onClick={() => confirmToolCall()}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[13px] font-medium text-white bg-amber-600 rounded-lg hover:bg-amber-700 transition-colors"
            >
              <ShieldCheck size={14} />
              允许执行
            </button>
          </div>
        </div>
      )}

      {/* Message input */}
      <MessageInput
        enabled={!isStreaming}
        hintText={t('chat.input.hint')}
        onSend={handleSend}
        onStop={() => useChatStore.getState().stopChat()}
      />

      {/* Debug panel */}
      <DebugPanel messages={debugMessages} open={showDebug} />
    </div>
  );
}
