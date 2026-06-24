// WebGateway — 轻量级 Web 浏览器 Agent 入口
// 处理所有浏览器相关任务：浏览、搜索、导航、元素交互、数据抓取等
// 类似 DocGateway，直接使用 TaskAgentRunner + web 工具集

import type { ProviderConfig } from '@/types/provider';
import type { ISkillExecutor } from '@/interfaces/skill-executor';
import { TaskAgentRunner, type AgentProgressEvent } from '@/services/task-agent/runner';
import { TaskTreeDB } from '@/services/multi-agent/task-tree-db';
import type { TaskResult } from '@/services/task-agent/gateway';

export interface WebGatewayResponse {
  message: string;
  tasks: TaskResult[];
}

// Web agent 允许使用的工具（基础集）
const WEB_TOOL_FILTER = new Set([
  // 搜索
  'web_search', 'web_fetch',
  // Playwright 操作
  'web_launch', 'web_navigate', 'web_get_interactive',
  'web_click', 'web_fill', 'web_scroll', 'web_close',
  'run_playwright_script',
  // 控制
  'think',
  'request_user_input',
  'web_done',
  'finalize',
]);

// 需要 Playwright 才能使用的工具
const PLAYWRIGHT_ONLY_TOOLS = new Set(['run_playwright_script']);

export class WebGateway {
  private skillExecutor: ISkillExecutor;

  constructor(skillExecutor: ISkillExecutor) {
    this.skillExecutor = skillExecutor;
  }

