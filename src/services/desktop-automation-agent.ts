// 来源: lib/services/desktop/desktop_automation_agent.dart

import { ModelCallService, ModelScenario } from '@/adapters/model-call-service';
import { DesktopScreenSkill } from '@/skills/desktop';
import type { SkillResult } from '@/types/skill';
import type { ProviderConfig } from '@/types/provider';
import type { LLMMessage } from '@/types/message';
import type { WindowInfo } from './desktop-service';
import { compressImage, type CompressedImage } from '@/utils/image';

export interface ToolCallInfo {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface AgentTurn {
  toolCalls: ToolCallInfo[];
  results: SkillResult[];
}

export interface AgentStepEvent {
  type: 'before_llm' | 'after_llm' | 'before_tool' | 'after_tool';
  data: Record<string, unknown>;
  turnIndex: number;
}

export type AgentStepCallback = (event: AgentStepEvent) => Promise<Record<string, unknown> | null>;

class AgentContext {
  messages: LLMMessage[] = [];
  allResults: SkillResult[] = [];
  turns: AgentTurn[] = [];
}

export class DesktopAutomationAgent {
  private modelService: ModelCallService;
  private skill: DesktopScreenSkill;
  testMode = false;

  constructor(modelService: ModelCallService, skill: DesktopScreenSkill) {
    this.modelService = modelService;
    this.skill = skill;
  }

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
  }): Promise<AgentTurn[] | null> {
    const {
      screenshotBase64,
      goal,
      provider,
      apiKey,
      windows,
      actionHistory = [],
      toolFilter,
      maxTurns = 3,
      onStep,
    } = params;

    const allTools = this.skill.tools.map((t) => ({
      type: 'function',
      function: { name: t.name, description: t.description, parameters: t.parameters },
    }));
    const resolvedTools = toolFilter
      ? allTools.filter((t) => {
          const fn = t['function'] as { name: string };
          return toolFilter.has(fn.name);
        })
      : allTools;

    if (resolvedTools.length === 0) return null;

    const ctx = new AgentContext();
    const tools = resolvedTools;

    let compressedInitial: CompressedImage | undefined;
    if (screenshotBase64) {
      try {
        compressedInitial = await compressImage(screenshotBase64);
      } catch { /* use original if compression fails */ }
    }
    ctx.messages.push(this.buildUserMessage({ screenshotBase64, windows, actionHistory, compressedScreenshot: compressedInitial }));

    for (let turn = 0; turn < maxTurns; turn++) {
      let toolCalls: ToolCallInfo[];
      let responseText = '';

      if (this.testMode) {
        toolCalls = this.mockToolCalls(goal, turn);
      } else {
        const preEdit = await onStep?.({ type: 'before_llm', data: { model: provider.model, messages: ctx.messages, tools }, turnIndex: turn });
        const callTools = preEdit?.['tools'] ? preEdit['tools'] as Record<string, unknown>[] : tools;

        console.debug(`DesktopAutomation: turn=${turn} msgs=${ctx.messages.length} tools=${callTools.length}`);

        const stream = this.modelService.chatStream({
          scenario: ModelScenario.desktopAutomation,
          messages: ctx.messages,
          provider,
          apiKey,
          tools: callTools,
          goal,
        });

        const textBuffer: string[] = [];
        let toolJson: string | undefined;

        for await (const chunk of stream) {
          if (chunk.startsWith('__TOOLS__:')) {
            toolJson = chunk.substring(10);
          } else if (chunk.startsWith('__ERROR__:')) {
            throw new Error(chunk.substring(10));
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

        const postEdit = await onStep?.({ type: 'after_llm', data: { tool_calls: toolCalls }, turnIndex: turn });
        if (postEdit?.['tool_calls']) {
          const edited = postEdit['tool_calls'] as Array<Record<string, unknown>>;
          toolCalls = edited.map((tc) => ({
            id: tc['id'] as string ?? '',
            name: tc['name'] as string,
            arguments: tc['arguments'] as Record<string, unknown>,
          }));
        }
      }

      if (toolCalls.length === 0) break;

      const turnCallInfos = toolCalls.map((tc) => ({ id: tc.id, name: tc.name, arguments: tc.arguments }));
      const turnResults: SkillResult[] = [];

      ctx.messages.push({
        role: 'assistant',
        content: responseText || null,
        toolCalls: toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
        })),
      });

      for (const tc of toolCalls) {
        const toolEdit = await onStep?.({ type: 'before_tool', data: { name: tc.name, arguments: tc.arguments }, turnIndex: turn });
        const resolvedArgs = (toolEdit?.['toolArguments'] as Record<string, unknown>) ?? tc.arguments;

        const result = await this.skill.execute(tc.name, resolvedArgs);
        turnResults.push(result);
        ctx.allResults.push(result);

        let content = result.data ? JSON.stringify(result.data) : result.message;
        if (content.length > 8000) {
          content = `${content.substring(0, 1000)}... (truncated, original size: ${content.length} chars)`;
        }

        // For screenshot, inject image as user message directly
        if (tc.name === 'desktop_screenshot' && result.data) {
          const imageData = result.data['image_data'] as string | undefined;
          if (imageData) {
            try {
              const compressed = await compressImage(imageData);
              ctx.messages.push({
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: compressed.dataUrl } },
                  { type: 'text', text: `Latest screenshot (original size: ${compressed.originalWidth}x${compressed.originalHeight}). Continue with the task.` },
                ],
              });
            } catch {
              ctx.messages.push({
                role: 'user',
                content: [
                  { type: 'image_url', image_url: { url: imageData } },
                  { type: 'text', text: 'Here is the latest screenshot. Continue with the task.' },
                ],
              });
            }
          }
        } else {
          ctx.messages.push({ role: 'tool', content, toolCallId: tc.id });
        }

        await onStep?.({ type: 'after_tool', data: { name: tc.name, arguments: resolvedArgs, success: result.success, message: result.message, ...(result.data ? { data: result.data } : {}) }, turnIndex: turn });
      }

      ctx.turns.push({ toolCalls: turnCallInfos, results: turnResults });

      const lastResult = turnResults[turnResults.length - 1];
      if (lastResult.data?.['action'] === 'done') break;
    }

    return ctx.turns.length > 0 ? ctx.turns : null;
  }

  buildUserMessage(opts: { screenshotBase64?: string; windows?: WindowInfo[]; actionHistory: string[]; compressedScreenshot?: CompressedImage }): LLMMessage {
    const { screenshotBase64, windows, actionHistory, compressedScreenshot } = opts;

    if (screenshotBase64) {
      const imageUrl = compressedScreenshot?.dataUrl
        ?? (screenshotBase64.startsWith('data:') ? screenshotBase64 : `data:image/png;base64,${screenshotBase64}`);
      const parts: Array<Record<string, unknown>> = [
        { type: 'image_url', image_url: { url: imageUrl } },
      ];
      const textParts: string[] = [];
      if (compressedScreenshot) {
        textParts.push(`[屏幕原始尺寸: ${compressedScreenshot.originalWidth}x${compressedScreenshot.originalHeight}]`);
      }
      const windowSummary = this.buildWindowSummary(windows ?? []);
      if (windowSummary) textParts.push(`Visible windows:\n${windowSummary}`);
      if (actionHistory.length > 0) textParts.push(`Recent actions:\n${actionHistory.join('\n')}`);
      textParts.push('What should I do next?');
      parts.push({ type: 'text', text: textParts.join('\n\n') });
      return { role: 'user', content: parts as LLMMessage['content'] };
    }

    const textParts: string[] = [];
    if (windows && windows.length > 0) {
      textParts.push(`Visible windows:\n${this.buildWindowSummary(windows)}`);
    }
    if (actionHistory.length > 0) {
      textParts.push(`Recent actions:\n${actionHistory.join('\n')}`);
    }
    textParts.push('What should I do next? (Call desktop_screenshot first if you need to see the screen.)');
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
      return [
        { id: 'call_mock_1', name: 'desktop_list_apps', arguments: {} },
        { id: 'call_mock_2', name: 'desktop_screenshot', arguments: {} },
      ];
    }
    if (turn === 1) {
      const appName = goal.replace(/打开|启动|运行|launch|open/gi, '').trim();
      return [
        { id: 'call_mock_3', name: 'desktop_open_app', arguments: { name: appName || goal } },
      ];
    }
    return [
      { id: 'call_mock_done', name: 'desktop_done', arguments: { message: `已成功${goal} (mock)` } },
    ];
  }
}
