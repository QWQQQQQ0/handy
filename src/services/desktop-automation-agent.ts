// 桌面自动化智能体核心类：负责接收任务目标，调度LLM、技能、缓存，完成桌面端自动化操作

import type { ISkillExecutor } from '@/interfaces/skill-executor';
import type { ICacheService } from '@/interfaces/cache-service';
import type { SkillResult } from '@/types/skill';
import type { ProviderConfig } from '@/types/provider';
import type { LLMMessage } from '@/types/message';
import type { ToolContext } from '@/skills/skill';
import type { WindowInfo } from './desktop-service';
import { compressImage, type CompressedImage } from '@/utils/image';
import { getScreenshotScale } from '@/utils/coordinate-scale';
import type { InteractiveNode, SemanticAction, SemanticAnnotation, UIFingerprint } from '@/types/cache';
import { matchGoal } from '@/core/skill-resolver';
import { StateMachine } from './state-machine';
import { ActionMemory } from './action-memory';
import { AgentEndpoint } from '@/api/types';
import { apiStreamCompat } from '@/api/client';

// ── Agent 模块导入 ──
import type { AgentDeps, ToolCallInfo, AgentTurn, AgentStepEvent, AgentStepCallback } from './agent';
import { AgentContext } from './agent';
import { trySkillMatch } from './agent/skill-matcher';
import { ensureInteractiveNodes, toolCallsToSemanticActions, maybePromoteToSkillTemplate } from './agent/agent-cache';

// ── Re-export types ──
export type { ToolCallInfo, AgentTurn, AgentStepEvent, AgentStepCallback };

/** L2 步级缓存适用的交互工具 — 只缓存真正操作 UI 元素的工具 */
const STEP_CACHE_TOOLS = new Set([
  'uia_click', 'uia_double_click', 'uia_right_click',
  'uia_type', 'uia_expand', 'uia_select', 'uia_scroll',
]);

// ── TaskProgress：LLM 看图确认的子目标进度，跨窗口跨应用持久 ──

/**
 * 任务进度追踪器。
 * 与 UI 状态不同，进度是任务级的：一个 task 可能涉及多个应用/窗口。
 * LLM 通过 task_progress_mark 工具自行确认子目标完成后，后续轮次自动提醒。
 */
class TaskProgress {
  private steps: string[] = [];

  /** LLM 确认一个或多个子目标已完成 */
  mark(steps: string[]): void {
    for (const s of steps) {
      if (!this.steps.includes(s)) {
        this.steps.push(s);
      }
    }
  }

  /** 构建注入 LLM 的上下文消息，无进度时返回 null */
  buildContext(): string | null {
    if (this.steps.length === 0) return null;
    const items = this.steps.map((s, i) => `  ${i + 1}. ${s}`);
    return `📋 Task progress (confirmed by visually checking the screenshot — these are DONE, do NOT redo):\n${items.join('\n')}\n\nContinue with the NEXT incomplete step. If all steps are done, call desktop_done.`;
  }
}

/** task_progress_mark 工具的 OpenAI function 定义 */
function buildTaskProgressTool() {
  return {
    type: 'function' as const,
    function: {
      name: 'task_progress_mark',
      description:
        'Mark sub-goals as completed after you visually CONFIRM them in the current screenshot. ' +
        'Only call this when the screenshot shows the step has actually taken effect. ' +
        'Marked steps will be shown in future turns so you know what is already done. ' +
        'Call this alongside action tools in the same turn — no extra turn needed.',
      parameters: {
        type: 'object',
        properties: {
          done: {
            type: 'array',
            items: { type: 'string' },
            description:
              'Sub-goals you can SEE are completed in the current screenshot. ' +
              'Describe each in natural language, e.g. "已打开浏览器", "已登录账号", "已打开设置页面", "表格数据已填写完成". ' +
              'Be specific enough that future turns can understand what was accomplished.',
          },
        },
        required: ['done'],
      },
    },
  };
}

