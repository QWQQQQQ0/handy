// FreeAgent 独立页面 — 全能力 AI 开发者
// 使用通用 ChatPanel 组件 + DB 消息持久化

import { useState, useRef, useCallback, useEffect } from 'react';
import { Code, Globe, Trash2 } from 'lucide-react';
import { useModelConfigStore } from '@/stores/model-config-store';
import { FreeAgentGateway } from '@/services/free-agent';
import type { AgentProgressEvent } from '@/services/task-agent/runner';
import { ChatPanel } from '@/components/chat/chat-panel';
import type { DisplayMessage, ToolCallEntry, ConfirmationState, UserInputFormState } from '@/types/chat';
import type { MessageContent } from '@/types/message';
import { extractText } from '@/utils/content';
import { getDB } from '@/db';
import { retrieveRelevantExperiences, formatExperiencesForPrompt } from '@/services/task-memory';

// FreeAgent 固定 conversation_id（单对话模式）
const FREE_AGENT_CONV_ID = 'free-agent-default';

// ── DB persistence ──

async function loadMessages(): Promise<DisplayMessage[]> {
  try {
    const db = await getDB();
    const rows = await db.query<{
      id: string; role: string; content: string; timestamp: string;
      reasoning_content: string | null; tool_calls: string | null;
    }>(
      `SELECT id, role, content, timestamp, reasoning_content, tool_calls
       FROM messages WHERE conversation_id = ? AND agent_internal = 0
       ORDER BY timestamp ASC`,
      [FREE_AGENT_CONV_ID],
    );
    return rows.map((r) => ({
      id: r.id,
      role: (r.role === 'user' || r.role === 'assistant') ? r.role : 'assistant',
      content: r.content,
      status: 'done' as const,
      timestamp: r.timestamp,
      reasoning_content: r.reasoning_content ?? undefined,
      toolCalls: r.tool_calls ? (safeParse(r.tool_calls) || undefined) : undefined,
    }));
  } catch {
    return [];
  }
}

