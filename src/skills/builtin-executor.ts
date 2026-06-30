// Shared built-in executor factory — DB is the single source of truth for tool definitions.
// On startup, skill-store syncs SKILL.md directories → DB. This module reads from DB configs
// and registers the corresponding TypeScript execution classes.
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
import { ChatToolsSkill } from './chat-tools';
import { SchedulerToolsSkill } from './scheduler-tools';
import type { Skill } from './skill';
import type { UserSkillConfig, ToolDefinition } from '@/types/skill';
import { desktopService } from '@/services/desktop-service';
import { extensionBridge } from '@/services/extension-bridge';
import { webScreenService } from '@/services/web-screen-service';
import type { IModelService } from '@/interfaces/model-service';
import type { ProviderConfig } from '@/types/provider';
import { PluginLoader, type PluginContext } from './plugin-loader';
import { SkillMdAdapter } from './skill-md-adapter';
import type { SkillExecutionDelegate } from './skill-md-adapter';

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
        case 'info':  console.log(prefix, message); break;
        case 'warn':  console.warn(prefix, message); break;
        case 'error': console.error(prefix, message); break;
      }
    },
  };
}

/**
 * Initialize the built-in executor with skill configs from DB.
 * Must be called after skill-store.initializeSkills() so configs are available.
 *
 * @param configs  Skill configs loaded from DB (the single source of truth).
 * @param adapters Map of skill id → SkillMdAdapter for directory-based skills.
 */
