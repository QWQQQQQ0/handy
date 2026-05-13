// Skill store — DB-backed CRUD for built-in + user-defined skills

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getDB } from '@/db';
import type { SkillRow } from '@/db/types';
import type { UserSkillConfig, ToolDefinition } from '@/types/skill';
import { UserDefinedSkill } from '@/skills/user-defined';
import { loadSkills } from '@/skills/loader';
import type { SkillExecutor } from '@/skills/executor';

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
  };
}

interface SkillState {
  loaded: boolean;
  userSkills: Map<string, UserDefinedSkill>;
  allConfigs: UserSkillConfig[];

  initializeSkills: () => Promise<void>;
  createSkill: (config: UserSkillConfig) => Promise<void>;
  updateSkill: (config: UserSkillConfig) => Promise<void>;
  deleteSkill: (id: string) => Promise<void>;
  toggleSkill: (id: string, enabled: boolean) => Promise<void>;
  refreshUserSkills: (executor: SkillExecutor) => Promise<void>;
  getUserSkillInstances: () => UserDefinedSkill[];
}

export const useSkillStore = create<SkillState>()(
  immer((set, get) => ({
    loaded: false,
    userSkills: new Map(),
    allConfigs: [],

    initializeSkills: async () => {
      if (get().loaded) return;
      const db = await getDB();

      // Seed built-in skills from markdown files on first run
      const builtinRow = await db.get<{ cnt: number }>(
        'SELECT COUNT(*) as cnt FROM skills WHERE builtin = 1',
      );
      if (!builtinRow || builtinRow.cnt === 0) {
        const configs = await loadSkills();
        for (const cfg of configs) {
          const row = configToRow({
            ...cfg,
            builtin: true,
          });
          await db.execute(
            'INSERT OR REPLACE INTO skills (id, name, description, category, schema_json, enabled, builtin, steps_json, implementation, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
            [row.id, row.name, row.description, row.category, row.schema_json, row.enabled, row.builtin, row.steps_json, row.implementation, row.created_at, row.updated_at],
          );
        }
      }

      // Load all enabled skills (builtin + user)
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

      set({ loaded: true, allConfigs: configs, userSkills });
    },

    createSkill: async (config) => {
      const db = await getDB();
      const row = configToRow({ ...config, builtin: false });
      await db.execute(
        'INSERT INTO skills (id, name, description, category, schema_json, enabled, builtin, steps_json, implementation, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [row.id, row.name, row.description, row.category, row.schema_json, row.enabled, row.builtin, row.steps_json, row.implementation, row.created_at, row.updated_at],
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
        "UPDATE skills SET name=?, description=?, schema_json=?, steps_json=?, implementation=?, updated_at=datetime('now') WHERE id=?",
        [row.name, row.description, row.schema_json, row.steps_json, row.implementation, row.id],
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
        // Re-register user skills in executor
        for (const skill of userSkills.values()) {
          try { executor.unregister(skill.id); } catch { /* not registered */ }
          executor.register(skill);
        }
      });
    },

    getUserSkillInstances: () => {
      return [...get().userSkills.values()];
    },
  }))
);
