// 来源: lib/providers/chat_provider.dart

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ChatMessage, MessageContent, LLMMessage } from '@/types/message';
import type { ConversationRow } from '@/db';
import { getDB } from '@/db';
import type { SQLiteAdapter } from '@/db/adapter';
import { serializeContent, deserializeContent, hasImages, truncateToolResult } from '@/utils/content';
import { resolveMultimodalProvider } from '@/utils/multimodal-provider';
import { isMobile } from '@/utils/platform';
import { useModelConfigStore } from './model-config-store';
import { useSettingsStore } from './settings-store';
import { AgentEndpoint } from '@/api/types';

// Chat 基础工具 —— 只保留系统配置工具，业务工具通过 request_agent 路由到各 agent
const DESKTOP_CHAT_TOOLS = new Set([
  'web_search', 'web_fetch',
  'agent_memory_update',
  'search_chat_history',
  'recall_memory',
  // System config tools
  'list_skills', 'toggle_skill',
  'list_models', 'switch_model', 'add_model', 'update_model',
  'get_settings', 'update_settings',
  'list_watchers',
  'get_agent_log',
]);

const MOBILE_CHAT_TOOLS = new Set([
  'web_search', 'web_fetch',
  'agent_memory_update',
  'search_chat_history',
  'recall_memory',
  // System config tools
  'list_skills', 'toggle_skill',
  'list_models', 'switch_model', 'add_model', 'update_model',
  'get_settings', 'update_settings',
  'list_watchers',
  'get_agent_log',
]);

function getChatBasicTools(): Set<string> {
  return isMobile() ? MOBILE_CHAT_TOOLS : DESKTOP_CHAT_TOOLS;
}

// Agent 专属工具集（@ 选中时绕过用户 toolMode，直接用 agent 自己的工具）
const AGENT_TOOL_FILTERS: Record<string, Set<string>> = {
  code: new Set([
    'read_file', 'write_file', 'glob_files', 'grep_files',
    'generate_code', 'generate_project', 'execute_code',
    'save_code', 'list_code', 'save_app', 'save_project',
    'run_command', 'web_search', 'web_fetch',
  ]),
  web: new Set([
    'web_search', 'web_fetch',
    'web_launch', 'web_navigate', 'web_get_interactive',
    'web_click', 'web_fill', 'web_scroll', 'web_close',
    'run_playwright_script',
    'think', 'request_user_input', 'web_done', 'finalize',
  ]),
  document: new Set([
    'office_detect', 'com_read', 'com_edit', 'generate_doc', 'doc_code_exec',
    'generate_word', 'generate_excel', 'generate_ppt',
    'word_com_read', 'word_com_edit', 'excel_com_read', 'excel_com_edit',
    'ppt_com_read', 'ppt_com_edit',
    'read_file', 'glob_files', 'write_file',
    'think', 'request_user_input', 'doc_done', 'finalize',
  ]),
  computeruse: new Set([
    'desktop_screenshot', 'screenshot_window', 'screenshot_window_region',
    'desktop_click', 'desktop_double_click', 'desktop_right_click',
    'desktop_move_cursor', 'desktop_drag', 'desktop_scroll',
    'desktop_type_text', 'desktop_press_key', 'desktop_key_down', 'desktop_key_up',
    'desktop_list_windows', 'desktop_focus_window', 'desktop_resize_window',
    'desktop_maximize_window', 'desktop_minimize_window', 'desktop_close_window',
    'desktop_open_app', 'desktop_find_app',
    'desktop_get_clipboard', 'desktop_set_clipboard',
    'uia_get_interactive', 'uia_click', 'uia_type_text', 'uia_find_element',
    'uia_fingerprint', 'uia_find_element_at_point', 'uia_get_property',
    'read_file', 'write_file', 'run_command',
    'think', 'request_user_input', 'finalize',
  ]),
  // app agent: 不限制工具，由页面能力上下文驱动
  app: DESKTOP_CHAT_TOOLS,
};

function getAgentToolFilter(agentName: string): Set<string> {
  return AGENT_TOOL_FILTERS[agentName] ?? getChatBasicTools();
}

// @agent → 后端 API 路由映射
const AGENT_ENDPOINTS: Record<string, AgentEndpoint> = {
  code: AgentEndpoint.codeAgent,
  web: AgentEndpoint.webAgent,
  document: AgentEndpoint.docAgent,
  computeruse: AgentEndpoint.desktopAutomation,
};

function getAgentEndpoint(agentName: string): AgentEndpoint | undefined {
  return AGENT_ENDPOINTS[agentName];
}

// ---------------------------------------------------------------------------
// Tool classification — lightweight LLM call to select relevant tools
// ---------------------------------------------------------------------------

export enum ToolMode {
  basic = 'basic',
  all = 'all',
  none = 'none',
  favorites = 'favorites',
  custom = 'custom',
}

export interface Conversation {
  id: string;
  title: string;
  modelProviderId: string;
  createdAt: string;
  updatedAt: string;
}

function rowToConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    title: row.title,
    modelProviderId: row.model_provider_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// 消息历史限制：避免内存无限增长
const MAX_MESSAGES = 200;  // 最多保留 200 条消息（提升以适应 agent 多轮交互）
const MAX_IMAGE_AGE = 10;  // 超过 10 条消息的图片会被清理

interface ChatState {
  activeConversation: Conversation | null;
  conversations: Conversation[];
  messages: ChatMessage[];
  debugMessages: ChatMessage[];
  isStreaming: boolean;
  streamingConversationId: string | null;  // 正在 streaming 的会话 ID
  _abortController: AbortController | null;
  error: string | null;
  toolMode: ToolMode;
  customTools: Set<string>;
  // @ 长效保持（跨窗口持久）
  stickyAgent: { context: string; label: string } | null;
  setStickyAgent: (agent: { context: string; label: string } | null) => void;

  // Tool confirmation state
  awaitingConfirmation?: {
    toolName: string;
    args: Record<string, unknown>;
    command: string;
  };
  // User input form state
  awaitingUserInput?: {
    message: string;
    fields: Array<{ label: string; key: string; type?: string }>;
  };
  /** @internal generator reference for resuming after confirmation */
  _pendingGenerator?: AsyncGenerator<import('@/services/chat-service').ChatStateUpdate>;
  _pendingResolve?: (value: { confirmed: boolean }) => void;
  _pendingInputResolve?: (value: Record<string, string>) => void;

  // Actions — basic
  loadConversations: () => Promise<void>;
  createConversation: (modelProviderId: string, title: string) => Promise<Conversation>;
  loadMessages: (conversationId: string) => Promise<void>;
  deleteConversation: (id: string) => Promise<void>;
  newChat: () => void;
  switchConversation: (conv: Conversation) => Promise<void>;
  setToolMode: (mode: ToolMode) => void;
  setCustomTools: (tools: Set<string>) => void;
  toggleCustomTool: (toolName: string) => void;
  clearError: () => void;

  // Actions — message manipulation
  deleteMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;

  // Actions — streaming
  sendMessage: (content: MessageContent, password?: string, options?: { noSystemPrompt?: boolean; skipAddUserMessage?: boolean; systemExtra?: string; useFreeAgent?: boolean; agentName?: string; agentContext?: string }) => Promise<void>;
  stopChat: () => void;
  confirmToolCall: () => Promise<void>;
  rejectToolCall: () => Promise<void>;
  submitUserInput: (values: Record<string, string>) => Promise<void>;
}

