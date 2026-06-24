// Math and coordinate utility functions for the unified analyzer.

import type { SemanticEvent } from '@/types/semantic-event';

export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0
    ? sorted[mid]
    : Math.round((sorted[mid - 1] + sorted[mid]) / 2);
}

export function variance(values: number[]): number {
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  return values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
}

export function diffs(values: number[]): number[] {
  const result: number[] = [];
  for (let i = 1; i < values.length; i++) {
    result.push(values[i] - values[i - 1]);
  }
  return result;
}

/**
 * 获取事件的屏幕坐标（自动处理视口坐标→屏幕坐标转换）
 * 全局监听器的坐标已经是屏幕坐标，扩展的坐标是视口坐标需要加 chromeHeight
 */
export function getScreenCoord(e: SemanticEvent): { x: number; y: number } | null {
  const coord = e.action.target?.coordinate;
  if (!coord) return null;
  const x = coord.x as number;
  const y = coord.y as number;
  const wr = e.context?.windowRect as Record<string, number> | undefined;
  if (wr && typeof wr.chromeHeight === 'number' && wr.chromeHeight > 0) {
    // 扩展事件：视口坐标 + chromeHeight = 屏幕坐标
    return { x, y: y + wr.chromeHeight };
  }
  // 全局监听器事件：已经是屏幕坐标
  return { x, y };
}
