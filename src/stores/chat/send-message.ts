import type { ChatMessage, MessageContent } from '@/types/message';
import type { SQLiteAdapter } from '@/db/adapter';
import { serializeContent, hasImages } from '@/utils/content';
import { resolveMultimodalProvider } from '@/utils/multimodal-provider';
import { useModelConfigStore } from '@/stores/model-config-store';
import { useSettingsStore } from '@/stores/settings-store';
import { ToolMode } from './tool-config';
import { handleFreeAgent } from './free-agent-handler';
import { handleToolLoop } from './tool-loop-handler';

// 消息历史限制
const MAX_MESSAGES = 200;
const MAX_IMAGE_AGE = 10;

// ── DB write helper ──

export async function saveMsgToDb(msg: ChatMessage, db: SQLiteAdapter) {
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
}

// ── sendMessage 主函数 ──

export interface SendMessageOptions {
  noSystemPrompt?: boolean;
  skipAddUserMessage?: boolean;
  systemExtra?: string;
  useFreeAgent?: boolean;
  agentName?: string;
  agentContext?: string;
}

export interface SendMessageDeps {
  get: () => Record<string, unknown>;
  set: (fn: (s: Record<string, unknown>) => void) => void;
}

export async function sendMessage(
  deps: SendMessageDeps,
  content: MessageContent,
  password?: string,
  options?: SendMessageOptions,
): Promise<void> {
  const { get, set } = deps;
  console.log('[chat-store] sendMessage options:', options);
  const noSystemPrompt = options?.noSystemPrompt ?? false;
  const skipAddUserMessage = options?.skipAddUserMessage ?? false;
  const systemExtra = options?.systemExtra;
  const state = get() as Record<string, unknown>;
  // 按会话检查：只有同一个会话在 streaming 时才阻塞
  if (state.isStreaming && state.streamingConversationId === (state.activeConversation as Record<string, unknown>)?.id) return;

  const abortController = new AbortController();
  set((s) => {
    s.isStreaming = true;
    s.streamingConversationId = ((s.activeConversation as Record<string, unknown>)?.id as string) ?? null;
    s._abortController = abortController;
    s.error = null;
    s.debugMessages = [];
  });

  // 内存优化：清理旧消息中的图片
  set((s) => {
    const msgs = s.messages as ChatMessage[];
    if (msgs.length > MAX_MESSAGES) {
      const nonInternal = msgs.filter(m => !m._agentInternal);
      const internal = msgs.filter(m => m._agentInternal);
      const excess = msgs.length - MAX_MESSAGES;
      if (excess > 0) {
        const keepInternal = internal.slice(Math.min(excess, internal.length));
        const keepNonInternal = nonInternal.length > MAX_MESSAGES
          ? nonInternal.slice(-MAX_MESSAGES) : nonInternal;
        s.messages = [...keepInternal, ...keepNonInternal].sort(
          (a: ChatMessage, b: ChatMessage) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
        );
      }
    }
    const cutoff = (s.messages as ChatMessage[]).length - MAX_IMAGE_AGE;
    s.messages = (s.messages as ChatMessage[]).map((m, i) => {
      if (i < cutoff && Array.isArray(m.content)) {
        const hasImg = m.content.some((p: Record<string, unknown>) => p.type === 'image_url');
        if (hasImg) {
          return {
            ...m,
            content: m.content.map((p: Record<string, unknown>) =>
              p.type === 'image_url'
                ? { type: 'text' as const, text: '[图片已清理]' }
                : p,
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
      set((s) => {
        s.error = 'No model configured. Please add a model provider first.';
        s.isStreaming = false;
        s.streamingConversationId = null;
        s._abortController = null;
      });
      return;
    }

    // 多模态自动切换
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
    let currentConv = state.activeConversation as Record<string, unknown> | null;

    if (!currentConv) {
      const text = typeof content === 'string' ? content : content
        .filter((p: Record<string, unknown>) => p.type === 'text')
        .map((p: Record<string, unknown>) => p.type === 'text' ? p.text : '')
        .join(' ');
      const title = text.length > 50 ? text.substring(0, 50) + '...' : text;
      // createConversation is on the store, call via get()
      const conv = await (get() as Record<string, unknown>).createConversation as (pid: string, t: string) => Promise<Record<string, unknown>>;
      currentConv = await conv(provider.id, title);
      set((s) => { s.activeConversation = currentConv; });
    }
    conversationId = currentConv!.id as string;

    // @ 长效保持
    if (options?.agentContext) {
      const ctx = options.agentContext;
      const label = ctx.startsWith('knowledge_source:') ? ctx.slice(17)
        : ctx.startsWith('knowledge_skill:') ? ctx.slice(16)
        : ctx.startsWith('custom_agent:') ? ctx.slice(13)
        : ctx.replace(/^Agent\s+"(.+)".*/s, '$1');
      try {
        localStorage.setItem(`openpaw_sticky_agent:${conversationId}`, JSON.stringify({ context: ctx, label }));
      } catch { /* ignore */ }
      set((s) => { s.stickyAgent = { context: ctx, label }; });
    }

    const { getDB } = await import('@/db');
    const db = await getDB();
    // 捕获当前消息作为对话历史
    const historyBeforeCurrent = (get() as Record<string, unknown>).messages as ChatMessage[];

    // Save user message to DB
    if (!skipAddUserMessage) {
      const userMsgId = crypto.randomUUID();
      const serContent = serializeContent(content);
      await db.execute(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, 0, \'\')',
        [userMsgId, conversationId, 'user', serContent, new Date().toISOString()],
      );
      await db.execute(
        'UPDATE conversations SET updated_at = ? WHERE id = ?',
        [new Date().toISOString(), conversationId],
      );
      // Load existing messages
      await (get() as Record<string, unknown>).loadMessages as (cid: string) => Promise<void>;
      await ((get() as Record<string, unknown>).loadMessages as (cid: string) => Promise<void>)(conversationId);
    }

    const existingMsgIds = new Set(((get() as Record<string, unknown>).messages as ChatMessage[]).map(m => m.id));

    // Load skills from DB
    const { useSkillStore } = await import('@/stores/skill-store');
    const skillStore = useSkillStore.getState();
    await skillStore.initializeSkills();

    const { initBuiltinExecutor, setCodeToolsModelService } = await import('@/skills/builtin-executor');
    const dbConfigs = skillStore.allConfigs.filter((c) => c.builtin);
    const executor = await initBuiltinExecutor(dbConfigs);
    executor.disabledTools = settingsStore.disabledTools;

    const { getModelService } = await import('@/services/model-service-singleton');
    setCodeToolsModelService(getModelService(), provider, apiKey);

    for (const skill of skillStore.getUserSkillInstances()) {
      if (skill.config.exposedToAI === false) continue;
      skill.setExecutor(executor);
      executor.register(skill);
    }

    const userText = typeof content === 'string'
      ? content
      : content.filter((p: Record<string, unknown>) => p.type === 'text').map((p: Record<string, unknown>) => p.text).join(' ');

    // ── 判断是否使用 FreeAgent ──
    const toolModeForCheck = (get() as Record<string, unknown>).toolMode as ToolMode;
    const shouldUseFreeAgent = options?.useFreeAgent
      || (!options?.agentName && toolModeForCheck === ToolMode.all);

    console.log('[ChatStore] FreeAgent decision:', {
      toolMode: toolModeForCheck,
      optionsUseFreeAgent: options?.useFreeAgent,
      optionsAgentName: options?.agentName,
      shouldUseFreeAgent,
    });

    if (shouldUseFreeAgent) {
      const { FreeAgentGateway } = await import('@/services/free-agent');
      const gateway = new FreeAgentGateway(executor);

      const handled = await handleFreeAgent({
        get: get as () => { messages: ChatMessage[] },
        set: set as (fn: (s: { messages: ChatMessage[] }) => void) => void,
        gateway,
        userText,
        provider: provider as unknown as Record<string, unknown>,
        apiKey,
        password,
        abortController,
        conversationId,
        db,
        systemExtra,
        historyBeforeCurrent,
      });
      if (handled) {
        set((s) => { s.isStreaming = false; });
        return;
      }
    }

    // ── Tool Loop 分支 ──
    await handleToolLoop({
      get: get as () => import('./tool-loop-handler').ChatStateGetter,
      set: set as import('./tool-loop-handler').SetFn,
      provider: provider as unknown as Record<string, unknown>,
      apiKey,
      password,
      abortController,
      conversationId,
      db,
      executor,
      existingMsgIds,
      agentName: options?.agentName,
      systemExtra,
    });

  } catch (e) {
    set((s) => {
      s.error = String(e);
      s.isStreaming = false;
      s.streamingConversationId = null;
      s._abortController = null;
    });
  }
}
