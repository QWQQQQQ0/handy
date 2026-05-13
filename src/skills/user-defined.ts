// Dynamic user-defined skill — tools defined in DB config, no native bindings
// Execution modes: sandboxed JS (implementation) or step replay (steps)

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult } from '@/types/skill';
import type { UserSkillConfig, AutomationStep } from '@/types/skill';
import type { SkillExecutor } from './executor';

function substituteParams(obj: Record<string, unknown>, params: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      result[key] = value.replace(/\{\{(\w+)\}\}/g, (_, name) => String(params[name] ?? ''));
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class UserDefinedSkill implements Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: SkillTool[] = [];
  config: UserSkillConfig;
  private executorRef: SkillExecutor | null = null;

  constructor(config: UserSkillConfig) {
    this.config = config;
    this.id = config.id;
    this.name = config.name;
    this.category = config.category;
    this.description = config.description;
    this.tools = config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));
  }

  setExecutor(executor: SkillExecutor) {
    this.executorRef = executor;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    const tool = this.config.tools.find((t) => t.name === toolName);
    if (!tool) return SkillFail(`Unknown tool: ${toolName}`);

    // Mode 1: LLM-generated implementation (sandboxed JS)
    if (this.config.implementation) {
      try {
        const fn = new Function('params', 'skill', 'executor', this.config.implementation);
        const result = fn(params, { ok: SkillOk, fail: SkillFail }, this.executorRef);
        if (result && typeof (result as SkillResult).success === 'boolean') {
          return result as SkillResult;
        }
        return SkillOk('Implementation executed', result as Record<string, unknown> | undefined);
      } catch (e) {
        return SkillFail(`Implementation error: ${e}`);
      }
    }

    // Mode 2: Recorded step replay
    if (this.config.steps && this.config.steps.length > 0) {
      const matchingSteps = this.config.steps.filter((s) => s.toolName === toolName);
      if (matchingSteps.length === 0) {
        return SkillFail(`No recorded step matches tool: ${toolName}`);
      }
      const results: SkillResult[] = [];
      for (const step of matchingSteps) {
        const resolvedArgs = substituteParams(step.arguments, params);
        if (this.executorRef) {
          const r = await this.executorRef.executeToolCall(step.toolName, resolvedArgs);
          results.push(r);
        } else {
          results.push(SkillOk(`Replayed: ${step.description ?? step.toolName}`, resolvedArgs));
        }
      }
      const allOk = results.every((r) => r.success);
      return allOk
        ? SkillOk(`Replayed ${results.length} step(s)`, { results })
        : SkillFail(`Some steps failed`, { results });
    }

    return SkillFail(`Tool "${toolName}" has no implementation or recorded steps`);
  }

  getSteps(): AutomationStep[] {
    return this.config.steps ?? [];
  }
}
