// TaskAgentRunner — Task 专用 agent 执行器
// 独立于 AgentRunner（代码生成），复用 TaskTreeDB/ProcessLogDB
// 核心：LLM 工具调用循环 + 桌面工具委托给 SkillExecutor

import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import { ProcessLogDB } from '@/services/multi-agent/process-log-db';
import type { TaskAgentType, TaskLogAction } from '@/services/multi-agent/types';
import type { TaskTreeRow } from '@/db/types';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import type { ToolContext } from '@/skills/skill';
import type { ProviderConfig } from '@/types/provider';
import { getScreenshotScale } from '@/utils/coordinate-scale';
import { compressImage } from '@/utils/image';
import { truncateToolResult } from '@/utils/content';
import { getTaskTools, getTaskToolDef, getTaskToolDefs } from './tools';
import { buildTaskContext } from './context-builder';
import { AgentEndpoint } from '@/api/types';
import { apiStreamCompat } from '@/api/client';
import { ToolDisclosure } from '@/skills/tool-disclosure';

export interface TaskAgentResult {
  success: boolean;
  taskId: string;
  agentId: string;
  error?: string;
  /** finalize / *_done 工具的 summary 参数（任务完成时的总结） */
  summary?: string;
  /** 子 agent 执行链最后一条助手消息的文本内容（LLM 的自然语言结论） */
  lastResponseText?: string;
  /** 最后一个成功执行工具的返回消息（用于出错时保留部分成功结果） */
  lastSuccessfulToolResult?: string;
}

/** Agent 执行过程中的进度事件 */
export type AgentProgressEvent =
  | { type: 'llm_thinking'; text: string; reasoning?: string; turn: number }
  | { type: 'stream_chunk'; text: string; reasoning?: string; turn: number }
  | { type: 'tool_start'; name: string; args: Record<string, unknown>; turn: number }
  | { type: 'tool_end'; name: string; success: boolean; message?: string; turn: number }
  | { type: 'turn_start'; turn: number; maxTurns: number }
  | { type: 'agent_done'; success: boolean; turn: number };

export class TaskAgentRunner {
  private taskDB = new TaskTreeDB();
  private logDB = new ProcessLogDB();
  private skillExecutor: ISkillExecutor;
  private onConfirm?: (command: string) => Promise<boolean>;
  private onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;

  constructor(skillExecutor: ISkillExecutor) {
    this.skillExecutor = skillExecutor;
  }

  generateAgentId(agentType: TaskAgentType): string {
    return `task-${agentType}-${crypto.randomUUID().slice(0, 8)}`;
  }

