/**
 * SkillMdAdapter — adapts a standard AgentSkills SKILL.md directory to the Skill interface.
 *
 * Handles both built-in skills (execution delegated to TypeScript classes) and
 * user-defined skills (execution via sandboxed implementation or step replay).
 *
 * Supports the 3-level progressive loading:
 *   Level 1: name + description (always loaded via ToolDisclosure menu)
 *   Level 2: full tools JSON Schema + usage docs (loaded on gatekeeper activation)
 *   Level 3: references/ directory files (loaded on-demand on first tool use)
 */

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult, ToolDefinition } from '@/types/skill';
import type { StandardSkillConfig } from './standard-md-parser';
import { standardNameToLegacyId } from './standard-md-parser';

// ── Execution delegate (for built-in skills) ─────────────────────────────

/**
 * A built-in skill's TypeScript class only needs to provide execution logic.
 * Tool definitions come from SKILL.md, not from the class.
 */
export interface SkillExecutionDelegate {
  /** Execute a named tool. Returns SkillResult. */
  executeTool(toolName: string, params: Record<string, unknown>): Promise<SkillResult>;
  /** Called when the skill is loaded */
  onLoad?(): Promise<void>;
  /** Called when the skill is disposed */
  onDispose?(): Promise<void>;
}

// ── SkillMdAdapter ────────────────────────────────────────────────────────

export class SkillMdAdapter implements Skill {
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

  /** SKILL.md directory path (e.g. "public/skills/code-tools" or absolute path) */
  readonly dirPath: string;

  /** Raw config for Level 2/3 content access */
  readonly config: StandardSkillConfig;

  /** Execution delegate for built-in skills; undefined = pure-prompt / user-defined */
  private delegate: SkillExecutionDelegate | null = null;

  /** User-defined execution: JS implementation string from DB */
  private implementation: string | null = null;

  /** User-defined execution: automation steps from DB */
  private steps: Array<{ toolName: string; arguments: Record<string, unknown> }> | null = null;

  /** Reference file cache (Level 3) */
  private referenceCache: Map<string, string> | null = null;

  constructor(config: StandardSkillConfig, dirPath: string) {
    this.config = config;
    this.dirPath = dirPath;

    // Map kebab-case name to snake_case id for backward compatibility
    this.id = standardNameToLegacyId(config.name);
    this.name = config.name;
    this.description = config.description;
    this.usage = config.usage;

    // Category: from x-i18n.category_cn or empty
    this.category = config['x-i18n']?.category_cn ?? '';

    // I18n fields
    this.nameCn = config['x-i18n']?.name_cn;
    this.descriptionCn = config['x-i18n']?.description_cn;
    this.categoryCn = config['x-i18n']?.category_cn;
    this.usageCn = config['x-i18n']?.usage_cn;

    // Tools: from SKILL.md tools array (canonical source)
    this.tools = (config.tools ?? []).map((t) => this.mapTool(t));
  }

  // ── Delegate + user-defined setup ─────────────────────────────────────

  /** Attach execution delegate for a built-in skill */
  setDelegate(delegate: SkillExecutionDelegate): void {
    this.delegate = delegate;
  }

  /** Set user-defined implementation (JS function body) */
  setImplementation(impl: string | null): void {
    this.implementation = impl;
  }

  /** Set user-defined automation steps */
  setSteps(steps: Array<{ toolName: string; arguments: Record<string, unknown> }> | null): void {
    this.steps = steps;
  }

  // ── Skill interface ──────────────────────────────────────────────────

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    // 1. Built-in skill → delegate to TypeScript class
    if (this.delegate) {
      return this.delegate.executeTool(toolName, params);
    }

    // 2. User-defined: JS implementation
    if (this.implementation) {
      return this.executeSandboxed(toolName, params);
    }

    // 3. User-defined: step replay
    if (this.steps && this.steps.length > 0) {
      return this.executeSteps(toolName, params);
    }

    // 4. Pure prompt skill — no execution, LLM uses description only
    return SkillFail(`Tool "${toolName}" has no execution handler. This is a prompt-only skill.`);
  }

  async onLoad(): Promise<void> {
    if (this.delegate?.onLoad) {
      await this.delegate.onLoad();
    }
    // Pre-scan references/ directory? Not here — lazy load during execution.
  }

  async onDispose(): Promise<void> {
    if (this.delegate?.onDispose) {
      await this.delegate.onDispose();
    }
    this.referenceCache = null;
  }

  // ── Level 3: References ──────────────────────────────────────────────

  /**
   * Check if this skill has a references/ directory with files.
   * Only meaningful for directory-based skills with filesystem access.
   */
  hasReferences(): boolean {
    // In web mode this can't be checked without fetch; assume false.
    // Tauri mode: caller uses fs:readDir to check.
    return false;
  }

  /**
   * Set reference file contents (caller reads files and passes them in).
   */
  setReferenceCache(files: Map<string, string>): void {
    this.referenceCache = files;
  }

  /**
   * Get a specific reference file content.
   */
  getReference(name: string): string | undefined {
    return this.referenceCache?.get(name);
  }

  /** All reference file names */
  getReferenceNames(): string[] {
    return this.referenceCache ? Array.from(this.referenceCache.keys()) : [];
  }

  // ── Private helpers ──────────────────────────────────────────────────

  private mapTool(t: ToolDefinition): SkillTool {
    // Merge x-i18n tool translations
    const toolI18n = this.config['x-i18n']?.tools?.[t.name];
    return {
      name: t.name,
      description: t.description,
      parameters: t.parameters ?? { type: 'object', properties: {} },
      returns: t.returns,
      nameCn: toolI18n?.name_cn ?? t.nameCn,
      descriptionCn: toolI18n?.description_cn ?? t.descriptionCn,
    };
  }

  private executeSandboxed(
    toolName: string,
    params: Record<string, unknown>,
  ): Promise<SkillResult> {
    return new Promise((resolve) => {
      try {
        const fn = new Function(
          'params',
          'toolName',
          'skill',
          `"use strict";
${this.implementation!}
//# sourceURL=skill-${this.id}-${toolName}.js`,
        );

        const skillHelper = {
          ok: (message: string, data?: Record<string, unknown>) =>
            resolve(SkillOk(message, data)),
          fail: (message: string, data?: Record<string, unknown>) =>
            resolve(SkillFail(message, data)),
        };

        const result = fn(params, toolName, skillHelper);
        if (result && typeof result.then === 'function') {
          // Async implementation
          result.then(
            (r: SkillResult) => resolve(r ?? SkillOk('Done')),
            (e: unknown) =>
              resolve(SkillFail(`Execution failed: ${(e as Error).message}`)),
          );
        } else if (result) {
          resolve(result as SkillResult);
        }
      } catch (e) {
        resolve(SkillFail(`Sandbox error: ${(e as Error).message}`));
      }
    });
  }

  private executeSteps(
    toolName: string,
    _params: Record<string, unknown>,
  ): Promise<SkillResult> {
    // Step replay mode — for later implementation.
    // Currently UserDefinedSkill handles this; this is a placeholder
    // for when we migrate user skills to SkillMdAdapter.
    return Promise.resolve(
      SkillFail(`Step replay not yet supported in SkillMdAdapter for tool: ${toolName}`),
    );
  }
}
