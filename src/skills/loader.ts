/**
 * Skill Loader — scans skill directories and parses standard SKILL.md files.
 *
 * Skills live in directory-per-skill format under src/skills/definitions/
 * conforming to the AgentSkills open standard (with Handy extensions).
 */

import { parseStandardSkillMd } from './standard-md-parser';
import type { StandardSkillConfig } from './standard-md-parser';

// ── Build-time glob: discover all SKILL.md files ─────────────────────────
//
// import.meta.glob is a Vite build-time feature. At build time, Vite scans
// the definitions/ directory tree and imports each SKILL.md as a raw string.
// Content is loaded eagerly so no fetch() is needed at runtime.

const SKILL_MD_MODULES = import.meta.glob<string>(
  './definitions/*/SKILL.md',
  { eager: true, query: '?raw', import: 'default' },
);

/**
 * Extract skill directory names from the glob keys.
 * e.g. "./definitions/code-tools/SKILL.md" → "code-tools"
 */
function extractSkillDirs(): string[] {
  const dirs: string[] = [];
  for (const path of Object.keys(SKILL_MD_MODULES)) {
    const match = /(?:^|\/)definitions\/([^/]+)\/SKILL\.md$/.exec(path);
    if (match) {
      dirs.push(match[1]);
    }
  }
  return dirs.sort();
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Load all built-in skill configs from src/skills/definitions/ subdirectories.
 *
 * Uses import.meta.glob (eager) so content is bundled at build time —
 * no fetch() needed at runtime.
 */
export function loadSkillConfigs(): StandardSkillConfig[] {
  const configs: StandardSkillConfig[] = [];
  const loaded = new Set<string>();

  for (const [path, content] of Object.entries(SKILL_MD_MODULES)) {
    try {
      const config = parseStandardSkillMd(content);
      if (loaded.has(config.name)) {
        console.warn(`[loader] Duplicate skill name "${config.name}" — skipping ${path}`);
        continue;
      }
      loaded.add(config.name);
      configs.push(config);
    } catch (err) {
      console.warn(`[loader] Failed to parse ${path}: ${(err as Error).message}`);
    }
  }

  return configs;
}

/**
 * Load a single skill config by directory name.
 */
export function loadSkillConfig(dirName: string): StandardSkillConfig | null {
  const key = `./definitions/${dirName}/SKILL.md`;
  const content = SKILL_MD_MODULES[key];
  if (!content) return null;

  try {
    return parseStandardSkillMd(content);
  } catch (err) {
    console.warn(`[loader] Failed to parse skill "${dirName}": ${(err as Error).message}`);
    return null;
  }
}

/**
 * Get the list of available skill directory names.
 */
export function listSkillDirs(): string[] {
  return extractSkillDirs();
}

/**
 * Map of directory name → SKILL.md raw content.
 */
export function getRawSkillMdMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const [path, content] of Object.entries(SKILL_MD_MODULES)) {
    const match = /(?:^|\/)definitions\/([^/]+)\/SKILL\.md$/.exec(path);
    if (match) {
      map[match[1]] = content;
    }
  }
  return map;
}
