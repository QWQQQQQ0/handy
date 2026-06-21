/**
 * Skill Plugin Loader
 *
 * 支持从外部文件或目录加载自定义 Skill 插件。
 * 插件遵循标准接口规范，可以由第三方开发者编写。
 */

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult } from '@/types/skill';

// ---------------------------------------------------------------------------
// 插件接口定义
// ---------------------------------------------------------------------------

/**
 * 插件元数据
 */
export interface PluginMetadata {
  /** 插件唯一标识 */
  id: string;
  /** 插件名称 */
  name: string;
  /** 插件版本 */
  version: string;
  /** 插件描述 */
  description: string;
  /** 插件作者 */
  author?: string;
  /** 分类 */
  category?: string;
  /** 中文名称 */
  nameCn?: string;
  /** 中文描述 */
  descriptionCn?: string;
  /** 最低宿主版本要求 */
  minHostVersion?: string;
  /** 插件依赖 */
  dependencies?: string[];
}

/**
 * 插件工具定义
 */
export interface PluginToolDefinition {
  /** 工具名称（必须唯一） */
  name: string;
  /** 工具描述 */
  description: string;
  /** 参数定义（JSON Schema 格式） */
  parameters: Record<string, unknown>;
  /** 中文名称 */
  nameCn?: string;
  /** 中文描述 */
  descriptionCn?: string;
  /** 执行函数 */
  execute: (params: Record<string, unknown>, context: PluginContext) => Promise<PluginResult>;
}

/**
 * 插件执行上下文
 */
export interface PluginContext {
  /** 调用其他工具 */
  callTool: (toolName: string, params: Record<string, unknown>) => Promise<SkillResult>;
  /** 读取文件 */
  readFile?: (path: string) => Promise<string>;
  /** 写入文件 */
  writeFile?: (path: string, content: string) => Promise<void>;
  /** 执行命令 */
  execCommand?: (command: string) => Promise<string>;
  /** 获取设置 */
  getSetting?: (key: string) => unknown;
  /** 日志输出 */
  log: (message: string, level?: 'info' | 'warn' | 'error') => void;
}

/**
 * 插件执行结果
 */
export interface PluginResult {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Skill 插件接口
 */
export interface SkillPlugin {
  /** 插件元数据 */
  metadata: PluginMetadata;
  /** 工具定义列表 */
  tools: PluginToolDefinition[];
  /** 插件初始化（可选） */
  onInit?: (context: PluginContext) => Promise<void>;
  /** 插件销毁（可选） */
  onDispose?: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// 插件适配器 - 将 Plugin 转换为 Skill
// ---------------------------------------------------------------------------

/**
 * 将外部插件适配为内部 Skill 接口
 */
export class PluginAdapter implements Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: SkillTool[];
  nameCn?: string;
  descriptionCn?: string;
  categoryCn?: string;

  private plugin: SkillPlugin;
  private toolMap: Map<string, PluginToolDefinition>;
  private context: PluginContext;

  constructor(plugin: SkillPlugin, context: PluginContext) {
    this.plugin = plugin;
    this.context = context;
    this.toolMap = new Map();

    // 映射元数据
    this.id = plugin.metadata.id;
    this.name = plugin.metadata.name;
    this.category = plugin.metadata.category || 'plugin';
    this.description = plugin.metadata.description;
    this.nameCn = plugin.metadata.nameCn;
    this.descriptionCn = plugin.metadata.descriptionCn;
    this.categoryCn = plugin.metadata.category;

    // 映射工具
    this.tools = plugin.tools.map(tool => {
      this.toolMap.set(tool.name, tool);
      return {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
        nameCn: tool.nameCn,
        descriptionCn: tool.descriptionCn,
      };
    });
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    const tool = this.toolMap.get(toolName);
    if (!tool) {
      return SkillFail(`Unknown tool: ${toolName}`);
    }

    try {
      const result = await tool.execute(params, this.context);
      return result.success
        ? SkillOk(result.message, result.data)
        : SkillFail(result.message, result.data);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      return SkillFail(`Plugin tool "${toolName}" failed: ${error}`);
    }
  }

  async onLoad?(): Promise<void> {
    if (this.plugin.onInit) {
      await this.plugin.onInit(this.context);
    }
  }

  async onDispose?(): Promise<void> {
    if (this.plugin.onDispose) {
      await this.plugin.onDispose();
    }
  }
}

// ---------------------------------------------------------------------------
// 插件加载器
// ---------------------------------------------------------------------------

export class PluginLoader {
  private loadedPlugins: Map<string, PluginAdapter> = new Map();
  private context: PluginContext;

  constructor(context: PluginContext) {
    this.context = context;
  }

  /**
   * 从 JavaScript 对象加载插件
   */
  async loadFromObject(plugin: SkillPlugin): Promise<PluginAdapter> {
    // 验证插件
    this.validatePlugin(plugin);

    // 检查是否已加载
    if (this.loadedPlugins.has(plugin.metadata.id)) {
      throw new Error(`Plugin "${plugin.metadata.id}" is already loaded`);
    }

    // 创建适配器
    const adapter = new PluginAdapter(plugin, this.context);

    // 初始化
    if (adapter.onLoad) {
      await adapter.onLoad();
    }

    // 缓存
    this.loadedPlugins.set(plugin.metadata.id, adapter);

    return adapter;
  }

