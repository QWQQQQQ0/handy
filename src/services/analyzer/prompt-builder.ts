// Prompt construction for LLM analysis and refinement.

import type { RecordingSession } from '@/types/recording-session';
import type { DataFlow } from '@/types/unified-data';
import type { UnifiedAction } from '@/types/unified-action';
import type { AutomationTemplate } from '@/types/automation-template';
import { getScreenCoord } from './utils';
import { buildCoordinatePatternsSummary } from './coord-patterns';
import type { CoordinatePattern } from './types';

/**
 * 格式化事件 target 描述
 */
export function describeTarget(target?: UnifiedAction['target'], params?: Record<string, unknown>): string {
  if (!target) return '';
  if (target.semantic) return `[${target.semantic.role}] "${target.semantic.name}"`;
  if (target.path) return `path: ${target.path}`;
  if (params?.start_x !== undefined) {
    return `(${params.start_x},${params.start_y}) → (${params.end_x},${params.end_y})`;
  }
  if (target.coordinate) return `(${target.coordinate.x}, ${target.coordinate.y})`;
  return '';
}

function buildManualStepsSummary(session: RecordingSession): string {
  const steps = session.manualSteps;
  if (!steps || steps.length === 0) return '';

  const lines = steps.map((s, i) => {
    if (s.stepType === 'tool_call') {
      return `${i + 1}. [手动] tool_call: ${s.toolName} — ${s.description}`;
    }
    return `${i + 1}. [手动] llm_call: "${(s.llmPrompt || '').substring(0, 80)}" — ${s.description}`;
  });

  return `
### 用户手动插入的步骤

${lines.join('\n')}

注意：这些步骤穿插在录制事件序列中，afterEventId 指定了插入位置。请按整体顺序编排。
`;
}

function buildAvailableToolsSummary(): string {
  try {
    const { useSkillStore } = require('@/stores/skill-store');
    const skills = useSkillStore.getState?.()?.skills;
    if (!skills || skills.length === 0) return '';

    const lines: string[] = [];
    for (const s of skills) {
      for (const t of s.tools) {
        lines.push(`- **${t.name}** (${s.name}): ${t.description}`);
      }
    }
    if (lines.length === 0) return '';

    return `
### 可用 Skill Tools

以下 tools 可在步骤中使用（action="tool_call", params.toolName="工具名"）：

${lines.join('\n')}
`;
  } catch {
    return '';
  }
}

/**
 * 构建组合 prompt（分析+生成一步到位）
 */
