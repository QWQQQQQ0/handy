// 来源: lib/skills/app_builder_skill.dart

import { getDB } from '@/db';
import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult, ToolDefinition } from '@/types/skill';

export interface SavedAppRow {
  id: string;
  name: string;
  code: string;
  created_at: string;
  description?: string;
  project_type?: string;
  files_json?: string;
  entry_file?: string;
  updated_at?: string;
}

export class AppBuilderSkill implements Skill {
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

  constructor(config?: { id?: string; name?: string; category?: string; description?: string; tools?: ToolDefinition[]; nameCn?: string; descriptionCn?: string; categoryCn?: string; usage?: string; usageCn?: string }) {
    this.id = config?.id ?? 'app_builder';
    this.name = config?.name ?? 'App Builder';
    this.category = config?.category ?? 'Application';
    this.description = config?.description ?? 'Save, list, update, and delete generated applications.';
    this.tools = config?.tools?.map(t => ({ name: t.name, description: t.description, parameters: t.parameters, nameCn: t.nameCn, descriptionCn: t.descriptionCn })) ?? [];
    if (config?.nameCn) this.nameCn = config.nameCn;
    if (config?.descriptionCn) this.descriptionCn = config.descriptionCn;
    if (config?.categoryCn) this.categoryCn = config.categoryCn;
    if (config?.usage) this.usage = config.usage;
    if (config?.usageCn) this.usageCn = config.usageCn;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (toolName) {
      case 'save_app': return this.saveApp(params);
      case 'save_project': return this.saveProject(params);
      case 'list_apps': return this.listApps();
      case 'get_app': return this.getApp(params);
      case 'update_app': return this.updateApp(params);
      case 'delete_app': return this.deleteApp(params);
      default: return SkillFail(`Unknown tool: ${toolName}`);
    }
  }

  private async saveApp(params: Record<string, unknown>): Promise<SkillResult> {
    const name = params['name'] as string;
    const description = (params['description'] as string) ?? '';
    const code = params['code'] as string;

    if (!name) return SkillFail('App name is required');
    if (!code) return SkillFail('App code is required');

    try {
      const db = await getDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await db.execute(
        'INSERT INTO savedApps (id, name, code, description, project_type, source_type, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [id, name, code, description, 'single', 'generated', now, now],
      );
      return SkillOk(`App "${name}" saved successfully`, { id, name, description, code, created_at: now });
    } catch (e) {
      return SkillFail(`Failed to save app: ${e}`);
    }
  }

  /**
   * Save a multi-file project.
   */
  private async saveProject(params: Record<string, unknown>): Promise<SkillResult> {
    const name = params['name'] as string;
    const description = (params['description'] as string) ?? '';
    const files = params['files'] as Record<string, string>;
    const entryFile = (params['entry_file'] as string) ?? 'index.html';

    if (!name) return SkillFail('Project name is required');
    if (!files || Object.keys(files).length === 0) return SkillFail('Project files are required');

    try {
      const db = await getDB();
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      // Get the entry file content for the main code field
      const entryContent = files[entryFile] || files[Object.keys(files)[0]] || '';

      await db.execute(
        `INSERT INTO savedApps (id, name, code, description, project_type, source_type, files_json, entry_file, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, name, entryContent, description, 'multi', 'generated', JSON.stringify(files), entryFile, now, now],
      );

      return SkillOk(`Project "${name}" saved successfully`, {
        id,
        name,
        description,
        files: Object.keys(files),
        entry_file: entryFile,
        created_at: now,
      });
    } catch (e) {
      return SkillFail(`Failed to save project: ${e}`);
    }
  }

  private async listApps(): Promise<SkillResult> {
    try {
      const db = await getDB();
      const rows = await db.query<SavedAppRow>(
        'SELECT id, name, description, project_type, source_type, local_path, entry_file, created_at FROM savedApps ORDER BY created_at DESC',
      );
      return SkillOk(`Found ${rows.length} saved app${rows.length !== 1 ? 's' : ''}`, {
        apps: rows.map((r) => ({
          id: r.id,
          name: r.name,
          description: r.description,
          project_type: r.project_type || 'single',
          source_type: r.source_type || 'generated',
          local_path: r.local_path || '',
          entry_file: r.entry_file,
          created_at: r.created_at,
        })),
        count: rows.length,
      });
    } catch (e) {
      return SkillFail(`Failed to list apps: ${e}`);
    }
  }

  private async getApp(params: Record<string, unknown>): Promise<SkillResult> {
    const id = params['id'] as string;
    if (!id) return SkillFail('App ID is required');

    try {
      const db = await getDB();
      const rows = await db.query<SavedAppRow>(
        'SELECT * FROM savedApps WHERE id = ?',
        [id],
      );
      if (rows.length === 0) return SkillFail(`App not found: ${id}`);
      const app = rows[0];

      // Parse files_json for multi-file projects
      let files: Record<string, string> | undefined;
      if (app.project_type === 'multi' && app.files_json) {
        try {
          files = JSON.parse(app.files_json);
        } catch {
          // Fall through
        }
      }

      return SkillOk(`App found: ${app.name}`, {
        id: app.id,
        name: app.name,
        description: app.description,
        code: app.code,
        project_type: app.project_type || 'single',
        files,
        entry_file: app.entry_file,
        created_at: app.created_at,
      });
    } catch (e) {
      return SkillFail(`Failed to get app: ${e}`);
    }
  }

  private async updateApp(params: Record<string, unknown>): Promise<SkillResult> {
    const id = params['id'] as string;
    if (!id) return SkillFail('App ID is required');

    try {
      const db = await getDB();
      const existing = await db.query<SavedAppRow>(
        'SELECT * FROM savedApps WHERE id = ?',
        [id],
      );
      if (existing.length === 0) return SkillFail(`App not found: ${id}`);

      const app = existing[0];
      const name = (params['name'] as string) ?? app.name;
      const description = (params['description'] as string) ?? app.description;
      const code = (params['code'] as string) ?? app.code;
      const now = new Date().toISOString();

      // Handle multi-file updates
      let filesJson = app.files_json;
      let entryFile = app.entry_file;
      if (params['files']) {
        filesJson = JSON.stringify(params['files']);
      }
      if (params['entry_file']) {
        entryFile = params['entry_file'] as string;
      }

      await db.execute(
        'UPDATE savedApps SET name = ?, code = ?, description = ?, files_json = ?, entry_file = ?, updated_at = ? WHERE id = ?',
        [name, code, description, filesJson, entryFile, now, id],
      );

      return SkillOk(`App "${name}" updated successfully`);
    } catch (e) {
      return SkillFail(`Failed to update app: ${e}`);
    }
  }

  private async deleteApp(params: Record<string, unknown>): Promise<SkillResult> {
    const id = params['id'] as string;
    if (!id) return SkillFail('App ID is required');

    try {
      const db = await getDB();
      await db.execute('DELETE FROM savedApps WHERE id = ?', [id]);
      return SkillOk('App deleted');
    } catch (e) {
      return SkillFail(`Failed to delete app: ${e}`);
    }
  }
}
