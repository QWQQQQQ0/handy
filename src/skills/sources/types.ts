/**
 * SkillSource — 技能源抽象接口
 *
 * 每个 SkillSource 代表一个技能发现位置（内置目录、工作区目录、用户目录、远程 URL 等）。
 * SkillRegistry 聚合多个源，统一管理和加载。
 */

import type { StandardSkillConfig } from '../standard-md-parser';

// ── SkillManifest (Level 1: 轻量扫描结果) ────────────────────────────────

export interface SkillManifest {
  /** kebab-case 技能名，全局唯一 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 源内的位置标识（相对路径 / URL / 子目录名） */
  location: string;
  /** 是否有 tools 定义（true=工具型 → SkillExecutor, false=知识型 → @ 列表） */
  hasTools: boolean;
  /** 所属源 ID */
  sourceId: string;
  /** 源类型标签 */
  sourceType: string;
  /** 版本号（可选） */
  version?: string;
}

// ── SkillSource 接口 ──────────────────────────────────────────────────────

export interface SkillSource {
  /** 唯一源 ID */
  id: string;
  /** 源类型：'builtin' | 'directory' | 'url' | 'git' */
  type: string;
  /** 人类可读标签 */
  label: string;
  /** 优先级，越大越优先（冲突时覆盖同名 skill）。builtin=0, user=5, workspace=10 */
  priority: number;
  /** 是否启用 */
  enabled: boolean;

  /**
   * 轻量扫描：列出该源下所有技能的名称和一句话描述。
   * 不应加载完整 SKILL.md 内容，仅解析 frontmatter 的 name + description。
   */
  discover(): Promise<SkillManifest[]>;

  /**
   * 完整加载某个技能的 SKILL.md 内容。
   * @param location manifest.location 的值
   */
  load(location: string): Promise<StandardSkillConfig>;
}

// ── 知识型 skill 信息（供 @ 列表和 FreeAgent 使用） ─────────────────────

export interface KnowledgeSkillInfo {
  /** 技能名 */
  name: string;
  /** 一句话描述 */
  description: string;
  /** 完整 body 文本（markdown） */
  body: string;
  /** usage 文本（如果 SKILL.md frontmatter 有 usage 字段） */
  usage?: string;
  /** 来源标签 */
  sourceLabel: string;
}
