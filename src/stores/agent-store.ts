// Agent store — user-defined agent CRUD with SQLite persistence.
// Agents = system prompt + tool filter + enable toggle.
// Enabled agents appear in request_agent.enum and @mention dropdown.

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';
import { getDB } from '@/db';
import type { UserAgentConfig } from '@/types/agent';

interface AgentRow {
  id: string; name: string; description: string;
  system_prompt: string; tool_names: string;
  enabled: number;
  created_at: string; updated_at: string;
}

function rowToConfig(row: AgentRow): UserAgentConfig {
  let toolNames: string[] = [];
  try { toolNames = JSON.parse(row.tool_names); } catch { /* keep empty */ }
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? '',
    systemPrompt: row.system_prompt ?? '',
    toolNames,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface AgentState {
  loaded: boolean;
  agents: UserAgentConfig[];

  load: () => Promise<void>;
  createAgent: (config: UserAgentConfig) => Promise<void>;
  updateAgent: (config: UserAgentConfig) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  toggleAgent: (id: string, enabled: boolean) => Promise<void>;
  getEnabledAgents: () => UserAgentConfig[];
}

export const useAgentStore = create<AgentState>()(
  immer((set, get) => ({
    loaded: false,
    agents: [],

    load: async () => {
      const db = await getDB();
      const rows = await db.query<AgentRow>(
        'SELECT * FROM agents ORDER BY name ASC',
      );
      set({ agents: rows.map(rowToConfig), loaded: true });
    },

    createAgent: async (config) => {
      const db = await getDB();
      const toolNamesJson = JSON.stringify(config.toolNames ?? []);
      await db.execute(
        `INSERT INTO agents (id, name, description, system_prompt, tool_names, enabled)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [config.id, config.name, config.description ?? '', config.systemPrompt ?? '', toolNamesJson, config.enabled ? 1 : 0],
      );
      await get().load();
    },

    updateAgent: async (config) => {
      const db = await getDB();
      const toolNamesJson = JSON.stringify(config.toolNames ?? []);
      await db.execute(
        `UPDATE agents SET name=?, description=?, system_prompt=?, tool_names=?, enabled=?, updated_at=datetime('now')
         WHERE id=?`,
        [config.name, config.description ?? '', config.systemPrompt ?? '', toolNamesJson, config.enabled ? 1 : 0, config.id],
      );
      await get().load();
    },

    deleteAgent: async (id) => {
      const db = await getDB();
      await db.execute('DELETE FROM agents WHERE id = ?', [id]);
      await get().load();
    },

    toggleAgent: async (id, enabled) => {
      const db = await getDB();
      await db.execute(
        "UPDATE agents SET enabled=?, updated_at=datetime('now') WHERE id=?",
        [enabled ? 1 : 0, id],
      );
      set((s) => {
        const agent = s.agents.find((a) => a.id === id);
        if (agent) agent.enabled = enabled;
      });
    },

    getEnabledAgents: () => {
      return get().agents.filter((a) => a.enabled);
    },
  })),
);
