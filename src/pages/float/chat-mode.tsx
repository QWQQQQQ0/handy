import { useRef, useCallback, useEffect, useImperativeHandle, forwardRef, useState, useDeferredValue, useMemo } from 'react';
import { ChevronDown, ChevronUp, MessageSquarePlus, Trash2, Pencil, Check, X, MessageCircle, Terminal, CheckCircle, XCircle, Loader2 } from 'lucide-react';
import { useChatStore, ToolMode } from '@/stores/chat-store';
import { useSettingsStore } from '@/stores/settings-store';
import { extractBbox, BboxOverlay } from '@/components/bbox-overlay';
import { MessageInput } from '@/components/chat/message-input';
import { StreamingText } from '@/components/chat/streaming-text';
import { MarkdownBody } from '@/components/chat/markdown-body';
import { ToolModeBar } from '@/components/chat/tool-mode-bar';
import { ToolSelectorPanel } from '@/components/chat/tool-selector-panel';
import { formatRelativeTime } from '@/i18n/strings';
import type { SkillTool } from '@/skills/skill';
import type { MessageContent, ChatMessage } from '@/types/message';
import type { ToolGroup } from './types';
import { ThinkingBlock } from '@/components/chat/thinking-block';
import { AgentLogGroup } from '@/components/chat/agent-log-group';
import { writeLocal } from './utils';

export interface ChatModeHandle {
  clearMessages: () => void;
}

