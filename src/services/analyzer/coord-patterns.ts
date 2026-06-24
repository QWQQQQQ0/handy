// Coordinate pattern detection, summarization, and application to LLM output.

import type { SemanticEvent } from '@/types/semantic-event';
import type { AutomationTemplate } from '@/types/automation-template';
import { getScreenCoord, median, variance, diffs } from './utils';
import type { CoordinatePattern, LLMAnalysisResult } from './types';

/**
 * 从事件序列中检测坐标规律（线性递增/固定值）
 */
export function detectCoordinatePatterns(events: SemanticEvent[]): Map<string, CoordinatePattern> {
  const patterns = new Map<string, CoordinatePattern>();

  // 按 action type + window 分组
  const groups = new Map<string, SemanticEvent[]>();
  for (const e of events) {
    if (!e.action.target?.coordinate) continue;
    const window = e.context?.windowTitle || '';
    const key = `${e.action.type}@${window}`;
    const arr = groups.get(key) || [];
    arr.push(e);
    groups.set(key, arr);
  }

  for (const [key, groupEvents] of groups) {
    if (groupEvents.length < 2) continue;

    // 用屏幕坐标做规律检测
    const coords = groupEvents
      .map(e => getScreenCoord(e))
      .filter((c): c is { x: number; y: number } => c !== null);

    const xValues = coords.map(c => c.x);
    const yValues = coords.map(c => c.y);

    // x 方向分析
    let xPattern: { base: number; step: number } | null = null;
    const xVar = variance(xValues);
    if (xVar < 225) {
      xPattern = { base: median(xValues), step: 0 };
    } else {
      const xDiffs = diffs(xValues);
      const xDiffVar = variance(xDiffs);
      if (xDiffVar < 100) {
        xPattern = { base: xValues[0], step: median(xDiffs) };
      }
    }

    // y 方向分析
    let yPattern: { base: number; step: number } | null = null;
    const yVar = variance(yValues);
    if (yVar < 225) {
      yPattern = { base: median(yValues), step: 0 };
    } else {
      const yDiffs = diffs(yValues);
      const yDiffVar = variance(yDiffs);
      if (yDiffVar < 400) {
        yPattern = { base: yValues[0], step: median(yDiffs) };
      }
    }

    if (xPattern || yPattern) {
      patterns.set(key, {
        groupKey: key,
        x: xPattern || { base: median(xValues), step: 0 },
        y: yPattern || { base: median(yValues), step: 0 },
        samples: coords,
      });
    }
  }

  return patterns;
}

/**
 * 从已有模板的 steps 中提取坐标规律（供 refine 使用）
 */
export function detectCoordinatePatternsFromTemplate(template: AutomationTemplate): Map<string, CoordinatePattern> {
  const patterns = new Map<string, CoordinatePattern>();
  const groups = new Map<string, Array<{ x: number; y: number }>>();

  for (const step of template.steps) {
    const coord = step.target?.coordinate;
    if (!coord) continue;
    const x = typeof coord.x === 'string' ? parseFloat(coord.x) : (coord.x as number);
    const y = typeof coord.y === 'string' ? parseFloat(coord.y) : (coord.y as number);
    if (isNaN(x) || isNaN(y)) continue;
    const key = step.action;
    const arr = groups.get(key) || [];
    arr.push({ x, y });
    groups.set(key, arr);
  }

  for (const [key, coords] of groups) {
    if (coords.length < 2) continue;
    const xValues = coords.map(c => c.x);
    const yValues = coords.map(c => c.y);
    const xVar = variance(xValues);
    const yVar = variance(yValues);
    let xPattern: { base: number; step: number } | null = null;
    let yPattern: { base: number; step: number } | null = null;

    if (xVar < 225) {
      xPattern = { base: median(xValues), step: 0 };
    } else {
      const xDiffs = diffs(xValues);
      if (variance(xDiffs) < 100) xPattern = { base: xValues[0], step: median(xDiffs) };
    }
    if (yVar < 225) {
      yPattern = { base: median(yValues), step: 0 };
    } else {
      const yDiffs = diffs(yValues);
      if (variance(yDiffs) < 400) yPattern = { base: yValues[0], step: median(yDiffs) };
    }

    if (xPattern || yPattern) {
      patterns.set(key, {
        groupKey: key,
        x: xPattern || { base: median(xValues), step: 0 },
        y: yPattern || { base: median(yValues), step: 0 },
        samples: coords,
      });
    }
  }
  return patterns;
}

/**
 * 构建坐标模式的 prompt 摘要
 */
