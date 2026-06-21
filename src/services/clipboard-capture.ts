/**
 * 剪贴板捕获服务
 *
 * 在录制过程中，检测全局事件中的复制/粘贴热键，
 * 自动读取剪贴板内容并附加到事件上下文中。
 */

import type { GlobalInputEvent } from './global-listener';

/** 是否是复制/剪切热键 */
function isCopyHotkey(event: GlobalInputEvent): boolean {
  if (event.event_type !== 'key_down') return false;
  const mods = (event.modifiers || []).map(m => m.toLowerCase());
  const key = (event.key || '').toLowerCase();
  return mods.includes('ctrl') && (key === 'c' || key === 'x');
}

/** 是否是粘贴热键 */
function isPasteHotkey(event: GlobalInputEvent): boolean {
  if (event.event_type !== 'key_down') return false;
  const mods = (event.modifiers || []).map(m => m.toLowerCase());
  const key = (event.key || '').toLowerCase();
  return mods.includes('ctrl'  ) && key === 'v';
}

/**
 * 如果事件是复制/粘贴操作，读取剪贴板内容并返回。
 * 调用方应将返回值存入 event.context.clipboardContent。
 *
 * @returns 剪贴板文本，或 null（非复制粘贴事件 / 读取失败 / 内容为空）
 */
export async function captureClipboardIfNeeded(
  event: GlobalInputEvent,
): Promise<string | null> {
  if (!isCopyHotkey(event) && !isPasteHotkey(event)) {
    return null;
  }

  try {
    const { desktopService } = await import('./desktop-service');
    const text = await desktopService.getClipboard();
    // 只保留文本，截断过长内容
    if (text && text.trim().length > 0) {
      return text.length > 500 ? text.slice(0, 500) + '...' : text;
    }
  } catch {
    // 剪贴板读取失败（可能被其他程序锁定），静默忽略
  }
  return null;
}
