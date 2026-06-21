import type { UnifiedElement } from './unified-element';
import type { UnifiedAction } from './unified-action';

/**
 * 语义化录制事件 —— 每次用户操作生成一条
 *
 * 核心理念：
 * 1. 记录用户的每个操作
 * 2. 同时记录操作命中的 UI 元素语义信息
 * 3. 捕获操作上下文（窗口、页面等）
 * 4. 支持用户手动标记
 */
export interface SemanticEvent {
  // ── 基础信息 ──
  id: string;                          // 事件唯一 ID
  timestamp: number;                   // 时间戳 (ms)
  action: UnifiedAction;               // 统一动作

  // ── 元素信息 ──
  element: UnifiedElement | null;      // 命中的 UI 元素

  // ── 上下文 ──
  context: EventContext;

  // ── 用户标记 ──
  tags?: EventTag[];                   // 用户手动标记

  // ── 元数据 ──
  metadata?: Record<string, unknown>;
}

/**
 * 事件上下文
 */
export interface EventContext {
  windowTitle: string;                 // 当前窗口标题
  windowHwnd?: number;                 // 窗口句柄 (Windows)
  pageUrl?: string;                    // 页面 URL (Web)
  screenshot?: string;                 // 截图 (base64)
  clipboardContent?: string;           // 剪贴板内容（复制/粘贴时捕获）

  // 平台信息
  platform?: 'dom' | 'uia' | 'accessibility' | 'global' | 'custom';

  // ── 坐标上下文（录制时自动填充） ──
  windowRect?: {                       // 窗口位置和尺寸
    x: number;                         // 窗口左上角 X（屏幕坐标）
    y: number;                         // 窗口左上角 Y（屏幕坐标）
    width: number;                     // 窗口宽度
    height: number;                    // 窗口高度
  };
  relativeCoord?: {                    // 相对于窗口的坐标
    x: number;                         // 窗口内 X
    y: number;                         // 窗口内 Y
  };
  percentCoord?: {                     // 窗口内百分比位置
    x: number;                         // 0~100
    y: number;                         // 0~100
  };
  screenSize?: {                       // 全屏尺寸
    width: number;
    height: number;
  };

  // 附加信息
  [key: string]: unknown;
}

/**
 * 事件标签（用户标记或自动识别）
 */
export type EventTag =
  | 'variable'                         // 这是变量（如：列表项）
  | 'fixed'                            // 这是常量（如：目标位置）
  | 'loop_start'                       // 循环开始
  | 'loop_end'                         // 循环结束
  | 'conditional'                      // 条件分支
  | 'important'                        // 关键步骤
  | 'skip'                             // 可跳过步骤
  | 'source'                           // 数据源
  | 'target'                           // 数据目标
  | 'copy'                             // 复制操作
  | 'paste'                            // 粘贴操作
  | 'custom';                          // 自定义标记

/**
 * 事件标签常量
 */
export const EVENT_TAG = {
  VARIABLE: 'variable',
  FIXED: 'fixed',
  LOOP_START: 'loop_start',
  LOOP_END: 'loop_end',
  CONDITIONAL: 'conditional',
  IMPORTANT: 'important',
  SKIP: 'skip',
  SOURCE: 'source',
  TARGET: 'target',
  COPY: 'copy',
  PASTE: 'paste',
  CUSTOM: 'custom',
} as const;

/**
 * 事件过滤器
 */
export interface EventFilter {
  actionType?: string | string[];      // 过滤动作类型
  tag?: EventTag | EventTag[];         // 过滤标签
  platform?: string;                   // 过滤平台
  timeRange?: {
    start?: number;
    end?: number;
  };
}

/**
 * 事件统计
 */
export interface EventStats {
  totalEvents: number;
  actionTypeCounts: Record<string, number>;
  tagCounts: Record<string, number>;
  duration: number;                    // 录制时长 (ms)
  averageInterval: number;             // 平均操作间隔 (ms)
}

/**
 * 用户手动插入的步骤（录制后、分析前添加）
 * 可以是已有 skill tool 调用或自定义 LLM 调用
 */
export interface ManualStep {
  id: string;
  /** 步骤类型 */
  stepType: 'tool_call' | 'llm_call';
  /** 插入位置（afterEventId 对应的录制事件之后，undefined 表示最前面） */
  afterEventId?: string;
  /** tool_call: 调用的 skill tool */
  toolName?: string;
  toolDescription?: string;
  toolArgs?: Record<string, unknown>;
  /** llm_call: 自定义提示词 */
  llmPrompt?: string;
  /** 人工写的步骤描述 */
  description: string;
  /** 该步骤需要的可用 skills（LLM 分析时参考） */
  requiredTools?: Array<{ name: string; description: string }>;
}
