// Skill store — DB-backed CRUD for built-in + user-defined skills

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getDB } from '@/db';
import type { SkillRow } from '@/db/types';
import type { UserSkillConfig, ToolDefinition } from '@/types/skill';
import { UserDefinedSkill } from '@/skills/user-defined';
import { loadSkillConfigs } from '@/skills/loader';
import { standardNameToLegacyId } from '@/skills/standard-md-parser';
import type { SkillExecutor } from '@/skills/executor';
import { getSkillRegistry } from '@/skills/sources/registry';
import { BuiltinSource } from '@/skills/sources/builtin-source';
import { DirectorySource } from '@/skills/sources/directory-source';
import type { KnowledgeSkillInfo } from '@/skills/sources/types';

function rowToConfig(row: SkillRow): UserSkillConfig {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    category: row.category,
    tools: JSON.parse(row.schema_json) as ToolDefinition[],
    builtin: row.builtin === 1,
    steps: row.steps_json ? JSON.parse(row.steps_json) : undefined,
    implementation: row.implementation ?? undefined,
    nameCn: row.name_cn ?? undefined,
    descriptionCn: row.description_cn ?? undefined,
    categoryCn: row.category_cn ?? undefined,
    usage: row.usage_text ?? undefined,
    usageCn: row.usage_cn ?? undefined,
    exposedToAI: row.exposed_to_ai === 1,
    skillDir: row.skill_dir ?? undefined,
    license: row.license ?? undefined,
    compatibility: row.compatibility ?? undefined,
  };
}

function configToRow(config: UserSkillConfig): SkillRow {
  return {
    id: config.id,
    name: config.name,
    description: config.description,
    category: config.category,
    schema_json: JSON.stringify(config.tools),
    enabled: 1,
    builtin: config.builtin ? 1 : 0,
    steps_json: config.steps ? JSON.stringify(config.steps) : null,
    implementation: config.implementation ?? null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    name_cn: config.nameCn ?? null,
    description_cn: config.descriptionCn ?? null,
    category_cn: config.categoryCn ?? null,
    usage_text: config.usage ?? null,
    usage_cn: config.usageCn ?? null,
    exposed_to_ai: config.exposedToAI !== false ? 1 : 0,
    skill_dir: config.skillDir ?? null,
    license: config.license ?? null,
    compatibility: config.compatibility ?? null,
  };
}

interface SkillState {
  loaded: boolean;
  userSkills: Map<string, UserDefinedSkill>;
  allConfigs: UserSkillConfig[];
  /** 知识型技能列表（供 @ 列表用） */
  knowledgeSkills: Array<{ name: string; description: string; sourceLabel: string; location: string }>;

  initializeSkills: () => Promise<void>;
  createSkill: (config: UserSkillConfig) => Promise<void>;
  updateSkill: (config: UserSkillConfig) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
  refreshUserSkills: (executor: SkillExecutor) => Promise<void>;
  getUserSkillInstances: () => UserDefinedSkill[];
  /** 获取知识型技能完整信息（@ 选中时调用） */
  getKnowledgeSkill: (name: string) => Promise<KnowledgeSkillInfo | null>;
}

