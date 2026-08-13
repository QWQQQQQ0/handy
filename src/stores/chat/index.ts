// 来源: lib/providers/chat_provider.dart

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import type { ChatMessage, MessageContent } from '@/types/message';
import type { ConversationRow } from '@/db';
import { getDB } from '@/db';
import { serializeContent, deserializeContent } from '@/utils/content';
import { AgentEndpoint } from '@/api/types';
import { sendMessage, saveMsgToDb, type SendMessageOptions } from './send-message';
import { ToolMode } from './tool-config';

// Re-export for external consumers
export { ToolMode } from './tool-config';
export { sendMessage } from './send-message';

// ── Types ──

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

interface ChatState {
  activeConversation: Conversation | null;
  conversations: Conversation[];
  messages: ChatMessage[];
  debugMessages: ChatMessage[];
  isStreaming: boolean;
  streamingConversationId: string | null;
  _abortController: AbortController | null;
  error: string | null;
  toolMode: ToolMode;
  customTools: Set<string>;
  stickyAgent: { context: string; label: string } | null;
  setStickyAgent: (agent: { context: string; label: string } | null) => void;

  // Tool confirmation state
  awaitingConfirmation?: {
    toolName: string;
    args: Record<string, unknown>;
    command: string;
  };
  awaitingUserInput?: {
    message: string;
    fields: Array<{ label: string; key: string; type?: string }>;
  };
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
  setCustomToolsRaw: (tools: Set<string>) => void;
  toggleCustomTool: (toolName: string) => void;
  clearError: () => void;

  // Actions — message manipulation
  deleteMessage: (messageId: string) => Promise<void>;
  editMessage: (messageId: string, newContent: string) => Promise<void>;

  // Actions — streaming
  sendMessage: (content: MessageContent, password?: string, options?: SendMessageOptions) => Promise<void>;
  stopChat: () => void;
  confirmToolCall: () => Promise<void>;
  rejectToolCall: () => Promise<void>;
  submitUserInput: (values: Record<string, string>) => Promise<void>;
}

// ── Store ──

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
        set({ activeConversation: null, messages: [], debugMessages: [], error: null, stickyAgent: null });
        try { localStorage.removeItem(`openpaw_sticky_agent:${id}`); } catch { /* ignore */ }
      }
      await get().loadConversations();
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
    setCustomToolsRaw: (tools: Set<string>) => set({ customTools: tools }),
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

      const idsToDelete = new Set<string>();
      idsToDelete.add(messageId);

      if (msgs[targetIdx].role === 'user') {
        for (let i = targetIdx + 1; i < msgs.length; i++) {
          const m = msgs[i];
          if (m.role === 'user') break;
          idsToDelete.add(m.id);
        }
      }

      set((s) => { s.messages = s.messages.filter((m) => !idsToDelete.has(m.id)); });
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

      const subsequentIds = msgs.slice(targetIdx + 1).map((m) => m.id);

      set((s) => {
        s.messages = s.messages
          .map((m) => m.id === messageId ? { ...m, content: newContent } : m)
          .filter((m) => m.id === messageId || !subsequentIds.includes(m.id));
      });

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

    sendMessage: async (content, password, options) => {
      await sendMessage({ get, set }, content, password, options);
    },

    stopChat: () => {
      const ctrl = get()._abortController;
      if (ctrl) ctrl.abort();
      set((s) => {
        s.isStreaming = false;
        s.streamingConversationId = null;
        s._abortController = null;
        s.messages = s.messages.map((m) =>
          m.status === 'streaming' ? { ...m, status: 'done' as const } : m,
        );
      });
    },
  }))
);
