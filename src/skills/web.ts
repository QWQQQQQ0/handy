// 来源: lib/skills/web_screen_skill.dart

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult, ToolDefinition } from '@/types/skill';
import type { IExtensionBridge } from '@/interfaces/extension-bridge';
import type { IWebScreenService } from '@/interfaces/web-screen-service';
import type { IDesktopService } from '@/interfaces/desktop-service';

export class WebScreenSkill implements Skill {
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

  private extensionBridge: IExtensionBridge;
  private webScreenService: IWebScreenService;
  private desktopService: IDesktopService;

  constructor(
    extensionBridge: IExtensionBridge,
    webScreenService: IWebScreenService,
    desktopService: IDesktopService,
    config?: { id?: string; name?: string; category?: string; description?: string; tools?: ToolDefinition[]; nameCn?: string; descriptionCn?: string; categoryCn?: string; usage?: string; usageCn?: string }
  ) {
    this.extensionBridge = extensionBridge;
    this.webScreenService = webScreenService;
    this.desktopService = desktopService;
    this.id = config?.id ?? 'web_screen';
    this.name = config?.name ?? 'Web Screen Control';
    this.category = config?.category ?? 'Device Automation';
    this.description = config?.description ?? 'View and control web pages via browser extension or iframe.';
    this.tools = config?.tools?.map(t => ({ name: t.name, description: t.description, parameters: t.parameters, nameCn: t.nameCn, descriptionCn: t.descriptionCn })) ?? [];
    if (config?.nameCn) this.nameCn = config.nameCn;
    if (config?.descriptionCn) this.descriptionCn = config.descriptionCn;
    if (config?.categoryCn) this.categoryCn = config.categoryCn;
    if (config?.usage) this.usage = config.usage;
    if (config?.usageCn) this.usageCn = config.usageCn;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    // ── Backward-compat: translate old tool names to new unified names ──
    switch (toolName) {
      case 'web_pw_launch':
        toolName = 'web_launch';
        break;
      case 'web_pw_connect_cdp':
        toolName = 'web_launch';
        params = { ...params, cdp_url: params['cdp_url'] ?? 'http://localhost:9222' };
        break;
      case 'web_pw_navigate':
        toolName = 'web_navigate';
        break;
      case 'web_pw_get_interactive':
        toolName = 'web_get_interactive';
        break;
      case 'web_pw_click_selector':
        toolName = 'web_click';
        break;
      case 'web_pw_click_role':
        toolName = 'web_click';
        params = { ...params, role: params['role'], selector: undefined };
        break;
      case 'web_pw_fill':
        toolName = 'web_fill';
        break;
      case 'web_pw_scroll':
        toolName = 'web_scroll';
        params = { ...params, dy: params['delta_y'] };
        break;
      case 'web_pw_close':
        toolName = 'web_close';
        break;
    }

    // ── Playwright tools (Tauri → Python bridge) ──
    if (['web_launch', 'web_navigate', 'web_get_interactive', 'web_click', 'web_fill', 'web_scroll', 'web_close'].includes(toolName)) {
      return this.executePlaywright(toolName, params);
    }

    // ── Playwright script execution ──
    if (toolName === 'run_playwright_script') {
      return this.runPlaywrightScript(params);
    }

    // Generic tools that don't need a browser backend
    switch (toolName) {
      case 'web_wait': {
        const ms = Math.min(Number(params['durationMs']) || 1000, 10000);
        await new Promise((r) => setTimeout(r, ms));
        return SkillOk(`Waited ${ms}ms`, { action: 'wait', durationMs: ms });
      }
      case 'web_done': {
        const summary = (params['summary'] as string) ?? 'Task completed';
        return SkillOk(summary, { action: 'done', message: summary });
      }
    }

    // Legacy extension/iframe tools (backward-compat)
    if (this.webScreenService.hasIframe) {
      return this.executeIframe(toolName, params);
    }
    if (this.extensionBridge.isConnected) {
      return this.executeExtension(toolName, params);
    }
    return SkillFail(
      'No web context available. Call web_launch first.',
    );
  }