export function buildCombinedPrompt(
  session: RecordingSession,
  dataFlow: DataFlow | null,
  coordPatterns: Map<string, CoordinatePattern>,
  screenSize: { width: number; height: number },
): string {
  const windowSet = new Set<string>();
  for (const e of session.events) {
    const title = e.context?.windowTitle;
    if (title) windowSet.add(title);
  }
  const windowList = [...windowSet].join('、') || '未知';

  // 过滤：跳过原始中间事件，只保留已分类的可执行动作
  const filteredEvents = session.events.filter(e => {
    const t = e.action.type;
    if (t === 'mouse_down' || t === 'mouse_up') return false;
    if (t === 'key_up') return false;
    if (t === 'key_down') return false;
    return true;
  });

  // [DEBUG]
  const removedEvents = session.events.filter(e => {
    const t = e.action.type;
    return t === 'mouse_down' || t === 'mouse_up' || t === 'key_up' || t === 'key_down';
  });
  console.log('[UnifiedAnalyzer] buildCombinedPrompt — raw: %d, filtered: %d, removed: %d',
    session.events.length, filteredEvents.length, removedEvents.length);
  if (removedEvents.length > 0) {
    console.log('[UnifiedAnalyzer] removed events:');
    removedEvents.forEach(e => console.log(`  ✕ %s — %s`, e.action.type, e.context?.windowTitle || ''));
  }
  console.log('[UnifiedAnalyzer] events sent to LLM:');
  filteredEvents.forEach((e, i) => {
    const coord = e.action.target?.coordinate;
    const c = coord ? `(${coord.x}, ${coord.y})` : '';
    const key = e.action.params?.key ? ` [${e.action.params.key}]` : '';
    console.log(`  %d. %s%s — %s%s`, i + 1, e.action.type, c, e.context?.windowTitle || '', key);
  });

  const eventsSummary = filteredEvents.map((e, i) => {
    const action = e.action.type;
    const target = describeTarget(e.action.target, e.action.params);
    const element = e.element
      ? `[${e.element.identity.role}] "${e.element.identity.name}"`
      : '';
    const structure = e.element?.structure
      ? ` (in ${e.element.structure.container?.role})`
      : '';
    const window = e.context?.windowTitle ? ` @ "${e.context.windowTitle}"` : '';
    let coord = '';
    if (action === 'drag' && e.action.params?.start_x !== undefined) {
      const wr = e.context?.windowRect as Record<string, number> | undefined;
      const ch = (wr && wr.chromeHeight > 0) ? wr.chromeHeight : 0;
      coord = ` (${e.action.params.start_x},${(e.action.params.start_y as number) + ch})→(${e.action.params.end_x},${(e.action.params.end_y as number) + ch})`;
    } else {
      const sc = getScreenCoord(e);
      if (sc) coord = ` (${sc.x},${sc.y})`;
    }
    const key = e.action.params?.key ? ` key="${e.action.params.key}"` : '';
    const waitBefore = i > 0 ? e.timestamp - filteredEvents[i - 1].timestamp : 0;
    const waitStr = waitBefore > 100 ? ` [等待${Math.round(waitBefore)}ms]` : '';

    return `${i + 1}. ${action}${coord} ${element}${structure}${window}${key}${waitStr}`;
  }).join('\n');

  const dataFlowSummary = dataFlow
    ? `
## 数据流

源: ${dataFlow.source.type} - ${dataFlow.source.fields.map(f => f.name).join(', ')}
目标: ${dataFlow.target.type} - ${dataFlow.target.fields.map(f => f.name).join(', ')}
映射: ${dataFlow.mapping.map(m => `${m.source} → ${m.target}`).join(', ')}
`
    : '';

  const coordPatternsSummary = buildCoordinatePatternsSummary(coordPatterns);

  const duration = session.endTime && session.startTime
    ? `${Math.round((session.endTime - session.startTime) / 1000)}秒`
    : '未知';

  return `## 操作录制分析与模板生成

### 录制概况
- 操作数量: ${filteredEvents.length} 个
- 录制时长: ${duration}
- 涉及窗口: ${windowList}
- 屏幕分辨率: ${screenSize.width}x${screenSize.height}
- 用户描述: ${session.metadata.userDescription || '无'}

### 操作序列（含录制到的具体窗口名、元素名、坐标、按键）

${eventsSummary}
${dataFlowSummary}
${coordPatternsSummary}
${buildManualStepsSummary(session)}
${buildAvailableToolsSummary()}

### 任务要求

1. **分析模式**：识别操作模式（循环/线性/数据流）。手动插入的步骤和录制事件同等对待，按顺序排列。

2. **可用动作类型（action 字段必须使用以下值之一）**：

   鼠标操作：
   - \`click\` — 单击，target.coordinate 指定坐标
   - \`double_click\` — 双击
   - \`right_click\` — 右键点击
   - \`long_press\` — 长按（按住 >500ms），target.coordinate 指定坐标
   - \`drag\` — 拖拽，params 必须含 start_x/start_y/end_x/end_y
   - \`scroll\` — 滚动，params.direction="up"|"down"，params.amount=滚动量

   键盘操作：
   - \`key\` — 按单个键，params.key="键名"
   - \`hotkey\` — 组合键，params.key="Ctrl+c" 格式
   - \`type\` — 输入文本，params.text="要输入的文本"

   剪贴板操作：
   - \`copy\` — 复制（Ctrl+C），自动读取剪贴板到 vars.clipboard
   - \`paste\` — 粘贴（Ctrl+V）

   流程控制：
   - \`wait\` — 等待，params.duration=毫秒
   - \`code\` — 执行 JS 代码（数据加工），params.code 为代码字符串
   - \`loop_start\` / \`loop_end\` — 循环包裹
   - \`if\` / \`else\` / \`endif\` — 条件分支（见下方说明）
   - \`goto\` — 跳转到指定步骤（params.stepId=目标步骤ID）
   - \`break\` / \`continue\` — 循环控制

   外部调用（手动插入的步骤使用）：
   - \`tool_call\` — 调用已注册的 skill tool。params.toolName=工具名, params.arguments={参数对象}。可用的 tools 见上方 "可用 Skill Tools" 列表
   - \`llm_call\` — 调用 LLM 执行任务。params.prompt=提示词文本, params.systemPrompt=系统提示词(可选), params.model=模型名(可选)

   **重要**：事件摘要中的 action 类型已对齐上表，直接引用即可。

3. **窗口标题、元素名称、按键**等固定值直接硬编码到 steps 中，不要抽象成参数

4. **坐标参数化（关键）**：
   - 如果"坐标规律检测"发现了线性规律，**必须**使用循环 + 坐标公式，不要硬编码每次迭代的具体坐标
   - 坐标公式格式：\`{{base + loop_index * step}}\`，其中 base 是录制到的第一个坐标，step 是步长
   - 示例：录制到 (320,270), (316,330), (322,390) → 检测到 x≈320 固定, y=270+loop_index*60 → 生成 \`{"x": 320, "y": "{{270 + loop_index * 60}}"}\`
   - **固定轴直接用数字**（如 x: 320），**不要用 \`{{}}\` 包裹固定值**
   - 只有随循环变化的值才用 \`{{}}\` 模板语法（如 y: "{{270 + loop_index * 60}}"）
   - **base 必须是录制到的第一个坐标值**，不要从 0 开始推算
5. **循环参数化（关键）**：
   - 循环次数必须作为参数 \`loop_count\`，不要硬编码。loop_start 的 over 设为 \`{{loop_count}}\`
   - 起始轮次必须作为参数 \`start_index\`，默认值为 0
   - **start_index 的作用是跳过前 N 轮**：loop_start 设置初始变量 \`loop_index = start_index\`
   - 坐标公式中只用 \`loop_index\`，不要把 start_index 加进公式（loop_index 已经包含了 start_index 的偏移）
   - 在 parameters 中定义这两个参数，让用户执行时可以修改
6. **如果没有坐标规律**，则直接使用录制到的具体坐标值
7. **窗口切换使用 \`tool_call\`**：切换窗口时用 \`tool_call\` + \`desktop_focus_window\`（传 \`windowTitle\`）。
    示例：\`{"action": "tool_call", "params": {"toolName": "desktop_focus_window", "arguments": {"windowTitle": "Visual Studio Code"}}}\`
8. **保留操作间隔**：每步的 waitBefore 是录制时的实际等待时间（ms），必须原样写入 steps 中的 waitBefore 字段，不要省略
9. **跳过无效目标**：如果某个步骤的 target role 为 "unknown" 且 name 为空，则跳过该步骤（如窗口切换的中间点击）
10. **循环控制**：当检测到循环模式时，使用 loop_start 和 loop_end 控制结构包裹循环体步骤
11. **代码转换步骤（可选）**：当操作涉及数据加工时（去符号、格式转换、过滤、计算等），可在关键步骤之间插入 action="code" 的步骤。代码运行在沙箱中，可用变量：
    - \`vars\` — 读写上下文变量（vars.clipboard 获取剪贴板，vars.xxx = value 设置变量）
    - \`params\` — 当前步骤的参数
    - \`ok(msg, data)\` / \`fail(msg)\` — 返回结果
    - 代码中可用 fetch、JSON、Math、Date、RegExp 等标准 API
    - 示例：复制价格后去掉 ¥ 符号并转数字 → \`vars.price = parseFloat(vars.clipboard.replace('¥', ''))\`
12. **条件分支（if/else/endif/goto）**：当录制序列中存在以下模式时，必须使用 if/else/endif 生成条件分支：
	    - 用户在不同条件下执行了不同操作
	    - 录制描述中给出了特定条件（如"遇到X则跳过"、"当Y时执行Z"、"如果A则B否则C"）
	    - 剪贴板内容或变量值可能影响后续步骤选择
	    - 循环中的边界条件（如"如果数据为空则退出"、"每N行后翻页"）

	    if/else/endif 用法：
	    - \`if\` 步骤使用 \`condition\` 字段（顶层字段，不在 params 中）。条件表达式支持：\`{{var}}\` 模板引用、\`==\` \`!=\` \`>\` \`<\` \`>=\` \`<=\` 比较、\`and\`/\`or\`/\`not\` 逻辑运算、\`includes\`/\`not_includes\` 字符串匹配
	    - 条件示例：\`"{{index}} >= 5"\`、\`"{{clipboard}} == ''"\`、\`"{{row_count}} > 10 and {{has_more}}"\`、\`"{{title}} includes '完成'"\`
	    - \`else\` 和 \`endif\` 不需要额外参数，仅作为流程标记
	    - if/else/endif 支持嵌套
	    - \`goto\` 用于无条件跳转，使用 \`params.stepId\` 指定目标步骤的 id

	    条件分支示例：
	    \`\`\`json
	    {
	      "action": "if",
	      "description": "判断是否还有更多数据",
	      "condition": "{{has_more}} == true",
	      "params": {}
	    },
	    {
	      "action": "scroll",
	      "description": "向下滚动加载更多",
	      "params": { "direction": "down", "amount": 500 }
	    },
	    {
	      "action": "else",
	      "description": "否则跳过加载",
	      "params": {}
	    },
	    {
	      "action": "wait",
	      "description": "等待数据稳定",
	      "params": { "duration": 1000 }
	    },
	    {
	      "action": "endif",
	      "description": "条件结束",
	      "params": {}
	    }
	    \`\`\`

	13. **边界与翻页**：如果循环过程中的坐标变化趋势会导致后续迭代超出屏幕可见区域（屏幕高度 ${screenSize.height}px），应插入滚动或翻页步骤。示例：
    - 翻页：\`{"action": "hotkey", "description": "向下翻页", "params": {"key": "PageDown"}}\`
    - 滚动：\`{"action": "scroll", "description": "向下滚动", "params": {"direction": "down", "amount": 500}}\`

### 输出格式

返回纯 JSON，不要添加任何说明文字。JSON 中所有字符串值必须正确转义：
- 字符串内部的双引号必须写成 \\" （例如："描述中包含\\"引号\\"的内容"）
- 字符串内部的反斜杠必须写成 \\\\
- 字符串内部不能出现未转义的双引号，否则 JSON 解析会失败

\`\`\`json
{
  "pattern": {
    "type": "loop",
    "confidence": 0.95,
    "description": "模式描述",
    "loopVariable": "loop_index",
    "loopSource": "count",
    "count": "{{loop_count}}"
  },
  "parameters": [
    { "name": "loop_count", "type": "number", "label": "循环次数", "default": 5, "description": "总共执行多少轮" },
    { "name": "start_index", "type": "number", "label": "起始轮次", "default": 0, "description": "从第几轮开始（已执行过的轮数）" }
  ],
  "steps": [
    {
      "action": "loop_start",
      "description": "开始循环",
      "params": { "over": "{{loop_count}}", "variable": "loop_index", "startIndex": "{{start_index}}" }
    },
    {
      "action": "tool_call",
      "description": "切换到 Chrome 窗口",
      "params": { "toolName": "desktop_focus_window", "arguments": { "windowTitle": "Google Chrome" } }
    },
    {
      "action": "click",
      "description": "点击浏览器中的数据行",
      "target": {
        "coordinate": { "x": 320, "y": "{{270 + loop_index * 60}}" }
      },
      "window": "Google Chrome",
      "waitBefore": 350,
      "params": {}
    },
    {
      "action": "hotkey",
      "description": "复制",
      "params": { "key": "Ctrl+c" }
    },
    {
      "action": "scroll",
      "description": "超过一屏后向下滚动",
      "params": { "direction": "down", "amount": 500 }
    },
    {
      "action": "drag",
      "description": "拖动选择区域",
      "target": { "coordinate": { "x": 421, "y": 698 } },
      "window": "PixPin",
      "waitBefore": 500,
      "params": { "start_x": 9, "start_y": 613, "end_x": 421, "end_y": 698 }
    },
    {
      "action": "code",
      "description": "转换数据格式",
      "params": {
        "code": "vars.value = vars.clipboard.replace(/[^\\d.]/g, '')"
      }
    },
    {
      "action": "loop_end",
      "description": "结束循环"
    }
  ]
}
\`\`\`

注意：当检测到坐标规律时，coordinate 必须使用模板表达式（如 "{{150 + index * 60}}"），不要硬编码具体坐标。loop_start 的 over 字段使用数字表示循环次数。

注意：parameters 数组在大多数情况下应该为空，除非有真正需要用户每次执行时指定的变量。

注意：code 步骤仅在需要数据加工时使用，简单的复制粘贴不需要插入 code 步骤。code 必须是单行或多行合法 JS 代码字符串。
`;
}