export function buildCoordinatePatternsSummary(patterns: Map<string, CoordinatePattern>): string {
  if (patterns.size === 0) return '';

  const lines: string[] = [];
  for (const [, p] of patterns) {
    const xDesc = p.x.step !== 0
      ? `x = ${p.x.base} + index * ${p.x.step}`
      : `x ≈ ${p.x.base} (固定)`;
    const yDesc = p.y.step !== 0
      ? `y = ${p.y.base} + index * ${p.y.step}`
      : `y ≈ ${p.y.base} (固定)`;

    lines.push(`- ${p.groupKey}: ${p.samples.length} 个采样点 → ${xDesc}, ${yDesc}`);
  }

  return `\n### 坐标规律检测（来自录制分析）

${lines.join('\n')}

说明：以上坐标存在明显的线性规律（人手操作有 ±5-15px 的抖动，已取中位数修正）。模板中必须使用循环 + 坐标公式来泛化，不要硬编码每次操作的具体坐标。
`;
}

/**
 * 后处理：将坐标规律检测结果强制应用到 LLM 输出的 steps 中。
 */
export function applyCoordinatePatterns(
  result: LLMAnalysisResult,
  patterns: Map<string, CoordinatePattern>,
): void {
  const byAction = new Map<string, CoordinatePattern[]>();
  for (const p of patterns.values()) {
    const actionType = p.groupKey.split('@')[0];
    const arr = byAction.get(actionType) || [];
    arr.push(p);
    byAction.set(actionType, arr);
  }

  let loopVar = 'loop_index';
  for (const step of result.steps) {
    if (step.action === 'loop_start' && step.params?.variable) {
      loopVar = String(step.params.variable);
      break;
    }
  }

  let applied = 0;
  for (const step of result.steps) {
    const coord = step.target?.coordinate;
    if (!coord) continue;

    // 已有模板表达式 → 跳过
    const xStr = typeof coord.x === 'string';
    const yStr = typeof coord.y === 'string';
    if (xStr && (coord.x as string).includes('{{')) continue;
    if (yStr && (coord.y as string).includes('{{')) continue;

    const xNum = xStr ? parseFloat(coord.x as string) : (coord.x as number);
    const yNum = yStr ? parseFloat(coord.y as string) : (coord.y as number);
    if (isNaN(xNum) || isNaN(yNum)) continue;

    const candidates = byAction.get(step.action);
    if (!candidates || candidates.length === 0) continue;

    let best: CoordinatePattern | null = null;
    let bestDist = Infinity;
    for (const p of candidates) {
      const dx = xNum - p.x.base;
      const dy = yNum - p.y.base;
      const dist = dx * dx + dy * dy;
      if (dist < bestDist) {
        bestDist = dist;
        best = p;
      }
    }

    if (!best) continue;

    const TOLERANCE = 50;
    const xClose = Math.abs(xNum - best.x.base) <= TOLERANCE;
    const yClose = Math.abs(yNum - best.y.base) <= TOLERANCE;

    if (best.x.step !== 0 && xClose) {
      step.target!.coordinate!.x = `{{${best.x.base} + ${loopVar} * ${best.x.step}}}`;
      applied++;
    }
    if (best.y.step !== 0 && yClose) {
      step.target!.coordinate!.y = `{{${best.y.base} + ${loopVar} * ${best.y.step}}}`;
      applied++;
    }
  }

  if (applied > 0) {
    console.log(`[UnifiedAnalyzer] applyCoordinatePatterns: replaced ${applied} coordinate(s) with template expressions`);
  }
}

/**
 * 后处理：删除 desktop_focus_window 后面的冗余窗口切换 click。
 */
export function removeRedundantClicks(result: LLMAnalysisResult, screenSize: { width: number; height: number }): void {
  const TASKBAR_MARGIN = 30;
  const bottom = screenSize.height - TASKBAR_MARGIN;

  const filtered = result.steps.filter((step, i) => {
    if (step.action !== 'click' && step.action !== 'double_click' && step.action !== 'right_click') return true;

    const y = step.target?.coordinate?.y;
    if (y === undefined || y === null) return true;
    const yNum = typeof y === 'string' ? parseFloat(y) : (y as number);
    if (isNaN(yNum)) return true;

    if (yNum < bottom) return true;

    // 检查前后是否有 desktop_focus_window（距离 ≤ 2 步）
    for (let j = Math.max(0, i - 2); j <= Math.min(result.steps.length - 1, i + 2); j++) {
      if (j === i) continue;
      const s = result.steps[j];
      if (s.action === 'tool_call' && (s.params as any)?.toolName === 'desktop_focus_window') {
        console.log(`[UnifiedAnalyzer] removed redundant taskbar click at (${step.target?.coordinate?.x}, ${yNum})`);
        return false;
      }
    }
    return true;
  });

  if (filtered.length < result.steps.length) {
    result.steps = filtered;
  }
}
