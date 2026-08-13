import type { ChatMessage, LLMMessage } from '@/types/message';
import type { ToolCallEntry } from '@/types/chat';
import type { SQLiteAdapter } from '@/db/adapter';
import type { FreeAgentGateway } from '@/services/free-agent';

export interface FreeAgentContext {
  get: () => { messages: ChatMessage[] };
  set: (fn: (s: { messages: ChatMessage[] }) => void) => void;
  gateway: FreeAgentGateway;
  userText: string;
  provider: Record<string, unknown>;
  apiKey: string;
  password?: string;
  abortController: AbortController;
  conversationId: string;
  db: SQLiteAdapter;
  systemExtra?: string;
  historyBeforeCurrent: ChatMessage[];
}

/**
 * FreeAgent 分支：toolMode=all 时使用 FreeAgentGateway 执行全工具开放模式。
 * 返回 true 表示已处理（调用方应 return）。
 */
export async function handleFreeAgent(ctx: FreeAgentContext): Promise<boolean> {
  const {
    get, set, gateway, userText, provider, apiKey, password,
    abortController, conversationId, db, systemExtra, historyBeforeCurrent,
  } = ctx;

  try {
    // 按轮次管理 assistant 消息：每个 turn 一条，保留 runner 产出的自然交替结构。
    // UI 渲染时合并连续 assistant 为一条气泡，存储层不做变形。
    const turnAssistants = new Map<number, string>(); // turn → msgId
    const getOrCreateAssistant = (turn: number, s: { messages: ChatMessage[] }): ChatMessage => {
      let msgId = turnAssistants.get(turn);
      if (msgId) return s.messages.find(m => m.id === msgId)!;
      msgId = crypto.randomUUID();
      turnAssistants.set(turn, msgId);
      const msg: ChatMessage = {
        id: msgId, role: 'assistant', content: '',
        status: 'streaming', timestamp: new Date().toISOString(),
        toolCalls: [],
      } as ChatMessage;
      s.messages.push(msg);
      return msg;
    };

    // 构建对话历史：不过滤 _agentInternal（已统一为 0），所有消息直接注入
    console.log(`[FreeAgent] historyBeforeCurrent: ${historyBeforeCurrent.length} 条`);
    for (const m of historyBeforeCurrent) {
      console.log(`  [${m.role}] toolCalls=${(m as any).toolCalls?.length ?? 'none'} toolCallId=${(m as any).toolCallId ?? 'none'} content=${typeof m.content === 'string' ? m.content.substring(0, 60) : '[array]'}`);
    }

    const chatMessages: LLMMessage[] = historyBeforeCurrent
      .filter((m) => m.role !== 'system')
      .map((m): LLMMessage => {
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
    console.log(`[FreeAgent] chatMessages: ${chatMessages.length} 条`);
    for (const m of chatMessages) {
      console.log(`  [${m.role}] toolCalls=${m.toolCalls?.length ?? 'none'} toolCallId=${m.toolCallId ?? 'none'} content=${typeof m.content === 'string' ? m.content.substring(0, 60) : '[array]'}`);
    }

    const result = await gateway.handleUserGoal({
      goal: userText,
      provider,
      apiKey,
      password,
      signal: abortController.signal,
      maxTurns: 30,
      customSystemPrompt: systemExtra || '',
      chatMessages,
      onProgress: async (ev) => {
        if (ev.type === 'stream_chunk') {
          set((s) => {
            const msg = getOrCreateAssistant(ev.turn, s);
            msg.content = (msg.content || '') + ev.text;
            if (ev.reasoning) msg.reasoning_content = ev.reasoning;
          });
        } else if (ev.type === 'llm_thinking') {
          set((s) => {
            const msg = getOrCreateAssistant(ev.turn, s);
            if (ev.reasoning) msg.reasoning_content = ev.reasoning;
            if (!msg.content && ev.text && ev.text.trim()) {
              msg.content = ev.text;
            }
          });
        } else if (ev.type === 'tool_start') {
          const toolCall: ToolCallEntry = {
            id: `${ev.name}-${ev.turn}`,
            type: 'function',
            function: { name: ev.name, arguments: JSON.stringify(ev.args) },
          };
          set((s) => {
            const msg = getOrCreateAssistant(ev.turn, s);
            msg.toolCalls = [...(msg.toolCalls || []), toolCall];
            if (['finalize', 'desktop_done', 'web_done', 'doc_done', 'code_done'].includes(ev.name)) {
              const summary = ev.args?.summary || ev.args?.message;
              if (summary && typeof summary === 'string') msg.content = summary;
            } else if (!msg.content || (typeof msg.content === 'string' && msg.content.length === 0)) {
              const toolNames = (msg.toolCalls || []).map((tc: ToolCallEntry) => tc.function.name);
              msg.content = `🔧 正在执行：${toolNames.join(' → ')}`;
            }
          });
        } else if (ev.type === 'tool_end') {
          const toolMsgId = crypto.randomUUID();
          const toolCallId = `${ev.name}-${ev.turn}`;
          const toolResult = ev.message
            ? (typeof ev.message === 'string' ? ev.message : JSON.stringify(ev.message))
            : `ok`;
          const isDoneTool = ['finalize', 'desktop_done', 'web_done', 'doc_done', 'code_done'].includes(ev.name);
          set((s) => {
            const turnId = turnAssistants.get(ev.turn);
            if (turnId) {
              const msg = s.messages.find((m) => m.id === turnId);
              if (msg) {
                if (isDoneTool && (!msg.content || typeof msg.content !== 'string' || !msg.content.trim())) {
                  msg.content = ev.message && typeof ev.message === 'string' ? ev.message : `✓ 完成`;
                }
                if (!isDoneTool && (!msg.content || typeof msg.content !== 'string' || !msg.content.trim())) {
                  const toolNames = (msg.toolCalls || []).map((tc: ToolCallEntry) => tc.function.name);
                  msg.content = `🔧 已执行：${toolNames.join(' → ')}`;
                }
              }
            }
            s.messages.push({
              id: toolMsgId, role: 'tool', content: toolResult,
              timestamp: new Date().toISOString(), toolCallId,
              _internal: true,
            } as ChatMessage);
          });
          // 持久化 tool 消息到 DB
          await db.execute(
            'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'free\')',
            [toolMsgId, conversationId, 'tool', toolResult, new Date().toISOString(), toolCallId],
          );
        } else if (ev.type === 'agent_done') {
          set((s) => {
            for (const msgId of turnAssistants.values()) {
              const msg = s.messages.find((m) => m.id === msgId);
              if (msg) msg.status = ev.success ? 'done' : 'error';
            }
          });
        }
      },
    });

    // 所有轮次的 assistant 标记为 done，无内容的兜底
    set((s) => {
      for (const msgId of turnAssistants.values()) {
        const msg = s.messages.find((m) => m.id === msgId);
        if (msg) {
          if (msg.status === 'streaming') msg.status = 'done';
          if (!msg.content || (typeof msg.content === 'string' && msg.content.length === 0)) {
            msg.content = result.message || '任务完成';
          }
        }
      }
    });

    // 持久化所有轮次的 assistant 到 DB（agent_internal=0，不做变形）
    try {
      const currentMessages = get().messages;
      for (const msgId of turnAssistants.values()) {
        const msg = currentMessages.find((m) => m.id === msgId);
        if (!msg) continue;
        const serContent = typeof msg.content === 'string' ? msg.content : '';
        await db.execute(
          'INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, ?, 0, \'free\')',
          [
            msg.id, conversationId, 'assistant', serContent,
            msg.timestamp, msg.reasoning_content ?? null,
            msg.toolCalls?.length ? JSON.stringify(msg.toolCalls) : null,
          ],
        );
      }
    } catch (dbErr) {
      console.warn('[ChatStore] FreeAgent 持久化 assistant 消息失败:', dbErr);
    }

    return true;
  } catch (err) {
    set((s) => {
      // @ts-expect-error accessing error on state
      s.error = `FreeAgent 执行失败: ${err instanceof Error ? err.message : String(err)}`;
      // @ts-expect-error accessing isStreaming on state
      s.isStreaming = false;
    });
    return true;
  }
}