/**
 * 构建 refine（模板微调）prompt
 */
export function buildRefinePrompt(
  currentTemplate: AutomationTemplate,
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>,
  userMessage: string,
  screenSize: { width: number; height: number },
): string {
  const templateJson = JSON.stringify({
    name: currentTemplate.name,
    description: currentTemplate.description,
    parameters: currentTemplate.parameters,
    steps: currentTemplate.steps,
  }, null, 2);

  const historyStr = conversationHistory.length > 0
    ? conversationHistory.map(m => `**${m.role === 'user' ? '用户' : 'AI'}**: ${m.content}`).join('\n\n')
    : '（无历史对话）';

  return `## 模板微调

### 当前模板

\`\`\`json
${templateJson}
\`\`\`

### 对话历史

${historyStr}

### 用户最新要求

${userMessage}

### 屏幕分辨率
${screenSize.width}x${screenSize.height}

### 任务要求

请根据用户的微调要求修改模板。规则：

1. **输出完整模板**：返回修改后的完整 JSON，不要只返回差异
2. **保持结构一致**：输出格式与输入相同（name, description, parameters, steps）
3. **坐标参数化**：如涉及坐标调整，优先使用语义定位（role+name），其次用坐标模板表达式 \`{{base + loop_index * step}}\`
4. **可用 action 类型**：click, double_click, right_click, long_press, drag, scroll, key, hotkey, type, copy, paste, wait, code, loop_start, loop_end, if, else, endif, goto, break, continue, tool_call, llm_call
5. **循环参数**：loop_start 的 over 字段用 \`{{loop_count}}\`，variable 设为 \`loop_index\`
6. **tool_call**：params.toolName 为工具名，params.arguments 为参数对象
7. **waitBefore**：保留步骤间的等待时间（ms）
8. **不要编造录制中没有的操作**：只调整用户明确要求的部分

### 输出格式

返回纯 JSON，不要添加任何说明文字：

\`\`\`json
{
  "name": "模板名称",
  "description": "模板描述",
  "parameters": [
    { "name": "param_name", "type": "number", "label": "参数标签", "default": 0, "description": "参数说明", "required": true }
  ],
  "steps": [
    {
      "action": "click",
      "description": "步骤描述",
      "target": { "coordinate": { "x": 320, "y": "{{270 + loop_index * 60}}" } },
      "waitBefore": 350,
      "params": {}
    }
  ]
}
\`\`\``;
}