async function saveMessage(msg: DisplayMessage): Promise<void> {
  try {
    const db = await getDB();
    const toolCallsJson = msg.toolCalls?.length ? JSON.stringify(msg.toolCalls) : null;
    await db.execute(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, agent_internal, agent_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, '')`,
      [msg.id, FREE_AGENT_CONV_ID, msg.role, msg.content, msg.timestamp ?? new Date().toISOString(), msg.reasoning_content ?? null, toolCallsJson],
    );
  } catch { /* non-critical */ }
}

function safeParse(s: string): ToolCallEntry[] | null {
  try { const v = JSON.parse(s); return Array.isArray(v) ? v as ToolCallEntry[] : null; } catch { return null; }
}

// ── Component ──

export default function FreeAgentPage() {
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [previewHtml, setPreviewHtml] = useState<string | null>(null);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  const [streamingToolCalls, setStreamingToolCalls] = useState<ToolCallEntry[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // ── 安全确认状态 ──
  const [confirmationState, setConfirmationState] = useState<ConfirmationState | undefined>();
  const [userInputForm, setUserInputForm] = useState<UserInputFormState | undefined>();

  // Load history + init skill store on mount（@ 下拉需要知识型 skill 数据）
  useEffect(() => {
    loadMessages().then(setMessages);
    import('@/stores/skill-store').then(({ useSkillStore }) => {
      useSkillStore.getState().initializeSkills();
    });
  }, []);

  const handleSend = useCallback(async (content: MessageContent, agentContext?: string) => {
    const rawText = extractText(content);
    if (!rawText || isRunning) return;

    // ── 集中 @ 解析（FreeAgent 仅支持知识型 skill）──
    const { resolveAgentMention } = await import('@/services/agent-mention-resolver');
    const resolved = await resolveAgentMention(agentContext);
    const systemExtra = resolved?.systemExtra ?? '';
    const text = rawText;

    setError(null);
    setIsRunning(true);
    setStreamingText('');
    setStreamingReasoning('');
    setStreamingToolCalls([]);
    setPreviewHtml(null);
    setPreviewImage(null);

    const abortController = new AbortController();
    abortRef.current = abortController;

    const userMsg: DisplayMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      content: text,
      status: 'done',
      timestamp: new Date().toISOString(),
    };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    saveMessage(userMsg);

    const assistantMsgId = crypto.randomUUID();
    let assistantContent = '';
    let assistantReasoning = '';
    const toolCalls: ToolCallEntry[] = [];

    // ── 获取 provider 配置 ──
    await useModelConfigStore.getState().load();
    const config = useModelConfigStore.getState().defaultConfig();
    if (!config) {
      setError('未配置模型，请先在模型设置中添加一个模型。');
      setIsRunning(false);
      return;
    }
    const apiKey = await useModelConfigStore.getState().getApiKey(config.id, '');
    if (!apiKey) {
      setError('API Key 为空，请在模型设置中配置。');
      setIsRunning(false);
      return;
    }

    console.log('[FreeAgent] 🚀 provider config:', {
      type: config.type, model: config.model, baseUrl: config.baseUrl,
      thinkingMode: config.thinkingMode, supportsTools: config.supportsTools,
    });

    try {

      const { getBuiltinExecutor, initBuiltinExecutor, setCodeToolsModelService } = await import('@/skills/builtin-executor');

      // 确保 executor 已初始化（注册所有内置技能）
      const { useSkillStore } = await import('@/stores/skill-store');
      const skillStore = useSkillStore.getState();
      await skillStore.initializeSkills();
      const dbConfigs = skillStore.allConfigs.filter((c: { builtin?: boolean }) => c.builtin);
      const executor = await initBuiltinExecutor(dbConfigs);

      // 为 CodeTools 配置 LLM 访问能力
      const { getModelService } = await import('@/services/model-service-singleton');
      setCodeToolsModelService(getModelService(), config, apiKey);

      const gateway = new FreeAgentGateway(executor);

      // ── 检索相关历史经验，注入上下文 ──
      const relevantExps = await retrieveRelevantExperiences(text, 3);
      const expContext = formatExperiencesForPrompt(relevantExps);
      const enrichedGoal = expContext ? `${expContext}\n\n当前任务: ${text}` : text;

      // ── 构建对话历史（含工具执行记录，确保 LLM 有完整上下文） ──
      const historyMessages = messages.slice(-20).map((m) => {
        const role = (m.role === 'user' || m.role === 'assistant') ? m.role as 'user' | 'assistant' : 'assistant' as const;
        let content = m.content;
        // 把上一轮的工具执行链拼入 assistant 消息，LLM 才知道之前执行过什么
        if (role === 'assistant' && m.toolCalls && m.toolCalls.length > 0) {
          const toolSummary = m.toolCalls
            .map(tc => `${tc.success === false ? '❌' : '✅'} ${tc.name}${tc.message ? ': ' + tc.message : ''}`)
            .join('\n');
          content = content
            ? `${content}\n\n[本轮执行记录]\n${toolSummary}`
            : `[本轮执行记录]\n${toolSummary}`;
        }
        return { role, content };
      });

      const response = await gateway.handleUserGoal({
        goal: enrichedGoal,
        chatMessages: historyMessages.length > 0 ? historyMessages : undefined,
        provider: config,
        apiKey,
        customSystemPrompt: systemExtra || undefined,
        signal: abortController.signal,
        // ── 安全确认回调：run_command / execute_code 需要用户确认 ──
        onConfirm: (command: string) => {
          return new Promise<boolean>((resolve) => {
            setConfirmationState({
              command,
              toolName: 'run_command',
              args: { command },
              onConfirm: () => { setConfirmationState(undefined); resolve(true); },
              onReject: () => { setConfirmationState(undefined); resolve(false); },
            });
          });
        },
        onUserInput: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => {
          return new Promise<Record<string, string>>((resolve) => {
            setUserInputForm({
              message,
              fields,
              onSubmit: (values: Record<string, string>) => { setUserInputForm(undefined); resolve(values); },
            });
          });
        },
        onProgress: (event: AgentProgressEvent) => {
          switch (event.type) {
            case 'stream_chunk':
              // 实时推理流式推送
              if (event.reasoning) {
                setStreamingReasoning((prev) => prev + event.reasoning!);
                assistantReasoning += event.reasoning;
              }
              break;
            case 'llm_thinking':
              setStreamingText((prev) => prev + (event.text || ''));
              assistantContent += event.text || '';
              if (event.reasoning) {
                setStreamingReasoning((prev) => prev + event.reasoning!);
                assistantReasoning += event.reasoning;
              }
              break;
            case 'tool_start': {
              const tc: ToolCallEntry = {
                id: crypto.randomUUID(),
                name: event.name,
                args: event.args,
                status: 'running',
              };
              toolCalls.push(tc);
              setStreamingToolCalls([...toolCalls]);
              break;
            }
            case 'tool_end': {
              const tc = toolCalls.find((t) => t.name === event.name && t.status === 'running');
              if (tc) {
                tc.status = event.success ? 'done' : 'error';
                tc.success = event.success;
                tc.message = event.message;
              }
              setStreamingToolCalls([...toolCalls]);
              break;
            }
          }
        },
      });

      // 将 finalize 总结追加到 assistantContent 末尾（如果有且尚未包含）
      const finalSummary = response.tasks[0]?.message;
      if (finalSummary && !assistantContent.includes(finalSummary)) {
        assistantContent = assistantContent ? `${assistantContent}\n\n${finalSummary}` : finalSummary;
      }

      // Extract HTML/image preview
      if (finalSummary) {
        const msg = finalSummary;
        const htmlMatch = msg.match(/```html\n([\s\S]*?)```/) || msg.match(/<html[\s\S]*?<\/html>/i);
        if (htmlMatch) setPreviewHtml(htmlMatch[1] || htmlMatch[0]);
        const imgMatch = msg.match(/!\[.*?\]\((data:image\/[^)]+)\)/);
        if (imgMatch) setPreviewImage(imgMatch[1]);
      }
    } catch (e) {
      const errorMsg = e instanceof Error ? e.message : String(e);
      if (errorMsg !== 'AbortError' && !errorMsg.includes('abort')) {
        assistantContent += `\n\n> ⚠️ ${errorMsg}`;
        setError(errorMsg);
      }
    }

    setStreamingText('');
    setStreamingReasoning('');
    setStreamingToolCalls([]);

    const assistantMsg: DisplayMessage = {
      id: assistantMsgId,
      role: 'assistant',
      content: assistantContent || '任务执行完成',
      status: 'done',
      reasoning_content: assistantReasoning || undefined,
      toolCalls: toolCalls.length > 0 ? toolCalls.map(tc => ({ ...tc, status: tc.status as 'done' | 'error' | 'running' })) : undefined,
      timestamp: new Date().toISOString(),
    };
    const finalMessages = [...updatedMessages, assistantMsg];
    setMessages(finalMessages);
    saveMessage(assistantMsg);

    setIsRunning(false);
    abortRef.current = null;
  }, [messages, isRunning]);

  const handleStop = useCallback(() => {
    abortRef.current?.abort();
    setIsRunning(false);
  }, []);

  const clearChat = useCallback(async () => {
    setMessages([]);
    setPreviewHtml(null);
    setPreviewImage(null);
    try {
      const db = await getDB();
      await db.execute('DELETE FROM messages WHERE conversation_id = ?', [FREE_AGENT_CONV_ID]);
    } catch { /* ignore */ }
  }, []);

  // Preview panel
  const previewPanel = (
    <div className="w-[40%] min-w-[300px] flex flex-col bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800">
      <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
        <span className="text-[13px] font-medium text-zinc-600 dark:text-zinc-400">预览</span>
      </div>
      <div className="flex-1 overflow-hidden">
        {previewHtml ? (
          <iframe
            srcDoc={previewHtml}
            sandbox="allow-scripts allow-same-origin"
            className="w-full h-full border-0"
            title="Preview"
          />
        ) : previewImage ? (
          <div className="flex items-center justify-center h-full p-4">
            <img src={previewImage} alt="Preview" className="max-w-full max-h-full object-contain rounded-lg" />
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-zinc-400 dark:text-zinc-600 text-[13px]">
            HTML 输出或图片将在此预览
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ChatPanel
      messages={messages}
      onSend={handleSend}
      isStreaming={isRunning}
      streamingContent={streamingText}
      streamingReasoning={streamingReasoning}
      streamingToolCalls={streamingToolCalls}
      error={error}
      onStop={handleStop}
      onDismissError={() => setError(null)}
      showReasoning
      showStreaming
      allowImagePaste
      allowFileUpload
      allowStop
      agentTypes="knowledge"
      confirmationState={confirmationState}
      userInputForm={userInputForm}
      layout="full"
      previewPanel={previewPanel}
      inputPlaceholder="描述你的需求，如：分析 sales.csv 并画趋势图 / 爬取这个网站的文章列表 / 建一个图书管理数据库..."
      emptyTitle="FreeAgent — 全能力 AI 开发者"
      emptyDescription="完整代码执行环境 | Python 完全访问 | 文件系统 | 网络搜索 | Shell 命令"
      emptyIcon={<Code size={40} className="opacity-30" />}
      header={
        <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-100 dark:border-zinc-800">
          <div className="flex items-center gap-2">
            <Globe size={18} className="text-purple-500" />
            <span className="font-semibold text-[15px] text-zinc-900 dark:text-zinc-100">FreeAgent</span>
            <span className="text-[11px] text-zinc-400">全能力 AI 开发者</span>
          </div>
          <button
            onClick={clearChat}
            disabled={isRunning}
            className="p-1.5 rounded text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 disabled:opacity-30"
            title="清空对话"
          >
            <Trash2 size={15} />
          </button>
        </div>
      }
    />
  );
}