/**
 * 桌面自动化智能体主类
 * 核心功能：接收任务 → 匹配技能/缓存 → 调用LLM → 执行工具 → 缓存学习
 */
export class DesktopAutomationAgent {
  private skillExecutor: ISkillExecutor;
  private cacheService: ICacheService;
  testMode = false;

  constructor(skillExecutor: ISkillExecutor, cacheService: ICacheService) {
    this.skillExecutor = skillExecutor;
    this.cacheService = cacheService;
  }

  /** 构建依赖注入对象 */
  private get deps(): AgentDeps {
    return { skillExecutor: this.skillExecutor, cacheService: this.cacheService };
  }

  /** 路由工具调用：通过SkillExecutor执行（自动坐标还原） */
  private async executeToolCall(toolName: string, args: Record<string, unknown>, ctx?: ToolContext): Promise<SkillResult> {
    console.debug(`[Agent:Tool] executeToolCall — ${toolName}`);
    return this.skillExecutor.executeToolCall(toolName, args, ctx);
  }

  /**
   * 执行自动化命令（主入口）
   * 完整流程：缓存/技能匹配 → LLM规划 → 逐轮执行 → 缓存学习
   */
  async executeCommand(params: {
    screenshotBase64?: string;
    goal: string;
    provider: ProviderConfig;
    apiKey: string;
    windows?: WindowInfo[];
    actionHistory?: string[];
    toolFilter?: Set<string>;
    maxTurns?: number;
    onStep?: AgentStepCallback;
    signal?: AbortSignal;
    currentState?: string;
    context?: string;
    /** 子任务提示 — 当任务被 intent 拆分时，传入当前子任务的具体步骤，作为独立 user message */
    taskInstruction?: string;
    /** watcher 已定位的目标窗口 hwnd，优先级高于 windows 数组 */
    targetWindowHwnd?: number;
  }): Promise<AgentTurn[] | null> {
    const {
      screenshotBase64,
      goal,
      provider,
      apiKey,
      windows: initialWindows,
      actionHistory = [],
      toolFilter,
      maxTurns = 3,
      onStep,
      signal,
      currentState,
      context,
      taskInstruction,
      targetWindowHwnd,
    } = params;

    console.log(`[Agent] ▶ executeCommand START — goal="${goal}", maxTurns=${maxTurns}, windows=${initialWindows?.length ?? 0}, hasScreenshot=${!!screenshotBase64}, targetHwnd=${targetWindowHwnd ?? 'none'}`);

    let windows = initialWindows;
    // targetWindowHwnd（来自 watcher）优先，否则从 windows 数组取第一个可见窗口
    let focusedHwnd = targetWindowHwnd ?? windows?.find((w) => w.is_visible)?.hwnd;
    const focusedWindow = windows?.find((w) => w.hwnd === focusedHwnd) ?? null;
    const stateMachine = new StateMachine(goal, focusedWindow);
    console.log(`[Agent]   initial focusedHwnd=${focusedHwnd}, focusedWindow="${focusedWindow?.title ?? 'none'}"`);

    // ── L3 技能模板匹配 ──
    console.log(`[Agent]   Phase 3: trying L3 skill match...`);
    const l3Match = await matchGoal(goal);
    if (l3Match) {
      console.log(`[Agent]   L3 matched template="${l3Match.skill.name}", score=${l3Match.score.toFixed(2)}`);
      const skillResult = await trySkillMatch(this.deps, { goal, focusedHwnd: focusedHwnd ?? 0, windows: windows!, provider, apiKey, stateMachine });
      if (skillResult) {
        console.log(`[Agent] ✓ L3 skill match HIT — early return, turns=${skillResult.turns.length}`);
        stateMachine.setStage('done');
        return skillResult.turns;
      }
      console.log(`[Agent]   L3 skill execution failed, falling through`);
    } else {
      console.log(`[Agent]   L3 skill match MISS`);
    }

    // L1缓存 + 智能体上下文
    let l1CachedNodes: InteractiveNode[] | null = null;
    let l1Annotations: SemanticAnnotation[] = [];
    let l1Fingerprint: string | null = null;
    const ctx = new AgentContext();

    // 启动时立即加载 L1 标注（watcher 已聚焦窗口，不会触发 focus_window 事件）
    if (focusedHwnd) {
      try {
        const nodeResult = await ensureInteractiveNodes(this.deps, focusedHwnd, provider, apiKey);
        if (nodeResult && (nodeResult.nodes.length > 0 || nodeResult.annotations.length > 0)) {
          l1CachedNodes = nodeResult.nodes;
          l1Annotations = nodeResult.annotations;
          l1Fingerprint = nodeResult.fingerprint;
          console.log(`[Agent]   L1 loaded at startup — nodes=${l1CachedNodes.length}, annotations=${l1Annotations.length}, isVision=${!!nodeResult.isVision}`);
        }
      } catch { /* non-fatal */ }
    }

    // 构建可用工具列表
    const allTools = this.skillExecutor.buildToolsForLLM();
    const resolvedTools = toolFilter
      ? allTools.filter((t) => {
          const fn = t['function'] as { name: string };
          return toolFilter.has(fn.name);
        })
      : allTools;

    if (resolvedTools.length === 0) return null;

    // 注入 task_progress_mark 工具 + 创建进度追踪器 + 动作记忆
    const tools = [...resolvedTools, buildTaskProgressTool()];
    const progress = new TaskProgress();
    const actionMemory = new ActionMemory();

    // 初始消息（纯文本，LLM 自行决定是否截图）
    ctx.messages.push(this.buildUserMessage({ windows, actionHistory }));

    // 注入子任务提示 + 阶段上下文
    if (taskInstruction) {
      ctx.messages.push({ role: 'user', content: `🎯 Current step: ${taskInstruction}` });
    }
    const phaseContext = ctx.injectPhaseContext();
    if (phaseContext) {
      ctx.messages.push({ role: 'user', content: phaseContext });
    }
    stripOldScreenshots(ctx.messages);

    // ── 任务级坐标上下文（截图后更新，工具调用时自动传递） ──
    let toolCtx: ToolContext = { scale: null };

    let llmAborted = false;
    let taskCompleted = false;
    console.log(`[Agent]   Entering per-turn LLM loop (maxTurns=${maxTurns})...`);

    // 主循环：逐轮调用LLM → 执行工具 → 更新状态
    for (let turn = 0; turn < maxTurns; turn++) {
      if (signal?.aborted) { console.log(`[Agent] ■ signal.aborted at turn=${turn}`); break; }
      console.log(`[Agent]   ── Turn ${turn + 1}/${maxTurns} ──`);
      actionMemory.setTurn(turn);

      // 清理旧进度/动作记忆消息 → 注入最新上下文
      for (let i = ctx.messages.length - 1; i >= 0; i--) {
        const m = ctx.messages[i];
        if (m.role === 'user' && typeof m.content === 'string' &&
            (m.content.startsWith('📋 Task progress') || m.content.startsWith('📊 Actions already completed') || m.content.startsWith('⚠️ Failed actions'))) {
          ctx.messages.splice(i, 1);
        }
      }
      const progCtx = progress.buildContext();
      if (progCtx) {
        ctx.messages.push({ role: 'user', content: progCtx });
      }
      const memCtx = actionMemory.buildContext();
      if (memCtx) {
        ctx.messages.push({ role: 'user', content: memCtx });
      }

      let toolCalls: ToolCallInfo[];
      let responseText = '';
      let reasoningBuffer = '';

      if (this.testMode) {
        toolCalls = this.mockToolCalls(goal, turn);
      } else {
        const preEdit = await onStep?.({ type: 'before_llm', data: { model: provider.model, messages: ctx.messages, tools }, turnIndex: turn });
        const callTools = preEdit?.['tools'] ? preEdit['tools'] as Record<string, unknown>[] : tools;

        console.debug(`DesktopAutomation: turn=${turn} msgs=${ctx.messages.length} tools=${callTools.length}`);

        const stream = apiStreamCompat(
          AgentEndpoint.desktopAutomation,
          provider,
          apiKey,
          { messages: ctx.messages, tools: callTools, goal },
        );

        const textBuffer: string[] = [];
        let toolJson: string | undefined;

        for await (const chunk of stream) {
          if (chunk.startsWith('__TOOLS__:')) {
            toolJson = chunk.substring(10);
          } else if (chunk.startsWith('__ERROR__:')) {
            throw new Error(chunk.substring(10));
          } else if (chunk.startsWith('__REASONING__:')) {
            reasoningBuffer += chunk.substring(14);
          } else {
            textBuffer.push(chunk);
          }
        }

        responseText = textBuffer.join('');

        if (!toolJson) {
          toolCalls = [];
        } else {
          const list = JSON.parse(toolJson) as Array<Record<string, unknown>>;
          toolCalls = list.map((tc) => {
            const func = tc['function'] as Record<string, unknown>;
            return {
              id: tc['id'] as string,
              name: func['name'] as string,
              arguments: JSON.parse(func['arguments'] as string) as Record<string, unknown>,
            };
          });
        }

        const postEdit = await onStep?.({ type: 'after_llm', data: { tool_calls: toolCalls, reasoning: reasoningBuffer || undefined, responseText }, turnIndex: turn });
        if (postEdit?.['tool_calls']) {
          const edited = postEdit['tool_calls'] as Array<Record<string, unknown>>;
          toolCalls = edited.map((tc) => ({
            id: tc['id'] as string ?? '',
            name: tc['name'] as string,
            arguments: tc['arguments'] as Record<string, unknown>,
          }));
        }
      }

      // LLM未输出工具调用：补充提示重试
      if (toolCalls.length === 0) {
        if (responseText.trim().length > 0 && turn < maxTurns - 1) {
          console.log(`[TaskEnd] LLM no tools, text="${responseText.substring(0, 80)}..." — retrying turn=${turn}`);
          ctx.messages.push({
            role: 'user',
            content: 'You MUST respond with one or more tool calls now. Do not output reasoning text — call a tool to take the next action. If you are stuck or the task is done, call desktop_done.',
          });
          continue;
        }
        console.log(`[TaskEnd] llmAborted — no tool calls after retry, turn=${turn}, text="${responseText.substring(0, 80)}"`);
        llmAborted = true;
        break;
      }

      const turnCallInfos = toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
      const turnResults: SkillResult[] = [];

      ctx.messages.push({
        role: 'assistant',
        content: responseText || null,
        reasoning_content: reasoningBuffer || undefined,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });

      // Debug: verify reasoning_content is captured for MiMo thinking models
      console.debug(`[Agent] turn=${turn} assistant msg: hasRC=${!!reasoningBuffer}, rcLen=${reasoningBuffer.length}, tools=${toolCalls.map(t=>t.name).join(',')}`);

      // 逐工具执行
      for (const tc of toolCalls) {
        if (signal?.aborted) { console.log(`[Agent] ■ signal.aborted during tool exec, turn=${turn}, tool=${tc.name}`); break; }

        // ── task_progress_mark 拦截：LLM 确认已完成的子目标，不执行真实桌面操作 ──
        if (tc.name === 'task_progress_mark') {
          const done = tc.arguments['done'] as string[] | undefined;
          if (done && done.length > 0) {
            progress.mark(done);
            console.log(`[Agent]   task_progress_mark: +${done.length} step(s) → total=${progress['steps'].length}`);
          }
          const markResult: SkillResult = { success: true, message: `Marked ${done?.length ?? 0} step(s) as done` };
          turnResults.push(markResult);
          ctx.allResults.push(markResult);
          ctx.messages.push({ role: 'tool', content: JSON.stringify(markResult), toolCallId: tc.id });
          continue;
        }

        console.log(`[Agent]   executing tool: ${tc.name}`, Object.keys(tc.arguments).length > 0 ? tc.arguments : '');

        const toolEdit = await onStep?.({ type: 'before_tool', data: { name: tc.name, arguments: tc.arguments }, turnIndex: turn });
        const resolvedArgs = (toolEdit?.['toolArguments'] as Record<string, unknown>) ?? tc.arguments;

        // 注入 window_hwnd
        if (focusedHwnd && !('window_hwnd' in resolvedArgs)) {
          if (tc.name.startsWith('uia_') || tc.name === 'desktop_screenshot') {
            resolvedArgs['window_hwnd'] = focusedHwnd;
          } else if (tc.name.startsWith('desktop_click') || tc.name.startsWith('desktop_double_click')
            || tc.name.startsWith('desktop_right_click') || tc.name.startsWith('desktop_middle_click')
            || tc.name === 'desktop_scroll' || tc.name === 'desktop_move_mouse'
            || tc.name === 'desktop_mouse_down' || tc.name === 'desktop_mouse_up'
            || tc.name === 'desktop_drag' || tc.name === 'desktop_move_cursor') {
            resolvedArgs['window_hwnd'] = focusedHwnd;
          }
        }
        if (focusedHwnd && !('hwnd' in resolvedArgs) && tc.name === 'desktop_focus_window') {
          resolvedArgs['hwnd'] = focusedHwnd;
        }

        // Skip desktop_list_windows
        let result: SkillResult;
        if (tc.name === 'desktop_list_windows' && focusedHwnd && windows?.length) {
          console.log(`[Agent]   skipping desktop_list_windows — already have focusedHwnd=${focusedHwnd}`);
          result = { success: true, message: 'Using pre-known window context', data: { windows, count: windows.length } };
        } else {
          // executor 自动处理坐标还原（通过 toolCtx.scale）
          result = await this.executeToolCall(tc.name, resolvedArgs, toolCtx);
        }
        console.log(`[Agent]   tool ${tc.name} → success=${result.success}${result.message ? `, msg="${result.message.substring(0, 80)}"` : ''}`);
        turnResults.push(result);

        // 记录到动作记忆（每轮注入到 LLM 上下文，防止重复执行）
        actionMemory.record(tc.name, resolvedArgs, result.success, result.data ?? undefined);
        ctx.allResults.push(result);

        // L2 步级缓存
        if (result.success && STEP_CACHE_TOOLS.has(tc.name) && tc.arguments['role']) {
          try {
            await this.cacheService.storeStepCache({
              goalFragment: (tc.arguments['name'] as string) || (tc.arguments['role'] as string),
              role: tc.arguments['role'] as string,
              name: (tc.arguments['name'] as string) || '',
              windowFP: l1Fingerprint || undefined,
              appName: goal.match(/打开(\S+)/)?.[1],
            });
          } catch { /* 非致命 */ }
        }

        // 窗口切换
        if (result.success) {
          if (tc.name === 'desktop_focus_window' && resolvedArgs['hwnd']) {
            focusedHwnd = Number(resolvedArgs['hwnd']);
          } else if (tc.name === 'desktop_open_app' && result.data) {
            const newHwnd = result.data['hwnd'] as number;
            if (newHwnd && newHwnd !== 0) {
              focusedHwnd = newHwnd;
            } else {
              await new Promise((r) => setTimeout(r, 1500));
              try {
                const refreshed = await this.skillExecutor.executeToolCall('desktop_list_windows', {});
                if (refreshed.success && refreshed.data) {
                  const refreshedWindows = (refreshed.data['windows'] as WindowInfo[]) || [];
                  windows = refreshedWindows.filter((w) => w.is_visible && w.title.trim().length > 0);
                  const focused = windows.find((w) => w.hwnd === focusedHwnd);
                  if (!focused) {
                    const candidate = windows[windows.length - 1];
                    if (candidate) focusedHwnd = candidate.hwnd;
                  }
                }
              } catch { /* 非致命 */ }
            }
          }
          if (tc.name === 'desktop_focus_window' || tc.name === 'desktop_open_app') {
            const newWinInfo = windows?.find(w => w.hwnd === focusedHwnd);
            if (newWinInfo) stateMachine.setWindow(null, newWinInfo);
            if (focusedHwnd) {
              try {
                const nodeResult = await ensureInteractiveNodes(this.deps, focusedHwnd, provider, apiKey);
                if (nodeResult && (nodeResult.nodes.length > 0 || nodeResult.annotations.length > 0)) {
                  l1CachedNodes = nodeResult.nodes;
                  l1Annotations = nodeResult.annotations;
                  l1Fingerprint = nodeResult.fingerprint;
                  if (nodeResult.isVision) {
                    const summary = l1Annotations.slice(0, 30).map((a) => {
                      const w = a.relativeWidth ?? 0; const h = a.relativeHeight ?? 0;
                      return `- "${a.label}": ${a.description} @ center(${(a.relativeX + w / 2).toFixed(2)}, ${(a.relativeY + h / 2).toFixed(2)})`;
                    }).join('\n');
                    ctx.messages.push({ role: 'system', content: `Window changed (vision). Elements:\n${summary}\n\nUse desktop_click with absolute coordinates.` });
                  } else if (l1Annotations.length > 0) {
                    const summary = l1Annotations.slice(0, 30).map((a) => `- "${a.label}" [${a.role}]`).join('\n');
                    ctx.messages.push({ role: 'system', content: `Window changed. Elements:\n${summary}\n\nUse uia_click/uia_type.` });
                  }
                }
              } catch { /* 非致命 */ }
            }
          }
        }

        // 剥离 region_screenshot → 多模态注入
        let regionScreenshot: string | undefined;
        if (result.data?.['region_screenshot']) {
          regionScreenshot = result.data['region_screenshot'] as string;
          delete result.data['region_screenshot'];
        }

        // 结果截断
        let content = result.data ? JSON.stringify(result.data) : result.message;
        if (content.length > 15000) {
          if (tc.name === 'uia_get_interactive' && result.data) {
            const data = result.data as Record<string, unknown>;
            const total = (data['total_count'] as number) || (data['count'] as number) || 0;
            const nodeArr = (data['nodes'] as Array<Record<string, unknown>>) || [];
            content = JSON.stringify({ ...data, nodes: nodeArr.slice(0, 20), note: `Showing 20 of ${total} nodes.` });
            if (content.length > 15000) content = content.substring(0, 15000) + '...';
          } else {
            content = `${content.substring(0, 5000)}... (truncated)`;
          }
        }

        // 截图结果特殊处理
        if (tc.name === 'desktop_screenshot' && result.data) {
          const imageData = result.data['image_data'] as string | undefined;
          if (imageData) {
            stripOldScreenshots(ctx.messages);
            try {
              const compressed = await compressImage(imageData);
              // 更新任务级坐标上下文（后续工具调用自动使用此 scale）
              toolCtx = { scale: getScreenshotScale(compressed) };
              ctx.messages.push({
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: compressed.dataUrl } },
                  { type: 'text', text: 'Latest screenshot. Continue with the task.' },
                ],
              });
            } catch {
              toolCtx = { scale: null };
              ctx.messages.push({
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: imageData } },
                  { type: 'text', text: 'Latest screenshot. Continue with the task.' },
                ],
              });
            }
          }
        } else {
          ctx.messages.push({ role: 'tool', content, toolCallId: tc.id });
        }

        // 区域验证截图 → 多模态 user 消息
        if (regionScreenshot) {
          ctx.messages.push({
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: regionScreenshot } },
              { type: 'text', text: '🔍 Region around the action point — 1:1 pixel mapping to your coordinate space. The image center IS your click/target coordinates. If the intended element is NOT at center, count the pixel offset and apply directly: corrected_x = your_x + offset_x_px, corrected_y = your_y + offset_y_px. No scale conversion needed.' },
            ],
          });
        }

        await onStep?.({ type: 'after_tool', data: { name: tc.name, arguments: resolvedArgs, success: result.success, message: result.message, ...(result.data ? { data: result.data } : {}) }, turnIndex: turn });
      }

      // LLM 已看到上一轮的 region_screenshot，清理
      stripRegionScreenshots(ctx.messages);

      ctx.turns.push({ toolCalls: turnCallInfos, results: turnResults });

      // 检测完成 → 截图验证
      const lastResult = turnResults[turnResults.length - 1];
      if (lastResult.data?.['action'] === 'done') {
        console.log(`[TaskEnd] desktop_done called, turn=${turn}, verifying...`);
        const verified = await this.verifyCompletion(goal, provider, apiKey, ctx, focusedHwnd);
        if (verified) {
          console.log(`[TaskEnd] ✓ verification PASSED`);
          taskCompleted = true;
          break;
        }
        console.log(`[TaskEnd] ✗ verification FAILED — continuing`);
      }

      if (turn === maxTurns - 1) {
        console.log(`[TaskEnd] maxTurns reached (${maxTurns})`);
      }
    }

    // 缓存存储（仅在任务有进展时缓存，避免存储不完整的执行）
    if (ctx.turns.length > 0 && !llmAborted) {
      await this.storeExecutionCache(goal, ctx.turns, l1Fingerprint, provider, apiKey);
    }

    // ── 退出诊断 ──
    if (taskCompleted) {
      console.log(`[TaskEnd] main loop done — turns=${ctx.turns.length}, completed ✓`);
    } else if (signal?.aborted) {
      console.log(`[TaskEnd] main loop aborted — turns=${ctx.turns.length}, signal.aborted`);
    } else if (llmAborted) {
      console.log(`[TaskEnd] main loop done — turns=${ctx.turns.length}, LLM stopped producing tool calls`);
    } else {
      // 关键：maxTurns 耗尽但任务未完成 — 不应静默忽略
      const toolNames = ctx.turns.flatMap(t => t.toolCalls.map(tc => tc.name));
      const uniqueTools = [...new Set(toolNames)];
      const summary = uniqueTools.length > 0
        ? `executed ${toolNames.length} tool calls (${uniqueTools.join(', ')})`
        : 'no tools executed';
      console.warn(`[TaskEnd] ⚠ maxTurns (${maxTurns}) exhausted WITHOUT task completion! ${ctx.turns.length} turns, ${summary}. The task may need splitting or a higher maxTurns.`);
    }

    return ctx.turns.length > 0 ? ctx.turns : null;
  }

  private async storeExecutionCache(goal: string, turns: AgentTurn[], l1Fingerprint: string | null, provider: ProviderConfig, apiKey: string): Promise<void> {
    if (turns.length === 0) return;
    const allSteps = toolCallsToSemanticActions(turns.flatMap(t => t.toolCalls));
    if (allSteps.length > 0) {
      try {
        await this.cacheService.storeSubGoalCache({
          subgoalKey: this.cacheService.normalizeGoal(goal),
          appName: goal.match(/打开(\S+)/)?.[1],
          params: [],
          template: allSteps,
          sourceGoal: goal,
        });
      } catch { /* 非致命 */ }
    }
    if (l1Fingerprint && allSteps.length >= 2) {
      try {
        await maybePromoteToSkillTemplate(this.deps, goal, l1Fingerprint, l1Fingerprint, allSteps, provider, apiKey);
      } catch { /* 非致命 */ }
    }
  }

  private async verifyCompletion(goal: string, provider: ProviderConfig, apiKey: string, ctx: AgentContext, focusedHwnd?: number): Promise<boolean> {
    try {
      const { VerificationAgent } = await import('@/agents/verification-api');
      const verifyAgent = new VerificationAgent();
      const { desktopService } = await import('@/services/desktop-service');
      const rawScreenshot = focusedHwnd && focusedHwnd !== 0
        ? await desktopService.screenshotWindow(focusedHwnd)
        : await desktopService.screenshot();
      ctx.lastScreenshot = rawScreenshot;
      const compressed = await compressImage(rawScreenshot);
      const result = await verifyAgent.verify(goal, compressed.dataUrl, provider, apiKey);
      if (result.completed) { ctx.taskCompleted = true; return true; }
      const compressedImg = await compressImage(result.screenshot);
      ctx.messages.push({
        role: 'user',
        content: [
          { type: 'image_url', image_url: { url: compressedImg.dataUrl } },
          { type: 'text', text: `⚠️ TASK NOT COMPLETE: ${result.feedback}\n\nThe goal was: "${goal}". Look at the current screenshot and continue. Do NOT call desktop_done again until truly done.` },
        ],
      });
      return false;
    } catch {
      ctx.taskCompleted = true;
      return true;
    }
  }

  /** 构建用户初始消息（纯文本，LLM 自行决定是否截图） */
  buildUserMessage(opts: { windows?: WindowInfo[]; actionHistory: string[] }): LLMMessage {
    const { windows, actionHistory } = opts;

    const textParts: string[] = [];
    if (windows && windows.length > 0) {
      textParts.push(`Visible windows:\n${this.buildWindowSummary(windows)}`);
    }
    if (actionHistory.length > 0) {
      textParts.push(`Recent actions:\n${actionHistory.join('\n')}`);
    }
    textParts.push('What should I do next?');
    return { role: 'user', content: textParts.join('\n\n') };
  }

  private buildWindowSummary(windows: WindowInfo[]): string {
    if (windows.length === 0) return '';
    const lines = windows.slice(0, 20).map((w) => `- hwnd=${w.hwnd}: "${w.title}" (${w.width}x${w.height})`);
    if (windows.length > 20) lines.push(`... and ${windows.length - 20} more windows`);
    return lines.join('\n');
  }

  mockToolCalls(goal: string, turn: number): ToolCallInfo[] {
    if (turn === 0) {
      const appName = goal.replace(/打开|启动|运行|launch|open/gi, '').trim();
      return [
        { id: 'call_mock_1', name: 'desktop_screenshot', arguments: {} },
        { id: 'call_mock_2', name: 'desktop_open_app', arguments: { name: appName || goal } },
      ];
    }
    return [
      { id: 'call_mock_done', name: 'desktop_done', arguments: { message: `已成功${goal} (mock)` } },
    ];
  }
}

/** 剥离旧的截图消息（保留 region_screenshot） */
function stripOldScreenshots(messages: LLMMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== 'user') continue;
    const content = msg.content;
    if (Array.isArray(content) && content.some((p: Record<string, unknown>) => p['type'] === 'image_url')) {
      if (isRegionScreenshotMessage(msg)) continue;
      messages.splice(i, 1);
      count++;
    }
  }
  return count;
}

function isRegionScreenshotMessage(msg: LLMMessage): boolean {
  if (msg.role !== 'user') return false;
  const content = msg.content;
  return Array.isArray(content) && content.some((p: Record<string, unknown>) =>
    p['type'] === 'text' && typeof p['text'] === 'string' && (p['text'] as string).includes('Region around the action point')
  );
}

function stripRegionScreenshots(messages: LLMMessage[]): number {
  let count = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (isRegionScreenshotMessage(messages[i])) {
      messages.splice(i, 1);
      count++;
    }
  }
  if (count > 0) console.debug(`[Agent]   stripped ${count} stale region_screenshot(s)`);
  return count;
}
