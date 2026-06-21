// Shared built-in executor factory — DB is the single source of truth for tool definitions.
// On startup, skill-store syncs markdown → DB. This module only reads from DB configs.
// All consumers that need built-in skill instances must go through this module.

import { SkillExecutor } from './executor';
import { DesktopScreenSkill } from './desktop';
import { DesktopUIASkill } from './desktop_uia';
import { WebScreenSkill } from './web';
import { PhoneScreenSkill } from './phone';
import { AppBuilderSkill } from './app-builder';
import { OfficeDocSkill } from './office-doc';
import { CodeToolsSkill } from './code-tools';
import { SystemConfigSkill } from './system-config';
import type { Skill } from './skill';
import type { UserSkillConfig, ToolDefinition } from '@/types/skill';
import { desktopService } from '@/services/desktop-service';
import { extensionBridge } from '@/services/extension-bridge';
import { webScreenService } from '@/services/web-screen-service';
import type { IModelService } from '@/interfaces/model-service';
import type { ProviderConfig } from '@/types/provider';
import { PluginLoader, type PluginContext, type SkillPlugin } from './plugin-loader';
import { SkillOk, SkillFail } from './skill';

let _executor: SkillExecutor | null = null;
let _pluginLoader: PluginLoader | null = null;

/**
 * 创建插件上下文
 */
function createPluginContext(executor: SkillExecutor): PluginContext {
  return {
    async callTool(toolName: string, params: Record<string, unknown>) {
      return executor.executeToolCall(toolName, params);
    },
    log(message: string, level: 'info' | 'warn' | 'error' = 'info') {
      const prefix = `[Plugin]`;
      switch (level) {
        case 'info':
          console.log(prefix, message);
          break;
        case 'warn':
          console.warn(prefix, message);
          break;
        case 'error':
          console.error(prefix, message);
          break;
      }
    },
  };
}

/**
 * Initialize the built-in executor with skill configs from DB.
 * Must be called after skill-store.initializeSkills() so configs are available.
 * @param configs Skill configs loaded from DB (the single source of truth).
 */
export async function initBuiltinExecutor(configs: UserSkillConfig[]): Promise<SkillExecutor> {
  if (!_executor) {
    _executor = new SkillExecutor();
  }

  // Initialize plugin loader
  if (!_pluginLoader) {
    _pluginLoader = new PluginLoader(createPluginContext(_executor));
  }

  // Always rebuild from provided configs to avoid stale/empty executor from early init.
  if (configs.length > 0) {
    for (const cfg of configs) {
      if (!cfg.builtin) continue;
      const tools = cfg.tools as ToolDefinition[];
      const i18n = {
        nameCn: cfg.nameCn,
        descriptionCn: cfg.descriptionCn,
        categoryCn: cfg.categoryCn,
        usage: cfg.usage,
        usageCn: cfg.usageCn,
      };
      switch (cfg.id) {
        case 'desktop_screen':
          _executor.register(new DesktopScreenSkill(desktopService, { tools, ...i18n }));
          break;
        case 'desktop_uia':
          _executor.register(new DesktopUIASkill(desktopService, { tools, ...i18n }));
          break;
        case 'web_screen':
          _executor.register(new WebScreenSkill(extensionBridge, webScreenService, desktopService, { tools, ...i18n }));
          break;
        case 'phone_screen':
          _executor.register(new PhoneScreenSkill({ tools, ...i18n }));
          break;
        case 'app_builder':
          _executor.register(new AppBuilderSkill({ tools, ...i18n }));
          break;
        case 'office_doc':
          // Register all office tools — Chat uses DESKTOP_CHAT_TOOLS to filter,
          // DocAgent needs the full set.
          _executor.register(new OfficeDocSkill({ tools, ...i18n }));
          break;
        case 'code_tools':
          _executor.register(new CodeToolsSkill());
          break;
      }
    }
  }

  // Register SystemConfigSkill (not DB-driven, self-defines tools like CodeToolsSkill)
  if (!_executor.getSkill('system_config')) {
    _executor.register(new SystemConfigSkill());
  }

  // Load built-in plugins
  await loadBuiltinPlugins();

  return _executor;
}

/**
 * Load built-in plugins
 */
async function loadBuiltinPlugins(): Promise<void> {
  if (!_executor || !_pluginLoader) return;

  try {
    // Skip if already loaded
    if (_pluginLoader.getLoaded('example_utils')) return;

    // Dynamically import and register example plugin
    const { default: examplePlugin } = await import('./plugins/example-plugin');
    const adapter = await _pluginLoader.loadFromObject(examplePlugin);
    _executor.register(adapter);
  } catch (err) {
    console.warn('[BuiltinExecutor] Failed to load example plugin:', err);
  }
}

/**
 * Load a plugin from external path
 */
export async function loadPluginFromPath(path: string): Promise<Skill> {
  if (!_executor || !_pluginLoader) {
    throw new Error('Executor not initialized. Call initBuiltinExecutor() first.');
  }

  const adapter = await _pluginLoader.loadFromPath(path);
  _executor.register(adapter);
  return adapter;
}

/**
 * Load a plugin from config object
 */
export async function loadPluginFromConfig(config: {
  id: string;
  name: string;
  description: string;
  tools: Array<{
    name: string;
    description: string;
    parameters: Record<string, unknown>;
    implementation: string;
  }>;
}): Promise<Skill> {
  if (!_executor || !_pluginLoader) {
    throw new Error('Executor not initialized. Call initBuiltinExecutor() first.');
  }

  const adapter = await _pluginLoader.loadFromConfig(config);
  _executor.register(adapter);
  return adapter;
}

/**
 * Unload a plugin
 */
export async function unloadPlugin(pluginId: string): Promise<void> {
  if (!_pluginLoader) {
    throw new Error('Plugin loader not initialized');
  }

  await _pluginLoader.unload(pluginId);
  _executor?.unregister(pluginId);
}

/**
 * Get the plugin loader instance
 */
export function getPluginLoader(): PluginLoader | null {
  return _pluginLoader;
}

export function getBuiltinExecutor(): SkillExecutor {
  return _executor ?? new SkillExecutor();
}

export function getBuiltinSkill(id: string): Skill | undefined {
  return _executor?.getSkill(id);
}

/**
 * Configure ModelService for CodeToolsSkill.
 * This enables unified LLM access for code generation tools.
 */
export function setCodeToolsModelService(
  modelService: IModelService,
  provider: ProviderConfig,
  apiKey: string,
): void {
  const codeTools = _executor?.getSkill('code_tools') as CodeToolsSkill | undefined;
  if (codeTools) {
    codeTools.setModelService(modelService, provider, apiKey);
  }
}
