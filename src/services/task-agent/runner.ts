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
import { getTaskTools, getTaskToolDef, getTaskToolDefs } from './tools';
import { buildTaskContext } from './context-builder';
import { AgentEndpoint } from '@/api/types';
import { apiStreamCompat } from '@/api/client';

export interface TaskAgentResult {
  success: boolean;
  taskId: string;
  agentId: string;
  error?: string;
}

/** Agent 执行过程中的进度事件 */
export type AgentProgressEvent =
  | { type: 'llm_thinking'; text: string; reasoning?: string; turn: number }
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
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<TaskAgentResult> {
    const { taskId, agentType, goal, provider, apiKey, password, signal, subTaskDescription, toolFilter, onConfirm, onUserInput, onProgress } = params;
    this.onConfirm = onConfirm;
    this.onUserInput = onUserInput;
    const maxTurns = params.maxTurns ?? 20;
    const agentId = this.generateAgentId(agentType);

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
    let tools: Record<string, unknown>[];
    if (agentType === 'executor' || agentType === 'doc' || agentType === 'web' || agentType === 'code') {
      const dynamicTools = this.skillExecutor.buildToolsForLLM(toolFilter);
      // 基础工具始终包含，不经过 toolFilter 筛选
      const baseToolNames = agentType === 'doc'
        ? ['think', 'request_user_input', 'doc_done', 'finalize']
        : agentType === 'web'
        ? ['think', 'request_user_input', 'web_done', 'finalize']
        : agentType === 'code'
        ? ['think', 'request_user_input', 'code_done', 'finalize']
        : ['think', 'request_user_input', 'desktop_done', 'finalize',  // 内部工具
           'desktop_screenshot', 'desktop_list_windows', 'desktop_open_app', 'desktop_wait'];  // 桌面基础工具
      const baseTools = getTaskToolDefs(baseToolNames);
      // 去重：dynamicTools 中已有的基础工具不再重复添加
      const dynamicNames = new Set(dynamicTools.map(t => (t as any).function?.name));
      const extraBaseTools = baseTools.filter(t => !dynamicNames.has((t as any).function?.name));
      tools = [...dynamicTools, ...extraBaseTools];
      console.log(`[TaskRunner] ▶ agent=${agentId} type=${agentType} goal="${goal.substring(0, 80)}" filter=${toolFilter?.size ?? 'none'} dynamic=${dynamicTools.length} base=${extraBaseTools.length} total=${tools.length}`);
    } else {
      tools = getTaskTools(agentType);
      console.log(`[TaskRunner] ▶ agent=${agentId} type=${agentType} tools=${tools.length}`);
    }
    const messages: unknown[] = [
      { role: 'user', content: userPrompt },
    ];

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
          : AgentEndpoint.desktopAutomation;

        const stream = apiStreamCompat(
          endpoint,
          currentProvider,
          currentApiKey,
          { messages, tools, goal },
        );

        for await (const chunk of stream) {
          if (chunk.startsWith('__TOOLS__:')) {
            toolJson = chunk.substring(10);
          } else if (chunk.startsWith('__ERROR__:')) {
            throw new Error(chunk.substring(10));
          } else if (chunk.startsWith('__REASONING__:')) {
            reasoningText += chunk.substring(14);
          } else {
            responseText += chunk;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await this.taskDB.updateStatus(taskId, 'failed', msg);
        onProgress?.({ type: 'agent_done', success: false, turn });
        return { success: false, taskId, agentId, error: msg };
      }

      // 发射 LLM 思考事件
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
        break;
      }

      console.log(`[TaskRunner] turn=${turn} 工具调用: ${toolCalls.map(tc => tc.name).join(', ')}`);

      // 助手消息
      messages.push({
        role: 'assistant',
        content: responseText || null,
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

        onProgress?.({ type: 'tool_start', name: tc.name, args: tc.args, turn });
        const result = await this.executeTool(tc.name, tc.args, taskId, agentId, turn, toolCtx);
        onProgress?.({ type: 'tool_end', name: tc.name, success: result.success, message: result.message, turn });

        // desktop_done / web_done / doc_done / code_done / finalize → 任务完成
        if (tc.name === 'desktop_done' || tc.name === 'web_done' || tc.name === 'doc_done' || tc.name === 'code_done' || tc.name === 'finalize') {
          await this.taskDB.updateStatus(taskId, 'done');
          shouldBreak = true;
        }

        // desktop_screenshot 特殊处理：压缩 + 坐标 scale + 注入多模态消息
        if (tc.name === 'desktop_screenshot' && result.success && result.data?.image_data) {
          try {
            const imageData = result.data.image_data as string;
            const imageFormat = (result.data as Record<string, unknown>)['format'] as string | undefined;
            // 补全 data: 前缀（桌面截图返回的是 raw base64，format=bmp）
            const dataUrl = imageData.startsWith('data:') ? imageData : `data:image/${imageFormat || 'bmp'};base64,${imageData}`;
            const compressed = await compressImage(dataUrl, 1024, 45);
            toolCtx = { scale: getScreenshotScale(compressed) };
            // 清理旧截图避免内存膨胀
            stripOldScreenshots(messages);
            // 注入多模态消息，LLM 能真正看到截图
            messages.push({
              role: 'user',
              content: [
                { type: 'image_url', image_url: { url: compressed.dataUrl } },
                { type: 'text', text: '这是当前屏幕截图。请分析截图内容，然后继续执行任务。' },
              ],
            });
          } catch {
            toolCtx = { scale: null };
          }
        } else {
          // 非截图工具：过滤大图片数据后推入消息
          const filteredResult = tc.name === 'desktop_screenshot' && result.data
            ? { ...result, data: { ...result.data as Record<string, unknown>, image_data: '[image data omitted]' } }
            : result;
          messages.push({
            role: 'tool',
            toolCallId: tc.id,
            content: JSON.stringify(filteredResult),
          });
        }
      }

      if (shouldBreak) break;
    }

    onProgress?.({ type: 'agent_done', success: true, turn: maxTurns });
    return { success: true, taskId, agentId };
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

    // run_command / execute_code → 需要用户确认
    if (name === 'run_command' || name === 'execute_code') {
      const displayText = name === 'execute_code'
        ? `[${args['language'] ?? 'code'}] ${String(args['code'] ?? '')}`.substring(0, 500)
        : String(args['command'] ?? '');
      if (this.onConfirm) {
        const confirmed = await this.onConfirm(displayText);
        if (!confirmed) {
          return { success: false, message: '用户拒绝执行此命令。' };
        }
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
