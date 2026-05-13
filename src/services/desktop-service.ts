// 来源: lib/services/desktop/desktop_native_service.dart
// Frontend wrapper for Tauri Rust desktop automation commands

import { isTauri } from '@/utils/platform';

export interface WindowInfo {
  hwnd: number;
  title: string;
  class_name: string;
  is_visible: boolean;
  process_id: number;
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface AppInfo {
  name: string;
  app_id: string;
  source: string;
  path: string;
}

const tauriApi = {
  screenshot: async (): Promise<string> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('desktop_screenshot');
  },
  listWindows: async (): Promise<WindowInfo[]> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<WindowInfo[]>('desktop_list_windows');
  },
  focusWindow: async (hwnd: number): Promise<boolean> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('desktop_focus_window', { hwnd });
  },
  click: async (x: number, y: number): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_click', { x, y });
  },
  doubleClick: async (x: number, y: number): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_double_click', { x, y });
  },
  rightClick: async (x: number, y: number): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_right_click', { x, y });
  },
  typeText: async (text: string): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_type_text', { text });
  },
  pressKey: async (key: string): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_press_key', { key });
  },
  scroll: async (x: number, y: number, delta: number): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_scroll', { x, y, delta });
  },
  moveMouse: async (x: number, y: number): Promise<void> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke('desktop_move_mouse', { x, y });
  },
  listApps: async (): Promise<AppInfo[]> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<AppInfo[]>('desktop_list_apps');
  },
  openApp: async (name: string): Promise<boolean> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<boolean>('desktop_open_app', { name });
  },
  refreshApps: async (): Promise<number> => {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<number>('desktop_refresh_apps');
  },
};

type DesktopApi = typeof tauriApi;

const fallbackError = 'Desktop API not available outside Tauri desktop environment';

const fallback = {
  screenshot: async () => { throw new Error(fallbackError); },
  listWindows: async () => { throw new Error(fallbackError); },
  focusWindow: async () => { throw new Error(fallbackError); },
  click: async () => { throw new Error(fallbackError); },
  doubleClick: async () => { throw new Error(fallbackError); },
  rightClick: async () => { throw new Error(fallbackError); },
  typeText: async () => { throw new Error(fallbackError); },
  pressKey: async () => { throw new Error(fallbackError); },
  scroll: async () => { throw new Error(fallbackError); },
  moveMouse: async () => { throw new Error(fallbackError); },
  listApps: async () => { throw new Error(fallbackError); },
  openApp: async () => { throw new Error(fallbackError); },
  refreshApps: async () => { throw new Error(fallbackError); },
} as DesktopApi;

export const desktopService: DesktopApi = isTauri() ? tauriApi : fallback;
