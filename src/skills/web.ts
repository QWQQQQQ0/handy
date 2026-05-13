// 来源: lib/skills/web_screen_skill.dart

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult, ToolDefinition } from '@/types/skill';
import { extensionBridge } from '@/services/extension-bridge';
import { webScreenService } from '@/services/web-screen-service';

const defaultTools: SkillTool[] = [
  { name: 'web_get_ui', description: 'Get the DOM tree of the current page. Returns an array of interactive node objects with: tag, text, selector, bounds (x/y/width/height), clickable, inViewport, inputType, href.', parameters: { type: 'object', properties: {} } },
  { name: 'web_screenshot', description: 'Take a screenshot of the current browser tab. Returns a base64-encoded JPEG image.', parameters: { type: 'object', properties: {} } },
  { name: 'web_click', description: 'Click at coordinates (x, y) on the page. Use web_get_ui first to find element coordinates.', parameters: { type: 'object', properties: { x: { type: 'number', description: 'X coordinate on the page' }, y: { type: 'number', description: 'Y coordinate on the page' } }, required: ['x', 'y'] } },
  { name: 'web_click_element', description: "Click an element by CSS selector. Example selectors: '#search', '.btn-primary', 'input[name=\"q\"]'.", parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector of the element to click' } }, required: ['selector'] } },
  { name: 'web_type', description: 'Type text into the currently focused input field. Click the input first to focus it.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to type' } }, required: ['text'] } },
  { name: 'web_fill', description: 'Fill a specific input field by CSS selector. Focuses the field and sets its value.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector of the input field' }, text: { type: 'string', description: 'Text to fill' } }, required: ['selector', 'text'] } },
  { name: 'web_scroll', description: 'Scroll the page by (dx, dy) pixels. Positive dy scrolls down (300 ≈ one viewport).', parameters: { type: 'object', properties: { dx: { type: 'number', description: 'Horizontal scroll in pixels' }, dy: { type: 'number', description: 'Vertical scroll in pixels' } }, required: ['dx', 'dy'] } },
  { name: 'web_scroll_into_view', description: 'Scroll until an element identified by CSS selector is visible in the viewport.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector of the element to scroll to' } }, required: ['selector'] } },
  { name: 'web_press_key', description: "Press a keyboard key (e.g., 'Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp') on the active element.", parameters: { type: 'object', properties: { key: { type: 'string', description: 'Key name to press' } }, required: ['key'] } },
  { name: 'web_navigate', description: 'Navigate the browser to a URL. Opens in the current tab.', parameters: { type: 'object', properties: { url: { type: 'string', description: 'Full URL to navigate to' } }, required: ['url'] } },
  { name: 'web_extract', description: 'Extract text content from an element by CSS selector.', parameters: { type: 'object', properties: { selector: { type: 'string', description: 'CSS selector of the element to extract text from' } }, required: ['selector'] } },
  { name: 'web_list_tabs', description: "List all open browser tabs with their IDs, titles, and URLs.", parameters: { type: 'object', properties: {} } },
  { name: 'web_wait', description: 'Wait for a specified duration to allow the page to load or system to respond.', parameters: { type: 'object', properties: { durationMs: { type: 'integer', description: 'Time to wait in milliseconds, default 1000' } }, required: ['durationMs'] } },
  { name: 'web_done', description: 'Signal that the automation task is complete.', parameters: { type: 'object', properties: { summary: { type: 'string', description: 'Summary of what was accomplished' } }, required: ['summary'] } },
];