export const useChatStore = create<ChatState>()(
  immer((set, get) => ({
    activeConversation: null,
    conversations: [],
    messages: [],
    debugMessages: [],
    isStreaming: false,
    streamingConversationId: null,
    _abortController: null,
    error: null,
    toolMode: ToolMode.all,
    customTools: new Set(),
    stickyAgent: null,
    setStickyAgent: (agent) => {
      const convId = get().activeConversation?.id;
      if (convId) {
        try {
          if (agent) {
            localStorage.setItem(`openpaw_sticky_agent:${convId}`, JSON.stringify(agent));
          } else {
            localStorage.removeItem(`openpaw_sticky_agent:${convId}`);
          }
        } catch { /* localStorage 不可用时忽略 */ }
      }
      set({ stickyAgent: agent });
    },

    loadConversations: async () => {
      const db = await getDB();
      const rows = await db.query<ConversationRow>(
        'SELECT * FROM conversations ORDER BY updated_at DESC'
      );
      set({ conversations: rows.map(rowToConversation) });
    },

    createConversation: async (modelProviderId, title) => {
      const db = await getDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        `INSERT INTO conversations (id, title, model_provider_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
        [id, title, modelProviderId, now, now]
      );
      const conv: Conversation = { id, title, modelProviderId, createdAt: now, updatedAt: now };
      set((s) => { s.conversations.unshift(conv); });
      return conv;
    },

    loadMessages: async (conversationId) => {
      const db = await getDB();
      const rows = await db.query<{
        id: string; conversation_id: string; role: string; content: string;
        timestamp: string; reasoning_content: string | null;
        tool_calls: string | null; tool_call_id: string | null;
        agent_internal: number | null; agent_type: string | null;
      }>(
        'SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC',
        [conversationId]
      );
      const messages = rows.map((r) => {
        const msg: ChatMessage = {
          id: r.id,
          conversationId: r.conversation_id,
          role: r.role as ChatMessage['role'],
          content: deserializeContent(r.content),
          timestamp: r.timestamp,
          status: 'done' as const,
          reasoning_content: r.reasoning_content || undefined,
          _agentInternal: r.agent_internal === 1 || undefined,
          _agentType: r.agent_type || undefined,
        };
        if (r.tool_calls) {
          try { msg.toolCalls = JSON.parse(r.tool_calls); } catch { /* ignore */ }
        }
        if (r.tool_call_id) {
          msg.toolCallId = r.tool_call_id;
        }
        return msg;
      });
      set({ messages });
    },

    deleteConversation: async (id) => {
      const db = await getDB();
      await db.execute('DELETE FROM messages WHERE conversation_id = ?', [id]);
      await db.execute('DELETE FROM conversations WHERE id = ?', [id]);
      const wasActive = get().activeConversation?.id === id;
      if (wasActive) {
        // 清理当前对话全部状态（与 newChat 对齐）
        set({ activeConversation: null, messages: [], debugMessages: [], error: null, stickyAgent: null });
        // 清理该对话的 localStorage
        try { localStorage.removeItem(`openpaw_sticky_agent:${id}`); } catch { /* ignore */ }
      }
      await get().loadConversations();
      // 删除当前对话后自动切到下一个，避免卡在空状态
      if (wasActive) {
        const remaining = get().conversations;
        if (remaining.length > 0) {
          await get().switchConversation(remaining[0]);
        }
      }
    },

    newChat: () => {
      set({ activeConversation: null, messages: [], debugMessages: [], error: null, stickyAgent: null });
    },

    switchConversation: async (conv) => {
      // 切换对话时恢复该对话的 @ 状态
      let restored: { context: string; label: string } | null = null;
      try {
        const r = localStorage.getItem(`openpaw_sticky_agent:${conv.id}`);
        if (r) restored = JSON.parse(r);
      } catch { /* ignore */ }
      set({ activeConversation: conv, error: null, stickyAgent: restored });
      await get().loadMessages(conv.id);
    },

    setToolMode: (mode) => set({ toolMode: mode }),
    setCustomTools: (tools) => set({ toolMode: ToolMode.custom, customTools: tools }),
    toggleCustomTool: (toolName) => set((state) => {
      const next = new Set(state.customTools);
      if (next.has(toolName)) next.delete(toolName);
      else next.add(toolName);
      return { customTools: next };
    }),
    clearError: () => set({ error: null }),

    deleteMessage: async (messageId: string) => {
      if (get().isStreaming) return;
      const msgs = get().messages;
      const targetIdx = msgs.findIndex((m) => m.id === messageId);
      if (targetIdx < 0) return;

      // Collect IDs to delete: the message itself + consecutive assistant/tool messages after it
      const idsToDelete = new Set<string>();
      idsToDelete.add(messageId);

      // If deleting a user message, also delete the following assistant reply chain
      if (msgs[targetIdx].role === 'user') {
        for (let i = targetIdx + 1; i < msgs.length; i++) {
          const m = msgs[i];
          if (m.role === 'user') break; // Stop at next user message
          idsToDelete.add(m.id);
        }
      }

      // Remove from memory
      set((s) => { s.messages = s.messages.filter((m) => !idsToDelete.has(m.id)); });
      // Remove from DB
      try {
        const db = await getDB();
        const placeholders = Array.from(idsToDelete).map(() => '?').join(',');
        await db.execute(`DELETE FROM messages WHERE id IN (${placeholders})`, Array.from(idsToDelete));
      } catch (e) {
        console.error('[chat-store] deleteMessage DB error:', e);
      }
    },

    editMessage: async (messageId: string, newContent: string) => {
      if (get().isStreaming) return;
      const msgs = get().messages;
      const targetIdx = msgs.findIndex((m) => m.id === messageId);
      if (targetIdx < 0) return;

      // Collect IDs of all subsequent messages (to delete)
      const subsequentIds = msgs.slice(targetIdx + 1).map((m) => m.id);

      // Update the edited message + remove subsequent messages from memory
      set((s) => {
        s.messages = s.messages
          .map((m) => m.id === messageId ? { ...m, content: newContent } : m)
          .filter((m) => m.id === messageId || !subsequentIds.includes(m.id));
      });

      // Sync to DB: update edited message + delete subsequent
      try {
        const db = await getDB();
        await db.execute('UPDATE messages SET content = ? WHERE id = ?', [newContent, messageId]);
        if (subsequentIds.length > 0) {
          const placeholders = subsequentIds.map(() => '?').join(',');
          await db.execute(`DELETE FROM messages WHERE id IN (${placeholders})`, subsequentIds);
        }
      } catch (e) {
        console.error('[chat-store] editMessage DB error:', e);
      }

      // 编辑后自动重发请求（跳过添加用户消息，已编辑的消息就是当前消息）
      // sendMessage 内部读取当前 toolMode 决定工具集
      get().sendMessage(newContent, undefined, { skipAddUserMessage: true });
    },

    confirmToolCall: async () => {
      const resolve = get()._pendingResolve;
      if (resolve) {
        set((s) => {
          s.awaitingConfirmation = undefined;
          s._pendingResolve = undefined;
        });
        resolve({ confirmed: true });
      }
    },

    rejectToolCall: async () => {
      const resolve = get()._pendingResolve;
      if (resolve) {
        set((s) => {
          s.awaitingConfirmation = undefined;
          s._pendingResolve = undefined;
        });
        resolve({ confirmed: false });
      }
    },

    submitUserInput: async (values: Record<string, string>) => {
      const resolve = get()._pendingInputResolve;
      if (resolve) {
        set((s) => {
          s.awaitingUserInput = undefined;
          s._pendingInputResolve = undefined;
        });
        resolve(values);
      }
    },

    // ── DB write helper — persists a ChatMessage with all columns ──
    _saveMsgToDb: async (msg: ChatMessage, db: SQLiteAdapter) => {
      const serContent = typeof msg.content === 'string' ? msg.content : serializeContent(msg.content);
      await db.execute(
        `INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, tool_call_id, agent_internal, agent_type)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          msg.id, msg.conversationId, msg.role, serContent, msg.timestamp,
          msg.reasoning_content || null,
          msg.toolCalls ? JSON.stringify(msg.toolCalls) : null,
          msg.toolCallId || null,
          msg._agentInternal ? 1 : 0,
          msg._agentType || '',
        ],
      );
    },

    sendMessage: async (content, password, options) => {
      console.log('[chat-store] sendMessage options:', options);
      const noSystemPrompt = options?.noSystemPrompt ?? false;
      const skipAddUserMessage = options?.skipAddUserMessage ?? false;
      const systemExtra = options?.systemExtra;
      const state = get();
      // 按会话检查：只有同一个会话在 streaming 时才阻塞
      if (state.isStreaming && state.streamingConversationId === state.activeConversation?.id) return;

      const abortController = new AbortController();
      set({ isStreaming: true, streamingConversationId: state.activeConversation?.id ?? null, _abortController: abortController, error: null, debugMessages: [] });

      // 内存优化：清理旧消息中的图片，避免内存无限增长
      set((s) => {
        const msgs = s.messages;
        if (msgs.length > MAX_MESSAGES) {
          // 智能裁剪：优先删除 _agentInternal 内部消息，保留用户对话和结果
          const nonInternal = msgs.filter(m => !m._agentInternal);
          const internal = msgs.filter(m => m._agentInternal);
          const excess = msgs.length - MAX_MESSAGES;
          if (excess > 0) {
            // 先删最旧的内部消息
            const keepInternal = internal.slice(Math.min(excess, internal.length));
            const keepNonInternal = nonInternal.length > MAX_MESSAGES
              ? nonInternal.slice(-MAX_MESSAGES) // 如果非内部消息本身超限，只保留最新的
              : nonInternal;
            s.messages = [...keepInternal, ...keepNonInternal].sort(
              (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
            );
          }
        }
        // 清理旧消息中的图片（保留最近 MAX_IMAGE_AGE 条消息的图片）
        const cutoff = s.messages.length - MAX_IMAGE_AGE;
        s.messages = s.messages.map((m, i) => {
          if (i < cutoff && Array.isArray(m.content)) {
            // 将旧消息的图片替换为占位符
            const hasImg = m.content.some(p => 'type' in p && p.type === 'image_url');
            if (hasImg) {
              return {
                ...m,
                content: m.content.map(p =>
                  'type' in p && p.type === 'image_url'
                    ? { type: 'text' as const, text: '[图片已清理]' }
                    : p
                ),
              };
            }
          }
          return m;
        });
      });

      try {
        const modelStore = useModelConfigStore.getState();
        const settingsStore = useSettingsStore.getState();

        let provider = modelStore.defaultConfig();
        if (!provider) {
          set({ error: 'No model configured. Please add a model provider first.', isStreaming: false, streamingConversationId: null, _abortController: null });
          return;
        }

        // 多模态自动切换：如果消息包含图片但当前模型不支持多模态，自动切换
        if (hasImages(content) && provider.supportsMultimodal === false) {
          const { provider: resolved, switched } = resolveMultimodalProvider(provider, modelStore.providers, content);
          if (switched) provider = resolved;
        }

        const apiKey = await modelStore.getApiKey(provider.id, password);

        console.log('[ChatStore] 🚀 provider config:', {
          type: provider.type, model: provider.model, baseUrl: provider.baseUrl,
          thinkingMode: provider.thinkingMode, supportsTools: provider.supportsTools,
        });

        // Get or create conversation
        let conversationId: string;
        let currentConv = state.activeConversation;

        if (!currentConv) {
          const text = typeof content === 'string' ? content : content
            .filter(p => p.type === 'text')
            .map(p => p.type === 'text' ? p.text : '')
            .join(' ');
          const title = text.length > 50 ? text.substring(0, 50) + '...' : text;
          currentConv = await get().createConversation(provider.id, title);
          set({ activeConversation: currentConv });
        }
        conversationId = currentConv.id;

        // @ 长效保持：对话创建后再持久化（新建对话时 activeConversation 之前为 null）
        if (options?.agentContext) {
          const ctx = options.agentContext;
          const label = ctx.startsWith('knowledge_source:') ? ctx.slice(17)
            : ctx.startsWith('knowledge_skill:') ? ctx.slice(16)
            : ctx.startsWith('custom_agent:') ? ctx.slice(13)
            : ctx.replace(/^Agent\s+"(.+)".*/s, '$1');
          try {
            localStorage.setItem(`openpaw_sticky_agent:${conversationId}`, JSON.stringify({ context: ctx, label }));
          } catch { /* ignore */ }
          set({ stickyAgent: { context: ctx, label } });
        }

        const db = await getDB();
        // Save user message to DB (编辑重发时跳过，消息已在 state + DB 中)
        if (!skipAddUserMessage) {
          const userMsgId = crypto.randomUUID();
          const serContent = serializeContent(content);
          await db.execute(
            'INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, 0, \'\')',
            [userMsgId, conversationId, 'user', serContent, new Date().toISOString()]
          );
          await db.execute(
            'UPDATE conversations SET updated_at = ? WHERE id = ?',
            [new Date().toISOString(), conversationId]
          );

          // Load existing messages
          await get().loadMessages(conversationId);
        }

        // 记录 DB 中已有的消息 ID，防止后续持久化时 UNIQUE 冲突
        const existingMsgIds = new Set(get().messages.map(m => m.id));

        // Load skills from DB first (DB is the single source of truth)
        const { useSkillStore } = await import('@/stores/skill-store');
        const skillStore = useSkillStore.getState();
        await skillStore.initializeSkills();

        // Build SkillExecutor with DB configs for built-in skills
        const { initBuiltinExecutor, setCodeToolsModelService } = await import('@/skills/builtin-executor');
        const dbConfigs = skillStore.allConfigs.filter((c) => c.builtin);
        const executor = await initBuiltinExecutor(dbConfigs);
        executor.disabledTools = settingsStore.disabledTools;

        // Configure CodeToolsSkill with ModelService for unified LLM access
        const { getModelService } = await import('@/services/model-service-singleton');
        setCodeToolsModelService(getModelService(), provider, apiKey);

        // Register user-defined skills from DB (skip skills not exposed to AI)
        for (const skill of skillStore.getUserSkillInstances()) {
          if (skill.config.exposedToAI === false) continue;
          skill.setExecutor(executor);
          executor.register(skill);
        }

        const userText = typeof content === 'string'
          ? content
          : content.filter((p) => p.type === 'text').map((p) => p.text).join(' ');

        // ── 判断是否使用 FreeAgent（基础工具模式 或 知识技能 @ 选择时） ──
        const toolModeForCheck = get().toolMode;
        const shouldUseFreeAgent = options?.useFreeAgent
          || (!options?.agentName && toolModeForCheck === ToolMode.basic);

        console.log('[ChatStore] FreeAgent decision:', {
          toolMode: toolModeForCheck,
          optionsUseFreeAgent: options?.useFreeAgent,
          optionsAgentName: options?.agentName,
          shouldUseFreeAgent,
        });

        if (shouldUseFreeAgent) {
          try {
            // FreeAgent：使用专属系统提示词 + 全工具开放（通过 ToolDisclosure 渐进式披露）
            const { FreeAgentGateway } = await import('@/services/free-agent');

            const gateway = new FreeAgentGateway(executor);
            const sysExtra = options?.systemExtra || '';

            const assistantMsgId = crypto.randomUUID();
            let fullText = '';

            // 构建对话历史（排除最后一条 user 消息，它会作为 goal 参数单独传入 runAgent）
            // 注意：必须在 assistant 占位消息 push 之前构建，否则最后一条消息是 assistant 而非 user
            const allMsgs = get().messages.filter((m) => m.role !== 'system').filter((m) => !m._agentInternal);
            const historyWithoutLast = allMsgs.length > 0 && allMsgs[allMsgs.length - 1].role === 'user'
              ? allMsgs.slice(0, -1)
              : allMsgs;
            const chatMessages: LLMMessage[] = historyWithoutLast.map((m): LLMMessage => {
              const msgContent: string | { type: string; [k: string]: unknown }[] =
                typeof m.content === 'string' ? m.content
                : Array.isArray(m.content) ? m.content as { type: string; [k: string]: unknown }[]
                : '';
              const base: LLMMessage = {
                role: m.role,
                content: msgContent,
              };
              if (m.role === 'assistant' && m.toolCalls) {
                base.toolCalls = m.toolCalls;
              }
              if (m.role === 'tool' && m.toolCallId) {
                base.toolCallId = m.toolCallId;
              }
              return base;
            });
            console.log(`[ChatStore] FreeAgent chatMessages: ${chatMessages.length} 条历史消息`);

            // 先推占位 assistant 消息，流式过程中实时更新
            set((s) => {
              s.messages.push({
                id: assistantMsgId,
                role: 'assistant',
                content: '',
                status: 'streaming',
                timestamp: new Date().toISOString(),
                toolCalls: [],
              });
            });

            const result = await gateway.handleUserGoal({
              goal: userText,
              provider,
              apiKey,
              password,
              signal: abortController.signal,
              maxTurns: 30,
              customSystemPrompt: sysExtra,
              chatMessages,
              onProgress: async (ev) => {
                // 注意：所有 Handler 必须用 find 定位 assistant 消息，因为 tool_end
                // 会将 tool 消息 push 到数组末尾，不能用 msgs[msgs.length - 1]
                if (ev.type === 'stream_chunk') {
                  fullText += ev.text;
                  set((s) => {
                    const msg = s.messages.find((m) => m.id === assistantMsgId);
                    if (msg) {
                      msg.content = fullText;
                      if (ev.reasoning) msg.reasoning_content = ev.reasoning;
                    }
                  });
                } else if (ev.type === 'llm_thinking') {
                  set((s) => {
                    const msg = s.messages.find((m) => m.id === assistantMsgId);
                    if (msg) {
                      // stream_chunk 已用 fullText 增量更新内容，这里只补 reasoning
                      if (ev.reasoning) msg.reasoning_content = ev.reasoning;
                      // 如果流式过程中没有 stream_chunk（纯 reasoning 场景），用 ev.text 兜底
                      if (!msg.content && ev.text && ev.text.trim()) {
                        msg.content = ev.text;
                      }
                    }
                  });
                } else if (ev.type === 'tool_start') {
                  const toolCall: ToolCallEntry = {
                    id: `${ev.name}-${ev.turn}`,
                    type: 'function',
                    function: { name: ev.name, arguments: JSON.stringify(ev.args) },
                  };
                  set((s) => {
                    const msg = s.messages.find((m) => m.id === assistantMsgId);
                    if (msg) {
                      msg.toolCalls = [...(msg.toolCalls || []), toolCall];
                      // finalize / *_done 工具的 summary 作为显示文本
                      if (['finalize', 'desktop_done', 'web_done', 'doc_done', 'code_done'].includes(ev.name)) {
                        const summary = ev.args?.summary || ev.args?.message;
                        if (summary && typeof summary === 'string' && !msg.content) {
                          msg.content = summary;
                        }
                      }
                    }
                  });
                } else if (ev.type === 'tool_end') {
                  const toolMsgId = crypto.randomUUID();
                  const toolCallId = `${ev.name}-${ev.turn}`;
                  set((s) => {
                    s.messages.push({
                      id: toolMsgId,
                      role: 'tool',
                      content: ev.message || '',
                      timestamp: new Date().toISOString(),
                      toolCallId,
                    });
                  });
                  // 持久化 tool 消息到 DB（避免下次 loadMessages 时丢失）
                  const toolContent = typeof ev.message === 'string' ? ev.message : (ev.message ? JSON.stringify(ev.message) : '');
                  await db.execute(
                    'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
                    [toolMsgId, conversationId, 'tool', toolContent, new Date().toISOString(), toolCallId],
                  );
                } else if (ev.type === 'agent_done') {
                  set((s) => {
                    const msg = s.messages.find((m) => m.id === assistantMsgId);
                    if (msg) {
                      msg.status = ev.success ? 'done' : 'error';
                    }
                  });
                }
              },
            });

            // 更新 assistant 消息最终状态（如果 tool calls 还没设）
            set((s) => {
              const msg = s.messages.find((m) => m.id === assistantMsgId);
              if (msg) {
                if (!msg.content || typeof msg.content === 'string' && msg.content.length === 0) {
                  msg.content = result.message || '任务完成';
                }
                if (msg.status === 'streaming') msg.status = 'done';
              }
            });

            // 持久化 assistant 消息到 DB（避免下次 loadMessages 时丢失）
            try {
              const finalMsg = get().messages.find((m) => m.id === assistantMsgId);
              if (finalMsg && !existingMsgIds.has(finalMsg.id)) {
                const serContent = typeof finalMsg.content === 'string' ? finalMsg.content : '';
                await db.execute(
                  'INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, ?, 0, \'\')',
                  [
                    finalMsg.id,
                    conversationId,
                    'assistant',
                    serContent,
                    finalMsg.timestamp,
                    finalMsg.reasoning_content ?? null,
                    finalMsg.toolCalls?.length ? JSON.stringify(finalMsg.toolCalls) : null,
                  ],
                );
              }
            } catch (dbErr) {
              console.warn('[ChatStore] FreeAgent 持久化 assistant 消息失败:', dbErr);
            }

          } catch (err) {
            set({ error: `FreeAgent 执行失败: ${err instanceof Error ? err.message : String(err)}`, isStreaming: false });
          }
          set({ isStreaming: false });
          return;
        }

        // ── 构建工具列表：基础工具 + request_agent ──
        const { ChatAgent } = await import('@/agents/chat-api');
        const chatAgent = new ChatAgent();

        const requestAgentTool = await (async () => {
          // 动态加载用户自定义 agent 名称
          let customAgentNames: string[] = [];
          try {
            const { useAgentStore } = await import('@/stores/agent-store');
            const agentStore = useAgentStore.getState();
            if (!agentStore.loaded) await agentStore.load();
            customAgentNames = agentStore.getEnabledAgents().map(a => a.name);
          } catch { /* agent-store not available */ }

          return {
          type: 'function' as const,
          function: {
            name: 'request_agent',
            description: '将用户请求委托给专业 Agent。Agent 会执行完整任务并返回最终结果——该结果即是给用户的答案，你直接据此回复即可。',
            parameters: {
              type: 'object',
              properties: {
                agent: {
                  type: 'string',
                  enum: ['computeruse', 'web', 'document', 'code', ...customAgentNames],
                  description: '可用 Agent 及其能力：\n- web：浏览器操作，可通过 Chrome 扩展连接用户当前已打开的浏览器（读取标签页 URL/标题/DOM、执行 JS、捕获事件），也可启动 Playwright 进行完整的网页自动化（导航、点击、填表、滚动、脚本执行），支持 web_search/web_fetch 搜索和抓取\n- code：读写文件、搜索文件内容/文件名、生成代码、执行 Shell 命令、沙箱执行 JS/Python/SQL/HTML、创建和保存 Web 应用\n- document：Word/Excel/PPT/WPS 文档操作，检测已打开文档、读取内容、LLM 智能处理（翻译/总结/分类/生成）、写回结果\n- computeruse：桌面自动化，截图→视觉分析→鼠标/键盘操作，支持窗口管理、OCR 文字识别、UIA 语义元素定位' + (customAgentNames.length > 0 ? '\n用户自定义 Agent：' + customAgentNames.map(n => `\n- ${n}：用户创建的专用 Agent`).join('') : ''),
                },
                reason: { type: 'string', description: '委托原因，简述任务内容和关键上下文' },
                args: { type: 'object', description: '额外的业务参数（非必填），按 Agent 类型传递。示例：document → {"path":"D:/report.xlsx"}；code → {"workspace":"D:/project"}；web → {"url":"https://example.com"}；computeruse → {"app":"记事本"}。Agent 将优先使用指定参数而非自动检测。' },
                user_message_indices: {
                  type: 'array',
                  items: { type: 'number' },
                  description: '需要传给子 Agent 的消息索引列表（从0开始），通常用于传递含图片的消息。例如第0条消息是设计稿截图，传 [0]。如果不需要图片参考，传 [] 或不传。对话中第一条消息索引为0，依序递增。',
                },
              },
              required: ['agent'],
            },
          },
        }; })();

        const getAgentLogTool = {
          type: 'function' as const,
          function: {
            name: 'get_agent_log',
            description: '查询子 Agent 的详细执行过程。当你委托任务给 Agent 后，可用此工具查看它具体做了什么（调了哪些工具、每步的输入输出、耗时等），帮助分析执行细节或排查问题。',
            parameters: {
              type: 'object',
              properties: {
                task_id: { type: 'string', description: '任务 ID（从 request_agent 返回结果中的 taskId 字段获取）。不传则返回当前对话最近一次 Agent 执行记录。' },
              },
            },
          },
        };

        // 从 executor 获取工具定义，根据 toolMode / @agent 决定范围
        const currentToolMode = get().toolMode;
        const currentCustomTools = get().customTools;
        const agentName = options?.agentName;
        let agentEndpoint: AgentEndpoint | undefined;
        let customAgentSystemExtra: string | undefined;
        let toolFilter: Set<string>;
        if (agentName) {
          // 先查内置 agent
          if (AGENT_TOOL_FILTERS[agentName]) {
            toolFilter = getAgentToolFilter(agentName);
            agentEndpoint = getAgentEndpoint(agentName);
          } else {
            // 自定义 agent：从 agent-store 加载 tool_names + system_prompt
            try {
              const { useAgentStore } = await import('@/stores/agent-store');
              const agents = useAgentStore.getState().getEnabledAgents();
              const customAgent = agents.find(a => a.name === agentName);
              if (customAgent) {
                toolFilter = new Set(customAgent.toolNames ?? []);
                customAgentSystemExtra = customAgent.systemPrompt ?? '';
              } else {
                toolFilter = getChatBasicTools();
              }
            } catch {
              toolFilter = getChatBasicTools();
            }
            agentEndpoint = AgentEndpoint.chat;
          }
        } else if (currentToolMode === ToolMode.none) {
          toolFilter = new Set();
        } else if (currentToolMode === ToolMode.favorites) {
          toolFilter = settingsStore.favoriteTools ?? new Set();
        } else if (currentToolMode === ToolMode.custom) {
          toolFilter = currentCustomTools.size > 0 ? currentCustomTools : getChatBasicTools();
        } else if (currentToolMode === ToolMode.basic) {
          // 默认/未选中 → 基础工具集
          toolFilter = getChatBasicTools();
        } else {
          // ToolMode.all → 所有已注册技能工具
          toolFilter = new Set(executor.enabledToolNames);
        }
        const basicToolDefs = executor.buildToolsForLLM(toolFilter);
        // ToolMode.none = no tools at all (including requestAgentTool)
        const allTools = currentToolMode === ToolMode.none
          ? []
          : [...basicToolDefs, requestAgentTool, getAgentLogTool];

        // ── 工具调用循环（每轮独立 assistant 消息，数据层不做删改覆盖） ──
        const MAX_TOOL_ROUNDS = 50;
        const persistedMsgIds = new Set(existingMsgIds);
        let prevToolCalls: Array<{ name: string; args: string }> = [];

        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (abortController.signal.aborted) break;

          // 构建 LLM 历史：保留完整的 assistant/tool 结构（toolCalls + toolCallId）
          // @ 选中时不过滤 _agentInternal，保留完整上下文给 agent 专用 LLM
          // 非 @ 时过滤 _agentInternal（子 agent 内部工具调用不进 Chat LLM 上下文）
          const shouldFilterInternal = !agentName;
          const historyMsgs = get().messages
            .filter((m) => m.role !== 'system')
            .filter((m) => shouldFilterInternal ? !m._agentInternal : true)
            .map((m): LLMMessage => {
              // Preserve multimodal content (e.g. [text, image_url] arrays)
              const msgContent: string | { type: string; [k: string]: unknown }[] =
                typeof m.content === 'string' ? m.content
                : Array.isArray(m.content) ? m.content as { type: string; [k: string]: unknown }[]
                : '';
              const base: LLMMessage = {
                role: m.role,
                content: msgContent,
              };
              if (m.role === 'assistant' && m.toolCalls) {
                base.toolCalls = m.toolCalls;
              }
              if (m.role === 'tool' && m.toolCallId) {
                base.toolCallId = m.toolCallId;
              }
              return base;
            });

          // 每轮创建独立的 assistant 消息
          const roundAssistantId = crypto.randomUUID();
          let roundText = '';
          let toolCallJson = '';

          set((s) => {
            s.messages = [...s.messages, {
              id: roundAssistantId,
              conversationId,
              role: 'assistant' as const,
              content: '',
              timestamp: new Date().toISOString(),
              status: 'streaming' as const,
            }];
          });

          // 系统提示由后端 buildSystemPrompt(chat) 自动注入
          console.log('[chat-store] Sending to LLM:', {
            messageCount: historyMsgs.length,
            messages: historyMsgs.map((m, i) => ({
              idx: i,
              role: m.role,
              contentType: Array.isArray(m.content) ? 'array' : typeof m.content,
              contentLength: Array.isArray(m.content)
                ? m.content.length
                : typeof m.content === 'string'
                  ? m.content.length
                  : 0,
              hasToolCalls: !!m.toolCalls,
              hasToolCallId: !!m.toolCallId,
            })),
          });
          console.log('[chat-store] 🎯 agent routing:', { agentName, agentEndpoint, toolFilterSize: toolFilter.size });
          const stream = chatAgent.chat({
            messages: historyMsgs,
            provider: {
              id: provider.id,
              name: provider.name,
              type: provider.type as 'openai' | 'anthropic' | 'google',
              baseUrl: provider.baseUrl,
              model: provider.model,
              encryptedApiKey: provider.encryptedApiKey,
              isDefault: false,
              supportsTools: provider.supportsTools ?? true,
              thinkingMode: provider.thinkingMode ?? false,
              createdAt: '',
            },
            apiKey,
            tools: provider.supportsTools === false ? undefined : allTools,
            systemExtra: customAgentSystemExtra
              ? (systemExtra ? `${customAgentSystemExtra}\n\n${systemExtra}` : customAgentSystemExtra)
              : systemExtra,
            endpoint: agentEndpoint,
          });

          for await (const chunk of stream) {
            if (abortController.signal.aborted) break;
            if (chunk.startsWith('__ERROR__:')) {
              roundText = chunk.substring(10);
              break;
            }
            if (chunk.startsWith('__REASONING__:')) {
              const rc = chunk.substring(14);
              // 累积推理内容到本轮 assistant 消息
              set((s) => {
                s.messages = s.messages.map((m) =>
                  m.id === roundAssistantId ? { ...m, reasoning_content: (m.reasoning_content || '') + rc } : m,
                );
              });
              continue;
            }
            if (chunk.startsWith('__TOOLS__:')) {
              toolCallJson = chunk.substring(10);
              continue;
            }
            roundText += chunk;
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === roundAssistantId ? { ...m, content: roundText } : m,
              );
            });
          }

          // 无工具调用 → 纯文本回复，本轮结束
          if (!toolCallJson) {
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === roundAssistantId ? { ...m, content: roundText, status: 'done' as const } : m,
              );
            });
            break;
          }

          // 解析工具调用
          let calls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = [];
          try {
            calls = JSON.parse(toolCallJson);
          } catch { break; }

          // 标准化本轮的 toolCalls
          const toolCallsForAssistant = calls.map((c) => ({
            id: c.id || crypto.randomUUID(),
            type: 'function' as const,
            function: {
              name: c.function!.name!,
              arguments: c.function!.arguments ?? '{}',
            },
          }));

          // 检查是否有 request_agent
          const agentCall = calls.find((c) => c.function?.name === 'request_agent');
          if (agentCall) {
            // ── request_agent → 路由到 TaskGateway ──
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === roundAssistantId
                  ? { ...m, toolCalls: toolCallsForAssistant, content: roundText || '正在分析任务...', status: 'done' as const }
                  : m,
              );
            });

            // Agent 开始消息（带折叠标记）
            const agentStartMsgId = crypto.randomUUID();
            let selectedAgent = 'computeruse';
            let agentReason = '';
            let agentArgs: Record<string, unknown> = {};
            let userMessageIndices: number[] = [];
            try {
              const args = JSON.parse(agentCall.function?.arguments ?? '{}') as { agent?: string; reason?: string; user_message_indices?: number[]; args?: Record<string, unknown> };
              selectedAgent = args.agent ?? 'computeruse';
              agentReason = args.reason ?? '';
              agentArgs = args.args ?? {};
              userMessageIndices = args.user_message_indices ?? [];
            } catch { /* use default */ }
            let agentLabel = ({ computeruse: '🖥️ 计算机操作', web: '🌐 浏览器', document: '📄 文档', code: '💻 代码' }[selectedAgent] ?? selectedAgent);

            set((s) => {
              s.messages = [...s.messages, {
                id: agentStartMsgId,
                conversationId,
                role: 'assistant',
                content: `${agentLabel} Agent 开始执行...`,
                timestamp: new Date().toISOString(),
                status: 'streaming' as const,
                _agentInternal: true,
                _agentType: selectedAgent,
                _isAgentStart: true,
              }];
            });

            // onProgress 回调：收集统计 + 推送 UI 更新
            const agentStats = {
              turns: 0,
              maxTurns: 0,
              tools: [] as Array<{ name: string; success: boolean; message?: string }>,
              keyOutputs: [] as string[],  // 重要产出物描述
            };
            const onProgress = (event: import('@/services/task-agent').AgentProgressEvent) => {
              const msgId = crypto.randomUUID();
              const now = new Date().toISOString();
              console.log('[chat-store] onProgress event:', event.type, event);

              switch (event.type) {
                case 'turn_start': {
                  agentStats.turns = event.turn + 1;
                  agentStats.maxTurns = event.maxTurns;
                  set((s) => {
                    s.messages = [...s.messages, {
                      id: msgId,
                      conversationId,
                      role: 'assistant' as const,
                      content: `🔄 第 ${event.turn + 1}/${event.maxTurns} 轮`,
                      timestamp: now,
                      status: 'done' as const,
                      _agentInternal: true,
                      _agentType: selectedAgent,
                    }];
                  });
                  break;
                }
                case 'llm_thinking': {
                  // LLM 思考过程，作为 assistant 消息
                  if (event.text || event.reasoning) {
                    set((s) => {
                      s.messages = [...s.messages, {
                        id: msgId,
                        conversationId,
                        role: 'assistant' as const,
                        content: event.text || '',
                        reasoning_content: event.reasoning,
                        timestamp: now,
                        status: 'done' as const,
                        _agentInternal: true,
                        _agentType: selectedAgent,
                      }];
                    });
                  }
                  break;
                }
                case 'tool_start': {
                  // 工具调用开始，作为 tool_call 消息
                  set((s) => {
                    s.messages = [...s.messages, {
                      id: msgId,
                      conversationId,
                      role: 'assistant' as const,
                      content: '',
                      timestamp: now,
                      status: 'done' as const,
                      _agentInternal: true,
                      _agentType: selectedAgent,
                      _toolCallInfo: {
                        name: event.name,
                        args: event.args,
                        status: 'running',
                      },
                    }];
                  });
                  // 先登记再写入，避免兜底持久化时因异步延迟误判为未写入
                  persistedMsgIds.add(msgId);
                  db.execute(
                    `INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type)
                     VALUES (?, ?, ?, ?, ?, 1, ?)`,
                    [msgId, conversationId, 'assistant', '', now, selectedAgent],
                  ).catch((e) => {
                    console.warn('[chat-store] tool_start DB write failed:', e);
                  });
                  break;
                }
                case 'tool_end': {
                  // 收集工具调用统计
                  agentStats.tools.push({ name: event.name, success: event.success ?? false, message: event.message });
                  // 收集重要产出物
                  if (event.success && event.message) {
                    const keyTools = ['save_app', 'save_project', 'write_file', 'generate_code', 'generate_project'];
                    if (keyTools.includes(event.name)) {
                      const shortMsg = event.message.length > 100 ? event.message.substring(0, 100) + '...' : event.message;
                      agentStats.keyOutputs.push(`[${event.name}] ${shortMsg}`);
                    }
                  }
                  // 工具调用结束，作为 tool 结果消息
                  const statusIcon = event.success ? '✅' : '❌';
                  const resultText = event.message ? `${statusIcon} ${event.name}: ${event.message.substring(0, 200)}` : `${statusIcon} ${event.name}`;
                  // 超长截断：agent 内部 tool 结果
                  const atr = truncateToolResult('agent_internal', resultText);
                  const toolEndMsgId = msgId;
                  const fullUserMsgId = atr.fullUserMessage ? crypto.randomUUID() : undefined;
                  set((s) => {
                    const newMsgs = [...s.messages, {
                      id: toolEndMsgId,
                      conversationId,
                      role: 'tool' as const,
                      content: atr.toolContent,
                      timestamp: now,
                      status: 'done' as const,
                      _agentInternal: true,
                      _agentType: selectedAgent,
                    }];
                    if (atr.fullUserMessage && fullUserMsgId) {
                      newMsgs.push({
                        id: fullUserMsgId, conversationId,
                        role: 'user' as const,
                        content: atr.fullUserMessage,
                        timestamp: now, status: 'done' as const,
                        _agentInternal: true, _agentType: selectedAgent,
                      });
                    }
                    s.messages = newMsgs;
                  });
                  // 先登记再写入，避免兜底持久化时因异步延迟误判为未写入
                  persistedMsgIds.add(toolEndMsgId);
                  db.execute(
                    `INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type)
                     VALUES (?, ?, ?, ?, ?, 1, ?)`,
                    [toolEndMsgId, conversationId, 'tool', atr.toolContent, now, selectedAgent],
                  ).catch((e) => {
                    console.warn('[chat-store] tool_end DB write failed:', e);
                  });
                  if (atr.fullUserMessage && fullUserMsgId) {
                    persistedMsgIds.add(fullUserMsgId);
                    db.execute(
                      `INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type)
                       VALUES (?, ?, ?, ?, ?, 1, ?)`,
                      [fullUserMsgId, conversationId, 'user', atr.fullUserMessage, now, selectedAgent],
                    ).catch((e) => {
                      console.warn('[chat-store] tool_end fullUser DB write failed:', e);
                    });
                  }
                  break;
                }
                case 'agent_done': {
                  // Agent 完成，更新开始消息状态
                  set((s) => {
                    s.messages = s.messages.map((m) =>
                      m.id === agentStartMsgId
                        ? { ...m, status: 'done' as const, content: `${agentLabel} Agent ${event.success ? '执行完成' : '执行失败'}` }
                        : m,
                    );
                  });
                  break;
                }
              }
            };

            // 路由到对应的 gateway
            let gateway: { handleUserMessage(params: Record<string, unknown>): Promise<Record<string, unknown>> };
            // 检查是否为用户自定义 agent
            let customAgentConfig: import('@/types/agent').UserAgentConfig | null = null;
            try {
              const { useAgentStore } = await import('@/stores/agent-store');
              const agentStore = useAgentStore.getState();
              if (!agentStore.loaded) await agentStore.load();
              customAgentConfig = agentStore.agents.find(a => a.name === selectedAgent) ?? null;
            } catch { /* agent-store not available */ }

            if (customAgentConfig) {
              agentLabel = `🤖 ${selectedAgent}`;
              const { CustomAgentGateway } = await import('@/services/custom-agent');
              gateway = new CustomAgentGateway(
                executor as unknown as import('@/interfaces/skill-executor').ISkillExecutor,
                customAgentConfig,
              ) as unknown as { handleUserMessage(params: Record<string, unknown>): Promise<Record<string, unknown>> };
            } else if (selectedAgent === 'document') {
              const { DocGateway } = await import('@/services/doc-agent/doc-gateway');
              gateway = new DocGateway(executor as unknown as import('@/interfaces/skill-executor').ISkillExecutor);
            } else if (selectedAgent === 'web') {
              const { WebGateway } = await import('@/services/web-agent');
              gateway = new WebGateway(executor as unknown as import('@/interfaces/skill-executor').ISkillExecutor);
            } else if (selectedAgent === 'code') {
              const { CodeGateway } = await import('@/services/code-agent');
              gateway = new CodeGateway(executor as unknown as import('@/interfaces/skill-executor').ISkillExecutor);
            } else {
              const { TaskGateway } = await import('@/services/task-agent');
              gateway = new TaskGateway(executor as unknown as import('@/interfaces/skill-executor').ISkillExecutor);
            }

            // 构建消息历史，传递给 agent 实现方案 A（共享上下文）
            const agentMessages: import('@/types/message').LLMMessage[] = get().messages
              .filter((m) => m.role !== 'system' && !m._agentInternal)
              .map((m) => {
                const msgContent: string | { type: string; [k: string]: unknown }[] =
                  typeof m.content === 'string' ? m.content
                  : Array.isArray(m.content) ? m.content as { type: string; [k: string]: unknown }[]
                  : '';
                const base: import('@/types/message').LLMMessage = {
                  role: m.role,
                  content: msgContent,
                };
                if (m.role === 'assistant' && m.toolCalls) {
                  base.toolCalls = m.toolCalls;
                }
                if (m.role === 'tool' && m.toolCallId) {
                  base.toolCallId = m.toolCallId;
                }
                return base;
              });

            // 提取上轮 agent 任务上下文，串联给新 agent
            const msgs = get().messages;
            let prevContextMsg: typeof msgs[number] | undefined;
            for (let i = msgs.length - 1; i >= 0; i--) {
              if (msgs[i]._taskContext && Object.keys(msgs[i]._taskContext!).length > 0 && msgs[i]._agentType === selectedAgent) {
                prevContextMsg = msgs[i];
                break;
              }
            }
            if (prevContextMsg?._taskContext) {
              const ctxEntries = Object.entries(prevContextMsg._taskContext);
              // 分离 ActionMemory 摘要（结构化执行记录）和普通产出物
              const actionMemText = ctxEntries.find(([k]) => k === '_actionMemory')?.[1];
              const outputEntries = ctxEntries.filter(([k]) => k !== '_actionMemory');

              // ActionMemory 摘要单独注入，保持其结构化格式
              if (actionMemText) {
                agentMessages.unshift({ role: 'user', content: actionMemText });
              }
              if (outputEntries.length > 0) {
                const ctxText = outputEntries.map(([k, v]) => `[上次${k} agent 产出]: ${v}`).join('\n');
                agentMessages.unshift({ role: 'user', content: ctxText });
              }
            }

            // ── 按 LLM 指定的 user_message_indices 提取图片，注入给子 Agent ──
            if (userMessageIndices.length > 0) {
              const allMessages = get().messages;
              const imageParts: Array<{ type: 'image_url'; image_url: { url: string } }> = [];
              const seenUrls = new Set<string>();
              for (const idx of userMessageIndices) {
                const m = allMessages[idx];
                if (!m) continue;
                const content = Array.isArray(m.content) ? m.content : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : []);
                for (const part of content as Array<{ type: string; image_url?: { url: string }; text?: string }>) {
                  if (part.type === 'image_url' && part.image_url?.url && !seenUrls.has(part.image_url.url)) {
                    seenUrls.add(part.image_url.url);
                    imageParts.push({ type: 'image_url', image_url: { url: part.image_url.url } });
                    console.log(`[chat-store] 📷 request_agent 指定索引#${idx} → 注入图片 (${(part.image_url.url.length / 1024).toFixed(0)} KB)`);
                  }
                }
              }
              if (imageParts.length > 0) {
                const imgContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
                  { type: 'text', text: '以下为 Chat Agent 根据用户指令指定的参考图片：' },
                  ...imageParts,
                ];
                agentMessages.unshift({
                  role: 'user' as const,
                  content: imgContent as unknown as string,
                });
              }
            }

            let response;
            try {
              response = await gateway.handleUserMessage({
                content: Object.keys(agentArgs).length > 0 ? `[参数: ${JSON.stringify(agentArgs)}]\n${agentReason || userText}` : (agentReason || userText),
                provider,
                apiKey,
                password,
                signal: abortController.signal,
                messages: agentMessages,  // 传递消息历史
                onConfirm: (command: string) => {
                  return new Promise<boolean>((resolve) => {
                    set((s) => {
                      s.awaitingConfirmation = { toolName: 'run_command', args: { command }, command };
                      s._pendingResolve = (v: { confirmed: boolean }) => resolve(v.confirmed);
                    });
                  });
                },
                onUserInput: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => {
                  return new Promise<Record<string, string>>((resolve) => {
                    set((s) => {
                      s.awaitingUserInput = { message, fields };
                      s._pendingInputResolve = (v: Record<string, string>) => resolve(v);
                    });
                  });
                },
                onProgress,
              });
            } catch (err) {
              // 异常/中断时：构建 ActionMemory 摘要供下次恢复
              const abortActionMem = buildActionMemorySummary(agentStats.tools);
              const errorContent = `❌ 任务中断: ${err instanceof Error ? err.message : String(err)}`;
              set((s) => {
                // 清理：移除所有 streaming 状态的空 assistant 消息（中断时可能有多个未完成的轮次）
                const cleanedMessages = s.messages.filter((m) => {
                  // 保留已完成的消息
                  if (m.status !== 'streaming') return true;
                  // 移除空的 streaming 消息（中断时未完成的轮次）
                  if (m.role === 'assistant' && (!m.content || m.content === '') && !m.toolCalls) return false;
                  return true;
                });

                // 添加错误消息
                const errorMsg = {
                  id: crypto.randomUUID(),
                  conversationId,
                  role: 'assistant' as const,
                  content: errorContent,
                  timestamp: new Date().toISOString(),
                  status: 'error' as const,
                  _agentInternal: true,
                  _agentType: selectedAgent,
                  _taskContext: abortActionMem ? { _actionMemory: abortActionMem } : undefined,
                };

                // 更新 Agent 开始消息状态
                const updatedMessages = cleanedMessages.map((m) =>
                  m.id === agentStartMsgId ? { ...m, status: 'done' as const, content: `${agentLabel} Agent 执行中断` } : m,
                );

                s.messages = [...updatedMessages, errorMsg];
                s.isStreaming = false;
                s.streamingConversationId = null;
                s._abortController = null;
              });
              return;
            }

            // ── Agent 执行完成，把结果作为 tool 消息喂给 Chat LLM 做总结 ──
            const tasks = (response.tasks ?? []) as Array<Record<string, unknown>>;
            const responseMessage = (response.message ?? '') as string;
            const success = tasks.length > 0 ? tasks.every((t) => t.status === 'done') : !!responseMessage;

            // 折叠摘要（仅展示，不进 LLM 上下文）
            const toolFlow = agentStats.tools.length > 0
              ? agentStats.tools.map(t => t.name).join(' → ')
              : '—';
            const foldedSummary = `${agentLabel} Agent: ${agentStats.turns}/${agentStats.maxTurns} 轮 · ${toolFlow}`;

            // 构建给 Chat LLM 的 tool 结果数据（含 taskId 供 get_agent_log 查询）
            const agentResultData: Record<string, unknown> = { agent: selectedAgent };
            const agentTaskId = tasks.length > 0 ? (tasks[0].taskId as string) : undefined;
            if (agentTaskId) agentResultData.taskId = agentTaskId;
            // 子 agent 执行链的最后一条消息（LLM 的自然语言结论），直接作为 tool 结果返回给 Chat LLM
            const agentFinalMessage = tasks.length > 0 ? ((tasks[0].lastMessage ?? tasks[0].summary ?? tasks[0].message) as string) : '';
            const toolResultMessage = agentFinalMessage || responseMessage || (success ? 'OK' : 'Failed');
            if (toolResultMessage) agentResultData.response = toolResultMessage;
            if (agentStats.keyOutputs.length > 0) agentResultData.keyOutputs = agentStats.keyOutputs;

            // 构建传递给后续 agent 的任务上下文
            const taskContext: Record<string, string> = {};
            if (agentStats.keyOutputs.length > 0) {
              taskContext[selectedAgent] = agentStats.keyOutputs.join('; ');
            }
            const actionMemSummary = buildActionMemorySummary(agentStats.tools);
            if (actionMemSummary) {
              taskContext['_actionMemory'] = actionMemSummary;
            }

            // 更新 Agent 开始消息状态
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === agentStartMsgId
                  ? { ...m, status: 'done' as const, content: `${agentLabel} Agent ${success ? '执行完成' : '执行失败'}` }
                  : m,
              );
            });

            // 本轮 assistant 消息的 toolCalls 已在前面设置，这里直接用 agentCall 的 id
            const requestAgentCallId = agentCall.id || crypto.randomUUID();

            // 折叠摘要（仅展示）+ tool 结果消息（进入 LLM 上下文）
            const foldedId = crypto.randomUUID();
            const foldedMsg: ChatMessage = {
              id: foldedId, conversationId,
              role: 'assistant', content: foldedSummary,
              timestamp: new Date().toISOString(), status: 'done',
              _agentInternal: true, _isAgentStart: true, _agentType: selectedAgent,
            };
            const toolResultMsgId = crypto.randomUUID();
            const rawAgentResult = JSON.stringify({ success, message: toolResultMessage, data: agentResultData });
            const art = truncateToolResult('request_agent', rawAgentResult);
            const toolResultMsg: ChatMessage = {
              id: toolResultMsgId, conversationId,
              role: 'tool', content: art.toolContent,
              toolCallId: requestAgentCallId,
              timestamp: new Date().toISOString(), status: 'done',
              _agentType: selectedAgent,
              _taskContext: taskContext,
            };

            set((s) => {
              const newMsgs = [...s.messages, foldedMsg, toolResultMsg];
              if (art.fullUserMessage) {
                newMsgs.push({
                  id: crypto.randomUUID(), conversationId,
                  role: 'user' as const, content: art.fullUserMessage,
                  timestamp: new Date().toISOString(), status: 'done' as const,
                  _agentType: selectedAgent, _taskContext: taskContext,
                  _internal: true as any, // 静默发送，不渲染到聊天窗口
                });
              }
              s.messages = newMsgs;
            });

            // Persist internal messages to DB（去重：跳过已持久化的 ID）
            const internalMsgs = get().messages.filter(m => m._agentInternal && !persistedMsgIds.has(m.id));
            for (const im of internalMsgs) {
              if (!im.id) continue;
              await get()._saveMsgToDb(im, db);
              persistedMsgIds.add(im.id);
            }

            // 继续 Chat LLM 循环 — 让 LLM 看到 tool 结果后生成自然语言总结
            continue;
          }

          // ── 执行基础工具调用 ──
          const allowedTools = toolFilter ?? new Set(executor.enabledToolNames);
          const basicCalls = calls.filter((c) => c.function?.name && allowedTools.has(c.function.name));
          if (basicCalls.length === 0) break; // 没有可执行的基础工具

          // 本轮 assistant 消息设置 toolCalls + 文本（不累积，每轮独立）
          set((s) => {
            s.messages = s.messages.map((m) =>
              m.id === roundAssistantId
                ? { ...m, toolCalls: toolCallsForAssistant, content: roundText, status: 'done' as const }
                : m,
            );
          });

          // ── 重复工具调用检测（工具名 + 参数都相同才算重复） ──
          const currentToolCalls = basicCalls.map((c) => ({
            name: c.function!.name!,
            args: c.function!.arguments ?? '{}',
          }));
          const isRepeat = prevToolCalls.length > 0
            && currentToolCalls.length === prevToolCalls.length
            && currentToolCalls.every((c, i) =>
              c.name === prevToolCalls[i].name && c.args === prevToolCalls[i].args,
            );
          prevToolCalls = currentToolCalls;

          if (isRepeat) {
            console.warn(`[chat-store] ⚠ 检测到连续重复工具调用: ${currentToolCalls.map(c => c.name).join(', ')}，提醒 LLM`);
            // 不执行工具，注入警告 tool result 让 LLM 自我纠正
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === roundAssistantId
                  ? { ...m, toolCalls: basicCalls.map((c) => ({
                      id: c.id || crypto.randomUUID(),
                      type: 'function' as const,
                      function: { name: c.function!.name!, arguments: c.function!.arguments ?? '{}' },
                    })), content: roundText }
                  : m,
              );
            });
            for (const call of basicCalls) {
              const toolName = call.function!.name!;
              const toolCallId = call.id || crypto.randomUUID();
              const toolMsgId = crypto.randomUUID();
              const toolContent = JSON.stringify({
                success: false,
                message: `⚠️ 你已连续多次调用 "${toolName}"，结果相同。请根据已有的工具返回信息，直接用自然语言回复用户，不要再调用此工具。`,
              });
              set((s) => {
                s.messages = [...s.messages, {
                  id: toolMsgId,
                  conversationId,
                  role: 'tool' as const,
                  toolCallId,
                  content: toolContent,
                  timestamp: new Date().toISOString(),
                  status: 'done' as const,
                }];
              });
              await db.execute(
                'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
                [toolMsgId, conversationId, 'tool', toolContent, new Date().toISOString(), toolCallId],
              );
            }
            continue; // 不执行工具，回到循环顶部让 LLM 看到警告后重新决策
          }

          // assistant 已在前面标记完成+持久化（request_agent 路径在 896 行，非 agent 路径在 879 行）

          for (const call of basicCalls) {
            const toolName = call.function!.name!;
            const toolCallId = call.id || crypto.randomUUID();
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(call.function!.arguments ?? '{}'); } catch { /* empty args */ }

            // run_command / execute_code / doc_code_exec 需要确认
            if (toolName === 'run_command' || toolName === 'execute_code' || toolName === 'doc_code_exec') {
              const displayCmd = toolName === 'run_command'
                ? (args.command as string)
                : (toolName === 'doc_code_exec' ? `[Python(doc)] ` : `[${(args as Record<string,unknown>).language ?? 'code'}] `) + String((args as Record<string,unknown>).code ?? '').substring(0, 300);
              const confirmed = await new Promise<boolean>((resolve) => {
                set((s) => {
                  s.awaitingConfirmation = { toolName, args, command: displayCmd };
                  s._pendingResolve = (v: { confirmed: boolean }) => resolve(v.confirmed);
                });
              });
              if (!confirmed) {
                const rejectMsgId = crypto.randomUUID();
                const rejectContent = JSON.stringify({ success: false, message: `用户拒绝执行: ${displayCmd}` });
                set((s) => {
                  s.messages = [...s.messages, {
                    id: rejectMsgId,
                    conversationId,
                    role: 'tool' as const,
                    toolCallId,
                    content: rejectContent,
                    timestamp: new Date().toISOString(),
                    status: 'done' as const,
                  }];
                });
                await db.execute(
                  'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
                  [rejectMsgId, conversationId, 'tool', rejectContent, new Date().toISOString(), toolCallId],
                );
                continue;
              }
            }

            // ── get_agent_log：查询子 Agent 执行历史 ──
            let result: { success: boolean; message: string; data?: Record<string, unknown> };
            if (toolName === 'get_agent_log') {
              const taskId = args['task_id'] as string | undefined;
              let rows: Array<Record<string, unknown>> = [];
              try {
                if (taskId) {
                  rows = await db.query<Record<string, unknown>>(
                    `SELECT id, agent_id, step_order, action, input_summary, output_summary, decision_rationale, error_info, duration_ms, created_at
                     FROM agent_process_log WHERE task_id = ? ORDER BY step_order ASC`, [taskId],
                  );
                } else {
                  // 无 taskId → 查找当前对话最近一次 agent 执行
                  const recentTask = await db.get<{ task_id: string }>(
                    `SELECT DISTINCT a.task_id FROM agent_process_log a
                     INNER JOIN messages m ON m.conversation_id = ? AND m.agent_internal = 1
                     WHERE a.task_id LIKE 'task-%'
                     ORDER BY a.id DESC LIMIT 1`,
                    [conversationId],
                  );
                  if (recentTask?.task_id) {
                    rows = await db.query<Record<string, unknown>>(
                      `SELECT id, agent_id, step_order, action, input_summary, output_summary, decision_rationale, error_info, duration_ms, created_at
                       FROM agent_process_log WHERE task_id = ? ORDER BY step_order ASC`, [recentTask.task_id],
                    );
                  }
                }
              } catch (e) {
                rows = [];
                console.warn('[chat-store] get_agent_log query error:', e);
              }

              if (rows.length === 0) {
                result = { success: false, message: taskId ? `未找到任务 ${taskId} 的执行记录` : '当前对话没有 Agent 执行记录' };
              } else {
                const formatted = rows.map((r) => {
                  const entry: Record<string, unknown> = {};
                  if (r.step_order != null) entry.step = r.step_order;
                  if (r.action) entry.action = r.action;
                  if (r.input_summary) entry.input = r.input_summary;
                  if (r.output_summary) entry.output = r.output_summary;
                  if (r.decision_rationale) entry.reasoning = r.decision_rationale;
                  if (r.error_info) entry.error = r.error_info;
                  if (r.duration_ms != null) entry.duration_ms = r.duration_ms;
                  return entry;
                });
                result = {
                  success: true,
                  message: `共 ${rows.length} 条执行记录`,
                  data: { task_id: taskId || rows[0]?.agent_id, steps: formatted },
                };
              }
            } else {
              // 执行工具
              result = await executor.executeToolCall(toolName, args);
            }

            // ── Screenshot → compress + inject as multimodal image ──
            if (toolName === 'desktop_screenshot' && result.success && result.data) {
              const imageData = (result.data as Record<string, unknown>)['image_data'] as string | undefined;
              const imageFormat = (result.data as Record<string, unknown>)['format'] as string | undefined;
              console.log('[chat-store] Screenshot result:', {
                hasImageData: !!imageData,
                imageDataLength: imageData?.length,
                imageFormat,
                dataKeys: Object.keys(result.data as Record<string, unknown>),
              });
              if (imageData) {
                try {
                  const { compressImage } = await import('@/utils/image');
                  const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/bmp;base64,${imageData}`;
                  console.log('[chat-store] Compressing screenshot:', {
                    dataUrlPrefix: dataUrl.substring(0, 50),
                    dataUrlLength: dataUrl.length,
                  });
                  const compressed = await compressImage(dataUrl, 1024, 45);
                  console.log('[chat-store] Screenshot compressed:', {
                    compressedDataUrlLength: compressed?.dataUrl?.length,
                    compressedDataUrlPrefix: compressed?.dataUrl?.substring(0, 100),
                    originalWidth: compressed?.originalWidth,
                    originalHeight: compressed?.originalHeight,
                    compressedWidth: compressed?.compressedWidth,
                    compressedHeight: compressed?.compressedHeight,
                  });
                  // Inject as multimodal user message so the LLM can see
                  // the screenshot and analyze cell positions, content, etc.
                  // Mark as _internal so it won't display in chat UI
                  set((s) => {
                    s.messages = [...s.messages, {
                      id: crypto.randomUUID(),
                      conversationId,
                      role: 'user' as const,
                      content: [
                        { type: 'text' as const, text: '这是你请求的截图。请分析截图中的内容（选中的单元格、文本、位置等），然后调用相应的工具进行操作。' },
                        { type: 'image_url' as const, image_url: { url: compressed.dataUrl } },
                      ],
                      timestamp: new Date().toISOString(),
                      status: 'done' as const,
                      _internal: true,
                    }];
                  });
                } catch (e) {
                  console.warn('[chat-store] Screenshot compression failed:', e);
                }
              } else {
                console.warn('[chat-store] Screenshot result has no image_data:', result.data);
              }
            }

            // Store tool result as role:'tool' with toolCallId so the LLM
            // correctly associates it with the tool call in the next round.
            const toolResultMsgId = crypto.randomUUID();
            // Filter out large image data from tool results to avoid sending huge payloads to LLM
            const filteredResult = toolName === 'desktop_screenshot' && result.success && result.data
              ? { ...result, data: { ...result.data as Record<string, unknown>, image_data: '[image data omitted]' } }
              : result;
            const rawContent = JSON.stringify(filteredResult);
            // 超长截断：tool 消息保留截断版，完整内容以 user 消息兜底
            const tr = truncateToolResult(toolName, rawContent);
            set((s) => {
              const newMsgs = [...s.messages, {
                id: toolResultMsgId,
                conversationId,
                role: 'tool' as const,
                toolCallId,
                content: tr.toolContent,
                timestamp: new Date().toISOString(),
                status: 'done' as const,
              }];
              if (tr.fullUserMessage) {
                newMsgs.push({
                  id: crypto.randomUUID(),
                  conversationId,
                  role: 'user' as const,
                  content: tr.fullUserMessage,
                  timestamp: new Date().toISOString(),
                  status: 'done' as const,
                  _internal: true as any, // 静默发送，不渲染到聊天窗口
                });
              }
              s.messages = newMsgs;
            });
            await db.execute(
              'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
              [toolResultMsgId, conversationId, 'tool', tr.toolContent, new Date().toISOString(), toolCallId],
            );
            if (tr.fullUserMessage) {
              const userMsgId = crypto.randomUUID();
              await db.execute(
                'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, NULL, 0, \'\')',
                [userMsgId, conversationId, 'user', tr.fullUserMessage, new Date().toISOString()],
              );
            }
          }

          // 继续下一轮 LLM 调用（让 LLM 看到工具结果后决定下一步）
        }

        // ── 完成：标记所有 streaming 消息为 done，持久化未写入 DB 的消息 ──
        set((s) => {
          s.messages = s.messages.map((m) =>
            m.status === 'streaming' ? { ...m, status: 'done' as const } : m,
          );
          s.isStreaming = false;
          s.streamingConversationId = null;
          s._abortController = null;
        });
        // Persist any assistant messages that haven't been written to DB yet
        const newAssistantMsgs = get().messages.filter(
          (m) => m.role === 'assistant' && !existingMsgIds.has(m.id) && !persistedMsgIds.has(m.id),
        );
        for (const am of newAssistantMsgs) {
          await db.execute(
            'INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, ?, 0, \'\')',
            [am.id, conversationId, 'assistant', typeof am.content === 'string' ? am.content : '', new Date().toISOString(), am.reasoning_content ?? null, am.toolCalls ? JSON.stringify(am.toolCalls) : null],
          );
        }
      } catch (e) {
        set({ error: String(e), isStreaming: false, streamingConversationId: null, _abortController: null });
      }
    },

    stopChat: () => {
      const ctrl = get()._abortController;
      if (ctrl) {
        ctrl.abort();
      }
      set((s) => {
        s.isStreaming = false;
        s.streamingConversationId = null;
        s._abortController = null;
        // 将正在 streaming 的消息标记为 done
        s.messages = s.messages.map((m) =>
          m.status === 'streaming' ? { ...m, status: 'done' as const } : m,
        );
      });
    },
  }))
);

// ── ActionMemory 摘要构建 ──

interface ToolStat {
  name: string;
  success: boolean;
  message?: string;
}

/**
 * 从 agentStats.tools 构建 ActionMemory 风格的执行摘要。
 * 用于中断恢复：下次 agent 启动时注入，告知 LLM 已做/已失败的操作。
 */
function buildActionMemorySummary(tools: ToolStat[]): string {
  if (tools.length === 0) return '';

  const seen = new Map<string, { success: boolean; message?: string; count: number }>();

  for (const t of tools) {
    const key = t.name;
    const prev = seen.get(key);
    if (prev) {
      prev.count++;
      if (prev.message && t.message) {
        prev.message = t.message.length > prev.message.length ? t.message : prev.message;
      }
      // 任意一次成功就算成功
      if (t.success) prev.success = true;
    } else {
      seen.set(key, { success: t.success, message: t.message, count: 1 });
    }
  }

  const completed: string[] = [];
  const failed: string[] = [];

  for (const [name, info] of seen) {
    const count = info.count > 1 ? ` ×${info.count}` : '';
    const msg = info.message ? ` → ${info.message.substring(0, 80)}` : '';
    if (info.success) {
      completed.push(`  ${completed.length + 1}. ✅ ${name}${count}${msg}`);
    } else {
      const warn = info.count >= 2 ? ' ⚠️ 请换方案' : '';
      failed.push(`  ${failed.length + 1}. ❌ ${name}${count}${msg}${warn}`);
    }
  }

  const parts: string[] = [];
  if (completed.length > 0) {
    parts.push(`📊 已完成（请勿重复）:\n${completed.join('\n')}`);
  }
  if (failed.length > 0) {
    parts.push(`⚠️ 已失败:\n${failed.join('\n')}`);
  }

  return parts.join('\n\n');
}
