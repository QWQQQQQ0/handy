// 来源: lib/skills/desktop_screen_skill.dart

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult, ToolDefinition } from '@/types/skill';
import { desktopService } from '@/services/desktop-service';

const defaultTools: SkillTool[] = [
  { name: 'desktop_screenshot', description: 'Take a screenshot of the entire desktop. Returns a PNG image.', parameters: { type: 'object', properties: {} } },
  { name: 'desktop_list_windows', description: 'List all visible windows with their titles, handles, and positions.', parameters: { type: 'object', properties: {} } },
  { name: 'desktop_focus_window', description: 'Bring a window to the foreground by its handle (hwnd).', parameters: { type: 'object', properties: { hwnd: { type: 'integer', description: 'Window handle' } }, required: ['hwnd'] } },
  { name: 'desktop_click', description: 'Click at absolute screen coordinates (x, y).', parameters: { type: 'object', properties: { x: { type: 'integer', description: 'X coordinate' }, y: { type: 'integer', description: 'Y coordinate' } }, required: ['x', 'y'] } },
  { name: 'desktop_double_click', description: 'Double-click at absolute screen coordinates (x, y).', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } },
  { name: 'desktop_right_click', description: 'Right-click at absolute screen coordinates (x, y).', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } },
  { name: 'desktop_type', description: 'Type text using keyboard simulation.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'Text to type' } }, required: ['text'] } },
  { name: 'desktop_press_key', description: 'Press a keyboard key (Enter, Escape, Tab, etc.).', parameters: { type: 'object', properties: { key: { type: 'string', description: 'Key name' } }, required: ['key'] } },
  { name: 'desktop_scroll', description: 'Scroll the mouse wheel at coordinates.', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' }, delta: { type: 'integer', description: 'Scroll amount, 120 = one notch' } }, required: ['x', 'y', 'delta'] } },
  { name: 'desktop_move_mouse', description: 'Move the mouse cursor without clicking.', parameters: { type: 'object', properties: { x: { type: 'integer' }, y: { type: 'integer' } }, required: ['x', 'y'] } },
  { name: 'desktop_wait', description: 'Wait for a specified number of milliseconds.', parameters: { type: 'object', properties: { milliseconds: { type: 'integer' } }, required: ['milliseconds'] } },
  { name: 'desktop_done', description: 'Signal that the automation task is complete.', parameters: { type: 'object', properties: { message: { type: 'string', description: 'Summary of what was accomplished' } }, required: ['message'] } },
  { name: 'desktop_list_apps', description: 'List all installed applications on this computer.', parameters: { type: 'object', properties: {} } },
  { name: 'desktop_open_app', description: 'Launch an application by name. Uses local app index with fuzzy matching — try simple names like "chrome", "notepad", "calculator". Also supports Chinese aliases like "浏览器"→Chrome, "记事本"→Notepad, "微信"→WeChat, "设置"→Settings. Prefer the simplest common name for best matching.', parameters: { type: 'object', properties: { name: { type: 'string', description: 'App name (e.g., chrome, notepad, vscode, wechat) or Chinese alias (浏览器, 记事本)' } }, required: ['name'] } },
];

export class DesktopScreenSkill implements Skill {
  id: string;
  name: string;
  category: string;
  description: string;
  tools: SkillTool[];

  constructor(config?: { id?: string; name?: string; category?: string; description?: string; tools?: ToolDefinition[] }) {
    this.id = config?.id ?? 'desktop_screen';
    this.name = config?.name ?? 'Desktop Screen Control';
    this.category = config?.category ?? 'Device Automation';
    this.description = config?.description ?? 'Control the Windows desktop via win32 native APIs.';
    this.tools = config?.tools?.map(t => ({ name: t.name, description: t.description, parameters: t.parameters })) ?? defaultTools;
  }

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      const data = await this.executeTool(toolName, params);
      return SkillOk('Tool executed successfully', data);
    } catch (e) {
      return SkillFail(`Tool execution failed: ${e}`);
    }
  }

  private async executeTool(toolName: string, params: Record<string, unknown>): Promise<Record<string, unknown>> {
    switch (toolName) {
      case 'desktop_screenshot': {
        const base64 = await desktopService.screenshot();
        return { image_data: base64, format: 'bmp', note: 'Desktop screenshot captured' };
      }
      case 'desktop_list_windows': {
        const windows = await desktopService.listWindows();
        return { windows, count: windows.length };
      }
      case 'desktop_focus_window': {
        const ok = await desktopService.focusWindow(Number(params['hwnd']));
        return { success: ok, hwnd: params['hwnd'] };
      }
      case 'desktop_click': {
        await desktopService.click(Number(params['x']), Number(params['y']));
        return { action: 'click', x: params['x'], y: params['y'] };
      }
      case 'desktop_double_click': {
        await desktopService.doubleClick(Number(params['x']), Number(params['y']));
        return { action: 'double_click', x: params['x'], y: params['y'] };
      }
      case 'desktop_right_click': {
        await desktopService.rightClick(Number(params['x']), Number(params['y']));
        return { action: 'right_click', x: params['x'], y: params['y'] };
      }
      case 'desktop_type': {
        await desktopService.typeText(String(params['text']));
        return { action: 'type', text: params['text'] };
      }
      case 'desktop_press_key': {
        await desktopService.pressKey(String(params['key']));
        return { action: 'press_key', key: params['key'] };
      }
      case 'desktop_scroll': {
        await desktopService.scroll(Number(params['x']), Number(params['y']), Number(params['delta']));
        return { action: 'scroll', x: params['x'], y: params['y'], delta: params['delta'] };
      }
      case 'desktop_move_mouse': {
        await desktopService.moveMouse(Number(params['x']), Number(params['y']));
        return { action: 'move_mouse', x: params['x'], y: params['y'] };
      }
      case 'desktop_wait': {
        const ms = Math.min(Number(params['milliseconds']) || 1000, 30000);
        await new Promise((r) => setTimeout(r, ms));
        return { action: 'wait', milliseconds: ms };
      }
      case 'desktop_done':
        return { action: 'done', message: params['message'] ?? 'Task completed' };
      case 'desktop_list_apps': {
        const apps = await desktopService.listApps();
        return { apps, count: apps.length };
      }
      case 'desktop_open_app': {
        const ok = await desktopService.openApp(String(params['name']));
        return { action: 'open_app', name: params['name'], success: ok };
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}
