// 来源: lib/skills/skill_executor.dart

import type { SkillResult, ToolDefinition } from '@/types/skill';
import type { Skill, SkillTool } from './skill';
import { toolToOpenAI } from './skill';

export class SkillExecutor {
  private skills: Map<string, Skill> = new Map();
  private toolToSkill: Map<string, Skill> = new Map();
  disabledTools: Set<string> = new Set();

  register(skill: Skill): void {
    this.skills.set(skill.id, skill);
    for (const tool of skill.tools) {
      this.toolToSkill.set(tool.name, skill);
    }
  }

  unregister(id: string): void {
    const skill = this.skills.get(id);
    if (skill) {
      for (const tool of skill.tools) {
        this.toolToSkill.delete(tool.name);
      }
      this.skills.delete(id);
    }
  }

  getSkill(id: string): Skill | undefined {
    return this.skills.get(id);
  }

  get allSkills(): Skill[] {
    return [...this.skills.values()];
  }

  get allTools(): SkillTool[] {
    return this.allSkills.flatMap((s) => s.tools);
  }

  get hasTools(): boolean {
    return this.allTools.length > 0;
  }

  get enabledToolNames(): string[] {
    return this.allTools
      .filter((t) => !this.disabledTools.has(t.name))
      .map((t) => t.name);
  }

  get enabledToolsBySkill(): Map<string, SkillTool[]> {
    const result = new Map<string, SkillTool[]>();
    for (const skill of this.allSkills) {
      const tools = skill.tools.filter((t) => !this.disabledTools.has(t.name));
      if (tools.length > 0) result.set(skill.name, tools);
    }
    return result;
  }

  async executeToolCall(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SkillResult> {
    for (const skill of this.allSkills) {
      if (skill.tools.some((t) => t.name === toolName)) {
        return skill.execute(toolName, params);
      }
    }
    return { success: false, message: `No enabled skill handles tool: ${toolName}` };
  }

  buildToolsForLLM(only?: Set<string>): Record<string, unknown>[] {
    let tools = this.allTools.filter((t) => !this.disabledTools.has(t.name));
    if (only) {
      tools = tools.filter((t) => only.has(t.name));
    }
    return tools.map(toolToOpenAI);
  }

  async loadAll(): Promise<void> {
    for (const skill of this.skills.values()) {
      await skill.onLoad?.();
    }
  }

  async disposeAll(): Promise<void> {
    for (const skill of this.skills.values()) {
      await skill.onDispose?.();
    }
  }
}