export class WebScreenSkill implements Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: SkillTool[];

  constructor(config?: { id?: string; name?: string; category?: string; description?: string; tools?: ToolDefinition[] }) {
    this.id = config?.id ?? 'web_screen';
    this.name = config?.name ?? 'Web Screen Control';
    this.category = config?.category ?? 'Device Automation';
    this.description = config?.description ?? 'View and control web pages via browser extension or iframe.';
    this.tools = config?.tools?.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) ?? defaultTools;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
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

    // Prefer iframe context (generated app) if available, else use extension
    if (webScreenService.hasIframe) {
      return this.executeIframe(toolName, params);
    }
    if (extensionBridge.isConnected) {
      return this.executeExtension(toolName, params);
    }
    return SkillFail(
      'No web context available. Open a generated app or connect the browser extension.',
    );
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
    const r = await extensionBridge.captureScreen();
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Screenshot failed');
    return SkillOk('Screenshot captured', { screenshot: r['screenshot'] });
  }

  private async extGetUI(): Promise<SkillResult> {
    const r = await extensionBridge.getDOM();
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Failed');
    const nodes = (r['nodes'] as Array<Record<string, unknown>>) ?? [];
    const interactiveCount = nodes.filter((n) => n['clickable'] === true).length;
    return SkillOk(`${nodes.length} interactive nodes`, { nodes, interactiveCount });
  }

  private async extClick(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'click', x: Number(p['x']), y: Number(p['y']) });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Click failed');
    return SkillOk(`Clicked at (${p['x']},${p['y']})`, { info: r['info'] });
  }

  private async extClickElement(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'click_element', selector: p['selector'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Click failed');
    return SkillOk(`Clicked ${p['selector']}`, { info: r['info'] });
  }

  private async extType(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'type', text: p['text'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Type failed');
    return SkillOk(`Typed "${p['text']}"`);
  }

  private async extFill(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'fill', selector: p['selector'] as string, text: p['text'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Fill failed');
    return SkillOk(`Filled ${p['selector']}`);
  }

  private async extScroll(p: Record<string, unknown>): Promise<SkillResult> {
    const dx = Number(p['dx']) || 0;
    const dy = Number(p['dy']) || 0;
    const r = await extensionBridge.executeAction(null, { type: 'scroll', dx, dy });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Scroll failed');
    return SkillOk(r['message'] as string ?? 'Scrolled');
  }

  private async extScrollIntoView(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'scroll_into_view', selector: p['selector'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Scroll failed');
    return SkillOk(`Scrolled to ${p['selector']}`);
  }

  private async extPressKey(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'press_key', key: p['key'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Key press failed');
    return SkillOk(`Pressed ${p['key']}`);
  }

  private async extNavigate(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.openURL(p['url'] as string);
    if (r['success'] !== true) return SkillFail(r['error'] as string ?? 'Navigation failed');
    return SkillOk(`Navigated to ${p['url']}`, { tabId: r['tabId'] });
  }

  private async extExtract(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await extensionBridge.executeAction(null, { type: 'extract', selector: p['selector'] as string });
    if (r['success'] !== true && r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Extract failed');
    return SkillOk('Extracted text', { text: r['text'] });
  }

  private async extListTabs(): Promise<SkillResult> {
    const r = await extensionBridge.listTabs();
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
    const r = await webScreenService.getUI();
    if (!r) return SkillFail('Failed to get UI tree');
    const nodes = (r['nodes'] as Array<Record<string, unknown>>) ?? [];
    const count = this.countNodes(nodes);
    return SkillOk(`${count} interactive nodes`, { uiTree: { nodes }, interactiveCount: count });
  }

  private async iframeClick(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await webScreenService.click(Number(p['x']), Number(p['y']));
    if (r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Click failed');
    const info = r['info'];
    const desc = info ? `Clicked ${(info as Record<string, unknown>)['tag']} at (${p['x']},${p['y']})` : `Clicked at (${p['x']},${p['y']})`;
    return SkillOk(desc, { info });
  }

  private async iframeType(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await webScreenService.typeText(p['text'] as string);
    if (r['ok'] !== true) return SkillFail(r['error'] as string ?? 'Type failed');
    return SkillOk(r['message'] as string ?? `Typed "${p['text']}"`);
  }

  private async iframeScroll(p: Record<string, unknown>): Promise<SkillResult> {
    const r = await webScreenService.scroll(Number(p['dx']) || 0, Number(p['dy']) || 0);
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
