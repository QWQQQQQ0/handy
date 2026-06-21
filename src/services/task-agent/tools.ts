// Task 专用工具集定义
// 复用 AgentRunner 的 BASE_TOOLS 模式，为 Task agents 定义工具集

import type { TaskAgentType } from '@/services/multi-agent/types';

interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

// ── Task 专用工具 ──

const TASK_TOOLS: Record<string, ToolDef> = {
  think: {
    name: 'think',
    description: 'Record your internal reasoning.',
    input_schema: {
      type: 'object',
      properties: {
        thought: { type: 'string', description: 'Your reasoning.' },
      },
      required: ['thought'],
    },
  },

  submit_plan: {
    name: 'submit_plan',
    description: '[Decomposer] Submit a task decomposition decision.',
    input_schema: {
      type: 'object',
      properties: {
        should_split: { type: 'boolean', description: 'Whether to split into sub-tasks.' },
        reason: { type: 'string', description: 'Rationale.' },
        sub_tasks: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              description: { type: 'string' },
            },
            required: ['name', 'description'],
          },
          description: 'Sub-tasks if should_split is true.',
        },
      },
      required: ['should_split', 'reason'],
    },
  },

  desktop_screenshot: {
    name: 'desktop_screenshot',
    description: 'Capture a screenshot of the desktop or a specific window.',
    input_schema: {
      type: 'object',
      properties: {
        window_hwnd: { type: 'number', description: 'Window handle (0 or omit for fullscreen).' },
      },
    },
  },

  desktop_click: {
    name: 'desktop_click',
    description: 'Click at a screen position.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        button: { type: 'string', enum: ['left', 'right', 'middle'] },
        clicks: { type: 'number' },
        window_hwnd: { type: 'number' },
      },
      required: ['x', 'y'],
    },
  },

  desktop_type: {
    name: 'desktop_type',
    description: 'Type text via keyboard.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
      },
      required: ['text'],
    },
  },

  desktop_open_app: {
    name: 'desktop_open_app',
    description: 'Open or focus an application.',
    input_schema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'App name or path.' },
        windowTitle: { type: 'string', description: 'Window title to find.' },
        hwnd: { type: 'number', description: 'Known window handle.' },
      },
    },
  },

  desktop_press_key: {
    name: 'desktop_press_key',
    description: 'Press a keyboard key.',
    input_schema: {
      type: 'object',
      properties: {
        key: { type: 'string' },
      },
      required: ['key'],
    },
  },

  desktop_list_windows: {
    name: 'desktop_list_windows',
    description: 'List all visible windows.',
    input_schema: { type: 'object', properties: {} },
  },

  desktop_scroll: {
    name: 'desktop_scroll',
    description: 'Scroll at a position.',
    input_schema: {
      type: 'object',
      properties: {
        x: { type: 'number' },
        y: { type: 'number' },
        delta: { type: 'number' },
        window_hwnd: { type: 'number' },
      },
      required: ['x', 'y', 'delta'],
    },
  },

  desktop_drag: {
    name: 'desktop_drag',
    description: 'Drag from one position to another.',
    input_schema: {
      type: 'object',
      properties: {
        start_x: { type: 'number' },
        start_y: { type: 'number' },
        end_x: { type: 'number' },
        end_y: { type: 'number' },
        duration_ms: { type: 'number' },
        window_hwnd: { type: 'number' },
      },
      required: ['start_x', 'start_y', 'end_x', 'end_y'],
    },
  },

  uia_get_interactive: {
    name: 'uia_get_interactive',
    description: 'Get interactive UI elements of a window via UI Automation. NOTE: UIA only works with standard Win32/WPF/WinUI controls. Custom-drawn UIs (WeChat, Electron apps, Qt, Java Swing) return 0 elements. If this returns empty, fall back to desktop_screenshot + desktop_click with coordinates.',
    input_schema: {
      type: 'object',
      properties: {
        window_hwnd: { type: 'number' },
        roles: { type: 'array', items: { type: 'string' } },
        name_keyword: { type: 'string' },
        limit: { type: 'number' },
      },
    },
  },

  uia_click: {
    name: 'uia_click',
    description: 'Click a UI element by semantic role and name.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        window_hwnd: { type: 'number' },
      },
      required: ['role'],
    },
  },

  uia_type: {
    name: 'uia_type',
    description: 'Type text into a UI element.',
    input_schema: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        role: { type: 'string' },
        name: { type: 'string' },
        window_hwnd: { type: 'number' },
      },
      required: ['text'],
    },
  },

  uia_find_element: {
    name: 'uia_find_element',
    description: 'Find a specific UI element.',
    input_schema: {
      type: 'object',
      properties: {
        role: { type: 'string' },
        name: { type: 'string' },
        window_hwnd: { type: 'number' },
      },
      required: ['role'],
    },
  },

  desktop_focus_window: {
    name: 'desktop_focus_window',
    description: 'Focus a window by handle.',
    input_schema: {
      type: 'object',
      properties: {
        hwnd: { type: 'number' },
      },
      required: ['hwnd'],
    },
  },

  desktop_done: {
    name: 'desktop_done',
    description: 'Signal task completion.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string' },
      },
    },
  },

  request_user_input: {
    name: 'request_user_input',
    description: 'When encountering login, password, captcha, payment, or any form that requires user-specific information NOT provided in the original request, pause and ask the user to fill in the form. Do NOT use this if the user explicitly told you what to type.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Explain to the user what input is needed' },
        fields: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: 'Field label shown to user (e.g. "邮箱", "密码")' },
              key: { type: 'string', description: 'Field identifier' },
              type: { type: 'string', enum: ['text', 'password'], description: 'Input type' },
            },
            required: ['label', 'key'],
          },
          description: 'Form fields for the user to fill',
        },
      },
      required: ['message', 'fields'],
    },
  },

  finalize: {
    name: 'finalize',
    description: 'Mark the task as complete with a summary.',
    input_schema: {
      type: 'object',
      properties: {
        summary: { type: 'string', description: 'What was accomplished.' },
      },
      required: ['summary'],
    },
  },

  doc_done: {
    name: 'doc_done',
    description: 'Signal document task completion with a summary of what was done.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Summary of what was accomplished.' },
      },
    },
  },

  code_done: {
    name: 'code_done',
    description: 'Signal code task completion with a summary of what was done.',
    input_schema: {
      type: 'object',
      properties: {
        message: { type: 'string', description: 'Summary of what was accomplished.' },
      },
    },
  },
};