  /**
   * 从文件路径加载插件
   */
  async loadFromPath(path: string): Promise<PluginAdapter> {
    try {
      // 动态导入插件模块
      const module = await import(/* @vite-ignore */ path);
      const plugin = module.default || module;

      if (!this.isSkillPlugin(plugin)) {
        throw new Error(`Invalid plugin format at "${path}"`);
      }

      return await this.loadFromObject(plugin);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to load plugin from "${path}": ${error}`);
    }
  }

  /**
   * 从 JSON 配置加载插件（用于用户自定义工具）
   */
  async loadFromConfig(config: {
    id: string;
    name: string;
    description: string;
    tools: Array<{
      name: string;
      description: string;
      parameters: Record<string, unknown>;
      implementation: string;
    }>;
  }): Promise<PluginAdapter> {
    const plugin: SkillPlugin = {
      metadata: {
        id: config.id,
        name: config.name,
        version: '1.0.0',
        description: config.description,
        category: 'custom',
      },
      tools: config.tools.map(tool => ({
        ...tool,
        execute: this.createExecuteFunction(tool.implementation),
      })),
    };

    return await this.loadFromObject(plugin);
  }

  /**
   * 卸载插件
   */
  async unload(pluginId: string): Promise<void> {
    const adapter = this.loadedPlugins.get(pluginId);
    if (!adapter) {
      throw new Error(`Plugin "${pluginId}" is not loaded`);
    }

    if (adapter.onDispose) {
      await adapter.onDispose();
    }

    this.loadedPlugins.delete(pluginId);
  }

  /**
   * 获取已加载的插件
   */
  getLoaded(pluginId: string): PluginAdapter | undefined {
    return this.loadedPlugins.get(pluginId);
  }

  /**
   * 获取所有已加载的插件
   */
  getAllLoaded(): PluginAdapter[] {
    return Array.from(this.loadedPlugins.values());
  }

  // ---- 私有方法 -----------------------------------------------------------

  /**
   * 验证插件格式
   */
  private validatePlugin(plugin: unknown): asserts plugin is SkillPlugin {
    const p = plugin as SkillPlugin;

    if (!p.metadata) {
      throw new Error('Plugin must have metadata');
    }
    if (!p.metadata.id || typeof p.metadata.id !== 'string') {
      throw new Error('Plugin metadata must have a valid id');
    }
    if (!p.metadata.name || typeof p.metadata.name !== 'string') {
      throw new Error('Plugin metadata must have a valid name');
    }
    if (!Array.isArray(p.tools)) {
      throw new Error('Plugin must have a tools array');
    }

    // 验证每个工具
    for (const tool of p.tools) {
      if (!tool.name || typeof tool.name !== 'string') {
        throw new Error(`Tool must have a valid name`);
      }
      if (!tool.description || typeof tool.description !== 'string') {
        throw new Error(`Tool "${tool.name}" must have a description`);
      }
      if (typeof tool.execute !== 'function') {
        throw new Error(`Tool "${tool.name}" must have an execute function`);
      }
    }
  }

  /**
   * 类型检查
   */
  private isSkillPlugin(obj: unknown): obj is SkillPlugin {
    const p = obj as SkillPlugin;
    return (
      typeof p === 'object' &&
      p !== null &&
      typeof p.metadata === 'object' &&
      typeof p.metadata.id === 'string' &&
      Array.isArray(p.tools)
    );
  }

  /**
   * 从实现代码创建执行函数
   */
  private createExecuteFunction(implementation: string): PluginToolDefinition['execute'] {
    return async (params, context) => {
      try {
        // 创建沙箱执行环境
        const fn = new Function(
          'params',
          'context',
          'skill',
          `
          "use strict";
          ${implementation}
          `
        );

        // 创建 skill 辅助对象
        const skillHelper = {
          ok: (message: string, data?: Record<string, unknown>) => ({
            success: true,
            message,
            data,
          }),
          fail: (message: string, data?: Record<string, unknown>) => ({
            success: false,
            message,
            data,
          }),
        };

        const result = await fn(params, context, skillHelper);
        return result || skillHelper.ok('Done');
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          message: `Execution failed: ${error}`,
        };
      }
    };
  }
}

// ---------------------------------------------------------------------------
// 插件注册表
// ---------------------------------------------------------------------------

/**
 * 全局插件注册表
 */
export class PluginRegistry {
  private static plugins: Map<string, SkillPlugin> = new Map();

  /**
   * 注册插件（用于静态导入的插件）
   */
  static register(plugin: SkillPlugin): void {
    if (this.plugins.has(plugin.metadata.id)) {
      console.warn(`[PluginRegistry] Overwriting plugin "${plugin.metadata.id}"`);
    }
    this.plugins.set(plugin.metadata.id, plugin);
  }

  /**
   * 获取注册的插件
   */
  static get(pluginId: string): SkillPlugin | undefined {
    return this.plugins.get(pluginId);
  }

  /**
   * 获取所有注册的插件
   */
  static getAll(): SkillPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * 取消注册
   */
  static unregister(pluginId: string): void {
    this.plugins.delete(pluginId);
  }
}
