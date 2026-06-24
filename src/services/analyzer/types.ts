// Shared types for the unified analyzer.

import type { PatternType } from '@/types/recording-session';

/**
 * LLM 分析结果
 */
export interface LLMAnalysisResult {
  pattern: {
    type: PatternType;
    confidence: number;
    description: string;
    loopVariable?: string;
    loopSource?: string;
    loopBodyIndices?: number[];
    count?: number;
  };
  dataFlow?: {
    source: { type: string; fields: string[] };
    target: { type: string; fields: string[] };
    mapping: Array<{ source: string; target: string }>;
  };
  parameters: Array<{
    name: string;
    description: string;
    type: string;
    required: boolean;
  }>;
  steps: Array<{
    action: string;
    description: string;
    target?: {
      semantic?: { role: string; name: string };
      path?: string;
      coordinate?: { x: number | string; y: number | string };
    };
    waitBefore?: number;
    params?: Record<string, unknown>;
    control?: { type: string; over?: string; variable?: string; body?: string[] };
  }>;
}

/**
 * 坐标模式 — 从同类操作的坐标序列中提取的数学规律
 */
export interface CoordinatePattern {
  /** 分组标识（action type + window） */
  groupKey: string;
  /** x 轴规律 */
  x: { base: number; step: number };
  /** y 轴规律 */
  y: { base: number; step: number };
  /** 原始坐标样本 */
  samples: Array<{ x: number; y: number }>;
}