export const useSkillStore = create<SkillState>()(
  immer((set, get) => ({
    loaded: false,
    userSkills: new Map(),
    allConfigs: [],
    knowledgeSkills: [],

    initializeSkills: async () => {
      const db = await getDB();

      // ── 设置 SkillRegistry ──
      const registry = getSkillRegistry();

      // 注册内置源
      if (!registry.getSource('builtin')) {
        registry.registerSource(new BuiltinSource());
      }

      // 注册工作区源 (./.handy/skills/)
      if (!registry.getSource('workspace')) {
        const workspaceSource = new DirectorySource(
          'workspace',
          './.handy/skills',
          10,
          '工作区',
        );
        registry.registerSource(workspaceSource);
      }

      // 注册用户源 (~/.handy/skills/)
      if (!registry.getSource('user')) {
        let userSkillsPath = './.handy/user-skills'; // fallback
        try {
          const { homeDir } = await import('@tauri-apps/api/path');
          userSkillsPath = (await homeDir()) + '.handy/skills';
        } catch { /* not Tauri */ }
        const userSource = new DirectorySource(
          'user',
          userSkillsPath,
          5,
          '用户',
        );
        registry.registerSource(userSource);
      }

      // 恢复上次导入的外部目录源
      await registry.restorePersistedSources();

      // 扫描所有源
      await registry.refresh();

      // 加载工具型技能配置
      const toolConfigs = await registry.loadAllToolConfigs();

      // Sync tool configs to DB (builtin + external tool skills)
      for (const sc of toolConfigs) {
        const legacyId = standardNameToLegacyId(sc.name);
        // 如果已经是内置 ID，用 builtin 标记；否则为外部工具型技能
        const isBuiltin = sc.name === legacyId || [
          'code_tools','desktop_screen','desktop_uia','web_screen',
          'phone_screen','app_builder','office_doc','system_config',
          'chat_tools','scheduler_tools'
        ].includes(legacyId);
        const row = configToRow({
          id: legacyId,
          name: sc.name,
          description: sc.description,
          category: sc['x-i18n']?.category_cn ?? '',
          tools: sc.tools ?? [],
          builtin: isBuiltin,
          nameCn: sc['x-i18n']?.name_cn,
          descriptionCn: sc['x-i18n']?.description_cn,
          categoryCn: sc['x-i18n']?.category_cn,
          usage: sc.usage,
          usageCn: sc['x-i18n']?.usage_cn,
          skillDir: `src/skills/definitions/${sc.name}`,
          license: sc.license,
          compatibility: sc.compatibility,
        });
        await db.execute(
          `INSERT OR REPLACE INTO skills
           (id, name, description, category, schema_json, enabled, builtin,
            steps_json, implementation, created_at, updated_at,
            name_cn, description_cn, category_cn, usage_text, usage_cn,
            exposed_to_ai, skill_dir, license, compatibility)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          [row.id, row.name, row.description, row.category, row.schema_json,
           row.enabled, row.builtin, row.steps_json, row.implementation,
           row.created_at, row.updated_at, row.name_cn, row.description_cn,
           row.category_cn, row.usage_text, row.usage_cn, row.exposed_to_ai,
           row.skill_dir, row.license, row.compatibility],
        );
      }

      // Clean up built-in skills that no longer exist
      const toolIds = toolConfigs.map(sc => standardNameToLegacyId(sc.name));
      if (toolIds.length > 0) {
        const placeholders = toolIds.map(() => '?').join(',');
        await db.execute(
          `DELETE FROM skills WHERE builtin = 1 AND id NOT IN (${placeholders})`,
          toolIds,
        );
      }

      // Load all enabled skills from DB (builtin + user)
      const rows = await db.query<SkillRow>(
        'SELECT * FROM skills WHERE enabled = 1 ORDER BY builtin DESC, name ASC',
      );
      const configs = rows.map(rowToConfig);

      const userSkills = new Map<string, UserDefinedSkill>();
      for (const cfg of configs) {
        if (!cfg.builtin) {
          userSkills.set(cfg.id, new UserDefinedSkill(cfg));
        }
      }

      // 收集知识型技能列表
      const knowledgeList = registry.getKnowledgeSkillList();

      set({ loaded: true, allConfigs: configs, userSkills, knowledgeSkills: knowledgeList });
    },

    createSkill: async (config) => {
      const db = await getDB();
      const row = configToRow({ ...config, builtin: false });
      await db.execute(
        'INSERT INTO skills (id, name, description, category, schema_json, enabled, builtin, steps_json, implementation, created_at, updated_at, exposed_to_ai, skill_dir, license, compatibility) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [row.id, row.name, row.description, row.category, row.schema_json, row.enabled, row.builtin, row.steps_json, row.implementation, row.created_at, row.updated_at, row.exposed_to_ai, row.skill_dir, row.license, row.compatibility],
      );
      const skill = new UserDefinedSkill({ ...config, builtin: false });
      set((s) => {
        s.userSkills.set(config.id, skill);
        s.allConfigs.push({ ...config, builtin: false });
      });
    },

    updateSkill: async (config) => {
      const db = await getDB();
      const row = configToRow({ ...config, builtin: config.builtin });
      await db.execute(
        "UPDATE skills SET name=?, description=?, schema_json=?, steps_json=?, implementation=?, exposed_to_ai=?, skill_dir=?, license=?, compatibility=?, updated_at=datetime('now') WHERE id=?",
        [row.name, row.description, row.schema_json, row.steps_json, row.implementation, row.exposed_to_ai, row.skill_dir, row.license, row.compatibility, row.id],
      );
      const skill = new UserDefinedSkill(config);
      set((s) => {
        s.userSkills.set(config.id, skill);
        const idx = s.allConfigs.findIndex((c) => c.id === config.id);
        if (idx >= 0) s.allConfigs[idx] = { ...config };
      });
    },

    deleteSkill: async (id) => {
      const db = await getDB();
      await db.execute('DELETE FROM skills WHERE id = ? AND builtin = 0', [id]);
      set((s) => {
        s.userSkills.delete(id);
        s.allConfigs = s.allConfigs.filter((c) => c.id !== id);
      });
    },

    toggleSkill: async (id, enabled) => {
      const db = await getDB();
      await db.execute('UPDATE skills SET enabled = ? WHERE id = ?', [enabled ? 1 : 0, id]);
      // Reload
      const rows = await db.query<SkillRow>(
        'SELECT * FROM skills WHERE enabled = 1 ORDER BY builtin DESC, name ASC',
      );
      const configs = rows.map(rowToConfig);
      const userSkills = new Map<string, UserDefinedSkill>();
      for (const cfg of configs) {
        if (!cfg.builtin) userSkills.set(cfg.id, new UserDefinedSkill(cfg));
      }
      set({ allConfigs: configs, userSkills });
    },

    refreshUserSkills: async (executor) => {
      const db = await getDB();
      const rows = await db.query<SkillRow>(
        'SELECT * FROM skills WHERE enabled = 1 AND builtin = 0 ORDER BY name ASC',
      );
      const configs = rows.map(rowToConfig);
      const userSkills = new Map<string, UserDefinedSkill>();
      for (const cfg of configs) {
        const skill = new UserDefinedSkill(cfg);
        skill.setExecutor(executor);
        userSkills.set(cfg.id, skill);
      }
      // Refresh allConfigs too
      const allRows = await db.query<SkillRow>(
        'SELECT * FROM skills WHERE enabled = 1 ORDER BY builtin DESC, name ASC',
      );
      set((s) => {
        s.userSkills = userSkills;
        s.allConfigs = allRows.map(rowToConfig);
        // Re-register user skills in executor (skip skills not exposed to AI)
        for (const skill of userSkills.values()) {
          try { executor.unregister(skill.id); } catch { /* not registered */ }
          if (skill.config.exposedToAI !== false) {
            executor.register(skill);
          }
        }
      });
    },

    getUserSkillInstances: () => {
      return [...get().userSkills.values()];
    },

    getKnowledgeSkill: async (name: string) => {
      const registry = getSkillRegistry();
      return registry.loadKnowledgeSkill(name);
    },
  }))
);
