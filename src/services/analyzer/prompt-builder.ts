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
    const { getBuiltinExecutor } = require('@/skills/builtin-executor');
    const { ToolDisclosure } = require('@/skills/tool-disclosure');
    const executor = getBuiltinExecutor();
    if (!executor || executor.allTools.length === 0) return '';

    const disclosure = new ToolDisclosure({ executor });
    const menuText = disclosure.buildMenuText();
    if (!menuText) return '';

    return `
### 可用工具

以下 tools 可在步骤中使用（action="tool_call", params.toolName="工具名"）。每个工具后附一句话描述，需要完整参数时可在执行时动态加载。

${menuText}
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

1. **分析模式**：根据录制内容判断操作类型：
    - 步骤无重复、每步各不相同 → 线性模式，pattern.type 设为 "linear"
    - 相同步骤序列重复出现 ≥2 次，或坐标差值规律一致 → 循环模式，pattern.type 设为 "loop"
    - 含复制粘贴、跨窗口搬运数据 → 附加 dataFlow

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

   外部调用（调用已注册的 skill tool 或 LLM）：
   - \`tool_call\` — 调用已注册的 skill tool。params.toolName=工具名, params.arguments={参数对象}。可用的 tools 见上方"可用工具"列表
   - \`llm_call\` — 调用 LLM 执行智能判断任务。params.prompt=提示词文本, params.systemPrompt=系统提示词(可选), params.model=模型名(可选), params.multimodal=是否启用多模态(布尔值), params.include_screenshots=引用前序截图步骤ID的数组。执行时可将截图传给 LLM 做视觉分析

   **重要**：事件摘要中的 action 类型已对齐上表，直接引用即可。

3. **窗口标题、元素名称、按键**等固定值直接硬编码到 steps 中，不要抽象成参数

4. **坐标参数化**（循环模式下适用）：
   - 坐标规律检测到等差变化时，用 \`{{base + loop_index * step}}\` 表达式代替逐个硬编码坐标
   - base 取录制到的第一个坐标值，step 取差值，固定轴直接用数字
   - 线性模式下直接用录制坐标，不需要参数化
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

14. **llm_call 智能判断（可选）**：当录制操作中存在以下场景时，应自动插入 \`llm_call\` 步骤：
    - 需要 OCR 识别屏幕上的文字内容（如读取验证码、识别表格数据、提取列表项）
    - 需要视觉判断（如检测弹窗是否出现、确认页面加载完成、判断某个元素是否可见）
    - 需要基于运行时信息做智能决策（下一步做什么取决于当前看到的内容，硬编码规则无法覆盖）
    - 需要理解/总结/翻译/分类屏幕上的非结构化内容
    使用方式：先用 \`tool_call\` + \`desktop_screenshot\` 截图，再用 \`llm_call\` 分析截图。
    - params.multimodal 设为 true
    - **params.include_screenshots 必须填写截图步骤的 ID**。步骤 ID 格式为 \`"step_N"\`，其中 N 是该步骤在 steps 数组中的 0-based 索引位置（即第 1 个步骤的 id 是 step_0，第 2 个是 step_1，以此类推）。你必须根据截图步骤在 steps 数组中的实际位置来填写正确的 ID，不要使用占位文字。
    - 如果想引用当前步骤之前最近的一个 desktop_screenshot 步骤，先把它的索引找出来再填入。

### 输出格式

返回纯 JSON，不要添加任何说明文字。JSON 中所有字符串值必须正确转义：
- 字符串内部的双引号必须写成 \\" （例如："描述中包含\\"引号\\"的内容"）
- 字符串内部的反斜杠必须写成 \\\\
- 字符串内部不能出现未转义的双引号，否则 JSON 解析会失败

**示例 1：单次线性操作（无循环）**

录制：打开记事本，输入一行文字，保存。3 步，无重复。

\`\`\`json
{
  "pattern": {
    "type": "linear",
    "confidence": 0.95,
    "description": "打开记事本→输入文字→保存"
  },
  "parameters": [],
  "steps": [
    {
      "action": "hotkey",
      "description": "打开运行窗口",
      "waitBefore": 0,
      "params": { "key": "Win+r" }
    },
    {
      "action": "type",
      "description": "输入 notepad 并回车启动记事本",
      "waitBefore": 300,
      "params": { "text": "notepad\\n" }
    },
    {
      "action": "type",
      "description": "输入内容",
      "waitBefore": 500,
      "params": { "text": "测试文本" }
    },
    {
      "action": "hotkey",
      "description": "保存文件",
      "waitBefore": 200,
      "params": { "key": "Ctrl+s" }
    }
  ]
}
\`\`\`

**示例 2：循环操作（含坐标规律）**

录制：重复点击列表中的 5 行数据并复制。坐标 y 每次 +60。

\`\`\`json
{
  "pattern": {
    "type": "loop",
    "confidence": 0.95,
    "description": "循环点击列表中每行并复制",
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
      "action": "tool_call",
      "description": "截取当前屏幕",
      "params": { "toolName": "desktop_screenshot", "arguments": {} }
    },
    {
      "action": "llm_call",
      "description": "用 LLM 识别截图中的表格数据",
      "params": {
        "prompt": "识别图片中的表格数据，提取第一列的所有行文本内容，以 JSON 数组格式返回。每行的格式为 {\"text\": \"...\", \"row_index\": N}",
        "multimodal": true,
        "include_screenshots": ["step_6"]
      }
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

注意：循环模式下 coordinate 使用模板表达式（如 "{{150 + loop_index * 60}}"），线性模式下直接用具体坐标值。

注意：parameters 数组在循环模式下包含 loop_count 和 start_index；线性模式下 parameters 通常为空。

注意：code 步骤仅在需要数据加工时使用。code 是单行或多行合法 JS 代码字符串。
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
6. **tool_call**：params.toolName 为工具名，params.arguments 为参数对象。可配合 llm_call 实现截图+分析等智能判断链
7. **llm_call**：调用 LLM 做智能判断，params.prompt 为提示词，params.multimodal 开启多模态，params.include_screenshots 引用截图步骤 id 数组
8. **waitBefore**：保留步骤间的等待时间（ms）
9. **不要编造录制中没有的操作**：只调整用户明确要求的部分
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
