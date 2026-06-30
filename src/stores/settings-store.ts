// 来源: lib/providers/settings_provider.dart

import { create } from 'zustand';
import { immer } from 'zustand/middleware/immer';

type ThemeMode = 'system' | 'light' | 'dark';

interface AppSettings {
  themeMode: ThemeMode;
  defaultModelProviderId: string | null;
  disabledTools: Set<string>;
  favoriteTools: Set<string>;
  locale: string | null; // 'en', 'zh', or null for system
  enableGlobalListener: boolean; // 是否启用全局输入监听
  workspacePath: string | null; // 用户自定义工作目录（null = 使用默认项目根目录/workspace）
}

interface SettingsState extends AppSettings {
  loaded: boolean;

  load: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  setDefaultModelProvider: (id: string) => void;
  disableTool: (toolName: string) => void;
  enableTool: (toolName: string) => void;
  toggleFavorite: (toolName: string) => void;
  setFavoriteTools: (tools: Set<string>) => void;
  isFavorite: (toolName: string) => boolean;
  setLocale: (locale: string | null) => void;
  setEnableGlobalListener: (enable: boolean) => void;
  setWorkspacePath: (path: string | null) => void;
}

function readSet(key: string): Set<string> {
  try {
    const raw = localStorage.getItem(key);
    if (raw) return new Set(JSON.parse(raw));
  } catch { /* ignore */ }
  return new Set();
}

function writeSet(key: string, value: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...value]));
}

export const useSettingsStore = create<SettingsState>()(
  immer((set, get) => ({
    themeMode: 'system',
    defaultModelProviderId: null,
    disabledTools: new Set(),
    favoriteTools: new Set(),
    locale: null,
    enableGlobalListener: true, // 默认启用
    workspacePath: null, // null = 使用默认位置
    loaded: false,

    load: () => {
      const theme = localStorage.getItem('theme_mode') as ThemeMode | null;
      const defaultProvider = localStorage.getItem('default_model_provider_id');
      const locale = localStorage.getItem('locale');
      const enableGlobalListener = localStorage.getItem('enable_global_listener');
      const workspacePath = localStorage.getItem('workspace_path') || null;

      set({
        themeMode: theme === 'dark' || theme === 'light' ? theme : 'system',
        defaultModelProviderId: defaultProvider || null,
        disabledTools: readSet('disabled_tools'),
        favoriteTools: readSet('favorite_tools'),
        locale: locale || null,
        enableGlobalListener: enableGlobalListener !== 'false', // 默认 true
        workspacePath,
        loaded: true,
      });
    },

    setThemeMode: (mode) => {
      localStorage.setItem('theme_mode', mode);
      set({ themeMode: mode });
    },

    setDefaultModelProvider: (id) => {
      localStorage.setItem('default_model_provider_id', id);
      set({ defaultModelProviderId: id });
    },

    disableTool: (toolName) => {
      set((s) => {
        s.disabledTools.add(toolName);
        writeSet('disabled_tools', s.disabledTools);
      });
    },

    enableTool: (toolName) => {
      set((s) => {
        s.disabledTools.delete(toolName);
        writeSet('disabled_tools', s.disabledTools);
      });
    },

    toggleFavorite: (toolName) => {
      set((s) => {
        if (s.favoriteTools.has(toolName)) {
          s.favoriteTools.delete(toolName);
        } else {
          s.favoriteTools.add(toolName);
        }
        writeSet('favorite_tools', s.favoriteTools);
      });
    },

    setFavoriteTools: (tools) => {
      set({ favoriteTools: tools });
      writeSet('favorite_tools', tools);
    },

    isFavorite: (toolName) => get().favoriteTools.has(toolName),

    setLocale: (locale) => {
      localStorage.setItem('locale', locale ?? '');
      set({ locale });
    },

    setEnableGlobalListener: (enable) => {
      localStorage.setItem('enable_global_listener', String(enable));
      set({ enableGlobalListener: enable });
    },

    setWorkspacePath: (path) => {
      if (path) {
        localStorage.setItem('workspace_path', path);
      } else {
        localStorage.removeItem('workspace_path');
      }
      set({ workspacePath: path });
    },
  }))
);
