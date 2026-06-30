/**
 * SkillRegistry — 统一技能注册表
 *
 * 聚合多个 SkillSource，按优先级去重，区分工具型/知识型技能。
 * 工具型技能配置传递给 SkillExecutor，知识型技能 body 存储供 @ 列表使用。
 */

import type { SkillSource, SkillManifest, KnowledgeSkillInfo } from './types';
import type { StandardSkillConfig } from '../standard-md-parser';
import { DirectorySource } from './directory-source';

export class SkillRegistry {
  private sources: Map<string, SkillSource> = new Map();

  /** 工具型技能完整配置（name → config） */
  private toolConfigs: Map<string, StandardSkillConfig> = new Map();

  /** 知识型技能信息（name → KnowledgeSkillInfo） */
  private knowledgeSkills: Map<string, KnowledgeSkillInfo> = new Map();

  /** 所有已发现的技能清单（Level 1） */
  private manifests: SkillManifest[] = [];

  // ── 源管理 ────────────────────────────────────────────────────────────

  registerSource(source: SkillSource): void {
    if (this.sources.has(source.id)) {
      console.warn(`[SkillRegistry] Source "${source.id}" already registered, overwriting`);
    }
    this.sources.set(source.id, source);
  }

  unregisterSource(id: string): void {
    this.sources.delete(id);
  }

  getSource(id: string): SkillSource | undefined {
    return this.sources.get(id);
  }

  getSources(): SkillSource[] {
    return [...this.sources.values()].sort((a, b) => a.priority - b.priority);
  }

  // ── 扫描与加载 ────────────────────────────────────────────────────────

  /**
   * 扫描所有已启用的源，合并技能清单。
   * 返回去重后的 manifests（高优先级覆盖低优先级）。
   */
  async refresh(): Promise<SkillManifest[]> {
    const allManifests: SkillManifest[] = [];

    for (const source of this.getSources()) {
      if (!source.enabled) continue;
      try {
        const results = await source.discover();
        console.log(`[SkillRegistry] Source "${source.id}" discovered ${results.length} skills`);
        allManifests.push(...results);
      } catch (err) {
        console.warn(`[SkillRegistry] Source "${source.id}" discover failed:`, err);
      }
    }

    // 去重：按 name 分组，取最高优先级的
    this.manifests = this.resolveConflicts(allManifests);
    return this.manifests;
  }

  /**
   * 完整加载所有工具型技能配置（用于同步到 DB + 注册 SkillExecutor）。
   * 知识型技能按需加载（在 @ 选中时才调用 loadKnowledgeSkill）。
   */
  async loadAllToolConfigs(): Promise<StandardSkillConfig[]> {
    const toolManifests = this.manifests.filter(m => m.hasTools);
    const configs: StandardSkillConfig[] = [];

    for (const manifest of toolManifests) {
      const source = this.sources.get(manifest.sourceId);
      if (!source) continue;

      try {
        const config = await source.load(manifest.location);
        this.toolConfigs.set(config.name, config);
        configs.push(config);
      } catch (err) {
        console.warn(`[SkillRegistry] Failed to load tool skill "${manifest.name}" from "${manifest.sourceId}":`, err);
      }
    }

    return configs;
  }

  /**
   * 按需加载单个知识型技能（@ 选中时调用）。
   * 返回完整的 body + usage 文本。
   */
  async loadKnowledgeSkill(name: string): Promise<KnowledgeSkillInfo | null> {
    // 如果有缓存，直接返回
    const cached = this.knowledgeSkills.get(name);
    if (cached) return cached;

    const manifest = this.manifests.find(m => m.name === name && !m.hasTools);
    if (!manifest) return null;

    const source = this.sources.get(manifest.sourceId);
    if (!source) return null;

    try {
      const config = await source.load(manifest.location);
      const info: KnowledgeSkillInfo = {
        name: config.name,
        description: config.description,
        body: config.body || '',
        usage: config.usage,
        sourceLabel: source.label,
      };
      this.knowledgeSkills.set(name, info);
      return info;
    } catch (err) {
      console.warn(`[SkillRegistry] Failed to load knowledge skill "${name}":`, err);
      return null;
    }
  }

  // ── 查询 ──────────────────────────────────────────────────────────────

  /** 获取所有已发现的技能清单 */
  getManifests(): SkillManifest[] {
    return this.manifests;
  }

  /** 获取工具型技能名列表 */
  getToolSkillNames(): string[] {
    return this.manifests.filter(m => m.hasTools).map(m => m.name);
  }

  /** 获取知识型技能名列表（供 @ 列表用） */
  getKnowledgeSkillNames(): string[] {
    return this.manifests.filter(m => !m.hasTools).map(m => m.name);
  }

