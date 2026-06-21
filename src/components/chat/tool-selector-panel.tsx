'use client';

import { useState, useEffect, useMemo } from 'react';
import { Search } from 'lucide-react';
import type { SkillTool } from '@/skills/skill';
import { useSettingsStore } from '@/stores/settings-store';
import { useT } from '@/i18n/strings';

interface ToolSelectorPanelProps {
  tools: SkillTool[];
  selected: Set<string>;
  setSelected: (tools: Set<string>) => void;
  onClose: () => void;
}

// Group tools by their skill prefix (e.g. "desktop_click" → "desktop", "generate_code" → "code")
// Tool name → group key
const TOOL_GROUP_MAP: Record<string, string> = {
  // Desktop
  desktop_click: 'desktop', desktop_double_click: 'desktop', desktop_right_click: 'desktop',
  desktop_type: 'desktop', desktop_type_text: 'desktop', desktop_press_key: 'desktop',
  desktop_drag: 'desktop', desktop_move_cursor: 'desktop', desktop_move_mouse: 'desktop',
  desktop_scroll: 'desktop', desktop_screenshot: 'desktop', desktop_ocr: 'desktop',
  desktop_open_app: 'desktop', desktop_list_apps: 'desktop', desktop_list_windows: 'desktop',
  desktop_focus_window: 'desktop', desktop_minimize_window: 'desktop', desktop_maximize_window: 'desktop',
  desktop_close_window: 'desktop', desktop_resize_window: 'desktop', desktop_wait: 'desktop',
  desktop_done: 'desktop', desktop_get_clipboard: 'desktop', desktop_set_clipboard: 'desktop',
  desktop_find_app: 'desktop', desktop_find_app_by_title: 'desktop', desktop_refresh_apps: 'desktop',
  // UIA
  uia_click: 'uia', uia_double_click: 'uia', uia_right_click: 'uia',
  uia_type: 'uia', uia_expand: 'uia', uia_select: 'uia', uia_scroll: 'uia',
  uia_get_interactive: 'uia', uia_find_element: 'uia', uia_find_element_at_point: 'uia',
  uia_get_property: 'uia', uia_fingerprint: 'uia',
  // Web
  web_pw_launch: 'web', web_pw_navigate: 'web', web_pw_click: 'web',
  web_pw_fill: 'web', web_pw_scroll: 'web', web_pw_get_interactive: 'web',
  web_pw_close: 'web', web_pw_start_recording: 'web', web_pw_stop_recording: 'web',
  web_pw_get_recorded_events: 'web',
  web_click_selector: 'web', web_click_role: 'web', web_fill: 'web', web_scroll: 'web',
  web_launch: 'web', web_navigate: 'web', web_get_interactive: 'web', web_close: 'web',
  web_start_recording: 'web', web_stop_recording: 'web', web_get_recorded_events: 'web',
  // Phone
  phone_screenshot: 'phone', phone_tap: 'phone', phone_swipe: 'phone',
  phone_type: 'phone', phone_press_key: 'phone', phone_open_app: 'phone',
  // Code generation
  generate_project: 'codegen', generate_code: 'codegen',
  // Code execution
  execute_code: 'codeexec', iterate_code: 'codeexec',
  // File I/O
  write_file: 'fileio', read_file: 'fileio',
  // Code registry
  save_code: 'codereg', list_code: 'codereg',
  // App builder
  app_build: 'appbuilder', app_preview: 'appbuilder',
  // Office
  word_generate: 'office', excel_generate: 'office', ppt_generate: 'office',
  // Global listener
  global_listener_start: 'listener', global_listener_stop: 'listener', global_listener_poll: 'listener',
  // System config
  list_skills: 'sysconfig', toggle_skill: 'sysconfig',
  list_models: 'sysconfig', switch_model: 'sysconfig', add_model: 'sysconfig', update_model: 'sysconfig',
  get_settings: 'sysconfig', update_settings: 'sysconfig',
  list_watchers: 'sysconfig',
};

function getToolGroup(name: string): string {
  return TOOL_GROUP_MAP[name] || name.split('_')[0] || 'other';
}

const GROUP_LABELS: Record<string, string> = {
  desktop: '🖥️ Desktop',
  uia: '♿ UIA',
  web: '🌐 Web',
  phone: '📱 Phone',
  codegen: '🔧 Code Generation',
  codeexec: '⚡ Code Execution',
  fileio: '📝 File I/O',
  codereg: '💾 Code Registry',
  appbuilder: '📦 App Builder',
  office: '📄 Office',
  listener: '🎧 Global Listener',
  sysconfig: '⚙️ System Config',
};

function getGroupLabel(group: string): string {
  return GROUP_LABELS[group] || `📌 ${group}`;
}

