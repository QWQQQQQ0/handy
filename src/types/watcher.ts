// Watcher types — persistent screen monitoring

import type { SemanticAction } from './cache';

// ── Workflow Template types (V1 - 向后兼容) ──

/** 工作流步骤：动作步骤 或 LLM 生成步骤 */
export type WorkflowStep = WorkflowActionStep | WorkflowLLMStep;

/** 动作步骤：直接回放的 SemanticAction，支持 {param} 占位符 */
export interface WorkflowActionStep {
  type: 'action';
  action: SemanticAction;
}

/** LLM 生成步骤：调用模型生成文本，结果注入后续步骤的变量 */
export interface WorkflowLLMStep {
  type: 'llm_generate';
  /** prompt 模板，支持 {diff}、{ocr}、{context}、{snapshot} 等占位符 */
  promptTemplate: string;
  /** LLM 输出注入到后续步骤变量映射的参数名，如 "reply_text" */
  outputParam: string;
}

// ── Workflow Template types (V2 - 新版) ──

/** 工作流步骤类型 */
export type WorkflowStepTypeV2 = 'screenshot' | 'llm_analyze' | 'execute_action' | 'verify' | 'check_complete';

/** 工作流步骤 V2：统一结构，每步都有类型和参数 */
export interface WorkflowStepV2 {
  type: WorkflowStepTypeV2;
  /** 步骤描述（用于调试和展示） */
  description?: string;
  /** 步骤参数 */
  params?: Record<string, unknown>;
  /** LLM 分析步骤的 prompt 模板，支持 {task}、{diff}、{chat_history}、{sender_info} 等占位符 */
  promptTemplate?: string;
  /** LLM 输出注入到后续步骤变量映射的参数名 */
  outputParam?: string;
  /** 执行动作的语义描述 */
  action?: SemanticAction;
}

/** 工作流模板 V2：记录可复用的执行流程 */
export interface WorkflowTemplate {
  /** 模板 ID */
  id: string;
  /** 模板名称 */
  name: string;
  /** 适用场景描述 */
  scenario: string;
  /** 步骤列表 */
  steps: WorkflowStepV2[];
  /** 创建时间 */
  createdAt: number;
  /** 最后更新时间 */
  updatedAt: number;
  /** 成功执行次数 */
  successCount: number;
}

// ── Chat Context types (for chat reply scenarios) ──

/** 聊天消息记录 */
export interface ChatMessage {
  id: string;
  /** 发送者标识 */
  senderId: string;
  /** 发送者显示名称 */
  senderName: string;
  /** 消息内容 */
  content: string;
  /** 消息时间戳 */
  timestamp: number;
  /** 是否是新消息（触发变更的消息） */
  isNew?: boolean;
}

/** 发送者信息 */
export interface SenderInfo {
  /** 发送者 ID */
  id: string;
  /** 发送者名称 */
  name: string;
  /** 发送者头像（可选） */
  avatar?: string;
  /** 群聊中的 @提及 */
  mentions?: string[];
}

/** 聊天上下文：用于聊天回复场景 */
export interface ChatContext {
  /** 聊天/会话 ID */
  chatId: string;
  /** 聊天名称（群名或私聊对象名） */
  chatName: string;
  /** 是否是群聊 */
  isGroupChat: boolean;
  /** 最近的聊天记录 */
  recentMessages: ChatMessage[];
  /** 新消息的发送者 */
  newMessageSender?: SenderInfo;
  /** 新消息内容 */
  newMessageContent?: string;
}

export interface ScreenRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type MonitorTargetType = 'fullscreen' | 'window';

export interface MonitorTarget {
  type: MonitorTargetType;
  windowHwnd?: number;  // 仅 window 类型时有值
  windowTitle?: string; // 窗口标题（页面级，如"文件管理群"）
  appName?: string;     // 应用名（应用级，如"微信"），用于打开/聚焦应用
}

export type DiffStrategyType = 'fast_visual' | 'semantic_text' | 'llm_vision';

export type RegionMode = 'manual' | 'auto';

export interface DiffBbox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DiffResult {
  changed: boolean;
  confidence: number;
  diffDetail?: string;
  currentSnapshot?: string;
  diffBbox?: DiffBbox;
  /** Raw visual_diff output from Rust — used by RegionQualityTracker */
  rawVisualDiff?: {
    visual_change_ratio: number;
    changed_blocks: number;
    total_blocks: number;
    confidence: number;
  };
}

// ── Runtime state types (used by WatcherManager / UI) ──

export type WatcherStatus = 'idle' | 'running' | 'paused' | 'triggered' | 'error';

export interface TaskQueueItem {
  id: number;
  enqueuedAt: number;
}

export interface WatcherState {
  configId: string;
  status: WatcherStatus;
  lastCheckAt: number;
  lastTriggerAt: number;
  triggerCount: number;
  lastError?: string;
  baseline: string;
  queueSize: number;
  queueItems: TaskQueueItem[];
  processing: boolean;
}

export type WatcherEventType =
  | 'tick'
  | 'diff_detected'
  | 'diff_unchanged'
  | 'low_confidence'
  | 'trigger_start'
  | 'trigger_end'
  | 'state_change'
  | 'error'
  | 'quality_evaluated'
  | 'quality_low'
  | 'region_reresolved'
  | 'agent_plan_done';

export interface DiffDetector {
  type: DiffStrategyType;
  detect(previous: string, current: string): Promise<DiffResult>;
}

// ── Region Discovery types ──

export interface WatchSignal {
  /** Human-readable description of what to watch for */
  description: string;
}

export interface WatchTarget {
  /** Semantic region name, e.g. "conversation_list" */
  semantic: string;
  /** Why this region matters */
  reason: string;
  /** Observable change signals */
  signals: WatchSignal[];
  /** 0.0–1.0 importance weight */
  importance: number;
  /** LLM 直接返回的 bbox（无 UIA 时使用） */
  bbox?: ScreenRegion;
}

export interface WatchProfile {
  watch_targets: WatchTarget[];
  uia_signature: string;
}

// ── Region Quality Auto-Validation ──

export interface TickQualityData {
  changed: boolean;
  confidence: number;
  ocrSuccess: boolean;
  visualChangeRatio: number;  // 0.0-1.0 from visual_diff
  jitter: boolean;            // changed but tiny ratio + low confidence
  hasDiffBbox: boolean;
}

export interface RegionQualityMetrics {
  ocrSuccessRate: number;    // 0-1
  changeFrequency: number;   // 0-1, ratio of changed ticks
  staticRatio: number;       // 0-1, max consecutive unchanged / window
  jitterRate: number;        // 0-1, jitter ticks / total
  diffStability: number;     // 0-1, post-change settle speed
  qualityScore: number;      // 0-1, weighted composite
  tickCount: number;
  evaluationCount: number;
}

