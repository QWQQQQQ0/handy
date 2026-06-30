/**
 * BuiltinSource — 内置技能源
 *
 * 包装现有 loader.ts 的 import.meta.glob 编译期扫描，
 * 适配为 SkillSource 接口。priority=0（最低，可被外部源覆盖）。
 */

import type { SkillSource, SkillManifest } from './types';
import type { StandardSkillConfig } from '../standard-md-parser';
import { loadSkillConfigs } from '../loader';

export class BuiltinSource implements SkillSource {
  id = 'builtin';
  type = 'builtin';
  label = '内置';
  priority = 0;
  enabled = true;

  private configs: StandardSkillConfig[] | null = null;

  private getConfigs(): StandardSkillConfig[] {
    if (!this.configs) {
      this.configs = loadSkillConfigs();
    }
    return this.configs;
  }

  async discover(): Promise<SkillManifest[]> {
    const configs = this.getConfigs();
    return configs.map((c) => ({
      name: c.name,
      description: c.description,
      location: `definitions/${c.name}`,
      hasTools: Array.isArray(c.tools) && c.tools.length > 0,
      sourceId: this.id,
      sourceType: this.type,
    }));
  }

  async load(location: string): Promise<StandardSkillConfig> {
    const configs = this.getConfigs();
    // location = "definitions/<name>"
    const dirName = location.replace(/^definitions\//, '');
    const config = configs.find((c) => c.name === dirName);
    if (!config) {
      throw new Error(`Builtin skill not found: ${dirName}`);
    }
    return config;
  }
}
