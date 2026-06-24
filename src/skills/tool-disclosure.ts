/**
 * ToolDisclosure — 渐进式工具披露（Progressive Disclosure）
 *
 * 核心思想：
 *   1. "菜单" — 只给 LLM 工具名 + 一句话描述（极轻量，~30 tokens/工具）
 *   2. "门卫" — 唯一的始终在上下文中的工具，LLM 调用它来加载完整定义
 *   3. "按需加载" — LLM 判断需要哪个工具后，调用 tool_detail 获取完整参数 schema
 *
 * 使用方式：
 *   const disclosure = new ToolDisclosure({ executor, tools: myToolSet });
 *
 *   // 第一轮
 *   const systemPrompt = basePrompt + disclosure.buildMenuText();
 *   const tools = [disclosure.buildGatekeeperTool()];
 *
 *   // LLM 调用 tool_detail → 注入下一轮
 *   if (toolCall.name === 'tool_detail') {
 *     disclosure.loadDetails(toolCall.args.tools);
 *   }
 *
 *   // 后续轮次
 *   const tools = disclosure.buildActiveTools();
 */

import type { SkillExecutor } from './executor';
import type { SkillTool } from './skill';

// ── 类型定义 ──

export interface ToolMenuItem {
  /** 工具名（与注册的工具名一致） */
  name: string;
  /** 一句话描述（~20-50 tokens），用于菜单展示 */
  description: string;
  /** 分类标签（可选，用于菜单分组） */
  category?: string;
}

export interface OpenAITool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolDisclosureConfig {
  /** SkillExecutor 实例，用于获取完整工具定义 */
  executor: SkillExecutor;
  /** 哪些工具进入菜单。默认 executor.enabledToolNames */
  tools?: Set<string>;
  /** 自定义菜单描述覆盖（优先级高于自动截取 tool.description 首句） */
  descriptions?: Record<string, string>;
  /** 门卫工具名（默认 'tool_detail'） */
  gatekeeperName?: string;
}

// ── 内部条目 ──

interface LoadedEntry {
  tool: OpenAITool;
  loadedAt: number;   // Date.now()
  lastUsedAt: number; // Date.now()，每次 buildActiveTools 时更新
}

// FreeAgent 允许使用的工具（白名单，排除 phone/UIA/desktop 自动化等无关工具）
export const FREE_AGENT_TOOLS = new Set([
  // 代码执行
  'execute_code', 'run_command',
  // 文件系统
  'read_file', 'write_file', 'glob_files', 'grep_files',
  // 网络
  'web_search', 'web_fetch',
  // 应用交付
  'save_app', 'list_apps', 'get_app', 'update_app', 'delete_app',
  // 文档
  'generate_doc', 'doc_code_exec',
  // 记忆
  'agent_memory_update', 'recall_memory', 'search_chat_history',
  // 控制
  'think', 'request_user_input', 'finalize',
]);

// ── 门卫工具定义 ──

const GATEKEEPER_TOOL: Omit<OpenAITool, 'function'> & { function: { name: string; description: string; parameters: Record<string, unknown> } } = {
  type: 'function',
  function: {
    name: 'tool_detail', // 会被 config.gatekeeperName 覆盖
    description:
      '加载指定工具的完整参数定义。当你从"可用工具菜单"中看到需要的工具，但不确定其参数格式时，先调用此工具获取详细信息。可以一次加载多个工具。加载后，工具会持续可用，无需重复加载。',
    parameters: {
      type: 'object',
      properties: {
        tools: {
          type: 'array',
          items: { type: 'string' },
          description: '需要加载详情的工具名称列表，如 ["execute_code", "write_file", "read_file"]',
        },
      },
      required: ['tools'],
    },
  },
};

// ── 工具类 ──

export class ToolDisclosure {
  private executor: SkillExecutor;
  private menuTools: Set<string>;
  private descriptions: Record<string, string>;
  private gatekeeperName: string;
  private loaded: Map<string, LoadedEntry> = new Map();

  constructor(config: ToolDisclosureConfig) {
    this.executor = config.executor;
    this.menuTools = config.tools ?? new Set(config.executor.enabledToolNames);
    this.descriptions = config.descriptions ?? {};
    this.gatekeeperName = config.gatekeeperName ?? 'tool_detail';
  }

  // ── 菜单 ──

  /** 构建菜单项列表（轻量：name + 一句话描述） */
  buildMenu(): ToolMenuItem[] {
    const allTools = this.executor.allTools.filter(
      (t) => this.menuTools.has(t.name) && !this.executor.disabledTools.has(t.name),
    );

    return allTools.map((t) => ({
      name: t.name,
      description: this.descriptions[t.name] ?? this.extractOneLiner(t),
      category: this.inferCategory(t.name),
    }));
  }

  /** 构建菜单文本（注入 system prompt） */
  buildMenuText(): string {
    const menu = this.buildMenu();
    if (menu.length === 0) return '';

    // 按分类分组
    const groups = new Map<string, ToolMenuItem[]>();
    for (const item of menu) {
      const cat = item.category ?? 'other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(item);
    }

    const lines: string[] = ['## 可用工具菜单'];
    lines.push('每个工具后附一句话描述。如需使用某个工具但不清楚参数格式，请调用 `tool_detail` 加载完整参数定义。');
    lines.push('');

    for (const [cat, items] of groups) {
      const catLabel = this.categoryLabel(cat);
      lines.push(`### ${catLabel}`);
      for (const item of items) {
        lines.push(`- **${item.name}** — ${item.description}`);
      }
      lines.push('');
    }

    return lines.join('\n');
  }

