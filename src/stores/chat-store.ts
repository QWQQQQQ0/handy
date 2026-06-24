// 来源: lib/providers/chat_provider.dart

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ChatMessage, MessageContent, LLMMessage } from '@/types/message';
import type { ConversationRow } from '@/db';
import { getDB } from '@/db';
import type { SQLiteAdapter } from '@/db/adapter';
import { serializeContent, deserializeContent, hasImages } from '@/utils/content';
import { resolveMultimodalProvider } from '@/utils/multimodal-provider';
import { isMobile } from '@/utils/platform';
import { useModelConfigStore } from './model-config-store';
import { useSettingsStore } from './settings-store';

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
]);

function getChatBasicTools(): Set<string> {
  return isMobile() ? MOBILE_CHAT_TOOLS : DESKTOP_CHAT_TOOLS;
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
  sendMessage: (content: MessageContent, password?: string, options?: { noSystemPrompt?: boolean; skipAddUserMessage?: boolean }) => Promise<void>;
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
      if (get().activeConversation?.id === id) {
        set({ activeConversation: null, messages: [], debugMessages: [] });
      }
      await get().loadConversations();
    },

    newChat: () => {
      set({ activeConversation: null, messages: [], debugMessages: [], error: null });
    },

    switchConversation: async (conv) => {
      set({ activeConversation: conv, error: null });
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
      const noSystemPrompt = options?.noSystemPrompt ?? false;
      const skipAddUserMessage = options?.skipAddUserMessage ?? false;
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

        // ── 构建工具列表：基础工具 + request_agent ──
        const { ChatAgent } = await import('@/agents/chat-api');
        const chatAgent = new ChatAgent();

        const requestAgentTool = {
          type: 'function' as const,
          function: {
            name: 'request_agent',
            description: '将用户请求委托给专业 agent 处理。各 agent 能力见参数描述。',
            parameters: {
              type: 'object',
              properties: {
                agent: {
                  type: 'string',
                  enum: ['computeruse', 'web', 'document', 'code'],
                  description: '可用 Agent 及其能力：\n- web：浏览器操作，可通过 Chrome 扩展连接用户当前已打开的浏览器（读取标签页 URL/标题/DOM、执行 JS、捕获事件），也可启动 Playwright 进行完整的网页自动化（导航、点击、填表、滚动、脚本执行），支持 web_search/web_fetch 搜索和抓取\n- code：读写文件、搜索文件内容/文件名、生成代码、执行 Shell 命令、沙箱执行 JS/Python/SQL/HTML、创建和保存 Web 应用\n- document：Word/Excel/PPT/WPS 文档操作，检测已打开文档、读取内容、LLM 智能处理（翻译/总结/分类/生成）、写回结果\n- computeruse：桌面自动化，截图→视觉分析→鼠标/键盘操作，支持窗口管理、OCR 文字识别、UIA 语义元素定位',
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
        };

        // 从 executor 获取工具定义，根据 toolMode 决定范围
        const currentToolMode = get().toolMode;
        const currentCustomTools = get().customTools;
        let toolFilter: Set<string>;
        if (currentToolMode === ToolMode.none) {
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
          : [...basicToolDefs, requestAgentTool];

        const assistantMsgId = crypto.randomUUID();
        let responseText = '';

        set((s) => {
          s.messages = [...s.messages, {
            id: assistantMsgId,
            conversationId,
            role: 'assistant',
            content: '',
            timestamp: new Date().toISOString(),
            status: 'streaming',
          }];
        });

        // ── 工具调用循环（最多 10 轮） ──
        const MAX_TOOL_ROUNDS = 10;
        const persistedMsgIds = new Set<string>();  // 防止 _agentInternal 消息重复持久化
        let prevToolCalls: Array<{ name: string; args: string }> = [];
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (abortController.signal.aborted) break;
          // Build LLM messages preserving full structure: toolCalls, tool role,
          // toolCallId. Previously this filtered to only user/assistant and
          // stripped toolCalls, causing the LLM to never see tool results and
          // loop on the same tool call endlessly.
          const historyMsgs = get().messages
            .filter((m) => m.status !== 'streaming' && m.role !== 'system' && !m._agentInternal)
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

          let roundText = '';
          let toolCallJson = '';

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
          });

          for await (const chunk of stream) {
            if (abortController.signal.aborted) break;
            if (chunk.startsWith('__ERROR__:')) {
              roundText = chunk.substring(10);
              break;
            }
            if (chunk.startsWith('__REASONING__:')) continue;
            if (chunk.startsWith('__TOOLS__:')) {
              toolCallJson = chunk.substring(10);
              continue;
            }
            roundText += chunk;
            responseText += chunk;
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === assistantMsgId ? { ...m, content: responseText } : m,
              );
            });
          }

          // 无工具调用 → 纯文本回复，结束
          if (!toolCallJson) break;

          // 解析工具调用
          let calls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = [];
          try {
            calls = JSON.parse(toolCallJson);
          } catch { break; }

          // 检查是否有 request_agent
          const agentCall = calls.find((c) => c.function?.name === 'request_agent');
          if (agentCall) {
            // ── request_agent → 路由到 TaskGateway ──
            // 保留 assistant 消息在 LLM 上下文中（不删除），但把内容替换为简短摘要
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === assistantMsgId
                  ? { ...m, content: roundText || '正在分析任务...', status: 'done' as const }
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
            const agentLabel = { computeruse: '🖥️ 计算机操作', web: '🌐 浏览器', document: '📄 文档', code: '💻 代码' }[selectedAgent] ?? selectedAgent;

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
                  set((s) => {
                    s.messages = [...s.messages, {
                      id: msgId,
                      conversationId,
                      role: 'tool' as const,
                      content: resultText,
                      timestamp: now,
                      status: 'done' as const,
                      _agentInternal: true,
                      _agentType: selectedAgent,
                    }];
                  });
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
            if (selectedAgent === 'document') {
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
              .filter((m) => m.status !== 'streaming' && m.role !== 'system' && !m._agentInternal)
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
                s.messages = [...s.messages, {
                  id: crypto.randomUUID(),
                  conversationId,
                  role: 'assistant' as const,
                  content: errorContent,
                  timestamp: new Date().toISOString(),
                  status: 'error' as const,
                  _agentInternal: true,
                  _agentType: selectedAgent,
                  _taskContext: abortActionMem ? { _actionMemory: abortActionMem } : undefined,
                }];
                // 更新 Agent 开始消息状态
                s.messages = s.messages.map((m) =>
                  m.id === agentStartMsgId ? { ...m, status: 'done' as const, content: `${agentLabel} Agent 执行中断` } : m,
                );
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

            // 构建给 Chat LLM 的 tool 结果数据
            const agentResultData: Record<string, unknown> = { agent: selectedAgent };
            if (responseMessage) agentResultData.response = responseMessage;
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

            // 标记 assistant 消息的 toolCalls，让 Chat LLM 知道它调用了 request_agent
            const requestAgentCallId = agentCall.id || crypto.randomUUID();
            const requestAgentArgs = agentCall.function?.arguments ?? '{}';
            set((s) => {
              s.messages = s.messages.map((m) =>
                m.id === assistantMsgId
                  ? {
                      ...m,
                      status: 'done' as const,
                      toolCalls: [{
                        id: requestAgentCallId,
                        function: { name: 'request_agent', arguments: requestAgentArgs },
                      }],
                    }
                  : m,
              );
            });

            // 折叠摘要（仅展示）+ tool 结果消息（进入 LLM 上下文）
            const foldedId = crypto.randomUUID();
            const foldedMsg: ChatMessage = {
              id: foldedId, conversationId,
              role: 'assistant', content: foldedSummary,
              timestamp: new Date().toISOString(), status: 'done',
              _agentInternal: true, _isAgentStart: true, _agentType: selectedAgent,
            };
            const toolResultMsgId = crypto.randomUUID();
            const toolResultMsg: ChatMessage = {
              id: toolResultMsgId, conversationId,
              role: 'tool', content: JSON.stringify({ success, message: responseMessage || (success ? 'OK' : 'Failed'), data: agentResultData }),
              toolCallId: requestAgentCallId,
              timestamp: new Date().toISOString(), status: 'done',
              _agentType: selectedAgent,
              _taskContext: taskContext,
            };

            set((s) => {
              s.messages = [...s.messages, foldedMsg, toolResultMsg];
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
          const allowedTools = toolFilter ?? (useBasicTools ? getChatBasicTools() : new Set(executor.enabledToolNames));
          const basicCalls = calls.filter((c) => c.function?.name && allowedTools.has(c.function.name));
          if (basicCalls.length === 0) break; // 没有可执行的基础工具

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
                m.id === assistantMsgId
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

          // Update the assistant message with toolCalls so the LLM can see
          // which tools were called in the conversation history.
          const toolCallsForAssistant = basicCalls.map((c) => ({
            id: c.id || crypto.randomUUID(),
            type: 'function' as const,
            function: {
              name: c.function!.name!,
              arguments: c.function!.arguments ?? '{}',
            },
          }));
          set((s) => {
            s.messages = s.messages.map((m) =>
              m.id === assistantMsgId
                ? { ...m, toolCalls: toolCallsForAssistant, content: roundText }
                : m,
            );
          });

          for (const call of basicCalls) {
            const toolName = call.function!.name!;
            const toolCallId = call.id || crypto.randomUUID();
            let args: Record<string, unknown> = {};
            try { args = JSON.parse(call.function!.arguments ?? '{}'); } catch { /* empty args */ }

            // run_command 需要确认
            if (toolName === 'run_command') {
              const command = args.command as string;
              const confirmed = await new Promise<boolean>((resolve) => {
                set((s) => {
                  s.awaitingConfirmation = { toolName: 'run_command', args: { command }, command };
                  s._pendingResolve = (v: { confirmed: boolean }) => resolve(v.confirmed);
                });
              });
              if (!confirmed) {
                const rejectMsgId = crypto.randomUUID();
                const rejectContent = JSON.stringify({ success: false, message: `用户拒绝执行: ${command}` });
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

            // 执行工具
            const result = await executor.executeToolCall(toolName, args);

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
            const toolResultContent = JSON.stringify(filteredResult);
            set((s) => {
              s.messages = [...s.messages, {
                id: toolResultMsgId,
                conversationId,
                role: 'tool' as const,
                toolCallId,
                content: toolResultContent,
                timestamp: new Date().toISOString(),
                status: 'done' as const,
              }];
            });
            await db.execute(
              'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
              [toolResultMsgId, conversationId, 'tool', toolResultContent, new Date().toISOString(), toolCallId],
            );
          }

          // 继续下一轮 LLM 调用（让 LLM 看到工具结果后决定下一步）
        }

        // ── 完成 ──
        const finalMessages = get().messages;
        const assistantMsg = finalMessages.find((m) => m.id === assistantMsgId);
        set((s) => {
          s.messages = s.messages.map((m) =>
            m.id === assistantMsgId ? { ...m, status: 'done' as const } : m,
          );
          s.isStreaming = false;
          s.streamingConversationId = null;
          s._abortController = null;
        });
        const toolCallsJson = assistantMsg?.toolCalls?.length
          ? JSON.stringify(assistantMsg.toolCalls)
          : null;
        await db.execute(
          'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_calls, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
          [assistantMsgId, conversationId, 'assistant', responseText, new Date().toISOString(), toolCallsJson],
        );
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
