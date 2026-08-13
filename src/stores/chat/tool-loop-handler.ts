import type { ChatMessage, MessageContent, LLMMessage } from '@/types/message';
import type { ToolCallEntry } from '@/types/chat';
import type { SQLiteAdapter } from '@/db/adapter';
import { serializeContent } from '@/utils/content';
import { useSettingsStore } from '@/stores/settings-store';
import { ToolMode, getChatBasicTools, getAgentToolFilter, getAgentEndpoint } from './tool-config';
import { truncateToolResult } from '@/utils/content';

// ── Types ──

export interface ToolLoopContext {
  get: () => ChatStateGetter;
  set: SetFn;
  provider: Record<string, unknown>;
  apiKey: string;
  password?: string;
  abortController: AbortController;
  conversationId: string;
  db: SQLiteAdapter;
  executor: { enabledToolNames: string[]; buildToolsForLLM: (f: Set<string>) => unknown[]; executeToolCall: (n: string, a: Record<string, unknown>) => Promise<{ success: boolean; message: string; data?: Record<string, unknown> }>; disabledTools?: Set<string> };
  existingMsgIds: Set<string>;
  agentName?: string;
  agentSystemExtra?: string;
  systemExtra?: string;
}

export interface ChatStateGetter {
  messages: ChatMessage[];
  toolMode: ToolMode;
  customTools: Set<string>;
}

export type SetFn = (fn: (s: Record<string, unknown>) => void) => void;

// ── Tool definitions ──

function buildRequestAgentTool(customAgentNames: string[]) {
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
  };
}

function buildGetAgentLogTool() {
  return {
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
}

/** 根据 toolMode / @agent 构建工具集 */
export async function buildTools(
  executor: ToolLoopContext['executor'],
  toolMode: ToolMode,
  customTools: Set<string>,
  agentName?: string,
) {
  const settingsStore = useSettingsStore.getState();

  // 动态加载用户自定义 agent 名称
  let customAgentNames: string[] = [];
  try {
    const { useAgentStore } = await import('@/stores/agent-store');
    const agentStore = useAgentStore.getState();
    if (!agentStore.loaded) await agentStore.load();
    customAgentNames = agentStore.getEnabledAgents().map(a => a.name);
  } catch { /* agent-store not available */ }

  const requestAgentTool = buildRequestAgentTool(customAgentNames);
  const getAgentLogTool = buildGetAgentLogTool();

  // 确定工具过滤集
  let toolFilter: Set<string>;
  if (agentName) {
    // 先查内置 agent
    const { AGENT_TOOL_FILTERS } = await import('./tool-config');
    if (AGENT_TOOL_FILTERS[agentName]) {
      toolFilter = getAgentToolFilter(agentName);
    } else {
      // 自定义 agent：从 agent-store 加载 tool_names + system_prompt
      try {
        const { useAgentStore } = await import('@/stores/agent-store');
        const agents = useAgentStore.getState().getEnabledAgents();
        const customAgent = agents.find(a => a.name === agentName);
        if (customAgent) {
          toolFilter = new Set(customAgent.toolNames ?? []);
        } else {
          toolFilter = getChatBasicTools();
        }
      } catch {
        toolFilter = getChatBasicTools();
      }
    }
  } else if (toolMode === ToolMode.none) {
    toolFilter = new Set();
  } else if (toolMode === ToolMode.favorites) {
    toolFilter = settingsStore.favoriteTools ?? new Set();
  } else if (toolMode === ToolMode.custom) {
    toolFilter = customTools.size > 0 ? customTools : getChatBasicTools();
  } else if (toolMode === ToolMode.basic) {
    toolFilter = getChatBasicTools();
  } else {
    // ToolMode.all → 所有已注册技能工具
    toolFilter = new Set(executor.enabledToolNames);
  }

  const basicToolDefs = executor.buildToolsForLLM(toolFilter);
  const includeSystemTools = toolMode === ToolMode.all || toolMode === ToolMode.basic;
  const allTools = includeSystemTools
    ? [...basicToolDefs, requestAgentTool, getAgentLogTool]
    : basicToolDefs;

  return { toolFilter, allTools, customAgentNames };
}

/** 注入 @agent 运行时状态到系统提示词 */
export async function buildAgentSystemExtra(agentName?: string, systemExtra?: string): Promise<string | undefined> {
  let agentSystemExtra = systemExtra;
  if (agentName === 'web') {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const status = await invoke<{ extension_connected?: boolean; playwright_launched?: boolean; url?: string }>('get_extension_status');
      const extConn = status.extension_connected ?? false;
      const pwLaunched = status.playwright_launched ?? false;
      const parts: string[] = [];
      if (extConn) parts.push('extension=connected');
      if (pwLaunched) parts.push(`playwright=launched${status.url ? ` url=${status.url}` : ''}`);
      if (!extConn && !pwLaunched) parts.push('browser=disconnected');
      const statusCtx = `\n\n[状态] ${parts.join(', ')}`;
      agentSystemExtra = statusCtx + (agentSystemExtra ? '\n\n' + agentSystemExtra : '');
    } catch { /* 非 Tauri 环境忽略 */ }
  }
  return agentSystemExtra;
}

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