export async function initBuiltinExecutor(
  configs: UserSkillConfig[],
  adapters?: Map<string, SkillMdAdapter>,
): Promise<SkillExecutor> {
  if (!_executor) {
    _executor = new SkillExecutor();
  }

  // Initialize plugin loader
  if (!_pluginLoader) {
    _pluginLoader = new PluginLoader(createPluginContext(_executor));
  }

  // Always rebuild from provided configs to avoid stale/empty executor.
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

      // Try to link SkillMdAdapter if available (for directory-based skills)
      const adapter = adapters?.get(cfg.id);

      let skillInstance: Skill | null = null;

      switch (cfg.id) {
        case 'desktop_screen':
          skillInstance = new DesktopScreenSkill(desktopService, { tools, ...i18n });
          break;
        case 'desktop_uia':
          skillInstance = new DesktopUIASkill(desktopService, { tools, ...i18n });
          break;
        case 'web_screen':
          skillInstance = new WebScreenSkill(extensionBridge, webScreenService, desktopService, { tools, ...i18n });
          break;
        case 'phone_screen':
          skillInstance = new PhoneScreenSkill({ tools, ...i18n });
          break;
        case 'app_builder':
          skillInstance = new AppBuilderSkill({ tools, ...i18n });
          break;
        case 'office_doc':
          // OfficeDocSkill self-defines its tools below
          break;
        case 'code_tools':
          skillInstance = new CodeToolsSkill();
          // CodeTools uses its own tools; override with DB/SKILL.md tools
          if (tools.length > 0) {
            (skillInstance as CodeToolsSkill).tools = tools.map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
              returns: t.returns,
              nameCn: t.nameCn,
              descriptionCn: t.descriptionCn,
            }));
          }
          // 注入实际工作区路径到工具描述（通过 getWorkspaceDir 统一解析）
          try {
            const { isTauri } = await import('@/utils/platform');
            if (isTauri()) {
              const { getWorkspaceDir } = await import('./code-tools/shell-utils');
              const wsPath = await getWorkspaceDir();
              (skillInstance as CodeToolsSkill).setWorkspacePath(wsPath);
              // 同步更新 adapter 的 tools 描述（LLM 实际看到的是 adapter.tools）
              if (adapter) {
                adapter.tools = (skillInstance as CodeToolsSkill).tools;
              }
            }
          } catch { /* 非 Tauri 或无路径 API */ }
          break;
      }

      if (skillInstance) {
        // If we have a SkillMdAdapter for this skill, link the delegate
        if (adapter) {
          const delegate: SkillExecutionDelegate = {
            executeTool: (toolName, params) => skillInstance!.execute(toolName, params),
            onLoad: skillInstance.onLoad?.bind(skillInstance),
            onDispose: skillInstance.onDispose?.bind(skillInstance),
          };
          adapter.setDelegate(delegate);
          _executor.register(adapter);
        } else {
          _executor.register(skillInstance);
        }
      }
    }
  }

  // Register skills that self-define their tools (not DB-driven)
  if (!_executor.getSkill('system_config')) {
    _executor.register(new SystemConfigSkill());
  }
  if (!_executor.getSkill('chat_tools')) {
    _executor.register(new ChatToolsSkill());
  }
  if (!_executor.getSkill('scheduler_tools')) {
    _executor.register(new SchedulerToolsSkill());
  }
  if (!_executor.getSkill('office_doc')) {
    const officeSkill = new OfficeDocSkill();
    // 注入工作区路径到工具描述（先尝试获取实际路径）
    try {
      const { isTauri } = await import('@/utils/platform');
      if (isTauri()) {
        const { getWorkspaceDir } = await import('./code-tools/shell-utils');
        officeSkill.setWorkspacePath(await getWorkspaceDir());
      }
    } catch { /* 非 Tauri 或无路径 API */ }
    _executor.register(officeSkill);
  }
  // 兜底：确保 code_tools 始终可用（即使 DB 配置丢失或未同步）
  if (!_executor.getSkill('code_tools')) {
    const fallback = new CodeToolsSkill();
    try {
      const { useSettingsStore } = await import('@/stores/settings-store');
      const userPath = useSettingsStore.getState().workspacePath;
      if (userPath) {
        fallback.setWorkspacePath(userPath);
      }
    } catch { /* settings store not available */ }
    _executor.register(fallback);
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
 * 更新工作区路径到所有已注册 code_tools skill 的工具描述。
 * 用户通过设置页修改工作目录后调用此函数，确保 LLM 看到的描述始终是最新的。
 * 可重复调用，幂等。
 */
export async function updateWorkspacePath(): Promise<void> {
  if (!_executor) return;

  // 解析当前工作区路径（通过 getWorkspaceDir 统一解析）
  let wsPath: string;
  try {
    const { getWorkspaceDir } = await import('./code-tools/shell-utils');
    wsPath = await getWorkspaceDir();
  } catch {
    return; // 非 Tauri 或无路径 API
  }

  // 清除 shell-utils 的工作区缓存
  try {
    const { clearWorkspaceDirCache } = await import('./code-tools/shell-utils');
    clearWorkspaceDirCache();
  } catch { /* ignore */ }

  // 更新 CodeToolsSkill
  const skill = _executor.getSkill('code_tools');
  if (skill && skill instanceof CodeToolsSkill) {
    skill.setWorkspacePath(wsPath);
  }
  const adapter = _executor.getSkill('code_tools');
  if (adapter && !(adapter instanceof CodeToolsSkill)) {
    const codeTools = [..._executor['skills'].values()]
      .find((s: Skill) => s instanceof CodeToolsSkill) as CodeToolsSkill | undefined;
    if (codeTools) {
      codeTools.setWorkspacePath(wsPath);
      adapter.tools = codeTools.tools;
    }
  }

  // 更新 OfficeDocSkill
  const officeSkill = _executor.getSkill('office_doc');
  if (officeSkill && officeSkill instanceof OfficeDocSkill) {
    officeSkill.setWorkspacePath(wsPath);
  }
}

/**
 * 获取知识型技能完整信息（@ 选中时调用）。
 * 委托给 skill-store，从 SkillRegistry 按需加载。
 */
export async function getKnowledgeSkillBody(name: string): Promise<string | null> {
  try {
    const { useSkillStore } = await import('@/stores/skill-store');
    const store = useSkillStore.getState();
    const info = await store.getKnowledgeSkill(name);
    if (!info) return null;
    // 返回 usage + body 拼接
    const parts: string[] = [];
    if (info.usage) parts.push(info.usage);
    if (info.body) parts.push(info.body);
    return parts.join('\n\n') || null;
  } catch {
    return null;
  }
}

/**
 * 运行时注册一个外部目录源（如 Remotion 项目的 .agents/skills/）。
 * 注册后自动扫描并更新 @ 列表中的知识型技能。
 *
 * @param dirPath 目录路径
 * @param label 人类可读标签，如 "Remotion 项目"
 * @returns 源 ID，可用于后续移除
 */
export async function addRuntimeSkillSource(dirPath: string, label: string): Promise<string> {
  const { getSkillRegistry } = await import('@/skills/sources/registry');
  const registry = getSkillRegistry();
  const sourceId = await registry.addDirectorySource(dirPath, label);

  // 更新 skill-store 中的知识型技能列表
  try {
    const { useSkillStore } = await import('@/stores/skill-store');
    const store = useSkillStore.getState();
    // 通过刷新 store 来更新 UI
    await store.initializeSkills();
  } catch { /* store 未初始化不影响 */ }

  return sourceId;
}

/**
 * 移除运行时注册的目录源及其所有技能。
 */
export async function removeRuntimeSkillSource(sourceId: string): Promise<void> {
  const { getSkillRegistry } = await import('@/skills/sources/registry');
  const registry = getSkillRegistry();
  await registry.removeSource(sourceId);

  // 刷新 store 更新 UI
  try {
    const { useSkillStore } = await import('@/stores/skill-store');
    await useSkillStore.getState().initializeSkills();
  } catch { /* ignore */ }
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
