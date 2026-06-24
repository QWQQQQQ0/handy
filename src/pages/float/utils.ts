import type { ToolGroup } from './types';

export function readLocal<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw == null) return fallback;
    return JSON.parse(raw) as T;
  } catch { return fallback; }
}

export function writeLocal<T>(key: string, value: T) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
}

export function readToolGroups(): ToolGroup[] {
  return readLocal<ToolGroup[]>('float_tool_groups', []);
}

export function writeToolGroups(groups: ToolGroup[]) {
  writeLocal('float_tool_groups', groups);
}