// ── 每个 agent 类型可用的工具集 ──

export const TASK_AGENT_TOOLS: Record<TaskAgentType, string[]> = {
  decomposer: ['think', 'submit_plan'],
  executor: [
    'think',
    'desktop_screenshot', 'desktop_click', 'desktop_type', 'desktop_open_app',
    'desktop_press_key', 'desktop_list_windows', 'desktop_scroll', 'desktop_drag',
    'desktop_focus_window',
    'uia_get_interactive', 'uia_click', 'uia_type', 'uia_find_element',
    'request_user_input',
    'desktop_done', 'finalize',
  ],
  verifier: ['think', 'desktop_screenshot', 'uia_get_interactive', 'finalize'],
  assembler: ['think', 'finalize'],
  doc: ['think', 'request_user_input', 'doc_done', 'finalize'],
  web: ['think', 'request_user_input', 'web_done', 'finalize'],  // 动态工具通过 toolFilter 从 SkillExecutor 获取
  code: ['think', 'request_user_input', 'code_done', 'finalize'],  // 动态工具通过 toolFilter 从 SkillExecutor 获取
};

/** 获取指定 agent 类型的工具定义（OpenAI function 格式） */
export function getTaskTools(agentType: TaskAgentType): Record<string, unknown>[] {
  return TASK_AGENT_TOOLS[agentType].map((name) => {
    const t = TASK_TOOLS[name];
    if (!t) return null;
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    };
  }).filter(Boolean) as Record<string, unknown>[];
}

/** 获取指定工具名的定义 */
export function getTaskToolDef(name: string): ToolDef | undefined {
  return TASK_TOOLS[name];
}

/** 获取多个内部工具的 OpenAI function 格式定义 */
export function getTaskToolDefs(names: string[]): Record<string, unknown>[] {
  return names.map((name) => {
    const t = TASK_TOOLS[name];
    if (!t) return null;
    return {
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.input_schema,
      },
    };
  }).filter(Boolean) as Record<string, unknown>[];
}
