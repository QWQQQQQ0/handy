// Skill Executor Interface
// 定义Skill执行器的接口，Service层通过此接口调用Skill

import type { SkillResult } from '@/types/skill';
import type { Skill, ToolContext } from '@/skills/skill';

export interface ISkillExecutor {
  /**
   * 执行工具调用
   * @param ctx 可选的执行上下文（坐标还原等平台级能力）
   */
  executeToolCall(toolName: string, params: Record<string, unknown>, ctx?: ToolContext): Promise<SkillResult>;

  /**
   * 构建LLM可用的工具列表
   */
  buildToolsForLLM(only?: Set<string> | string[]): Record<string, unknown>[];

  /**
   * 获取指定ID的Skill
   */
  getSkill(id: string): Skill | undefined;

  /**
   * 注册Skill
   */
  register(skill: Skill): void;

  /**
   * 注销Skill
   */
  unregister(id: string): void;
}
