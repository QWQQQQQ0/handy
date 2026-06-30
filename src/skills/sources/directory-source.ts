/**
 * DirectorySource — 运行时目录扫描技能源
 *
 * 扫描任意本地目录下的 README.md 文件。
 * 支持 .redirect 文件：指向外部 skill 目录。
 * 通过 Tauri fs API 读取。
 */

import type { SkillSource, SkillManifest } from './types';
import type { StandardSkillConfig } from '../standard-md-parser';
import { parseStandardSkillMd } from '../standard-md-parser';
import { isTauri } from '@/utils/platform';
import { load as parseYaml } from 'js-yaml';

export class DirectorySource implements SkillSource {
  id: string;
  type = 'directory';
  label: string;
  priority: number;
  enabled = true;

  /** 扫描的根目录路径（公开，供 registry 去重判断） */
  dirPath: string;

  /** 缓存 discover 时已解析的 config（避免 load 时重复解析 AGENTS.md 等无 frontmatter 文件失败） */
  private configCache = new Map<string, StandardSkillConfig>();

  constructor(id: string, dirPath: string, priority: number, label: string) {
    this.id = id;
    this.dirPath = dirPath;
    this.priority = priority;
    this.label = label;
  }

  async discover(): Promise<SkillManifest[]> {
    if (!isTauri()) {
      console.log(`[DirectorySource:${this.id}] Not in Tauri, skipping directory scan`);
      return [];
    }

    // 1. 优先找项目根目录的 AGENTS.md / CLAUDE.md → 作为唯一入口 skill
    for (const entryName of ['AGENTS.md', 'CLAUDE.md', '.agents/AGENTS.md']) {
      const entryPath = this.dirPath.replace(/[\\/]+$/, '') + '/' + entryName;
      try {
        const content = await this.readTextFile(entryPath);
        if (content && content.trim()) {
          let config: StandardSkillConfig;
          try {
            config = parseStandardSkillMd(content);
          } catch {
            const dirName = this.dirPath.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'project';
            const firstLine = content.trim().split('\n')[0].replace(/^#+\s*/, '').slice(0, 120);
            config = {
              name: dirName,
              description: firstLine || `${dirName} 项目入口`,
              body: content,
            };
          }
          this.configCache.set(entryPath, config);
          console.log(`[DirectorySource:${this.id}] Found project entry: ${entryPath} (skipping subdirectory scan)`);
          return [this.makeManifest(config, entryPath)];
        }
      } catch {
        // 文件不存在，继续下一个
      }
    }

    // 2. 没有入口文件 → 回退到扫描子目录 */README.md
    try {
      const found = await this.scanForSkills(this.dirPath);
      console.log(`[DirectorySource:${this.id}] Discovered ${found.length} skills from ${this.dirPath}`);
      return found;
    } catch (err) {
      console.warn(`[DirectorySource:${this.id}] Scan error:`, err);
      return [];
    }
  }

  /**
   * 扫描目录的直接子目录，每个子目录视为一个 skill。
   * 如果子目录内没有 README.md，尝试进入 ".agents/skills" 或 ".claude/skills" 继续扫。
   */
  private async scanForSkills(dirPath: string): Promise<SkillManifest[]> {
    const manifests: SkillManifest[] = [];
    const entries = await this.readDir(dirPath);
    if (!entries || entries.length === 0) return manifests;

    for (const entry of entries) {
      if (entry.name === '.' || entry.name === '..' || entry.name.startsWith('.git')) continue;

      if (entry.name.endsWith('.redirect')) {
        const redirectTarget = await this.readRedirect(entry.path);
        if (redirectTarget) {
          try {
            const config = await this.loadSkillMd(redirectTarget);
            manifests.push(this.makeManifest(config, redirectTarget));
          } catch (err) {
            console.warn(`[DirectorySource:${this.id}] Redirect load failed for "${entry.name}":`, err);
          }
        }
        continue;
      }

      if (!entry.isDirectory) continue;

      // 目录名即 skill 名，查找 README.md
      const readmePath = entry.path.replace(/[\\/]+$/, '') + '/README.md';
      try {
        const content = await this.readTextFile(readmePath);
        let config: StandardSkillConfig;
        try {
          config = parseStandardSkillMd(content);
        } catch {
          // README.md 可能没有 YAML frontmatter，从内容提取 name/description
          const firstHeading = content.match(/^#\s+(.+)$/m);
          const name = firstHeading ? firstHeading[1].trim().slice(0, 80) : entry.name;
          const descMatch = content.match(/^#\s+.+\n+(.+)$/m);
          const description = descMatch ? descMatch[1].trim().slice(0, 200) : `${entry.name} 技能`;
          config = { name, description, body: content };
        }
        manifests.push(this.makeManifest(config, entry.path));
        continue;
      } catch {
        // 该目录没有 README.md，不是一个直接 skill。
      }

      // 检查是否是容器目录（如 .agents, .claude），尝试进入 skills/
      for (const skillsDir of ['skills', 'commands']) {
        try {
          const innerPath = entry.path.replace(/[\\/]+$/, '') + '/' + skillsDir;
          const inner = await this.scanForSkills(innerPath);
          manifests.push(...inner);
          if (inner.length > 0) break; // 找到了就不再试其他
        } catch { /* 不存在 */ }
      }
    }

    return manifests;
  }

  private makeManifest(config: StandardSkillConfig, location: string): SkillManifest {
    return {
      name: config.name,
      description: config.description,
      location,
      hasTools: Array.isArray(config.tools) && config.tools.length > 0,
      sourceId: this.id,
      sourceType: this.type,
    };
  }

  async load(location: string): Promise<StandardSkillConfig> {
    // 缓存命中（AGENTS.md 等无 frontmatter 文件在 discover 时已合成）
    const cached = this.configCache.get(location);
    if (cached) return cached;

    // location 可能是文件路径或目录路径
    let filePath: string;

    if (location.endsWith('.md') || location.endsWith('.MD')) {
      filePath = location;
    } else {
      filePath = location.replace(/[\\/]+$/, '') + '/README.md';
    }

    const config = await this.loadSkillMd(filePath);
    this.configCache.set(location, config);
    return config;
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private async loadSkillMd(filePath: string): Promise<StandardSkillConfig> {
    const content = await this.readTextFile(filePath);
    return parseStandardSkillMd(content);
  }

  private parseFrontmatterOnly(content: string): { name?: string; description?: string; tools?: unknown[] } {
    // 快速提取 YAML frontmatter，不完整解析 body
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (!fmMatch) return {};

    try {
      const fm = parseYaml(fmMatch[1]) as Record<string, unknown>;
      return {
        name: typeof fm.name === 'string' ? fm.name : undefined,
        description: typeof fm.description === 'string' ? fm.description : undefined,
        tools: Array.isArray(fm.tools) ? fm.tools : undefined,
      };
    } catch {
      // 简单正则回退
      const nameMatch = fmMatch[1].match(/^name:\s*(.+)$/m);
      const descMatch = fmMatch[1].match(/^description:\s*(.+)$/m);
      const hasTools = /^tools:/m.test(fmMatch[1]);
      return {
        name: nameMatch?.[1]?.trim().replace(/^['"]|['"]$/g, ''),
        description: descMatch?.[1]?.trim().replace(/^['"]|['"]$/g, ''),
        tools: hasTools ? [] : undefined,
      };
    }
  }

  private async readRedirect(filePath: string): Promise<string | null> {
    try {
      const content = await this.readTextFile(filePath);
      const trimmed = content.trim();

      // 尝试 YAML 格式
      if (trimmed.startsWith('path:') || trimmed.startsWith('url:') || trimmed.startsWith('git:')) {
        try {
          const obj = parseYaml(trimmed) as { path?: string; url?: string; git?: string };
          if (obj.path) return obj.path;
          // url/git 暂不支持
          console.warn(`[DirectorySource:${this.id}] URL/git redirect not yet supported: ${filePath}`);
          return null;
        } catch {
          // fall through
        }
      }

      // 纯文本 = 相对/绝对路径
      const path = trimmed.split('\n')[0].trim();
      if (path && !path.startsWith('http')) {
        // 相对路径解析
        if (path.startsWith('.') || !path.includes(':')) {
          const dir = filePath.replace(/[^\\/]+$/, '');
          return dir + path;
        }
        return path;
      }

      return null;
    } catch {
      return null;
    }
  }

  // ── Tauri FS 封装 ─────────────────────────────────────────────────────

  private async readDir(dirPath: string): Promise<Array<{ name: string; path: string; isDirectory: boolean }>> {
    try {
      // @ts-ignore — plugin-fs optional
      const { readDir } = await import('@tauri-apps/plugin-fs');
      const entries = await readDir(dirPath);
      return entries
        .filter((e: { name?: string }) => !!e.name)
        .map((e: { name: string; isDirectory?: boolean }) => ({
          name: e.name,
          path: dirPath.replace(/[\\/]+$/, '') + '/' + e.name,
          isDirectory: e.isDirectory ?? false,
        }));
    } catch {
      return [];
    }
  }

  private async readTextFile(filePath: string): Promise<string> {
    // @ts-ignore — plugin-fs optional
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    return readTextFile(filePath);
  }
}
