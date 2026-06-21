// 来源: lib/skills/skill.dart

import type { SkillResult, ToolDefinition } from '@/types/skill';

export { type SkillResult, type ToolDefinition } from '@/types/skill';

export interface SkillTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  nameCn?: string;
  descriptionCn?: string;
}

export interface Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: SkillTool[];
  nameCn?: string;
  descriptionCn?: string;
  categoryCn?: string;
  usage?: string;
  usageCn?: string;

  execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult>;
  onLoad?(): Promise<void>;
  onDispose?(): Promise<void>;
}

export function toolToOpenAI(tool: SkillTool): Record<string, unknown> {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

export function makeResult(success: boolean, message: string, data?: Record<string, unknown>): SkillResult {
  return { success, message, data };
}

export const SkillOk = (message: string, data?: Record<string, unknown>) =>
  makeResult(true, message, data);

export const SkillFail = (message: string, data?: Record<string, unknown>) =>
  makeResult(false, message, data);

/**
 * 工具执行上下文 — 按任务维护，按次调用传递。
 * 包含当前截图压缩比例等坐标还原所需信息。
 */
export interface ToolContext {
  /** 当前截图的压缩比例（null/undefined = 无缩放，坐标视为原始空间） */
  scale?: { scaleX: number; scaleY: number } | null;
  /** 目标窗口句柄（用于避免浮窗遮挡） */
  targetWindowHwnd?: number | null;
}