  /** Execute Playwright-backed web tools via Tauri Python bridge. */
  private async executePlaywright(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      let data: Record<string, unknown> | undefined;

      switch (toolName) {
        case 'web_launch': {
          const cdpUrl = params['cdp_url'] as string | undefined;
          if (cdpUrl) {
            data = await this.desktopService.webConnectCdp(cdpUrl);
          } else {
            // LLM 参数可能是字符串，需要转换
            const headless = params['headless'] === true || params['headless'] === 'true';
            const connectExisting = params['connect_existing'] !== false && params['connect_existing'] !== 'false';
            data = await this.desktopService.webPwLaunch(
              headless || undefined,
              params['channel'] as string | undefined,
              connectExisting,
            );
          }
          // 如果 launch 成功，标记浏览器已连接
          if (data?.launched || data?.connected) {
            this._browserConnected = true;
          }
          break;
        }
        case 'web_navigate':
          data = await this.desktopService.webNavigate(
            params['url'] as string | undefined,
            params['action'] as string | undefined,
          );
          break;
        case 'web_get_interactive':
          // 优先用 Playwright，失败则降级到桌面截图
          try {
            data = await this.desktopService.webPwGetInteractive();
          } catch {
            return this.executeDesktopFallback('web_screenshot', params);
          }
          break;
        case 'web_click': {
          const selector = params['selector'] as string | undefined;
          const role = params['role'] as string | undefined;
          if (role) {
            data = await this.desktopService.webPwClickRole(role, params['name'] as string | undefined);
          } else if (selector) {
            data = await this.desktopService.webPwClickSelector(selector);
          } else if (params['x'] !== undefined && params['y'] !== undefined) {
            // 坐标点击，降级到桌面点击
            return this.executeDesktopFallback('web_click', params);
          } else {
            return SkillFail('web_click requires either "selector", "role", or "x"/"y" parameters');
          }
          break;
        }
        case 'web_fill':
          // 如果有坐标，降级到桌面操作
          if (params['x'] !== undefined && params['y'] !== undefined) {
            return this.executeDesktopFallback('web_fill', params);
          }
          data = await this.desktopService.webPwFill(String(params['selector']), String(params['text']));
          break;
        case 'web_scroll':
          data = await this.desktopService.webPwScroll(params['dy'] as number ?? params['delta_y'] as number);
          break;
        case 'web_close':
          data = await this.desktopService.webPwClose();
          this._browserConnected = false;
          break;
        default:
          return SkillFail(`Unknown Playwright tool: ${toolName}`);
      }

      return SkillOk(`${toolName} succeeded`, data ?? {});
    } catch (e) {
      const errMsg = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
      console.error(`[web-skill] ${toolName} threw:`, errMsg);
      // 连接失败时，尝试降级到桌面操作
      if (errMsg.includes('not launched') || errMsg.includes('Browser not launched') || errMsg.includes('connection')) {
        console.log(`[web-skill] browser not connected, falling back to desktop for ${toolName}`);
        return this.executeDesktopFallback(toolName, params);
      }
      return SkillFail(`Playwright tool ${toolName} failed: ${e}`);
    }
  }

  // ══ Playwright script execution ══

  /** Execute a Playwright Python script in the sandbox. */
  private async runPlaywrightScript(params: Record<string, unknown>): Promise<SkillResult> {
    const code = params['code'] as string;
    if (!code) return SkillFail('run_playwright_script requires "code" parameter');

    const timeoutSec = Number(params['timeout_sec']) || 60;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{
        success: boolean;
        output: string;
        error?: string;
        result?: unknown;
        duration_ms: number;
        truncated: boolean;
      }>('web_code_exec', {
        code,
        timeout_sec: timeoutSec,
      });

      let msg: string;
      if (result.success) {
        msg = `Script executed successfully (${result.duration_ms}ms)`;
        if (result.output) msg += `\nOutput:\n${result.output}`;
      } else {
        msg = `Script execution failed (${result.duration_ms}ms): ${result.error}`;
        if (result.output) msg += `\nOutput:\n${result.output}`;
      }

      return SkillOk(msg, {
        success: result.success,
        output: result.output,
        error: result.error,
        result: result.result,
        duration_ms: result.duration_ms,
        truncated: result.truncated,
      });
    } catch (e) {
      return SkillFail(`run_playwright_script failed: ${e}`);
    }
  }

  // ══ Desktop fallback (when browser not connected) ══

  private _browserConnected = false;
  private _targetWindowHwnd: number | null = null;

  /** 设置目标窗口（用于避免浮窗遮挡） */
  setTargetWindow(hwnd: number | null) {
    this._targetWindowHwnd = hwnd;
  }

  /** 降级到桌面自动化 */
  private async executeDesktopFallback(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    console.log(`[web-skill] executing desktop fallback for ${toolName}`);

    switch (toolName) {
      case 'web_screenshot':
      case 'web_get_interactive': {
        // 截图返回给 LLM，让 LLM 通过视觉分析页面
        let screenshot: string;
        let windowBounds: { x: number; y: number; width: number; height: number } | undefined;

        if (this._targetWindowHwnd) {
          // 截取目标窗口（避免浮窗遮挡）
          screenshot = await this.desktopService.screenshotWindow(this._targetWindowHwnd);
          windowBounds = await this.desktopService.getWindowBounds(this._targetWindowHwnd);
        } else {
          // 全屏截图
          screenshot = await this.desktopService.screenshot();
        }

        return SkillOk('Screenshot captured (desktop mode - browser not connected)', {
          screenshot,
          mode: 'desktop',
          windowBounds,
          message: 'Browser not connected. Use screenshot to see current page, then click/fill by coordinates.',
        });
      }

      case 'web_click': {
        let x = Number(params['x']);
        let y = Number(params['y']);
        if (isNaN(x) || isNaN(y)) {
          return SkillFail('web_click (desktop mode) requires x and y coordinates');
        }
        // 如果有目标窗口，坐标需要转换为屏幕坐标
        if (this._targetWindowHwnd) {
          const bounds = await this.desktopService.getWindowBounds(this._targetWindowHwnd);
          x = bounds.x + x;
          y = bounds.y + y;
        }
        await this.desktopService.click(x, y);
        return SkillOk(`Clicked at (${x}, ${y}) (desktop mode)`, { x, y, mode: 'desktop' });
      }

      case 'web_fill': {
        let x = Number(params['x']);
        let y = Number(params['y']);
        const text = String(params['text'] ?? '');
        if (isNaN(x) || isNaN(y)) {
          return SkillFail('web_fill (desktop mode) requires x and y coordinates');
        }
        // 如果有目标窗口，坐标需要转换为屏幕坐标
        if (this._targetWindowHwnd) {
          const bounds = await this.desktopService.getWindowBounds(this._targetWindowHwnd);
          x = bounds.x + x;
          y = bounds.y + y;
        }
        await this.desktopService.click(x, y);
        await this.desktopService.typeText(text);
        return SkillOk(`Filled "${text}" at (${x}, ${y}) (desktop mode)`, { x, y, text, mode: 'desktop' });
      }

      case 'web_navigate': {
        // 桌面模式无法直接导航，提示用户
        const url = params['url'] as string;
        return SkillFail(`Cannot navigate in desktop mode. Please open ${url} in your browser manually, then use screenshot to confirm.`);
      }

      default:
        return SkillFail(`Desktop fallback not supported for ${toolName}`);
    }
  }

  // ══ Extension backend ══

  private async executeExtension(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (toolName) {
      case 'web_screenshot': return this.extScreenshot();
      case 'web_get_ui': return this.extGetUI();
      case 'web_click': return this.extClick(params);
      case 'web_click_element': return this.extClickElement(params);
      case 'web_type': return this.extType(params);
      case 'web_fill': return this.extFill(params);
      case 'web_scroll': return this.extScroll(params);
      case 'web_scroll_into_view': return this.extScrollIntoView(params);
      case 'web_press_key': return this.extPressKey(params);
      case 'web_navigate': return this.extNavigate(params);
      case 'web_extract': return this.extExtract(params);
      case 'web_list_tabs': return this.extListTabs();
      default: return SkillFail(`Unknown tool: ${toolName}`);
    }
  }

  private async extScreenshot(): Promise<SkillResult> {
    const r = await this.extensionBridge.captureScreen();
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Screenshot failed');
    return SkillOk('Screenshot captured', { screenshot: r['screenshot'] });
  }

  private async extGetUI(): Promise<SkillResult> {
    const r = await this.extensionBridge.getDOM();
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Failed');
    const nodes = (r['nodes'] as Array<Record<string, unknown>>) ?? [];
    const interactiveCount = nodes.filter((n) => n['clickable'] === true).length;
    return SkillOk(`${nodes.length} interactive nodes`, { nodes, interactiveCount });
  }

  private async extClick(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'click', x: Number(p['x']), y: Number(p['y']) });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Click failed');
    return SkillOk(`Clicked at (${p['x']},${p['y']})`, { info: r['info'] });
  }

  private async extClickElement(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'click_element', selector: p['selector'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Click failed');
    return SkillOk(`Clicked ${p['selector']}`, { info: r['info'] });
  }

  private async extType(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'type', text: p['text'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Type failed');
    return SkillOk(`Typed "${p['text']}"`);
  }

  private async extFill(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'fill', selector: p['selector'] as string, text: p['text'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Fill failed');
    return SkillOk(`Filled ${p['selector']}`);
  }

  private async extScroll(p: Record<string, unknown>): Promise<SkillResult> {
    const dx = Number(p['dx']) || 0;
    const dy = Number(p['dy']) || 0;
    const r = await this.extensionBridge.executeAction(null, { type: 'scroll', dx, dy });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Scroll failed');
    return SkillOk(r['message'] as string ?? 'Scrolled');
  }

  private async extScrollIntoView(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'scroll_into_view', selector: p['selector'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Scroll failed');
    return SkillOk(`Scrolled to ${p['selector']}`);
  }

  private async extPressKey(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'press_key', key: p['key'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Key press failed');
    return SkillOk(`Pressed ${p['key']}`);
  }

  private async extNavigate(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.openURL(p['url'] as string);
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Navigation failed');
    return SkillOk(`Navigated to ${p['url']}`, { tabId: r['tabId'] });
  }

  private async extExtract(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.extensionBridge.executeAction(null, { type: 'extract', selector: p['selector'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Extract failed');
    return SkillOk('Extracted text', { text: r['text'] });
  }

  private async extListTabs(): Promise<SkillResult> {
    const r = await this.extensionBridge.listTabs();
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Failed');
    const tabs = (r['tabs'] as Array<unknown>) ?? [];
    return SkillOk(`${tabs.length} tabs`, { tabs });
  }

  // ══ Iframe backend (generated apps) ══

  private async executeIframe(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    switch (toolName) {
      case 'web_get_ui': return this.iframeGetUI();
      case 'web_click': return this.iframeClick(params);
      case 'web_type': return this.iframeType(params);
      case 'web_scroll': return this.iframeScroll(params);
      default: return SkillFail(`Unknown tool for iframe: ${toolName}`);
    }
  }

  private async iframeGetUI(): Promise<SkillResult> {
    const r = await this.webScreenService.getUI();
    if (!r) return SkillFail('Failed to get UI tree');
    const nodes = (r['nodes'] as Array<Record<string, unknown>>) ?? [];
    const count = this.countNodes(nodes);
    return SkillOk(`${count} interactive nodes`, { uiTree: { nodes }, interactiveCount: count });
  }

  private async iframeClick(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.webScreenService.click(Number(p['x']), Number(p['y']));
    if (r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Click failed');
    const info = r['info'];
    const desc = info ? `Clicked ${(info as Record<string, unknown>)['tag']} at (${p['x']},${p['y']})` : `Clicked at (${p['x']},${p['y']})`;
    return SkillOk(desc, { info });
  }

  private async iframeType(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.webScreenService.typeText(p['text'] as string);
    if (r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Type failed');
    return SkillOk(r['message'] as string ?? `Typed "${p['text']}"`);
  }

  private async iframeScroll(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await this.webScreenService.scroll(Number(p['dx']) || 0, Number(p['dy']) || 0);
    if (r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Scroll failed');
    return SkillOk(r['message'] as string ?? 'Scrolled');
  }

  private countNodes(nodes: Array<Record<string, unknown>>): number {
    let count = 0;
    for (const n of nodes) {
      if (n['clickable'] === true) count++;
      const children = n['children'] as Array<Record<string, unknown>> | undefined;
      if (children) count += this.countNodes(children);
    }
    return count;
  }
}