  /** 检查浏览器连接状态（扩展 + Playwright） */
  private async checkBrowserStatus(): Promise<{ connected: boolean; url?: string; extensionConnected: boolean; playwrightLaunched: boolean }> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ connected: boolean; url?: string; extension_connected?: boolean; playwright_launched?: boolean }>('get_extension_status');
      return {
        connected: result.connected ?? false,
        url: result.url,
        extensionConnected: result.extension_connected ?? false,
        playwrightLaunched: result.playwright_launched ?? false,
      };
    } catch {
      return { connected: false, extensionConnected: false, playwrightLaunched: false };
    }
  }

  /** 尝试启动浏览器（带调试端口，复用用户 profile） */
  private async launchBrowser(): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{ launched?: boolean; connected?: boolean }>('web_launch_browser', {
        browser: 'msedge',
        port: 9222,
      });
      console.log(`[WebGateway] launchBrowser result:`, result);
      return !!(result.launched || result.connected);
    } catch (e) {
      console.warn(`[WebGateway] launchBrowser failed:`, e);
      return false;
    }
  }

  /** 构建状态上下文字符串 */
  private buildStatusContext(extensionConnected: boolean, playwrightLaunched: boolean, url?: string): string {
    const parts: string[] = [];
    if (extensionConnected) parts.push('extension=connected');
    if (playwrightLaunched) parts.push(`playwright=launched${url ? ` url=${url}` : ''}`);
    if (!extensionConnected && !playwrightLaunched) parts.push('browser=disconnected');
    return `\n\n[状态] ${parts.join(', ')}`;
  }

  /** 构建工具过滤集 */
  private buildToolFilter(playwrightLaunched: boolean): Set<string> {
    const filter = new Set(WEB_TOOL_FILTER);
    if (!playwrightLaunched) {
      for (const t of PLAYWRIGHT_ONLY_TOOLS) filter.delete(t);
    }
    return filter;
  }

  /** 执行一次 agent 任务 */
  private async runOnce(params: {
    content: string;
    statusContext: string;
    toolFilter: Set<string>;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    signal?: AbortSignal;
    maxTurns?: number;
    messages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<{ result: Awaited<ReturnType<TaskAgentRunner['runAgent']>>; taskId: string }> {
    const { content, statusContext, toolFilter, provider, apiKey, password, signal, maxTurns, messages, onConfirm, onUserInput, onProgress } = params;

    const runner = new TaskAgentRunner(this.skillExecutor);
    const agentId = runner.generateAgentId('web');
    const taskDB = new TaskTreeDB();
    const taskId = await taskDB.createRoot(content, agentId);

    console.log(`[WebGateway] ▶ runOnce agentId=${agentId}, tools=[${[...toolFilter].join(', ')}]`);

    const result = await runner.runAgent({
      taskId,
      agentType: 'web',
      goal: content + statusContext,
      provider,
      apiKey,
      password,
      maxTurns: maxTurns ?? 20,
      signal,
      toolFilter,
      chatMessages: messages,
      onConfirm,
      onUserInput,
      onProgress,
    });

    return { result, taskId };
  }

  async handleUserMessage(params: {
    content: string;
    provider: ProviderConfig;
    apiKey: string;
    password?: string;
    signal?: AbortSignal;
    maxTurns?: number;
    messages?: import('@/types/message').LLMMessage[];
    onConfirm?: (command: string) => Promise<boolean>;
    onUserInput?: (message: string, fields: Array<{ label: string; key: string; type?: string }>) => Promise<Record<string, string>>;
    onProgress?: (event: AgentProgressEvent) => void;
  }): Promise<WebGatewayResponse> {
    const { content, provider, apiKey, password, signal, maxTurns, messages, onConfirm, onUserInput, onProgress } = params;

    console.log(`[WebGateway] ▶ Web 任务: "${content.substring(0, 80)}"`);

    // ── 第一次尝试：用当前可用的工具 ──
    const browserStatus = await this.checkBrowserStatus();
    const statusContext = this.buildStatusContext(browserStatus.extensionConnected, browserStatus.playwrightLaunched, browserStatus.url);
    const toolFilter = this.buildToolFilter(browserStatus.playwrightLaunched);

    const { result: firstResult, taskId } = await this.runOnce({
      content, statusContext, toolFilter,
      provider, apiKey, password, signal, maxTurns, messages,
      onConfirm, onUserInput, onProgress,
    });

    // ── 成功则直接返回 ──
    if (firstResult.success) {
      console.log(`[WebGateway] ✓ 第一次尝试成功`);
      return {
        message: firstResult.summary || 'Web 任务完成',
        tasks: [{ taskId, status: 'done', message: firstResult.summary }],
      };
    }

    // ── 失败 + Playwright 未启动 → 自动启动浏览器重试 ──
    if (!browserStatus.playwrightLaunched) {
      console.log(`[WebGateway] 第一次尝试失败，自动启动浏览器重试...`);
      const launched = await this.launchBrowser();

      if (launched) {
        // 等待 Playwright 连接就绪
        await new Promise(r => setTimeout(r, 1500));
        const newStatus = await this.checkBrowserStatus();

        if (newStatus.playwrightLaunched) {
          const newStatusContext = this.buildStatusContext(newStatus.extensionConnected, newStatus.playwrightLaunched, newStatus.url);
          const newToolFilter = this.buildToolFilter(true);
          // 把第一次的失败原因注入 goal，让 LLM 不重蹈覆辙
          const retryGoal = `${content}${newStatusContext}\n[上次尝试失败] ${firstResult.error || '未知错误'}，请换一种方式完成任务。`;

          console.log(`[WebGateway] ▶ 第二次尝试（Playwright 已就绪）`);

          // 通知用户正在重试
          onProgress?.({ type: 'turn_start', turn: 0, totalTurns: maxTurns ?? 20 });

          const { result: secondResult, taskId: retryTaskId } = await this.runOnce({
            content: retryGoal, statusContext: '', toolFilter: newToolFilter,
            provider, apiKey, password, signal, maxTurns, messages,
            onConfirm, onUserInput, onProgress,
          });

          if (secondResult.success) {
            console.log(`[WebGateway] ✓ 第二次尝试成功`);
            return {
              message: secondResult.summary || 'Web 任务完成（自动启动浏览器后）',
              tasks: [{ taskId: retryTaskId, status: 'done', message: secondResult.summary }],
            };
          }

          // 第二次也失败
          return {
            message: `Web 任务失败: ${secondResult.error}`,
            tasks: [{ taskId: retryTaskId, status: 'error', error: secondResult.error, message: secondResult.summary }],
          };
        }
      }

      console.warn(`[WebGateway] 自动启动浏览器失败`);
    }

    // ── 最终失败 ──
    return {
      message: `Web 任务失败: ${firstResult.error}`,
      tasks: [{ taskId, status: 'error', error: firstResult.error, message: firstResult.summary }],
    };
  }
}