export function ToolSelectorPanel({ tools, selected, setSelected, onClose }: ToolSelectorPanelProps) {
  const t = useT();
  const storeLocale = useSettingsStore((s) => s.locale);
  const isZh = storeLocale === 'zh' || !storeLocale;
  const { disabledTools } = useSettingsStore();

  const enabledTools = useMemo(() => tools.filter((tool) => !disabledTools.has(tool.name)), [tools, disabledTools]);

  // Filter selected against enabledTools to prune stale tool names
  const validNames = useMemo(() => new Set(enabledTools.map(t => t.name)), [enabledTools]);
  const [localSelected, setLocalSelected] = useState<Set<string>>(() => new Set([...selected].filter(n => validNames.has(n))));
  const [search, setSearch] = useState('');
  useEffect(() => {
    setLocalSelected(new Set([...selected].filter(n => validNames.has(n))));
  }, [selected, validNames]);

  const toggleLocal = (name: string) => {
    setLocalSelected((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleGroup = (groupTools: SkillTool[]) => {
    setLocalSelected((prev) => {
      const next = new Set(prev);
      const allChecked = groupTools.every(t => next.has(t.name));
      for (const t of groupTools) {
        if (allChecked) next.delete(t.name);
        else next.add(t.name);
      }
      return next;
    });
  };

  const selectAll = () => setLocalSelected(new Set(filteredTools.map((t) => t.name)));
  const clearAll = () => setLocalSelected(new Set());

  const handleConfirm = () => {
    setSelected(localSelected);
    onClose();
  };

  // Filter by search
  const filteredTools = useMemo(() => {
    if (!search.trim()) return enabledTools;
    const q = search.toLowerCase();
    return enabledTools.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.nameCn && t.nameCn.includes(q)) ||
      (t.descriptionCn && t.descriptionCn.includes(q))
    );
  }, [enabledTools, search]);

  // Group filtered tools
  const grouped = useMemo(() => {
    const map = new Map<string, SkillTool[]>();
    for (const tool of filteredTools) {
      const group = getToolGroup(tool.name);
      if (!map.has(group)) map.set(group, []);
      map.get(group)!.push(tool);
    }
    return map;
  }, [filteredTools]);

  if (enabledTools.length === 0) {
    return (
      <div className="px-3 py-2 text-[12px] text-zinc-400 dark:text-zinc-500 border-t border-zinc-100 dark:border-zinc-800">
        {t('skills.noTools')}
      </div>
    );
  }

  return (
    <div className="border-t border-zinc-100 dark:border-zinc-800">
      {/* Search + actions */}
      <div className="flex items-center gap-2 px-3 py-1.5">
        <div className="relative flex-1">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={isZh ? '搜索工具...' : 'Search tools...'}
            className="w-full pl-6 pr-2 py-1 text-[11px] bg-zinc-50 dark:bg-zinc-900 border border-zinc-200 dark:border-zinc-700 rounded-md focus:outline-none focus:ring-1 focus:ring-blue-500 text-zinc-800 dark:text-zinc-200"
          />
        </div>
        <button
          onClick={selectAll}
          className="text-[11px] text-blue-500 hover:text-blue-600 dark:hover:text-blue-400 shrink-0"
        >
          {t('toolmode.selectAll') || 'All'}
        </button>
        <span className="text-zinc-300 dark:text-zinc-600">|</span>
        <button
          onClick={clearAll}
          className="text-[11px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300 shrink-0"
        >
          {t('toolmode.clearAll') || 'Clear'}
        </button>
        <span className="text-[11px] text-zinc-400 dark:text-zinc-500 shrink-0">
          {localSelected.size}/{enabledTools.length}
        </span>
        <button
          onClick={handleConfirm}
          className="px-2.5 py-0.5 rounded-full text-[11px] font-medium bg-blue-500 text-white hover:bg-blue-600 dark:bg-blue-600 dark:hover:bg-blue-500 transition-colors shrink-0"
        >
          {t('common.confirm') || 'Confirm'}
        </button>
      </div>

      {/* Grouped tool list — 3 columns */}
      <div className="max-h-52 overflow-y-auto px-2 pb-1">
        {[...grouped.entries()].map(([group, groupTools]) => {
          const allChecked = groupTools.every(t => localSelected.has(t.name));
          const someChecked = groupTools.some(t => localSelected.has(t.name));
          return (
          <div key={group} className="mb-1.5">
            <div
              className="flex items-center gap-1.5 px-1 py-0.5 cursor-pointer select-none"
              onClick={() => toggleGroup(groupTools)}
            >
              <input
                type="checkbox"
                checked={allChecked}
                ref={el => { if (el) el.indeterminate = someChecked && !allChecked; }}
                readOnly
                className="w-3 h-3 rounded"
              />
              <span className="text-[10px] font-semibold text-zinc-400 dark:text-zinc-500 uppercase tracking-wider">
                {getGroupLabel(group)}
              </span>
              <span className="text-[9px] text-zinc-300 dark:text-zinc-600">
                {groupTools.filter(t => localSelected.has(t.name)).length}/{groupTools.length}
              </span>
            </div>
            <div className="grid grid-cols-3 gap-x-1 gap-y-0.5">
              {groupTools.map((tool) => {
                const displayName = (isZh && tool.nameCn) || tool.name;
                const isChecked = localSelected.has(tool.name);
                return (
                  <label
                    key={tool.name}
                    className={`flex items-center gap-1 py-1 px-1.5 rounded cursor-pointer transition-colors ${
                      isChecked
                        ? 'bg-blue-50 dark:bg-blue-900/30'
                        : 'hover:bg-zinc-50 dark:hover:bg-zinc-800/50'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => toggleLocal(tool.name)}
                      className="w-3 h-3 rounded shrink-0"
                    />
                    <span className="text-[11px] text-zinc-700 dark:text-zinc-300 truncate">{displayName}</span>
                  </label>
                );
              })}
            </div>
          </div>
          );
        })}
        {filteredTools.length === 0 && search && (
          <div className="px-2 py-3 text-[11px] text-zinc-400 dark:text-zinc-500 text-center">
            {isZh ? '没有匹配的工具' : 'No matching tools'}
          </div>
        )}
      </div>
    </div>
  );
}
