// Unified chat types — single message interface for all chat implementations

import type { MessageContent } from './message';

/** 工具调用条目（FreeAgent / Agent 内部的详细工具调用信息） */
export interface ToolCallEntry {
  id: string;
  name: string;
  args?: Record<string, unknown>;
  status?: 'running' | 'done' | 'error';
  success?: boolean;
  message?: string;
}

/** 统一的展示消息类型 — ChatPanel 内部使用的标准化格式 */
export interface DisplayMessage {
  id: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  status: 'sending' | 'streaming' | 'done' | 'error';
  timestamp?: string;
  reasoning_content?: string;
  toolCalls?: ToolCallEntry[];
  toolCallId?: string;
  /** Agent 内部消息（可折叠展示） */
  _agentInternal?: boolean;
  _agentType?: string;
  _isAgentStart?: boolean;
  _toolCallInfo?: ToolCallEntry;
}

/** ChatPanel 功能开关 */
export interface ChatPanelFeatures {
  showReasoning?: boolean;
  showAgentGroups?: boolean;
  showStreaming?: boolean;
  allowImagePaste?: boolean;
  allowFileUpload?: boolean;
  allowEdit?: boolean;
  allowDelete?: boolean;
  allowStop?: boolean;
  /** @ 提及过滤：'all' 显示全部 agent 类型，'knowledge' 仅显示知识型 skill */
  agentTypes?: 'all' | 'knowledge';
}

/** 工具模式配置 */
export interface ToolModeConfig {
  current: string;
  customTools: Set<string>;
  onChangeToolMode: (mode: string) => void;
  onChangeCustomTools: (tools: Set<string>) => void;
  onSaveGroup?: (name: string) => void;
  onDeleteGroup?: (groupId: string) => void;
  onGroupSelect?: (groupId: string) => void;
  groups?: Array<{ id: string; name: string; toolNames: string[] }>;
}

/** 对话列表配置 */
export interface ConversationConfig {
  conversations: Array<{ id: string; title: string; updatedAt: string }>;
  activeId?: string;
  onSwitch: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
}

/** 确认状态 */
export interface ConfirmationState {
  command: string;
  toolName: string;
  args: Record<string, unknown>;
  onConfirm: () => void;
  onReject: () => void;
}

/** 用户输入表单 */
export interface UserInputFormState {
  message: string;
  fields: Array<{ label: string; key: string; type?: string }>;
  onSubmit: (values: Record<string, string>) => void;
}

/** ChatPanel 完整 Props */
export interface ChatPanelProps extends ChatPanelFeatures {
  // ── 数据 ──
  messages: DisplayMessage[];
  onSend: (content: MessageContent, agentContext?: string) => void | Promise<void>;

  // ── 状态 ──
  isStreaming?: boolean;
  error?: string | null;
  streamingContent?: string;
  streamingReasoning?: string;
  streamingToolCalls?: ToolCallEntry[];

  // ── 回调 ──
  onStop?: () => void;
  onDismissError?: () => void;
  onDeleteMessage?: (id: string) => void;
  onEditMessage?: (id: string, newContent: string) => void;

  // ── 可选功能模块 ──
  confirmationState?: ConfirmationState;
  userInputForm?: UserInputFormState;
  conversationConfig?: ConversationConfig;

  // ── 布局 ──
  layout?: 'full' | 'compact' | 'panel';
  maxHeight?: string;
  className?: string;
  style?: React.CSSProperties;
  inputPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyIcon?: React.ReactNode;

  // ── 扩展插槽 ──
  header?: React.ReactNode;
  emptyState?: React.ReactNode;
  previewPanel?: React.ReactNode;
  modelSwitcher?: React.ReactNode;
  debugMessages?: DisplayMessage[];
}
