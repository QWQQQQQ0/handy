// Built-in skill providing system configuration tools for the Chat Agent.
// Allows the AI to manage skills, models, settings, and watchers.

import type { Skill, SkillTool, SkillResult } from './skill';
import { SkillOk, SkillFail } from './skill';

export class SystemConfigSkill implements Skill {
  id = 'system_config';
  name = 'System Config';
  nameCn = '系统配置';
  category = 'System';
  categoryCn = '系统';
  description = 'System configuration tools: manage skills, models, settings, and watchers';
  descriptionCn = '系统配置工具：管理技能、模型、设置和屏幕监控';

  tools: SkillTool[] = [
    // ── Skill Management ──
    {
      name: 'list_skills',
      description: 'List all registered skills (builtin and user-defined) with their status',
      nameCn: '列出技能',
      descriptionCn: '列出所有已注册的技能（内置和用户自定义）及其状态',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'toggle_skill',
      description: 'Enable or disable a skill by its ID',
      nameCn: '切换技能',
      descriptionCn: '按 ID 启用或禁用技能',
      parameters: {
        type: 'object',
        properties: {
          skill_id: { type: 'string', description: 'The skill ID (e.g. "desktop_screen", "code_tools")' },
          enabled: { type: 'boolean', description: 'true to enable, false to disable' },
        },
        required: ['skill_id', 'enabled'],
      },
    },
    // ── Model Management ──
    {
      name: 'list_models',
      description: 'List all configured model providers with their settings',
      nameCn: '列出模型',
      descriptionCn: '列出所有已配置的模型提供商及其设置',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'switch_model',
      description: 'Switch the default model provider',
      nameCn: '切换模型',
      descriptionCn: '切换默认模型提供商',
      parameters: {
        type: 'object',
        properties: {
          provider_id: { type: 'string', description: 'The provider ID to set as default' },
        },
        required: ['provider_id'],
      },
    },
    {
      name: 'add_model',
      description: 'Add a new model provider. The API key will be encrypted and stored securely.',
      nameCn: '添加模型',
      descriptionCn: '添加新的模型提供商，API key 会加密存储',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name (e.g. "My GPT-4o")' },
          type: { type: 'string', enum: ['openai', 'anthropic', 'google'], description: 'Provider type' },
          baseUrl: { type: 'string', description: 'API endpoint URL (e.g. "https://api.openai.com/v1")' },
          model: { type: 'string', description: 'Model identifier (e.g. "gpt-4o", "claude-sonnet-4-20250514")' },
          apiKey: { type: 'string', description: 'API key for authentication' },
          isDefault: { type: 'boolean', description: 'Set as default provider (default false)' },
          supportsTools: { type: 'boolean', description: 'Supports tool/function calling (default true)' },
          thinkingMode: { type: 'boolean', description: 'Enable thinking/reasoning mode (default false)' },
          supportsMultimodal: { type: 'boolean', description: 'Supports image+text input (default true)' },
        },
        required: ['name', 'type', 'baseUrl', 'model', 'apiKey'],
      },
    },
    {
      name: 'update_model',
      description: 'Update an existing model provider. Only provided fields will be changed.',
      nameCn: '更新模型',
      descriptionCn: '更新现有模型提供商，只修改提供的字段',
      parameters: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'The provider ID to update' },
          name: { type: 'string', description: 'New display name' },
          type: { type: 'string', enum: ['openai', 'anthropic', 'google'], description: 'Provider type' },
          baseUrl: { type: 'string', description: 'New API endpoint URL' },
          model: { type: 'string', description: 'New model identifier' },
          apiKey: { type: 'string', description: 'New API key (leave empty to keep existing)' },
          isDefault: { type: 'boolean', description: 'Set as default provider' },
          supportsTools: { type: 'boolean', description: 'Supports tool/function calling' },
          thinkingMode: { type: 'boolean', description: 'Enable thinking/reasoning mode' },
          supportsMultimodal: { type: 'boolean', description: 'Supports image+text input' },
        },
        required: ['id'],
      },
    },
    // ── Settings ──
    {
      name: 'get_settings',
      description: 'Read current application settings',
      nameCn: '获取设置',
      descriptionCn: '读取当前应用设置',
      parameters: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'update_settings',
      description: 'Update application settings. Only provided fields will be changed.',
      nameCn: '更新设置',
      descriptionCn: '更新应用设置，只修改提供的字段',
      parameters: {
        type: 'object',
        properties: {
          themeMode: { type: 'string', enum: ['system', 'light', 'dark'], description: 'Theme mode' },
          locale: { type: 'string', enum: ['en', 'zh'], description: 'UI language' },
          enableGlobalListener: { type: 'boolean', description: 'Enable global input listener' },
        },
      },
    },
    // ── Watchers ──
    {
      name: 'list_watchers',
      description: 'List all screen monitoring (watcher) tasks',
      nameCn: '列出监控',
      descriptionCn: '列出所有屏幕监控任务',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  ];

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      switch (toolName) {
        case 'list_skills':
          return this.handleListSkills();
        case 'toggle_skill':
          return this.handleToggleSkill(params);
        case 'list_models':
          return this.handleListModels();
        case 'switch_model':
          return this.handleSwitchModel(params);
        case 'add_model':
          return this.handleAddModel(params);
        case 'update_model':
          return this.handleUpdateModel(params);
        case 'get_settings':
          return this.handleGetSettings();
        case 'update_settings':
          return this.handleUpdateSettings(params);
        case 'list_watchers':
          return this.handleListWatchers();
        default:
          return SkillFail(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return SkillFail(`Error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // ── Skill Management ──

  private async handleListSkills(): Promise<SkillResult> {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { useSkillStore } = (await import('@/stores/skill-store')) as typeof import('@/stores/skill-store');
    const store = useSkillStore.getState();
    const skills = store.allConfigs.map((c) => ({
      id: c.id,
      name: c.name,
      nameCn: c.nameCn,
      builtin: c.builtin,
      enabled: true, // allConfigs only contains enabled skills
      exposedToAI: c.exposedToAI !== false,
      toolsCount: c.tools.length,
      category: c.category,
    }));
    return SkillOk(`Found ${skills.length} enabled skills`, { skills });
  }

  private async handleToggleSkill(params: Record<string, unknown>): Promise<SkillResult> {
    const skillId = params.skill_id as string;
    const enabled = params.enabled as boolean;
    if (!skillId) return SkillFail('Missing required parameter: skill_id');
    if (typeof enabled !== 'boolean') return SkillFail('Missing required parameter: enabled (boolean)');

    const { useSkillStore } = await import('@/stores/skill-store');
    const store = useSkillStore.getState();
    store.toggleSkill(skillId, enabled);
    return SkillOk(`Skill "${skillId}" ${enabled ? 'enabled' : 'disabled'}`);
  }

  // ── Model Management ──

  private async handleListModels(): Promise<SkillResult> {
    const { useModelConfigStore } = await import('@/stores/model-config-store');
    const store = useModelConfigStore.getState();
    const providers = store.providers.map((p) => ({
      id: p.id,
      name: p.name,
      type: p.type,
      model: p.model,
      baseUrl: p.baseUrl,
      isDefault: p.isDefault,
      supportsTools: p.supportsTools,
      thinkingMode: p.thinkingMode ?? false,
      supportsMultimodal: p.supportsMultimodal ?? true,
    }));
    const defaultProvider = store.defaultConfig();
    return SkillOk(`Found ${providers.length} model providers`, {
      providers,
      defaultId: defaultProvider?.id ?? null,
    });
  }

  private async handleSwitchModel(params: Record<string, unknown>): Promise<SkillResult> {
    const providerId = params.provider_id as string;
    if (!providerId) return SkillFail('Missing required parameter: provider_id');

    const { useModelConfigStore } = await import('@/stores/model-config-store');
    const store = useModelConfigStore.getState();
    const exists = store.providers.some((p) => p.id === providerId);
    if (!exists) return SkillFail(`Provider not found: ${providerId}`);

    store.setDefault(providerId);
    const newDefault = store.providers.find((p) => p.id === providerId);
    return SkillOk(`Default model switched to "${newDefault?.name}" (${newDefault?.model})`);
  }

  private async handleAddModel(params: Record<string, unknown>): Promise<SkillResult> {
    const name = params.name as string;
    const type = params.type as string;
    const baseUrl = params.baseUrl as string;
    const model = params.model as string;
    const apiKey = params.apiKey as string;

    if (!name || !type || !baseUrl || !model || !apiKey) {
      return SkillFail('Missing required parameters: name, type, baseUrl, model, apiKey');
    }
    if (!['openai', 'anthropic', 'google'].includes(type)) {
      return SkillFail('Invalid type. Must be: openai, anthropic, google');
    }

    const { useModelConfigStore } = await import('@/stores/model-config-store');
    const store = useModelConfigStore.getState();
    store.save({
      name,
      type: type as 'openai' | 'anthropic' | 'google',
      baseUrl,
      model,
      apiKey,
      isDefault: (params.isDefault as boolean) ?? false,
      supportsTools: (params.supportsTools as boolean) ?? true,
      thinkingMode: (params.thinkingMode as boolean) ?? false,
      supportsMultimodal: (params.supportsMultimodal as boolean) ?? true,
      password: '',
    });
    return SkillOk(`Model provider "${name}" (${model}) added successfully`);
  }

  private async handleUpdateModel(params: Record<string, unknown>): Promise<SkillResult> {
    const id = params.id as string;
    if (!id) return SkillFail('Missing required parameter: id');

    const { useModelConfigStore } = await import('@/stores/model-config-store');
    const store = useModelConfigStore.getState();
    const existing = store.providers.find((p) => p.id === id);
    if (!existing) return SkillFail(`Provider not found: ${id}`);

    // Only update fields that are provided
    store.save({
      id,
      name: (params.name as string) ?? existing.name,
      type: (params.type as 'openai' | 'anthropic' | 'google') ?? existing.type,
      baseUrl: (params.baseUrl as string) ?? existing.baseUrl,
      model: (params.model as string) ?? existing.model,
      apiKey: (params.apiKey as string) ?? '', // empty = keep existing encrypted key
      isDefault: (params.isDefault as boolean) ?? existing.isDefault,
      supportsTools: (params.supportsTools as boolean) ?? existing.supportsTools,
      thinkingMode: (params.thinkingMode as boolean) ?? existing.thinkingMode ?? false,
      supportsMultimodal: (params.supportsMultimodal as boolean) ?? existing.supportsMultimodal ?? true,
      password: '',
    });
    return SkillOk(`Model provider "${existing.name}" updated`);
  }

  // ── Settings ──

  private async handleGetSettings(): Promise<SkillResult> {
    const { useSettingsStore } = await import('@/stores/settings-store');
    const store = useSettingsStore.getState();
    return SkillOk('Current settings', {
      themeMode: store.themeMode,
      locale: store.locale ?? 'system',
      enableGlobalListener: store.enableGlobalListener,
      defaultModelProviderId: store.defaultModelProviderId,
      disabledToolsCount: store.disabledTools.size,
      favoriteToolsCount: store.favoriteTools.size,
    });
  }

  private async handleUpdateSettings(params: Record<string, unknown>): Promise<SkillResult> {
    const { useSettingsStore } = await import('@/stores/settings-store');
    const store = useSettingsStore.getState();
    const changes: string[] = [];

    if (params.themeMode !== undefined) {
      const mode = params.themeMode as string;
      if (!['system', 'light', 'dark'].includes(mode)) {
        return SkillFail('Invalid themeMode. Must be: system, light, dark');
      }
      store.setThemeMode(mode as 'system' | 'light' | 'dark');
      changes.push(`theme → ${mode}`);
    }

    if (params.locale !== undefined) {
      const locale = params.locale as string;
      if (!['en', 'zh'].includes(locale)) {
        return SkillFail('Invalid locale. Must be: en, zh');
      }
      store.setLocale(locale);
      changes.push(`locale → ${locale}`);
    }

    if (params.enableGlobalListener !== undefined) {
      const enable = params.enableGlobalListener as boolean;
      store.setEnableGlobalListener(enable);
      changes.push(`globalListener → ${enable}`);
    }

    if (changes.length === 0) {
      return SkillFail('No settings to update. Provide: themeMode, locale, or enableGlobalListener');
    }

    return SkillOk(`Settings updated: ${changes.join(', ')}`);
  }

  // ── Watchers ──

  private async handleListWatchers(): Promise<SkillResult> {
    const { getAllWatcherConfigs } = await import('@/services/cache-service');
    const configs = await getAllWatcherConfigs();
    const watchers = configs.map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      enabled: c.enabled,
      appId: c.appId,
      intervalMs: c.intervalMs,
    }));
    return SkillOk(`Found ${watchers.length} watchers`, { watchers });
  }
}
