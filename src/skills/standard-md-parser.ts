/**
 * Standard AgentSkills SKILL.md parser & generator.
 *
 * Parses SKILL.md files conforming to the AgentSkills open standard
 * (agentskills/agentskills), with Handy extensions for tool definitions
 * (top-level `tools` array) and i18n (`x-i18n` block).
 */

import { load as parseYaml, dump as dumpYaml } from 'js-yaml';
import type { ToolDefinition } from '@/types/skill';

// ── Types ────────────────────────────────────────────────────────────────

export interface SkillToolsI18n {
  [toolName: string]: {
    name_cn?: string;
    description_cn?: string;
  };
}

export interface SkillI18n {
  name_cn?: string;
  description_cn?: string;
  category_cn?: string;
  usage_cn?: string;
  tools?: SkillToolsI18n;
}

export interface StandardSkillConfig {
  /** kebab-case skill identifier (also used as internal id with snake_case mapping) */
  name: string;
  /** English description — should include trigger phrases for ToolDisclosure menu */
  description: string;
  /** SPDX license identifier or free-text */
  license?: string;
  /** Environment / version requirements */
  compatibility?: string;
  /** Usage documentation (replaces body markdown for LLM context) */
  usage?: string;
  /** Handy extension: tool definitions with JSON Schema parameters */
  tools?: ToolDefinition[];
  /** Handy extension: Chinese i18n */
  'x-i18n'?: SkillI18n;
  /** Raw markdown body after YAML frontmatter (Level 2 content) */
  body: string;
}

interface RawFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  usage?: string;
  tools?: Array<{
    name: string;
    description: string;
    name_cn?: string;
    description_cn?: string;
    parameters?: Record<string, unknown>;
    returns?: string;
  }>;
  'x-i18n'?: SkillI18n;
  // Allow unknown keys (standard parsers add fields we don't use)
  [key: string]: unknown;
}

// ── Parsing ───────────────────────────────────────────────────────────────

/**
 * Parse a standard AgentSkills SKILL.md string.
 *
 * @param md  Full SKILL.md content (YAML frontmatter + Markdown body)
 * @returns   Parsed StandardSkillConfig
 * @throws    If required fields are missing or YAML is malformed
 */
export function parseStandardSkillMd(md: string): StandardSkillConfig {
  // Extract YAML frontmatter between --- delimiters
  const fmMatch = /^---\s*\n([\s\S]*?)\n---/.exec(md);
  if (!fmMatch) {
    throw new Error('Missing YAML frontmatter (expected --- at start of file)');
  }

  let raw: RawFrontmatter;
  try {
    raw = parseYaml(fmMatch[1]) as RawFrontmatter;
  } catch (e) {
    throw new Error(`YAML parse error: ${(e as Error).message}`);
  }

  if (!raw.name || typeof raw.name !== 'string') {
    throw new Error('SKILL.md frontmatter must contain a "name" field');
  }
  if (!raw.description || typeof raw.description !== 'string') {
    throw new Error('SKILL.md frontmatter must contain a "description" field');
  }

  // Extract body (everything after frontmatter)
  const bodyStart = fmMatch.index! + fmMatch[0].length;
  const body = md.substring(bodyStart).trim();

  // Normalize tools: ensure parameters.default exists if not set
  const tools: ToolDefinition[] | undefined = raw.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters ?? { type: 'object', properties: {} },
    returns: t.returns,
    nameCn: t.name_cn,
    descriptionCn: t.description_cn,
  }));

  // Normalize x-i18n tools keys: map name_cn/description_cn
  const i18n = raw['x-i18n'];

  return {
    name: raw.name,
    description: raw.description,
    license: raw.license,
    compatibility: raw.compatibility,
    usage: raw.usage,
    tools: tools && tools.length > 0 ? tools : undefined,
    'x-i18n': i18n,
    body,
  };
}

// ── Generation ────────────────────────────────────────────────────────────

/**
 * Generate a standard AgentSkills SKILL.md string from config.
 * Used by the UI for AI skill generation and export.
 */
export function generateStandardSkillMd(config: StandardSkillConfig): string {
  const frontmatterObj: Record<string, unknown> = {
    name: config.name,
  };

  if (config.description) {
    frontmatterObj.description = config.description;
  }
  if (config.license) frontmatterObj.license = config.license;
  if (config.compatibility) frontmatterObj.compatibility = config.compatibility;
  if (config.usage) frontmatterObj.usage = config.usage;

  if (config.tools && config.tools.length > 0) {
    frontmatterObj.tools = config.tools.map((t) => ({
      name: t.name,
      description: t.description,
      ...(t.parameters ? { parameters: t.parameters } : {}),
      ...(t.returns ? { returns: t.returns } : {}),
      ...(t.nameCn ? { name_cn: t.nameCn } : {}),
      ...(t.descriptionCn ? { description_cn: t.descriptionCn } : {}),
    }));
  }

  if (config['x-i18n']) {
    frontmatterObj['x-i18n'] = config['x-i18n'];
  }

  const yamlBlock = dumpYaml(frontmatterObj, {
    lineWidth: -1,
    noCompatMode: true,
    quotingType: '"',
    forceQuotes: false,
  });

  const body = config.body ? `\n${config.body}\n` : '\n';

  return `---\n${yamlBlock}---\n${body}`;
}

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Convert kebab-case skill name to legacy snake_case internal id.
 * e.g. "code-tools" → "code_tools", "desktop-screen" → "desktop_screen"
 */
export function standardNameToLegacyId(name: string): string {
  return name.replace(/-/g, '_');
}

/**
 * Convert legacy snake_case id to kebab-case standard name.
 * e.g. "code_tools" → "code-tools", "desktop_uia" → "desktop-uia"
 */
export function legacyIdToStandardName(id: string): string {
  return id.replace(/_/g, '-');
}

/**
 * Extract a one-liner from a description (first sentence, max 80 chars).
 * Used by ToolDisclosure for the menu level.
 */
export function extractOneLiner(description: string): string {
  const firstSentence = description.split(/[.!?]\s/)[0];
  if (firstSentence.length <= 80) return firstSentence;
  return firstSentence.substring(0, 77) + '...';
}