  // ── 门卫 ──

  /** 构建门卫工具定义 */
  buildGatekeeperTool(): OpenAITool {
    return {
      ...GATEKEEPER_TOOL,
      function: {
        ...GATEKEEPER_TOOL.function,
        name: this.gatekeeperName,
      },
    };
  }

  /** 门卫工具名（用于判断 LLM 是否调用了它） */
  get gatekeeperToolName(): string {
    return this.gatekeeperName;
  }

  // ── 加载 ──

  /** 按需加载工具完整定义。返回 OpenAI function schema 数组。 */
  loadDetails(toolNames: string[]): OpenAITool[] {
    const allTools = this.executor.allTools;
    const result: OpenAITool[] = [];

    for (const name of toolNames) {
      // 跳过已加载的
      if (this.loaded.has(name)) {
        const entry = this.loaded.get(name)!;
        entry.lastUsedAt = Date.now();
        result.push(entry.tool);
        continue;
      }

      // 跳过不在菜单中的工具
      if (!this.menuTools.has(name)) continue;

      // 跳过门卫自身
      if (name === this.gatekeeperName) continue;

      const tool = allTools.find((t) => t.name === name);
      if (!tool) continue;

      const openai = this.skillToolToOpenAI(tool);
      const now = Date.now();
      this.loaded.set(name, { tool: openai, loadedAt: now, lastUsedAt: now });
      result.push(openai);
    }

    return result;
  }

  // ── 活跃工具 ──

  /** 构建当前轮次应发给 LLM 的完整 tools 数组（门卫 + 已加载详情） */
  buildActiveTools(): OpenAITool[] {
    const tools: OpenAITool[] = [this.buildGatekeeperTool()];

    const now = Date.now();
    for (const [name, entry] of this.loaded) {
      entry.lastUsedAt = now;
      tools.push(entry.tool);
    }

    return tools;
  }

  /** 判断某个工具是否已加载详情 */
  isLoaded(toolName: string): boolean {
    return this.loaded.has(toolName);
  }

  /** 已加载工具数量 */
  get loadedCount(): number {
    return this.loaded.size;
  }

  /** 已加载的工具名列表 */
  get loadedToolNames(): string[] {
    return [...this.loaded.keys()];
  }

  // ── 淘汰 ──

  /** 淘汰最久未使用的 N 个已加载工具 */
  evict(count: number): void {
    if (count <= 0) return;

    const sorted = [...this.loaded.entries()]
      .sort((a, b) => a[1].lastUsedAt - b[1].lastUsedAt);

    for (let i = 0; i < Math.min(count, sorted.length); i++) {
      this.loaded.delete(sorted[i][0]);
    }
  }

  /** 淘汰超过 maxIdleMs 未使用的工具 */
  evictIdle(maxIdleMs: number): number {
    const now = Date.now();
    let evicted = 0;
    for (const [name, entry] of this.loaded) {
      if (now - entry.lastUsedAt > maxIdleMs) {
        this.loaded.delete(name);
        evicted++;
      }
    }
    return evicted;
  }

  /** 清空所有已加载工具 */
  reset(): void {
    this.loaded.clear();
  }

  // ── 内部工具 ──

  /** 从 SkillTool 描述中提取一句话（取第一个句号前的内容，截断到 80 字符） */
  private extractOneLiner(tool: SkillTool): string {
    const raw = tool.descriptionCn || tool.description;
    const firstSentence = raw.split(/[。.]/)[0].trim();
    return firstSentence.length > 80
      ? firstSentence.substring(0, 77) + '...'
      : firstSentence;
  }

  /** 根据工具名推断分类 */
  private inferCategory(name: string): string {
    if (name.startsWith('desktop_') || name === 'code_exec') return 'desktop';
    if (name.startsWith('uia_')) return 'uia';
    if (name.startsWith('web_') || name === 'run_playwright_script') return 'web';
    if (name.startsWith('phone_')) return 'phone';
    if (['write_file', 'read_file', 'glob_files', 'grep_files',
      'generate_code', 'generate_project', 'execute_code',
      'save_code', 'list_code', 'run_command',
      'web_search', 'web_fetch'].includes(name)) return 'code';
    if (['save_app', 'list_apps', 'get_app', 'update_app', 'delete_app'].includes(name)) return 'app';
    if (['generate_doc', 'office_detect', 'com_read', 'com_edit', 'doc_code_exec'].includes(name)) return 'office';
    if (['think', 'request_user_input', 'finalize',
      'agent_memory_update', 'search_chat_history', 'recall_memory'].includes(name)) return 'control';
    return 'system';
  }

  /** 分类标签 */
  private categoryLabel(cat: string): string {
    const labels: Record<string, string> = {
      desktop: '桌面自动化',
      uia: 'UI Automation',
      web: '浏览器',
      phone: '手机',
      code: '代码 & 文件',
      app: '应用管理',
      office: '文档',
      control: '控制 & 记忆',
      system: '系统配置',
    };
    return labels[cat] ?? cat;
  }

  /** SkillTool → OpenAI function schema */
  private skillToolToOpenAI(tool: SkillTool): OpenAITool {
    const desc = tool.returns
      ? `${tool.description}\n\nReturn value: ${tool.returns}`
      : tool.description;
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: desc,
        parameters: tool.parameters,
      },
    };
  }
}
