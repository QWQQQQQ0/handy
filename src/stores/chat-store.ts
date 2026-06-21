// 来源: lib/providers/chat_provider.dart

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ChatMessage, MessageContent, LLMMessage } from '@/types/message';
import type { ConversationRow } from '@/db';
import { getDB } from '@/db';
import { serializeContent, deserializeContent, hasImages } from '@/utils/content';
import { resolveMultimodalProvider } from '@/utils/multimodal-provider';
import { isMobile } from '@/utils/platform';
import { useModelConfigStore } from './model-config-store';
import { useSettingsStore } from './settings-store';

// Chat 基础工具 —— 只保留系统配置工具，业务工具通过 request_agent 路由到各 agent
const DESKTOP_CHAT_TOOLS = new Set([
  'web_search', 'web_fetch',
  'agent_memory_update',
  // System config tools
  'list_skills', 'toggle_skill',
  'list_models', 'switch_model', 'add_model', 'update_model',
  'get_settings', 'update_settings',
  'list_watchers',
]);

const MOBILE_CHAT_TOOLS = new Set([
  'web_search', 'web_fetch',
  'agent_memory_update',
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
const MAX_MESSAGES = 50;  // 最多保留 50 条消息
const MAX_IMAGE_AGE = 10; // 超过 10 条消息的图片会被清理

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

  // Actions — streaming
  sendMessage: (content: MessageContent, password: string, options?: { noSystemPrompt?: boolean }) => Promise<void>;
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

    sendMessage: async (content, password, options) => {
      const noSystemPrompt = options?.noSystemPrompt ?? false;
      const state = get();
      // 按会话检查：只有同一个会话在 streaming 时才阻塞
      if (state.isStreaming && state.streamingConversationId === state.activeConversation?.id) return;

      const abortController = new AbortController();
      set({ isStreaming: true, streamingConversationId: state.activeConversation?.id ?? null, _abortController: abortController, error: null, debugMessages: [] });

      // 内存优化：清理旧消息中的图片，避免内存无限增长
      set((s) => {
        const msgs = s.messages;
        if (msgs.length > MAX_MESSAGES) {
          // 裁剪消息数量
          s.messages = msgs.slice(-MAX_MESSAGES);
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

        // Save user message to DB
        const db = await getDB();
        const userMsgId = crypto.randomUUID();
        const serContent = serializeContent(content);
        await db.execute(
          'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
          [userMsgId, conversationId, 'user', serContent, new Date().toISOString()]
        );
        await db.execute(
          'UPDATE conversations SET updated_at = ? WHERE id = ?',
          [new Date().toISOString(), conversationId]
        );

        // Load existing messages
        await get().loadMessages(conversationId);

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
            description: '将用户请求委托给专业 agent 处理。根据任务类型选择合适的 agent。',
            parameters: {
              type: 'object',
              properties: {
                agent: {
                  type: 'string',
                  enum: ['computeruse', 'web', 'document', 'code'],
                  description: 'computeruse = 兜底选项。当任务无法明确归类到 web/document/code 时选择此 agent，它具备意图分类能力，会自动筛选工具执行。\nweb = 浏览器操作（页面浏览、搜索、导航、元素交互、数据抓取）\ndocument = 文档操作（Word/Excel/PPT/WPS 的读取、编辑、生成）\ncode = 代码与文件操作（读写文件、搜索文件、生成代码、执行命令）',
                },
                reason: { type: 'string', description: '委托原因' },
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
        } else {
          // ToolMode.all → 用基础工具集
          toolFilter = getChatBasicTools();
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
        let prevToolCalls: Array<{ name: string; args: string }> = [];
        for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
          if (abortController.signal.aborted) break;
          // Build LLM messages preserving full structure: toolCalls, tool role,
          // toolCallId. Previously this filtered to only user/assistant and
          // stripped toolCalls, causing the LLM to never see tool results and
          // loop on the same tool call endlessly.
          const historyMsgs = get().messages
            .filter((m) => m.status !== 'streaming' && m.role !== 'system')
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
              supportsTools: true,
              createdAt: '',
            },
            apiKey,
            tools: allTools,
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
            try {
              const args = JSON.parse(agentCall.function?.arguments ?? '{}') as { agent?: string };
              selectedAgent = args.agent ?? 'computeruse';
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

            // onProgress 回调：追加 Agent 内部消息到主会话
            const onProgress = (event: import('@/services/task-agent').AgentProgressEvent) => {
              const msgId = crypto.randomUUID();
              const now = new Date().toISOString();

              switch (event.type) {
                case 'turn_start': {
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
              .filter((m) => m.status !== 'streaming' && m.role !== 'system')
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

            let response;
            try {
              response = await gateway.handleUserMessage({
                content: userText,
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
              // 异常时追加错误消息
              const errorContent = `❌ 任务异常: ${err instanceof Error ? err.message : String(err)}`;
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
                }];
                // 更新 Agent 开始消息状态
                s.messages = s.messages.map((m) =>
                  m.id === agentStartMsgId ? { ...m, status: 'done' as const, content: `${agentLabel} Agent 执行异常` } : m,
                );
                s.isStreaming = false;
                s.streamingConversationId = null;
                s._abortController = null;
              });
              return;
            }

            // 构建最终结果消息（展示完整执行结果）
            const tasks = (response.tasks ?? []) as Array<Record<string, unknown>>;
            const responseMessage = (response.message ?? '') as string;
            const success = tasks.length > 0 ? tasks.every((t) => t.status === 'done') : !!responseMessage;
            const resultParts: string[] = [];

            // 执行摘要
            resultParts.push(success ? '✅ 任务执行完成' : '❌ 任务执行失败');

            // 每个 task 的结果
            for (const task of tasks) {
              const taskMessage = task.message as string | undefined;
              const taskError = task.error as string | undefined;
              if (taskMessage) resultParts.push(`• ${taskMessage}`);
              if (taskError) resultParts.push(`• 错误: ${taskError}`);
            }

            // 如果有顶层 message，添加
            if (responseMessage && !resultParts.some(p => p.includes(responseMessage))) {
              resultParts.push(responseMessage);
            }

            const agentResultContent = resultParts.join('\n');
            const agentResultMsgId = crypto.randomUUID();

            set((s) => {
              s.messages = [...s.messages, {
                id: agentResultMsgId,
                conversationId,
                role: 'assistant' as const,
                content: agentResultContent,
                timestamp: new Date().toISOString(),
                status: 'done' as const,
                _agentInternal: false,  // 最终结果消息不是内部消息，正常展示
              }];
              // 更新 Agent 开始消息状态
              s.messages = s.messages.map((m) =>
                m.id === agentStartMsgId ? { ...m, status: 'done' as const, content: `${agentLabel} Agent ${success ? '执行完成' : '执行失败'}` } : m,
              );
              s.isStreaming = false;
              s.streamingConversationId = null;
              s._abortController = null;
            });

            // 保存到数据库
            await db.execute(
              'INSERT INTO messages (id, conversation_id, role, content, timestamp) VALUES (?, ?, ?, ?, ?)',
              [agentResultMsgId, conversationId, 'assistant', agentResultContent, new Date().toISOString()]
            );
            return; // agent 处理完毕，直接返回
          }

          // ── 执行基础工具调用 ──
          const allowedTools = toolFilter ?? getChatBasicTools();
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
                'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id) VALUES (?, ?, ?, ?, ?, ?)',
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
                  'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id) VALUES (?, ?, ?, ?, ?, ?)',
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
              'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id) VALUES (?, ?, ?, ?, ?, ?)',
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
          'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_calls) VALUES (?, ?, ?, ?, ?, ?)',
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