  /** 获取知识型技能简略信息（name + description + sourceLabel + location，供 @ 列表用） */
  getKnowledgeSkillList(): Array<{ name: string; description: string; sourceLabel: string; location: string }> {
    return this.manifests
      .filter(m => !m.hasTools)
      .map(m => {
        const src = this.sources.get(m.sourceId);
        return { name: m.name, description: m.description, sourceLabel: src?.label || m.sourceType, location: m.location };
      });
  }

  // ── 运行时注册 ────────────────────────────────────────────────────────

  /**
   * 运行时注册一个目录源。传入任意路径（如 Remotion 项目根目录），
   * 自动扫描目录下的 README.md 文件，更新知识型技能列表。
   *
   * @param dirPath 目录路径（绝对或相对）
   * @param label 人类可读标签
   * @param priority 优先级，默认 8（介于 user 和 workspace 之间）
   * @returns 新注册的源 ID
   */
  async addDirectorySource(dirPath: string, label: string, priority = 8): Promise<string> {
    // 规范化路径用于去重
    const normalized = dirPath.replace(/[\\/]+$/, '').replace(/\\/g, '/');

    // 检查是否已有同路径的源
    for (const [existingId, existing] of this.sources) {
      if (existing.type === 'directory') {
        const existingPath = (existing as DirectorySource).dirPath?.replace(/[\\/]+$/, '').replace(/\\/g, '/');
        if (existingPath === normalized) {
          console.log(`[SkillRegistry] Directory source already exists for "${normalized}" (id: ${existingId})`);
          return existingId;
        }
      }
    }

    // 生成持久 ID（非随机，重启后可识别）
    const id = `src-${normalized.replace(/[^a-zA-Z0-9]/g, '-').slice(-40)}`;
    const source = new DirectorySource(id, dirPath, priority, label);
    this.registerSource(source);

    // 立即扫描新源
    try {
      const results = await source.discover();
      console.log(`[SkillRegistry] Runtime source "${id}" (${label}) discovered ${results.length} skills`);
      const merged = [...this.manifests, ...results];
      this.manifests = this.resolveConflicts(merged);
    } catch (err) {
      console.warn(`[SkillRegistry] Runtime source "${id}" discover failed:`, err);
    }

    // 持久化
    this.saveSources();

    return id;
  }

  /** 从持久化存储恢复已导入的源 */
  async restorePersistedSources(): Promise<void> {
    try {
      const raw = localStorage.getItem('handy_skill_sources');
      if (!raw) return;
      const items: Array<{ path: string; label: string }> = JSON.parse(raw);
      for (const item of items) {
        const id = `src-${item.path.replace(/[^a-zA-Z0-9]/g, '-').slice(-40)}`;
        if (this.sources.has(id)) continue; // 已注册
        const source = new DirectorySource(id, item.path, 8, item.label);
        this.registerSource(source);
        console.log(`[SkillRegistry] Restored source "${id}" (${item.label}): ${item.path}`);
      }
    } catch { /* ignore */ }
  }

  /** 保存当前所有目录源到 localStorage */
  private saveSources(): void {
    try {
      const items: Array<{ path: string; label: string }> = [];
      for (const [id, source] of this.sources) {
        if (source.type === 'directory') {
          const ds = source as DirectorySource;
          items.push({ path: ds.dirPath, label: ds.label });
        }
      }
      localStorage.setItem('handy_skill_sources', JSON.stringify(items));
    } catch { /* ignore */ }
  }

  /**
   * 移除运行时注册的源并重新扫描。
   */
  async removeSource(id: string): Promise<void> {
    this.unregisterSource(id);
    this.saveSources();
    await this.refresh();
  }

  // ── 内部 ──────────────────────────────────────────────────────────────

  private resolveConflicts(all: SkillManifest[]): SkillManifest[] {
    const byName = new Map<string, SkillManifest>();

    for (const m of all) {
      const existing = byName.get(m.name);
      if (!existing) {
        byName.set(m.name, m);
        continue;
      }

      // 比较优先级
      const existingSource = this.sources.get(existing.sourceId);
      const currentSource = this.sources.get(m.sourceId);
      const existingPrio = existingSource?.priority ?? 0;
      const currentPrio = currentSource?.priority ?? 0;

      if (currentPrio > existingPrio) {
        console.log(`[SkillRegistry] Skill "${m.name}" overridden by higher priority source "${m.sourceId}" (${currentPrio} > ${existingPrio})`);
        byName.set(m.name, m);
      } else if (currentPrio === existingPrio) {
        console.warn(`[SkillRegistry] Skill "${m.name}" conflict — keeping first registered (source "${existing.sourceId}")`);
      }
      // currentPrio < existingPrio → keep existing
    }

    return [...byName.values()];
  }
}

/** 全局单例 */
let _globalRegistry: SkillRegistry | null = null;

export function getSkillRegistry(): SkillRegistry {
  if (!_globalRegistry) {
    _globalRegistry = new SkillRegistry();
  }
  return _globalRegistry;
}