  async runAgent(params: {
    taskId: string;
    agentType: TaskAgentType;
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    maxTurns?: number;
    subTaskDescription?: string;
    signal?: AbortSignal;
    toolFilter?: Set<string>;
    /** Chat 透传的消息历史（含图片），Agent 从中提取上下文 */
    chatMessages?: import('@/types/message').LLMMessage[];
    /** 将 chatMessages 作为对话历史注入（默认 false，仅提取图片）。FreeAgent 设为 true */
    injectHistory?: boolean;
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
    /** 自定义 system prompt（替代默认的 endpoint prompt） */
    customSystemPrompt?: string;
  }): Promise<TaskAgentResult> {
    const { taskId, agentType, goal, provider, apiKey, password, signal, subTaskDescription, toolFilter, chatMessages, injectHistory, onConfirm, onUserInput, onProgress, customSystemPrompt } = params;
    this.onConfirm = onConfirm;
    this.onUserInput = onUserInput;
    const maxTurns = params.maxTurns ?? 20;
    const agentId = this.generateAgentId(agentType);
    let taskCompleted = false;
    let finalSummary: string | undefined;  // 捕获 finalize/*_done 的 summary
    let lastResponseText: string | undefined;  // 捕获最后一条助手消息的文本内容
    let lastSuccessfulToolResult: string | undefined;  // 捕获最后一个成功工具的返回消息（用于错误时保留部分结果）
    const executedTools: string[] = [];  // 收集已执行的工具名（用于超时时的摘要）

    await this.taskDB.assignAgent(taskId, agentId, agentType as never);
    await this.taskDB.updateStatus(taskId, this.statusForAgent(agentType) as never);

    const task = await this.taskDB.getById(taskId);
    if (!task) {
      return { success: false, taskId, agentId, error: `Task not found: ${taskId}` };
    }

    // 构建上下文（系统提示由后端 buildSystemPrompt 统一注入）
    const { userPrompt } = buildTaskContext({
      agentType,
      task,
      goal,
      subTaskDescription,
    });

    // executor/doc 用 SkillExecutor 动态取工具 + 基础工具（不随 toolFilter 变化）
    // 其他 agent 类型用静态工具集
    // free 类型使用渐进式披露（首轮仅门卫，按需加载完整工具定义）
    let tools: Record<string, unknown>[];
    let disclosure: ToolDisclosure | null = null;
    const baseToolNames = agentType === 'doc'
      ? ['think', 'request_user_input', 'doc_done', 'finalize']
      : agentType === 'web'
      ? ['think', 'request_user_input', 'web_done', 'finalize']
      : agentType === 'code'
      ? ['think', 'request_user_input', 'code_done', 'finalize']
      : agentType === 'free'
      ? ['think', 'request_user_input', 'finalize']
      : ['think', 'request_user_input', 'desktop_done', 'finalize',
         'desktop_screenshot', 'desktop_list_windows', 'desktop_open_app', 'desktop_wait'];

    if (agentType === 'free') {
      // ── 渐进式披露：首轮只发门卫 ──
      disclosure = new ToolDisclosure({
        executor: this.skillExecutor as any,
        tools: toolFilter,
        gatekeeperName: 'tool_detail',
      });
      const gatekeeper = disclosure.buildGatekeeperTool();
      const baseToolDefs = getTaskToolDefs(baseToolNames);
      tools = [gatekeeper, ...baseToolDefs];
      console.log(`[TaskRunner] ▶ progressive agent=${agentId} gatekeeper+base=${tools.length} menuTools=${disclosure.buildMenu().length}`);
    } else if (agentType === 'executor' || agentType === 'doc' || agentType === 'web' || agentType === 'code') {
      const dynamicTools = this.skillExecutor.buildToolsForLLM(toolFilter);
      const baseToolDefs = getTaskToolDefs(baseToolNames);
      const dynamicNames = new Set(dynamicTools.map(t => (t as any).function?.name));
      const extraBaseTools = baseToolDefs.filter(t => !dynamicNames.has((t as any).function?.name));
      tools = [...dynamicTools, ...extraBaseTools];
      console.log(`[TaskRunner] ▶ agent=${agentId} type=${agentType} goal="${goal.substring(0, 80)}" filter=${toolFilter?.size ?? 'none'} dynamic=${dynamicTools.length} base=${extraBaseTools.length} total=${tools.length}`);
    } else {
      tools = getTaskTools(agentType);
      console.log(`[TaskRunner] ▶ agent=${agentId} type=${agentType} tools=${tools.length}`);
    }
    // 构建初始消息
    const messages: unknown[] = [];

    if (chatMessages && injectHistory) {
      // FreeAgent：chatMessages 作为完整对话历史注入
      const seenUrls = new Set<string>();
      for (const msg of chatMessages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          const parts = msg.content as Array<{ type: string; text?: string; image_url?: { url: string } }>;
          const textParts = parts.filter(p => p.type === 'text').map(p => p.text ?? '').join('\n');
          const imageParts = parts.filter(p => p.type === 'image_url' && p.image_url?.url && !seenUrls.has(p.image_url.url));
          for (const p of imageParts) seenUrls.add(p.image_url!.url);
          if (textParts || imageParts.length > 0) {
            messages.push({
              role: 'user',
              content: imageParts.length > 0
                ? [...imageParts.map(p => ({ type: 'image_url' as const, image_url: { url: p.image_url!.url } })), { type: 'text' as const, text: textParts }]
                : textParts,
            });
          }
        } else if (msg.content) {
          messages.push({ role: msg.role, content: msg.content });
        }
      }
      console.log(`[TaskRunner] 📜 FreeAgent 注入对话历史: ${chatMessages.length} 条 → ${messages.length} 条有效消息`);
    }