interface Props {
  sendToModel: boolean;
  allowImagePaste: boolean;
  noSystemPrompt: boolean;
  toolMode: ToolMode;
  customTools: Set<string>;
  groups: ToolGroup[];
  executorReady: boolean;
  onToolModeChange: (mode: ToolMode) => void;
  onCustomToolsChange: (tools: Set<string>) => void;
  onSaveGroup: (name: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onGroupSelect: (groupId: string) => void;
}


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
      className="absolute right-0 top-full mt-1 z-50 w-64 max-h-[320px] overflow-y-auto scrollbar-hide rounded-lg border border-zinc-200 dark:border-zinc-700 bg-white dark:bg-zinc-900 shadow-lg"
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

function FloatMessageBubble({
  message,
  isStreaming,
  text,
  bbox,
  userImage,
  onDelete,
  onEdit,
}: {
  message: ChatMessage;
  isStreaming: boolean;
  text: string;
  bbox: ReturnType<typeof extractBbox>;
  userImage: string | null;
  onDelete: (id: string) => void;
  onEdit: (id: string, content: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  // Only user text messages can be edited
  const canEdit = message.role === 'user' && typeof message.content === 'string' && (message.status === 'done' || message.status === 'error') && !isStreaming;
  const canDelete = message.role === 'user' && (message.status === 'done' || message.status === 'error') && !isStreaming;

  if (editing && typeof message.content === 'string') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] w-full">
          <textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="w-full bg-white dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 border border-blue-400 dark:border-blue-600 rounded-lg px-2.5 py-1.5 text-[12px] leading-relaxed resize-y min-h-[48px] focus:outline-none focus:ring-1 focus:ring-blue-400"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && editValue.trim()) { e.preventDefault(); onEdit(message.id, editValue); setEditing(false); }
              if (e.key === 'Escape') { setEditing(false); }
            }}
          />
          <div className="flex gap-1 mt-1 justify-end">
            <button
              onClick={() => setEditing(false)}
              className="px-2 py-0.5 text-[10px] text-zinc-500 dark:text-zinc-400 bg-zinc-100 dark:bg-zinc-800 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
            >
              取消
            </button>
            <button
              onClick={() => { if (editValue.trim()) { onEdit(message.id, editValue); setEditing(false); } }}
              className="px-2 py-0.5 text-[10px] text-white bg-blue-600 rounded hover:bg-blue-700 transition-colors"
            >
              保存
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={`max-w-[85%] rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
        message.role === 'user'
          ? 'bg-blue-600 text-white'
          : message.status === 'error'
          ? 'bg-red-50 dark:bg-red-950 text-red-600 dark:text-red-400'
          : 'bg-zinc-100 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100'
      }`}>
        {message.role === 'user' && Array.isArray(message.content) && (
          <div className="flex gap-1 mb-1 flex-wrap">
            {message.content.filter((p) => 'type' in p && p.type === 'image_url').map((p, i) => (
              <img key={i} src={(p as { image_url: { url: string } }).image_url.url} alt="" className="max-w-[120px] max-h-[80px] rounded object-cover" />
            ))}
          </div>
        )}
        {message.role === 'assistant' && (
          <>
            {message.reasoning_content && <ThinkingBlock content={message.reasoning_content} streaming={isStreaming} />}
            {isStreaming
              ? <StreamingText text={text} isStreaming={isStreaming} />
              : <MarkdownBody content={text} />
            }
          </>
        )}
        {message.role === 'user' && typeof message.content === 'string' && (
          <div className="whitespace-pre-wrap break-words">{text}</div>
        )}
        {bbox && userImage && <BboxOverlay imageUrl={userImage} bbox={bbox} />}
        {isStreaming && !text && (
          <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse rounded-sm" />
        )}
      </div>
      {(canEdit || canDelete) && (
        <div className={`flex flex-col items-center gap-0.5 self-start mt-1 ml-0.5 transition-opacity ${hovered ? 'opacity-100' : 'opacity-0'}`}>
          {canEdit && (
            <button
              onClick={() => { setEditValue(typeof message.content === 'string' ? message.content : ''); setEditing(true); }}
              className="p-0.5 rounded hover:bg-zinc-200 dark:hover:bg-zinc-700 transition-colors"
              title="编辑"
            >
              <Pencil size={11} className="text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300" />
            </button>
          )}
          {canDelete && (
            <button
              onClick={() => onDelete(message.id)}
              className="p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 transition-colors"
              title="删除"
            >
              <Trash2 size={11} className="text-zinc-400 hover:text-red-500" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}

const ChatMode = forwardRef<ChatModeHandle, Props>(function ChatMode({
  sendToModel, allowImagePaste, noSystemPrompt,
  toolMode, customTools, groups,
  onToolModeChange, onCustomToolsChange, onSaveGroup, onDeleteGroup, onGroupSelect,
  executorReady,
}, ref) {
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
    deleteMessage,
    editMessage,
  } = useChatStore();

  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [manualMode, setManualMode] = useState(false);
  const [allTools, setAllTools] = useState<SkillTool[]>([]);
  const [showSelectorPanel, setShowSelectorPanel] = useState(false);
  // @ 长效保持：一次选择后持续生效，存 Zustand（同 session 跨窗口持久）
  const stickyAgent = useChatStore((s) => s.stickyAgent);
  const setStickyAgent = useChatStore((s) => s.setStickyAgent);
  const stickyAgentRef = useRef(stickyAgent);
  stickyAgentRef.current = stickyAgent;
  const [selectedNow, setSelectedNow] = useState(false);
  // 追踪最新 toolMode/customTools，避免闭包读到旧值
  const toolModeRef = useRef(toolMode);
  toolModeRef.current = toolMode;
  const customToolsRef = useRef(customTools);
  customToolsRef.current = customTools;

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
      // 加载工具列表（用于选择面板）
      const { getBuiltinExecutor } = await import('@/skills/builtin-executor');
      const exec = getBuiltinExecutor();
      if (exec?.allTools && exec.allTools.length > 0) setAllTools(exec.allTools);
      setReady(true);
    })();
  }, [executorReady]);

  useImperativeHandle(ref, () => ({
    clearMessages: () => newChat(),
  }));

  // 跨 WebView 同步 @ 长效状态
  useEffect(() => {
    const syncSticky = (e: StorageEvent) => {
      const convId = useChatStore.getState().activeConversation?.id;
      if (convId && e.key === `openpaw_sticky_agent:${convId}`) {
        try {
          const raw = localStorage.getItem(e.key);
          setStickyAgent(raw ? JSON.parse(raw) : null);
        } catch { setStickyAgent(null); }
      }
    };
    window.addEventListener('storage', syncSticky);
    return () => window.removeEventListener('storage', syncSticky);
  }, []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);
  useEffect(() => { setManualMode(false); setFormValues({}); }, [awaitingUserInput]);

  // 同步浮窗 toolMode 到 store，确保 sendMessage / editMessage 使用正确的工具筛选
  const syncToolMode = useCallback(() => {
    useChatStore.getState().setToolMode(toolModeRef.current);
    useChatStore.getState().setCustomTools(customToolsRef.current);
  }, []);

  const handleSend = useCallback(async (content: MessageContent, agentContext?: string) => {
    if (!sendToModel) {
      const newMsg = {
        id: crypto.randomUUID(),
        conversationId: activeConversation?.id ?? '',
        role: 'user' as const,
        content,
        timestamp: new Date().toISOString(),
        status: 'done' as const,
      };
      useChatStore.setState((s) => ({ messages: [...s.messages, newMsg] }));
      return;
    }
    if (!ready) return;
    syncToolMode();
    // 长效上下文：优先当即 @ 选择 → Zustand store（sendMessage 内会持久化到 localStorage）
    const storedContext = stickyAgentRef.current?.context;
    const effectiveContext = agentContext || storedContext;
    // ── 集中 @ 解析 ──
    const { resolveAgentMention } = await import('@/services/agent-mention-resolver');
    const resolved = effectiveContext ? await resolveAgentMention(effectiveContext) : null;
    const text = typeof content === 'string' ? content : '';

    if (resolved) {
      // @ 选中 → 绕过用户工具选择，按 agent 类型走各自工具集
      if (resolved.useFreeAgent) {
        // 知识型 skill → FreeAgent
        await sendMessage(text, '', { systemExtra: resolved.systemExtra, useFreeAgent: true, agentContext: effectiveContext });
      } else if (resolved.textPrefix) {
        // custom_agent (@code, @web, @document, @computeruse) → 传 agentName 给后端路由
        const agentName = effectiveContext!.startsWith('custom_agent:') ? effectiveContext!.slice(13) : '';
        await sendMessage(text, '', { agentName, noSystemPrompt, agentContext: effectiveContext });
      } else if (resolved.systemExtra) {
        // App agent 页面能力上下文
        await sendMessage(text, '', { systemExtra: resolved.systemExtra, agentName: 'app', agentContext: effectiveContext });
      } else {
        await sendMessage(text, '', { noSystemPrompt, agentContext: effectiveContext });
      }
      return;
    }

    // 无 @ agent → basic 模式显式走 FreeAgent，其余走普通 Chat LLM
    const currentToolMode = toolModeRef.current;
    if (currentToolMode === ToolMode.basic) {
      await sendMessage(text, '', { useFreeAgent: true, noSystemPrompt });
    } else {
      await sendMessage(content, '', { noSystemPrompt });
    }
  }, [sendToModel, sendMessage, ready, noSystemPrompt, syncToolMode, activeConversation?.id]);

  // 包装 editMessage：编辑后自动重发，需先同步 toolMode
  const handleEditMessage = useCallback((messageId: string, newContent: string) => {
    syncToolMode();
    editMessage(messageId, newContent);
  }, [syncToolMode, editMessage]);

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
                <FloatMessageBubble
                  key={msg.id}
                  message={msg}
                  isStreaming={!!isStreaming}
                  text={text}
                  bbox={bbox}
                  userImage={userImage}
                  onDelete={deleteMessage}
                  onEdit={handleEditMessage}
                />
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

      {/* Tool selector panel (favorites/custom mode) */}
      {showSelectorPanel && (toolMode === ToolMode.favorites || toolMode === ToolMode.custom) && allTools.length > 0 && (
        <ToolSelectorPanel
          tools={allTools}
          selected={toolMode === ToolMode.favorites ? useSettingsStore.getState().favoriteTools : customTools}
          setSelected={toolMode === ToolMode.favorites ? useSettingsStore.getState().setFavoriteTools : onCustomToolsChange}
          onClose={() => setShowSelectorPanel(false)}
          compact={true}
          onSaveGroup={toolMode === ToolMode.custom ? onSaveGroup : undefined}
        />
      )}

      {/* Tool mode bar (compact) — @ 选中或长保持时隐藏 */}
      {!stickyAgent && !selectedNow && <ToolModeBar
        mode={toolMode}
        selectedCount={customTools.size}
        onModeChanged={(m) => {
          onToolModeChange(m);
          if (m === ToolMode.custom || m === ToolMode.favorites) {
            setShowSelectorPanel(true);
          } else {
            setShowSelectorPanel(false);
          }
        }}
        onFavoritesDoubleClick={() => {
          onToolModeChange(ToolMode.favorites);
          writeLocal('float_tool_mode', ToolMode.favorites);
          setShowSelectorPanel(true);
        }}
        compact={true}
        groups={groups}
        onGroupSelect={(groupId) => {
          const group = groups.find(g => g.id === groupId);
          if (group) {
            onCustomToolsChange(new Set(group.tools));
            onToolModeChange(ToolMode.custom);
            writeLocal('float_custom_tools', [...group.tools]);
            writeLocal('float_tool_mode', ToolMode.custom);
            setShowSelectorPanel(true);
          }
        }}
        onDeleteGroup={onDeleteGroup}
      />}

      <MessageInput
        onSend={handleSend}
        enabled={!isStreaming}
        hintText={sendToModel ? 'Send message...' : 'Type to save locally...'}
        allowImagePaste={allowImagePaste}
        allowFileUpload
        compact
        onAgentSelect={(name) => setSelectedNow(name !== null)}
        stickyAgent={stickyAgent}
        onClearStickyAgent={() => { setStickyAgent(null); setSelectedNow(false); }}
        onStop={() => useChatStore.getState().stopChat()}
      />
    </>
  );
});

export default ChatMode;
