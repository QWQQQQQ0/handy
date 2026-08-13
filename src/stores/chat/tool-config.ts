import { isMobile } from '@/utils/platform';
import { AgentEndpoint } from '@/api/types';

// ---------------------------------------------------------------------------
// Tool classification
// ---------------------------------------------------------------------------

export enum ToolMode {
  basic = 'basic',
  all = 'all',
  none = 'none',
  favorites = 'favorites',
  custom = 'custom',
}

// Chat 基础工具 —— 只保留系统配置工具，业务工具通过 request_agent 路由到各 agent
const DESKTOP_CHAT_TOOLS = new Set([
  'web_search', 'web_fetch',
  'agent_memory_update',
  'search_chat_history',
  'recall_memory',
  // System config tools
  'list_skills', 'toggle_skill',
  'list_models', 'switch_model', 'add_model', 'update_model',
  'get_settings', 'update_settings',
  'list_watchers',
  'get_agent_log',
]);

const MOBILE_CHAT_TOOLS = new Set([
  'web_search', 'web_fetch',
  'agent_memory_update',
  'search_chat_history',
  'recall_memory',
  // System config tools
  'list_skills', 'toggle_skill',
  'list_models', 'switch_model', 'add_model', 'update_model',
  'get_settings', 'update_settings',
  'list_watchers',
  'get_agent_log',
]);

export function getChatBasicTools(): Set<string> {
  return isMobile() ? MOBILE_CHAT_TOOLS : DESKTOP_CHAT_TOOLS;
}

// Agent 专属工具集（@ 选中时绕过用户 toolMode，直接用 agent 自己的工具）
export const AGENT_TOOL_FILTERS: Record<string, Set<string>> = {
  code: new Set([
    'read_file', 'write_file', 'glob_files', 'grep_files',
    'generate_code', 'generate_project', 'execute_code',
    'save_code', 'list_code', 'save_app', 'save_project',
    'run_command', 'web_search', 'web_fetch',
  ]),
  web: new Set([
    'web_search', 'web_fetch',
    'web_launch', 'web_navigate', 'web_get_interactive',
    'web_click', 'web_fill', 'web_scroll', 'web_close',
    'run_playwright_script',
    'think', 'request_user_input', 'web_done', 'finalize',
  ]),
  document: new Set([
    'office_detect', 'com_read', 'com_edit', 'generate_doc', 'doc_code_exec',
    'generate_word', 'generate_excel', 'generate_ppt',
    'word_com_read', 'word_com_edit', 'excel_com_read', 'excel_com_edit',
    'ppt_com_read', 'ppt_com_edit',
    'read_file', 'glob_files', 'write_file',
    'think', 'request_user_input', 'doc_done', 'finalize',
  ]),
  computeruse: new Set([
    'desktop_screenshot', 'screenshot_window', 'screenshot_window_region',
    'desktop_click', 'desktop_double_click', 'desktop_right_click',
    'desktop_move_cursor', 'desktop_drag', 'desktop_scroll',
    'desktop_type_text', 'desktop_press_key', 'desktop_key_down', 'desktop_key_up',
    'desktop_list_windows', 'desktop_focus_window', 'desktop_resize_window',
    'desktop_maximize_window', 'desktop_minimize_window', 'desktop_close_window',
    'desktop_open_app', 'desktop_find_app',
    'desktop_get_clipboard', 'desktop_set_clipboard',
    'uia_get_interactive', 'uia_click', 'uia_type_text', 'uia_find_element',
    'uia_fingerprint', 'uia_find_element_at_point', 'uia_get_property',
    'read_file', 'write_file', 'run_command',
    'think', 'request_user_input', 'finalize',
  ]),
  // app agent: 不限制工具，由页面能力上下文驱动
  app: DESKTOP_CHAT_TOOLS,
};

export function getAgentToolFilter(agentName: string): Set<string> {
  return AGENT_TOOL_FILTERS[agentName] ?? getChatBasicTools();
}

// @agent → 后端 API 路由映射
const AGENT_ENDPOINTS: Record<string, AgentEndpoint> = {
  code: AgentEndpoint.codeAgent,
  web: AgentEndpoint.webAgent,
  document: AgentEndpoint.docAgent,
  computeruse: AgentEndpoint.desktopAutomation,
};

export function getAgentEndpoint(agentName: string): AgentEndpoint | undefined {
  return AGENT_ENDPOINTS[agentName];
}