// ── request_agent 路由处理 ──

interface AgentCallContext {
  set: SetFn;
  get: () => ChatStateGetter;
  agentCall: { id?: string; function?: { name?: string; arguments?: string } };
  toolCallsForAssistant: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  roundAssistantId: string;
  roundText: string;
  conversationId: string;
  abortController: AbortController;
  db: SQLiteAdapter;
  executor: unknown;
  persistedMsgIds: Set<string>;
  agentName?: string;
}

/**
 * 处理 request_agent 工具调用：路由到对应 Gateway，收集进度，返回结果。
 * 返回 true 表示应继续 LLM 循环，false 表示应 break。
 */
async function handleAgentCall(ctx: AgentCallContext): Promise<boolean> {
  const {
    set, get, agentCall, toolCallsForAssistant, roundAssistantId, roundText,
    conversationId, abortController, db, executor, persistedMsgIds,
  } = ctx;

  // 标记本轮 assistant 消息完成
  set((s) => {
    s.messages = (s.messages as ChatMessage[]).map((m) =>
      m.id === roundAssistantId
        ? { ...m, toolCalls: toolCallsForAssistant, content: roundText || '正在分析任务...', status: 'done' as const }
        : m,
    );
  });

  // 解析 agent 参数
  let selectedAgent = 'computeruse';
  let agentReason = '';
  let agentArgs: Record<string, unknown> = {};
  let userMessageIndices: number[] = [];
  try {
    const args = JSON.parse(agentCall.function?.arguments ?? '{}') as {
      agent?: string; reason?: string; user_message_indices?: number[]; args?: Record<string, unknown>;
    };
    selectedAgent = args.agent ?? 'computeruse';
    agentReason = args.reason ?? '';
    agentArgs = args.args ?? {};
    userMessageIndices = args.user_message_indices ?? [];
  } catch { /* use default */ }

  let agentLabel = ({
    computeruse: '🖥️ 计算机操作', web: '🌐 浏览器',
    document: '📄 文档', code: '💻 代码',
  }[selectedAgent] ?? selectedAgent);

  // Agent 开始消息
  const agentStartMsgId = crypto.randomUUID();
  set((s) => {
    (s.messages as ChatMessage[]).push({
      id: agentStartMsgId, conversationId, role: 'assistant',
      content: `${agentLabel} Agent 开始执行...`,
      timestamp: new Date().toISOString(), status: 'streaming',
      _agentInternal: true, _agentType: selectedAgent, _isAgentStart: true,
    } as ChatMessage);
  });

  // onProgress 回调
  const agentStats = {
    turns: 0, maxTurns: 0,
    tools: [] as ToolStat[],
    keyOutputs: [] as string[],
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
          (s.messages as ChatMessage[]).push({
            id: msgId, conversationId, role: 'assistant' as const,
            content: `🔄 第 ${event.turn + 1}/${event.maxTurns} 轮`,
            timestamp: now, status: 'done' as const,
            _agentInternal: true, _agentType: selectedAgent,
          } as ChatMessage);
        });
        break;
      }
      case 'llm_thinking': {
        if (event.text || event.reasoning) {
          set((s) => {
            (s.messages as ChatMessage[]).push({
              id: msgId, conversationId, role: 'assistant' as const,
              content: event.text || '', reasoning_content: event.reasoning,
              timestamp: now, status: 'done' as const,
              _agentInternal: true, _agentType: selectedAgent,
            } as ChatMessage);
          });
        }
        break;
      }
      case 'tool_start': {
        set((s) => {
          (s.messages as ChatMessage[]).push({
            id: msgId, conversationId, role: 'assistant' as const,
            content: '', timestamp: now, status: 'done' as const,
            _agentInternal: true, _agentType: selectedAgent,
            _toolCallInfo: { name: event.name, args: event.args, status: 'running' },
          } as ChatMessage);
        });
        persistedMsgIds.add(msgId);
        db.execute(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [msgId, conversationId, 'assistant', '', now, selectedAgent],
        ).catch((e: unknown) => { console.warn('[chat-store] tool_start DB write failed:', e); });
        break;
      }
      case 'tool_end': {
        agentStats.tools.push({ name: event.name, success: event.success ?? false, message: event.message });
        if (event.success && event.message) {
          const keyTools = ['save_app', 'save_project', 'write_file', 'generate_code', 'generate_project'];
          if (keyTools.includes(event.name)) {
            const shortMsg = event.message.length > 100 ? event.message.substring(0, 100) + '...' : event.message;
            agentStats.keyOutputs.push(`[${event.name}] ${shortMsg}`);
          }
        }
        const statusIcon = event.success ? '✅' : '❌';
        const resultText = event.message ? `${statusIcon} ${event.name}: ${event.message.substring(0, 200)}` : `${statusIcon} ${event.name}`;
        const atr = truncateToolResult('agent_internal', resultText);
        const toolEndMsgId = msgId;
        set((s) => {
          (s.messages as ChatMessage[]).push({
            id: toolEndMsgId, conversationId, role: 'tool' as const,
            content: atr.toolContent, timestamp: now, status: 'done' as const,
            _agentInternal: true, _agentType: selectedAgent,
          } as ChatMessage);
        });
        persistedMsgIds.add(toolEndMsgId);
        db.execute(
          `INSERT INTO messages (id, conversation_id, role, content, timestamp, agent_internal, agent_type)
           VALUES (?, ?, ?, ?, ?, 1, ?)`,
          [toolEndMsgId, conversationId, 'tool', atr.toolContent, now, selectedAgent],
        ).catch((e: unknown) => { console.warn('[chat-store] tool_end DB write failed:', e); });
        break;
      }
      case 'agent_done': {
        set((s) => {
          s.messages = (s.messages as ChatMessage[]).map((m) =>
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
    ) as unknown as typeof gateway;
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

  // 构建消息历史
  const agentMessages: LLMMessage[] = get().messages
    .filter((m) => m.role !== 'system' && !m._agentInternal)
    .map((m) => {
      const msgContent: string | { type: string; [k: string]: unknown }[] =
        typeof m.content === 'string' ? m.content
        : Array.isArray(m.content) ? m.content as { type: string; [k: string]: unknown }[]
        : '';
      const base: LLMMessage = { role: m.role, content: msgContent };
      if (m.role === 'assistant' && m.toolCalls) base.toolCalls = m.toolCalls;
      if (m.role === 'tool' && m.toolCallId) base.toolCallId = m.toolCallId;
      return base;
    });

  // 提取上轮 agent 任务上下文
  const msgs = get().messages;
  let prevContextMsg: ChatMessage | undefined;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i]._taskContext && Object.keys(msgs[i]._taskContext!).length > 0 && msgs[i]._agentType === selectedAgent) {
      prevContextMsg = msgs[i];
      break;
    }
  }
  if (prevContextMsg?._taskContext) {
    const ctxEntries = Object.entries(prevContextMsg._taskContext);
    const actionMemText = ctxEntries.find(([k]) => k === '_actionMemory')?.[1];
    const outputEntries = ctxEntries.filter(([k]) => k !== '_actionMemory');
    if (actionMemText) agentMessages.unshift({ role: 'user', content: actionMemText });
    if (outputEntries.length > 0) {
      const ctxText = outputEntries.map(([k, v]) => `[上次${k} agent 产出]: ${v}`).join('\n');
      agentMessages.unshift({ role: 'user', content: ctxText });
    }
  }

  // 按 LLM 指定的 user_message_indices 提取图片
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
      const imgContent = [
        { type: 'text', text: '以下为 Chat Agent 根据用户指令指定的参考图片：' },
        ...imageParts,
      ];
      agentMessages.unshift({ role: 'user' as const, content: imgContent as unknown as string });
    }
  }

  // 调用 gateway
  let response: Record<string, unknown>;
  try {
    response = await gateway.handleUserMessage({
      content: Object.keys(agentArgs).length > 0
        ? `[参数: ${JSON.stringify(agentArgs)}]\n${agentReason || ''}`
        : agentReason,
      signal: abortController.signal,
      messages: agentMessages,
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
    const abortActionMem = buildActionMemorySummary(agentStats.tools);
    const errorContent = `❌ 任务中断: ${err instanceof Error ? err.message : String(err)}`;
    set((s) => {
      const cleanedMessages = (s.messages as ChatMessage[]).filter((m) => {
        if (m.status !== 'streaming') return true;
        if (m.role === 'assistant' && (!m.content || m.content === '') && !m.toolCalls) return false;
        return true;
      });
      const errorMsg: ChatMessage = {
        id: crypto.randomUUID(), conversationId, role: 'assistant',
        content: errorContent, timestamp: new Date().toISOString(), status: 'error',
        _agentInternal: true, _agentType: selectedAgent,
        _taskContext: abortActionMem ? { _actionMemory: abortActionMem } : undefined,
      };
      const updatedMessages = cleanedMessages.map((m) =>
        m.id === agentStartMsgId ? { ...m, status: 'done' as const, content: `${agentLabel} Agent 执行中断` } : m,
      );
      s.messages = [...updatedMessages, errorMsg];
      s.isStreaming = false;
      s.streamingConversationId = null;
      s._abortController = null;
    });
    return false;
  }

  // ── Agent 执行完成，把结果作为 tool 消息喂给 Chat LLM 做总结 ──
  const tasks = (response.tasks ?? []) as Array<Record<string, unknown>>;
  const responseMessage = (response.message ?? '') as string;
  const success = tasks.length > 0 ? tasks.every((t) => t.status === 'done') : !!responseMessage;

  const toolFlow = agentStats.tools.length > 0
    ? agentStats.tools.map(t => t.name).join(' → ') : '—';
  const foldedSummary = `${agentLabel} Agent: ${agentStats.turns}/${agentStats.maxTurns} 轮 · ${toolFlow}`;

  const agentResultData: Record<string, unknown> = { agent: selectedAgent };
  const agentTaskId = tasks.length > 0 ? (tasks[0].taskId as string) : undefined;
  if (agentTaskId) agentResultData.taskId = agentTaskId;
  const agentFinalMessage = tasks.length > 0 ? ((tasks[0].lastMessage ?? tasks[0].summary ?? tasks[0].message) as string) : '';
  const toolResultMessage = agentFinalMessage || responseMessage || (success ? 'OK' : 'Failed');
  if (toolResultMessage) agentResultData.response = toolResultMessage;
  if (agentStats.keyOutputs.length > 0) agentResultData.keyOutputs = agentStats.keyOutputs;

  const taskContext: Record<string, string> = {};
  if (agentStats.keyOutputs.length > 0) {
    taskContext[selectedAgent] = agentStats.keyOutputs.join('; ');
  }
  const actionMemSummary = buildActionMemorySummary(agentStats.tools);
  if (actionMemSummary) taskContext['_actionMemory'] = actionMemSummary;

  // 更新 Agent 开始消息状态
  set((s) => {
    s.messages = (s.messages as ChatMessage[]).map((m) =>
      m.id === agentStartMsgId
        ? { ...m, status: 'done' as const, content: `${agentLabel} Agent ${success ? '执行完成' : '执行失败'}` }
        : m,
    );
  });

  const requestAgentCallId = agentCall.id || crypto.randomUUID();
  const foldedId = crypto.randomUUID();
  const foldedMsg: ChatMessage = {
    id: foldedId, conversationId, role: 'assistant', content: foldedSummary,
    timestamp: new Date().toISOString(), status: 'done',
    _agentInternal: true, _isAgentStart: true, _agentType: selectedAgent,
  };
  const toolResultMsgId = crypto.randomUUID();
  const rawAgentResult = JSON.stringify({ success, message: toolResultMessage, data: agentResultData });
  const art = truncateToolResult('request_agent', rawAgentResult);
  const toolResultMsg: ChatMessage = {
    id: toolResultMsgId, conversationId, role: 'tool', content: art.toolContent,
    toolCallId: requestAgentCallId, timestamp: new Date().toISOString(), status: 'done',
    _agentType: selectedAgent, _taskContext: taskContext,
  };

  set((s) => {
    s.messages = [...(s.messages as ChatMessage[]), foldedMsg, toolResultMsg];
  });

  // Persist internal messages to DB
  const internalMsgs = get().messages.filter(m => m._agentInternal && !persistedMsgIds.has(m.id));
  for (const im of internalMsgs) {
    if (!im.id) continue;
    const serContent = typeof im.content === 'string' ? im.content : '';
    await db.execute(
      `INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, tool_call_id, agent_internal, agent_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [im.id, conversationId, im.role, serContent, im.timestamp, im.reasoning_content || null,
        im.toolCalls ? JSON.stringify(im.toolCalls) : null, im.toolCallId || null,
        im._agentInternal ? 1 : 0, im._agentType || ''],
    );
    persistedMsgIds.add(im.id);
  }

  return true; // continue loop
}

// ── Main tool loop ──

export async function handleToolLoop(ctx: ToolLoopContext): Promise<void> {
  const { ChatAgent } = await import('@/agents/chat-api');
  const chatAgent = new ChatAgent();

  const {
    get, set, provider, apiKey, password, abortController,
    conversationId, db, executor, existingMsgIds, agentName,
  } = ctx;

  const state = get();
  const agentEndpoint = agentName ? getAgentEndpoint(agentName) : undefined;

  // 加载自定义 agent systemPrompt
  let customAgentSystemExtra: string | undefined;
  if (agentName) {
    try {
      const { AGENT_TOOL_FILTERS } = await import('./tool-config');
      if (!AGENT_TOOL_FILTERS[agentName]) {
        const { useAgentStore } = await import('@/stores/agent-store');
        const agents = useAgentStore.getState().getEnabledAgents();
        const customAgent = agents.find(a => a.name === agentName);
        if (customAgent) customAgentSystemExtra = customAgent.systemPrompt ?? '';
      }
    } catch { /* ignore */ }
  }

  const { toolFilter, allTools } = await buildTools(
    executor, state.toolMode, state.customTools, agentName,
  );
  const agentSystemExtra = await buildAgentSystemExtra(agentName, ctx.systemExtra);

  // ── 工具调用循环（每轮独立 assistant 消息） ──
  const MAX_TOOL_ROUNDS = 50;
  const persistedMsgIds = new Set(existingMsgIds);
  let prevToolCalls: Array<{ name: string; args: string }> = [];

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    if (abortController.signal.aborted) break;

    // 构建 LLM 历史
    const shouldFilterInternal = !agentName;
    const historyMsgs = get().messages
      .filter((m) => m.role !== 'system')
      .filter((m) => shouldFilterInternal ? !m._agentInternal : true)
      .map((m): LLMMessage => {
        const msgContent: string | { type: string; [k: string]: unknown }[] =
          typeof m.content === 'string' ? m.content
          : Array.isArray(m.content) ? m.content as { type: string; [k: string]: unknown }[]
          : '';
        const base: LLMMessage = { role: m.role, content: msgContent };
        if (m.role === 'assistant' && m.toolCalls) base.toolCalls = m.toolCalls;
        if (m.role === 'tool' && m.toolCallId) base.toolCallId = m.toolCallId;
        return base;
      });

    // 每轮创建独立的 assistant 消息
    const roundAssistantId = crypto.randomUUID();
    let roundText = '';
    let toolCallJson = '';

    set((s) => {
      (s.messages as ChatMessage[]).push({
        id: roundAssistantId,
        conversationId,
        role: 'assistant' as const,
        content: '',
        timestamp: new Date().toISOString(),
        status: 'streaming' as const,
      });
    });

    console.log('[chat-store] Sending to LLM:', {
      messageCount: historyMsgs.length,
      messages: historyMsgs.map((m, i) => ({
        idx: i, role: m.role,
        contentType: Array.isArray(m.content) ? 'array' : typeof m.content,
        contentLength: Array.isArray(m.content) ? m.content.length
          : typeof m.content === 'string' ? m.content.length : 0,
        hasToolCalls: !!m.toolCalls, hasToolCallId: !!m.toolCallId,
      })),
    });
    console.log('[chat-store] 🎯 agent routing:', { agentName, agentEndpoint, toolFilterSize: toolFilter.size });

    const stream = chatAgent.chat({
      messages: historyMsgs,
      provider: {
        id: provider.id as string,
        name: provider.name as string,
        type: provider.type as 'openai' | 'anthropic' | 'google',
        baseUrl: provider.baseUrl as string,
        model: provider.model as string,
        encryptedApiKey: provider.encryptedApiKey as string,
        isDefault: false,
        supportsTools: (provider.supportsTools as boolean) ?? true,
        thinkingMode: (provider.thinkingMode as boolean) ?? false,
        createdAt: '',
      },
      apiKey,
      tools: provider.supportsTools === false ? undefined : allTools,
      systemExtra: customAgentSystemExtra
        ? (agentSystemExtra ? `${customAgentSystemExtra}\n\n${agentSystemExtra}` : customAgentSystemExtra)
        : agentSystemExtra,
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
        set((s) => {
          s.messages = (s.messages as ChatMessage[]).map((m) =>
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
        s.messages = (s.messages as ChatMessage[]).map((m) =>
          m.id === roundAssistantId ? { ...m, content: roundText } : m,
        );
      });
    }

    // 无工具调用 → 纯文本回复，本轮结束
    if (!toolCallJson) {
      set((s) => {
        s.messages = (s.messages as ChatMessage[]).map((m) =>
          m.id === roundAssistantId ? { ...m, content: roundText, status: 'done' as const } : m,
        );
      });
      break;
    }

    // 解析工具调用
    let calls: Array<{ id?: string; function?: { name?: string; arguments?: string } }> = [];
    try { calls = JSON.parse(toolCallJson); } catch { break; }

    const toolCallsForAssistant = calls.map((c) => ({
      id: c.id || crypto.randomUUID(),
      type: 'function' as const,
      function: { name: c.function!.name!, arguments: c.function!.arguments ?? '{}' },
    }));

    // 检查是否有 request_agent
    const agentCall = calls.find((c) => c.function?.name === 'request_agent');
    if (agentCall) {
      const shouldContinue = await handleAgentCall({
        set, get, agentCall, toolCallsForAssistant, roundAssistantId, roundText,
        conversationId, abortController, db, executor, persistedMsgIds, agentName,
      });
      if (shouldContinue) continue;
      break;
    }

    // ── 执行基础工具调用 ──
    const allowedTools = toolFilter ?? new Set(executor.enabledToolNames);
    const basicCalls = calls.filter((c) => c.function?.name && allowedTools.has(c.function.name));
    if (basicCalls.length === 0) break;

    // 本轮 assistant 消息设置 toolCalls + 文本
    set((s) => {
      s.messages = (s.messages as ChatMessage[]).map((m) =>
        m.id === roundAssistantId
          ? { ...m, toolCalls: toolCallsForAssistant, content: roundText, status: 'done' as const }
          : m,
      );
    });

    // ── 重复工具调用检测 ──
    const currentToolCalls = basicCalls.map((c) => ({
      name: c.function!.name!, args: c.function!.arguments ?? '{}',
    }));
    const isRepeat = prevToolCalls.length > 0
      && currentToolCalls.length === prevToolCalls.length
      && currentToolCalls.every((c, i) =>
        c.name === prevToolCalls[i].name && c.args === prevToolCalls[i].args,
      );
    prevToolCalls = currentToolCalls;

    if (isRepeat) {
      console.warn(`[chat-store] ⚠ 检测到连续重复工具调用: ${currentToolCalls.map(c => c.name).join(', ')}，提醒 LLM`);
      set((s) => {
        s.messages = (s.messages as ChatMessage[]).map((m) =>
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
          (s.messages as ChatMessage[]).push({
            id: toolMsgId, conversationId, role: 'tool' as const,
            toolCallId, content: toolContent, timestamp: new Date().toISOString(), status: 'done' as const,
          });
        });
        await db.execute(
          'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
          [toolMsgId, conversationId, 'tool', toolContent, new Date().toISOString(), toolCallId],
        );
      }
      continue;
    }

    // ── 执行每个工具调用 ──
    for (const call of basicCalls) {
      const toolName = call.function!.name!;
      const toolCallId = call.id || crypto.randomUUID();
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(call.function!.arguments ?? '{}'); } catch { /* empty */ }

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
            (s.messages as ChatMessage[]).push({
              id: rejectMsgId, conversationId, role: 'tool' as const,
              toolCallId, content: rejectContent, timestamp: new Date().toISOString(), status: 'done' as const,
            });
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
            success: true, message: `共 ${rows.length} 条执行记录`,
            data: { task_id: taskId || rows[0]?.agent_id, steps: formatted },
          };
        }
      } else {
        result = await executor.executeToolCall(toolName, args);
      }

      // ── Screenshot → compress + embed as multimodal ──
      let screenshotContent: Array<{ type: string; [k: string]: unknown }> | null = null;
      if (toolName === 'desktop_screenshot' && result.success && result.data) {
        const imageData = (result.data as Record<string, unknown>)['image_data'] as string | undefined;
        const imageFormat = (result.data as Record<string, unknown>)['format'] as string | undefined;
        console.log('[chat-store] Screenshot result:', { hasImageData: !!imageData, imageDataLength: imageData?.length, imageFormat });
        if (imageData) {
          try {
            const { compressImage } = await import('@/utils/image');
            const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/bmp;base64,${imageData}`;
            const compressed = await compressImage(dataUrl, 1024, 0.45);
            screenshotContent = [
              { type: 'text', text: '截图结果。请分析截图中的内容（选中的单元格、文本、位置等），然后调用相应的工具进行操作。' },
              { type: 'image_url', image_url: { url: compressed.dataUrl } },
            ];
            console.log('[chat-store] Screenshot compressed for tool message:', { compressedSize: compressed?.dataUrl?.length });
          } catch (e) {
            console.warn('[chat-store] Screenshot compression failed:', e);
          }
        }
      }

      // Store tool result
      const toolResultMsgId = crypto.randomUUID();
      const filteredResult = toolName === 'desktop_screenshot' && result.success && result.data
        ? { ...result, data: { ...result.data as Record<string, unknown>, image_data: '[image data omitted]' } }
        : result;
      const rawContent = JSON.stringify(filteredResult);
      const { truncateToolResult } = await import('@/utils/content');
      const tr = truncateToolResult(toolName, rawContent);
      const toolMsgContent: MessageContent = screenshotContent
        ? screenshotContent as MessageContent
        : tr.toolContent;
      set((s) => {
        (s.messages as ChatMessage[]).push({
          id: toolResultMsgId, conversationId, role: 'tool' as const,
          toolCallId, content: toolMsgContent, timestamp: new Date().toISOString(), status: 'done' as const,
        });
      });
      await db.execute(
        'INSERT INTO messages (id, conversation_id, role, content, timestamp, tool_call_id, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, 0, \'\')',
        [toolResultMsgId, conversationId, 'tool', serializeContent(toolMsgContent), new Date().toISOString(), toolCallId],
      );
    }

    // 继续下一轮 LLM 调用
  }

  // ── 完成：标记所有 streaming 消息为 done，持久化未写入 DB 的消息 ──
  set((s) => {
    s.messages = (s.messages as ChatMessage[]).map((m) =>
      m.status === 'streaming' ? { ...m, status: 'done' as const } : m,
    );
    s.isStreaming = false;
    s.streamingConversationId = null;
    s._abortController = null;
  });
  const newAssistantMsgs = get().messages.filter(
    (m) => m.role === 'assistant' && !existingMsgIds.has(m.id) && !persistedMsgIds.has(m.id),
  );
  for (const am of newAssistantMsgs) {
    await db.execute(
      'INSERT INTO messages (id, conversation_id, role, content, timestamp, reasoning_content, tool_calls, agent_internal, agent_type) VALUES (?, ?, ?, ?, ?, ?, ?, 0, \'\')',
      [am.id, conversationId, 'assistant', typeof am.content === 'string' ? am.content : '', new Date().toISOString(), am.reasoning_content ?? null, am.toolCalls ? JSON.stringify(am.toolCalls) : null],
    );
  }
}