    // customSystemPrompt 不替换默认 prompt，而是通过 systemPromptExtra 追加到末尾
    // 这样 FreeAgent 原始系统提示词（ToolDisclosure 菜单、记忆等）完整保留

    // 当前任务目标
    const initialContent: Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }> = [
      { type: 'text', text: userPrompt },
    ];
    // 其他 agent：chatMessages 仅提取图片（原有行为不变）
    if (chatMessages && !injectHistory) {
      const seenUrls = new Set<string>();
      for (const msg of chatMessages) {
        if (msg.role === 'user' && Array.isArray(msg.content)) {
          for (const part of msg.content as Array<{ type: string; text?: string; image_url?: { url: string } }>) {
            if (part.type === 'image_url' && part.image_url?.url && !seenUrls.has(part.image_url.url)) {
              seenUrls.add(part.image_url.url);
              initialContent.push({ type: 'image_url', image_url: { url: part.image_url.url } });
              console.log(`[TaskRunner] 📷 注入 Chat 透传图片 (${(part.image_url.url.length / 1024).toFixed(0)} KB)`);
            }
          }
        }
      }
    }
    messages.push({ role: 'user', content: initialContent.length === 1 ? initialContent[0].text : initialContent });

    // 任务级坐标上下文
    let toolCtx: ToolContext = {
      scale: null,
      targetWindowHwnd: task.target_window_hwnd,
    };

    // 多模态 provider 解析（截图发给 LLM 时需要支持图片的模型）
    let currentProvider = provider;
    let currentApiKey = apiKey;

    // 工具循环
    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) {
        onProgress?.({ type: 'agent_done', success: false, turn });
        break;
      }

      onProgress?.({ type: 'turn_start', turn, maxTurns });

      let responseText = '';
      let reasoningText = '';
      let toolJson: string | undefined;

      try {
        // 检查消息中是否包含图片，如果是则切换到支持多模态的模型
        const hasImageMessages = messages.some((m: any) => {
          const content = m?.content;
          if (Array.isArray(content)) {
            return content.some((p: any) => p.type === 'image_url' || (typeof p?.image_url?.url === 'string' && p.image_url.url.startsWith('data:image')));
          }
          return false;
        });
        if (hasImageMessages && currentProvider.supportsMultimodal === false) {
          const { useModelConfigStore } = await import('@/stores/model-config-store');
          const allProviders = useModelConfigStore.getState().providers;
          const multimodalProvider = allProviders.find((p: any) => p.supportsMultimodal !== false && p.id !== currentProvider.id);
          if (multimodalProvider) {
            console.log(`[TaskRunner] 多模态切换: ${currentProvider.name} → ${multimodalProvider.name}`);
            currentProvider = multimodalProvider;
            currentApiKey = await useModelConfigStore.getState().getApiKey(multimodalProvider.id, password ?? '');
          }
        }

        // 按 agent 类型选择端点（每个端点有自己的系统提示）
        const endpoint = agentType === 'decomposer' ? AgentEndpoint.taskDecomposer
          : agentType === 'verifier' ? AgentEndpoint.taskVerifier
          : agentType === 'doc' ? AgentEndpoint.docAgent
          : agentType === 'web' ? AgentEndpoint.webAgent
          : agentType === 'code' ? AgentEndpoint.codeAgent
          : agentType === 'free' ? AgentEndpoint.freeAgent
          : AgentEndpoint.desktopAutomation;

        const stream = apiStreamCompat(
          endpoint,
          currentProvider,
          currentApiKey,
          { messages, tools, goal, systemPromptExtra: customSystemPrompt || undefined },
        );

        for await (const chunk of stream) {
          if (chunk.startsWith('__TOOLS__:')) {
            toolJson = chunk.substring(10);
          } else if (chunk.startsWith('__ERROR__:')) {
            throw new Error(chunk.substring(10));
          } else if (chunk.startsWith('__REASONING__:')) {
            const rc = chunk.substring(14);
            reasoningText += rc;
            // 实时流式推理 — stream_chunk 事件仅 FreeAgent 等需要实时过程的消费者使用
            onProgress?.({ type: 'stream_chunk', text: '', reasoning: rc, turn });
          } else {
            responseText += chunk;
            // 实时流式文本 — 触发 stream_chunk 事件让 UI 更新
            onProgress?.({ type: 'stream_chunk', text: chunk, turn });
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.taskDB.updateStatus(taskId, 'failed', msg);
        onProgress?.({ type: 'agent_done', success: false, turn });
        return { success: false, taskId, agentId, error: msg, summary: finalSummary, lastResponseText, lastSuccessfulToolResult };
      }

      // 发射 LLM 思考事件（文本 + 推理汇总，推理已在 streaming 中实时推送）
      // 在成功收到 LLM 回复后，保留非空的 responseText（用于后续错误时保留部分结果）
      if (responseText && responseText.trim()) {
        lastResponseText = responseText;
      }
      if (responseText || reasoningText) {
        onProgress?.({
          type: 'llm_thinking',
          text: responseText,
          reasoning: reasoningText || undefined,
          turn,
        });
      }

      // 解析工具调用
      const toolCalls = toolJson ? this.parseToolCalls(toolJson) : [];

      console.log(`[TaskRunner] turn=${turn} hasToolJson=${!!toolJson} toolCalls=${toolCalls.length} responseLen=${responseText.length} response="${responseText.substring(0, 200)}"`);

      if (toolCalls.length === 0) {
        // 无工具调用 — LLM 可能只返回了文本，记录日志
        console.warn(`[TaskRunner] ⚠ agent=${agentId} turn=${turn} 无工具调用，LLM 返回了纯文本。responseText="${responseText.substring(0, 300)}"`);
        // 如果 LLM 明确表达了任务完成（含完成语义文本），视为正常结束
        if (/done|完成|成功|finished|complete/i.test(responseText)) {
          taskCompleted = true;
          lastResponseText = responseText || undefined;
        }
        break;
      }

      console.log(`[TaskRunner] turn=${turn} 工具调用: ${toolCalls.map(tc => tc.name).join(', ')}`);

      // 助手消息（MiMo 等思考模型多轮调用必须回传 reasoning_content）
      messages.push({
        role: 'assistant',
        content: responseText || null,
        reasoning_content: reasoningText || undefined,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.args) },
        })),
      });

      // 执行工具
      let shouldBreak = false;
      for (const tc of toolCalls) {
        if (signal?.aborted) { shouldBreak = true; break; }

        // ── 渐进式披露：拦截 tool_detail 调用 ──
        if (disclosure && tc.name === disclosure.gatekeeperToolName) {
          const requestedTools = (tc.args['tools'] as string[]) ?? [];
          const loaded = disclosure.loadDetails(requestedTools);
          // 将加载的工具注入到 tools 数组供后续轮次使用
          for (const t of loaded) {
            if (!tools.some(existing => (existing as any).function?.name === (t as any).function?.name)) {
              tools.push(t);
            }
          }
          const summary = loaded.length > 0
            ? `已加载 ${loaded.length} 个工具的完整定义：${loaded.map((t: any) => t.function.name).join(', ')}。现在可以直接调用这些工具了。`
            : `未找到工具：${requestedTools.join(', ')}。请检查工具名称是否正确，可从菜单中确认。`;
          onProgress?.({ type: 'tool_start', name: tc.name, args: tc.args, turn });
          const rawGatekeeper = JSON.stringify({ success: true, message: summary });
          const gk = truncateToolResult(tc.name, rawGatekeeper);
          messages.push({ role: 'tool', toolCallId: tc.id, content: gk.toolContent });
          if (gk.fullUserMessage) messages.push({ role: 'user', content: gk.fullUserMessage });
          onProgress?.({ type: 'tool_end', name: tc.name, success: true, message: summary, turn });
          console.log(`[TaskRunner] 🔍 tool_detail: requested=${requestedTools.length} loaded=${loaded.length} totalActive=${tools.length}`);
          continue;
        }

        onProgress?.({ type: 'tool_start', name: tc.name, args: tc.args, turn });
        const result = await this.executeTool(tc.name, tc.args, taskId, agentId, turn, toolCtx);
        onProgress?.({ type: 'tool_end', name: tc.name, success: result.success, message: result.message, turn });

        // 捕获最后一个成功工具的返回消息（出错时可用于保留部分结果）
        if (result.success && result.message) {
          lastSuccessfulToolResult = result.message;
        }

        executedTools.push(tc.name);

        // desktop_done / web_done / doc_done / code_done / finalize → 任务完成
        if (tc.name === 'desktop_done' || tc.name === 'web_done' || tc.name === 'doc_done' || tc.name === 'code_done' || tc.name === 'finalize') {
          finalSummary = result.message;
          lastResponseText = responseText || undefined;
          await this.taskDB.updateStatus(taskId, 'done');
          taskCompleted = true;
          shouldBreak = true;
        }

        // desktop_screenshot 特殊处理：压缩 + 坐标 scale + 注入多模态消息
        if (tc.name === 'desktop_screenshot' && result.success && result.data?.image_data) {
          try {
            const imageData = result.data.image_data as string;
            const imageFormat = (result.data as Record<string, unknown>)['format'] as string | undefined;
            const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/${imageFormat || 'bmp'};base64,${imageData}`;
            const compressed = await compressImage(dataUrl, 1024, 45);
            toolCtx = { scale: getScreenshotScale(compressed), targetWindowHwnd: toolCtx.targetWindowHwnd };
            // 清理旧截图避免内存膨胀
            stripOldScreenshots(messages);
            messages.push({
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: compressed.dataUrl } },
                { type: 'text', text: '这是当前屏幕截图。请分析截图内容，然后继续执行任务。' },
              ],
            });
          } catch {
            toolCtx = { scale: null, targetWindowHwnd: toolCtx.targetWindowHwnd };
          }
        } else {
          // 非截图工具：过滤大图片数据后推入消息，超长时截断 + user 消息兜底
          const filteredResult = tc.name === 'desktop_screenshot' && result.data
            ? { ...result, data: { ...result.data as Record<string, unknown>, image_data: '[image data omitted]' } }
            : result;
          const rawContent = JSON.stringify(filteredResult);
          const tr = truncateToolResult(tc.name, rawContent);
          messages.push({ role: 'tool', toolCallId: tc.id, content: tr.toolContent });
          if (tr.fullUserMessage) {
            messages.push({ role: 'user', content: tr.fullUserMessage });
          }
        }

        // request_user_input 后：用户操作可能导致界面变化（可能只填了信息，也可能进入了下一步）
        // 必须让 LLM 重新获取当前界面状态，不能依赖过时上下文
        if (tc.name === 'request_user_input' && result.success) {
          // 清理旧截图 — 用户操作后旧截图已不可信
          stripOldScreenshots(messages);
          const supportsVisual = currentProvider.supportsMultimodal !== false;
          const targetHwnd = toolCtx.targetWindowHwnd;

          if (supportsVisual) {
            // 多模态模型 → 对任务窗口自动截图
            try {
              const screenshotArgs: Record<string, unknown> = {};
              if (targetHwnd) screenshotArgs['window_hwnd'] = targetHwnd;
              const ssResult = await this.skillExecutor.executeToolCall('desktop_screenshot', screenshotArgs, toolCtx);
              if (ssResult.success && ssResult.data?.image_data) {
                const imageData = ssResult.data.image_data as string;
                const imageFormat = (ssResult.data as Record<string, unknown>)['format'] as string | undefined;
                const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/${imageFormat || 'bmp'};base64,${imageData}`;
                const compressed = await compressImage(dataUrl, 1024, 45);
                toolCtx = { scale: getScreenshotScale(compressed), targetWindowHwnd: targetHwnd };
                messages.push({
                  role: 'user',
                  content: [
                    { type: 'image_url', image_url: { url: compressed.dataUrl } },
                    { type: 'text', text: '用户已完成操作，这是当前屏幕截图。请分析截图确认界面状态，判断用户操作的实际效果（可能只填了信息，也可能已进入下一步），然后继续执行任务。' },
                  ],
                });
              } else {
                // 截图失败 → 降级为文本提示
                messages.push({
                  role: 'user',
                  content: '用户已完成操作，界面可能已变化。请通过 uia_get_interactive 或 desktop_screenshot 重新获取当前界面状态，确认用户操作的实际效果后再继续。',
                });
              }
            } catch {
              messages.push({
                role: 'user',
                content: '用户已完成操作，界面可能已变化。请通过 uia_get_interactive 重新获取当前界面元素，确认用户操作的实际效果后再继续。',
              });
            }
          } else {
            // 非多模态模型 → 引导重新获取 UIA 元素
            messages.push({
              role: 'user',
              content: '用户已完成操作，界面状态可能已改变（用户可能只填写了信息，也可能已进入了下一步）。请务必调用 uia_get_interactive 重新获取当前界面元素，确认界面实际状态后再继续执行任务。不要依赖之前的元素信息。',
            });
          }
        }
      }

      if (shouldBreak) break;
    }

    // ── 退出原因判断 ──
    let exitReason: string;
    let success: boolean;

    if (signal?.aborted) {
      exitReason = `任务被取消 (执行了 ${executedTools.length} 个工具后中止)`;
      success = false;
    } else if (taskCompleted) {
      exitReason = '';
      success = true;
    } else {
      // 轮次耗尽但 LLM 未调用 done 工具
      const uniqueTools = [...new Set(executedTools)];
      const toolSummary = uniqueTools.length > 0
        ? `已执行 ${executedTools.length} 次工具调用 (${uniqueTools.join(', ')})`
        : 'LLM 未产生有效的工具调用';
      exitReason = `任务未完成: 已达到最大轮次 ${maxTurns}，${toolSummary}。请考虑拆分任务或增加 maxTurns。`;
      success = false;
      console.warn(`[TaskRunner] ✗ agent=${agentId} ${exitReason}`);
    }

    onProgress?.({ type: 'agent_done', success, turn: maxTurns });
    return { success, taskId, agentId, summary: finalSummary, lastResponseText, lastSuccessfulToolResult, error: exitReason || undefined };
  }

  // ── 工具执行 ──

  private async executeTool(
    name: string,
    args: Record<string, unknown>,
    taskId: string,
    agentId: string,
    turn: number,
    toolCtx: ToolContext,
  ): Promise<{ success: boolean; message?: string; data?: Record<string, unknown> }> {
    const startTime = Date.now();

    // run_command / execute_code / doc_code_exec → 需要用户确认
    if (name === 'run_command' || name === 'execute_code' || name === 'doc_code_exec') {
      const displayText = name === 'execute_code' || name === 'doc_code_exec'
        ? `[${name === 'doc_code_exec' ? 'python(doc)' : (args['language'] ?? 'code')}] ${String(args['code'] ?? '')}`.substring(0, 500)
        : String(args['command'] ?? '');
      console.log(`[TaskRunner] 🔐 安全确认: tool=${name} hasOnConfirm=${!!this.onConfirm} cmd=${displayText.substring(0, 100)}`);
      if (this.onConfirm) {
        const confirmed = await this.onConfirm(displayText);
        console.log(`[TaskRunner] 🔐 用户确认结果: ${confirmed}`);
        if (!confirmed) {
          return { success: false, message: '用户拒绝执行此命令。' };
        }
      } else {
        console.warn(`[TaskRunner] ⚠️ 没有 onConfirm 回调，跳过安全确认！tool=${name}`);
      }
    }

    // request_user_input → 显示表单让用户填写
    if (name === 'request_user_input') {
      const message = String(args['message'] ?? '请填写以下信息');
      const fields = (args['fields'] as Array<{ label: string; key: string; type?: string }>) ?? [];
      if (this.onUserInput) {
        const userValues = await this.onUserInput(message, fields);
        return { success: true, message: '用户已填写', data: userValues };
      }
      return { success: false, message: '无法获取用户输入' };
    }

    // think → 只记录日志
    if (name === 'think') {
      await this.logDB.append(taskId, agentId, turn, 'decompose' as TaskLogAction as never, {
        decisionRationale: String(args.thought ?? ''),
      });
      return { success: true, message: 'thought recorded' };
    }

    // submit_plan → 存入 task decision
    if (name === 'submit_plan') {
      await this.taskDB.updateDecision(taskId, JSON.stringify(args));
      await this.logDB.append(taskId, agentId, turn, 'decompose' as TaskLogAction as never, {
        decisionRationale: String(args.reason ?? ''),
      });
      return { success: true, message: 'plan submitted' };
    }

    // finalize / *_done → 任务完成信号（无实际操作，由外层处理）
    if (name === 'finalize' || name === 'desktop_done' || name === 'web_done' || name === 'doc_done' || name === 'code_done') {
      return { success: true, message: args.summary ? String(args.summary) : 'Task completed' };
    }

    // 其他工具 → 委托给 SkillExecutor（桌面、web、文件等）
    try {
      const result = await this.skillExecutor.executeToolCall(name, args, toolCtx);
      const durationMs = Date.now() - startTime;

      await this.logDB.append(taskId, agentId, turn, 'execute' as TaskLogAction as never, {
        inputSummary: `${name}(${JSON.stringify(args).substring(0, 100)})`,
        outputSummary: result.message?.substring(0, 200) ?? '',
        durationMs,
      });

      return {
        success: result.success,
        message: result.message,
        data: result.data as Record<string, unknown> | undefined,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, message: msg };
    }
  }

  // ── 工具调用解析 ──

  private parseToolCalls(json: string): Array<{ id: string; name: string; args: Record<string, unknown> }> {
    try {
      const list = JSON.parse(json) as Array<Record<string, unknown>>;
      return list.map((tc) => {
        const func = tc['function'] as Record<string, unknown>;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(func['arguments'] as string);
        } catch { /* use empty */ }
        return {
          id: String(tc['id'] ?? ''),
          name: String(func['name'] ?? ''),
          args,
        };
      });
    } catch {
      return [];
    }
  }

  // ── 状态映射 ──

  private statusForAgent(agentType: TaskAgentType): string {
    switch (agentType) {
      case 'decomposer': return 'decomposing';
      case 'executor': return 'executing';
      case 'verifier': return 'verifying';
      case 'assembler': return 'done';
      default: return 'pending';
    }
  }
}

// ── 辅助函数 ──

/** 清理旧的截图多模态消息，避免内存膨胀 */
function stripOldScreenshots(messages: Array<{ role: string; content: unknown }>): void {
  // 保留最近 2 张截图，删除更早的
  let screenshotCount = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user' || !Array.isArray(msg.content)) continue;
    const hasImage = msg.content.some((p: Record<string, unknown>) => p['type'] === 'image_url');
    if (!hasImage) continue;
    screenshotCount++;
    if (screenshotCount > 2) {
      // 替换为纯文本标记，释放 base64 内存
      messages[i] = {
        ...msg,
        content: [{ type: 'text', text: '[截图已清理]' }],
      };
    }
  }
}
