/**
 * 临时任务存储
 *
 * 将录制分析生成的 AutomationTemplate 存入 localStorage，
 * 用户可以在录制器中快速找到并重复执行。
 */

import type { AutomationTemplate } from '@/types/automation-template';

const STORAGE_KEY = 'handy_temporary_tasks';
const MAX_TASKS = 20;

/** 从 localStorage 读取所有临时任务 */
export function loadTemporaryTasks(): AutomationTemplate[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as AutomationTemplate[];
  } catch {
    return [];
  }
}

/** 保存一个临时任务（追加到列表头部，超出上限时删除最旧的） */
export function saveTemporaryTask(template: AutomationTemplate): void {
  const tasks = loadTemporaryTasks();
  // 如果已存在同 ID 的，先移除
  const filtered = tasks.filter(t => t.id !== template.id);
  filtered.unshift(template);
  // 截断
  const trimmed = filtered.slice(0, MAX_TASKS);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
}

/** 删除一个临时任务 */
export function deleteTemporaryTask(id: string): void {
  const tasks = loadTemporaryTasks().filter(t => t.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks));
}
