# 工具出参（returns）修复计划

## 背景

当前工具系统只有入参 JSON Schema（`parameters`），没有出参定义。LLM 调用工具后，结果被 `JSON.stringify(result)` 序列化为文本注入上下文，LLM 靠读 JSON 文本来猜测返回值结构。这导致 LLM 经常忽略或误用工具返回值。

## 目标

给每个工具定义加 `returns` 字段（一段描述性文本），注入到发送给 LLM 的 tool definition 中，让 LLM 在调用工具**之前**就知道返回值结构。

## 改什么

### 文件清单

| 文件 | 改动 |
|------|------|
| `src/types/skill.ts` | `ToolDefinition` 加 `returns?: string` |
| `src/skills/skill.ts` | `SkillTool` 加 `returns?: string`，`toolToOpenAI()` 把 `returns` 注入 `description` |
| `src/skills/loader.ts` | Markdown 解析器中处理 `returns` 字段 |
| `public/skills/desktop_screen.md` | 22 个工具加 `returns` |
| `public/skills/desktop_uia.md` | 6 个工具加 `returns` |
| `public/skills/web_screen.md` | 8 个工具加 `returns` |
| `public/skills/office_doc.md` | 4 个工具加 `returns` |
| `public/skills/app_builder.md` | 7 个工具加 `returns` |
| `public/skills/code_tools.md` | 10 个工具加 `returns` |
| `public/skills/phone_screen.md` | 视情况加 `returns` |

### Step 1: 类型定义

**文件: `src/types/skill.ts`**

在 `ToolDefinition` 接口中添加 `returns` 字段：

```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  returns?: string;           // ← 新增：返回值描述文本
  nameCn?: string;
  descriptionCn?: string;
}
```

**文件: `src/skills/skill.ts`**

在 `SkillTool` 接口中添加 `returns` 字段：

```typescript
export interface SkillTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  returns?: string;           // ← 新增
  nameCn?: string;
  descriptionCn?: string;
}
```

修改 `toolToOpenAI()` 函数，把 `returns` 注入到 LLM 可见的 `description` 中：

```typescript
export function toolToOpenAI(tool: SkillTool): Record<string, unknown> {
  const desc = tool.returns
    ? `${tool.description}\n\nReturn value: ${tool.returns}`
    : tool.description;
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: desc,
      parameters: tool.parameters,
    },
  };
}
```

### Step 2: Markdown 加载器

**文件: `src/skills/loader.ts`**

第 65-71 行，手动映射了工具字段。需要加 `returns` 映射：

```typescript
tools = list.map((t: Record<string, unknown>) => ({
  name: t['name'] as string,
  description: t['description'] as string,
  parameters: (t['parameters'] as Record<string, unknown>) ?? {},
  returns: (t['returns'] as string) || undefined,    // ← 新增这一行
  nameCn: (t['name_cn'] as string) || undefined,
  descriptionCn: (t['description_cn'] as string) || undefined,
}));
```

### Step 3: 工具定义补充 `returns`

以下列出所有工具及其返回值结构。每个 `.md` 文件的 tools JSON 数组中，给每个对象加 `"returns": "..."`。

---

#### `public/skills/desktop_screen.md` — 22 个工具

```json
"returns": "{\"image_data\":\"base64 string\",\"format\":\"bmp\",\"hwnd\":\"(if window mode) window handle number\"}"
```

```json
"returns": "{\"windows\":[{\"hwnd\":number,\"title\":\"string\",\"x\":number,\"y\":number,\"width\":number,\"height\":number}],\"count\":number}"
```

```json
"returns": "{\"success\":true/false,\"hwnd\":number,\"windowTitle\":\"string (matched window title)\"}"
```

```json
"returns": "{\"success\":true/false,\"hwnd\":number}"
```

```json
"returns": "{\"success\":true/false,\"hwnd\":number}"
```

```json
"returns": "{\"success\":true/false,\"hwnd\":number}"
```

```json
"returns": "{\"success\":true/false,\"hwnd\":number,\"width\":number,\"height\":number}"
```

```json
"returns": "{\"text\":\"clipboard text content (string)\"}"
```

```json
"returns": "{\"success\":true,\"text\":\"the text that was set\"}"
```

```json
"returns": "{\"texts\":[{\"text\":\"recognized text\",\"bbox\":{\"left\":number,\"top\":number,\"width\":number,\"height\":number},\"confidence\":number}],\"raw\":\"full OCR result\"}"
```

```json
"returns": "{\"action\":\"desktop_click\",\"x\":number,\"y\":number,\"button\":\"left/right/middle\",\"clicks\":1/2,\"note\":\"execution note\",\"region_screenshot\":\"base64 data URL of 150x150 area around click point\"}"
```

```json
"returns": "{\"action\":\"desktop_drag\",\"from\":{\"x\":number,\"y\":number},\"to\":{\"x\":number,\"y\":number},\"note\":\"Drag completed\",\"region_screenshot\":\"base64 data URL\"}"
```

```json
"returns": "{\"action\":\"desktop_move_cursor\",\"path\":\"the SVG path used\",\"waypoints\":number,\"durationMs\":number}"
```

```json
"returns": "{\"action\":\"desktop_type\",\"text\":\"the text typed\",\"note\":\"Type executed\"}"
```

```json
"returns": "{\"action\":\"desktop_press_key\",\"key\":\"the key/combo pressed\",\"note\":\"Key press simulated\"}"
```

```json
"returns": "{\"action\":\"desktop_key_down\",\"x\":number,\"y\":number,\"button\":\"the button held\"}"
```

```json
"returns": "{\"action\":\"desktop_key_up\",\"x\":number,\"y\":number,\"button\":\"the button released\"}"
```

```json
"returns": "{\"action\":\"desktop_scroll\",\"x\":number,\"y\":number,\"delta\":number}"
```

```json
"returns": "{\"action\":\"desktop_wait\",\"milliseconds\":number,\"note\":\"Wait completed\"}"
```

```json
"returns": "{\"action\":\"desktop_done\",\"message\":\"the completion message\"}"
```

```json
"returns": "{\"apps\":[{\"name\":\"app name\",\"path\":\"executable path\",\"icon\":\"base64\"}],\"count\":number}"
```

```json
"returns": "{\"action\":\"desktop_open_app\",\"name\":\"app name or alias used\",\"success\":true/false,\"hwnd\":number (window handle if launched/found)}"
```

---

#### `public/skills/desktop_uia.md` — 6 个工具

```json
"returns": "{\"nodes\":[{\"role\":\"Button/Edit/List/...\",\"name\":\"element display name\",\"bounds\":{\"left\":number,\"top\":number,\"width\":number,\"height\":number},\"aid\":\"automation id (optional)\"}],\"count\":number,\"window_hwnd\":number}"
```

```json
"returns": "{\"success\":true/false,\"element\":{\"role\":\"...\",\"name\":\"...\",\"bounds\":{...}},\"message\":\"execution result\"}"
```

```json
"returns": "{\"success\":true/false,\"message\":\"typed text info\"}"
```

```json
"returns": "{\"success\":true/false,\"element\":{\"role\":\"...\",\"name\":\"...\",\"bounds\":{\"left\":number,\"top\":number,\"width\":number,\"height\":number},\"isEnabled\":true/false,\"controlType\":number},\"message\":\"\"}"
```

```json
"returns": "{\"success\":true/false,\"property\":\"the property name\",\"value\":\"the property value\",\"element\":{\"role\":\"...\",\"name\":\"...\"}}"
```

```json
"returns": "{\"fingerprint\":\"compact UI tree structure string\",\"nodeCount\":number,\"depth\":number}"
```

---

#### `public/skills/web_screen.md` — 8 个工具

```json
"returns": "{\"success\":true/false,\"browser\":\"chrome/msedge/...\",\"connected\":true/false,\"message\":\"status description\",\"debugPort\":number (if available)}"
```

```json
"returns": "{\"success\":true/false,\"url\":\"current page URL\",\"title\":\"page title\"}"
```

```json
"returns": "{\"nodes\":[{\"role\":\"button/textbox/link/...\",\"name\":\"accessible name\",\"selector\":\"CSS selector\",\"clickable\":true/false}],\"interactiveCount\":number}"
```

```json
"returns": "{\"success\":true/false,\"info\":\"click result info\"}"
```

```json
"returns": "{\"success\":true/false,\"info\":\"fill result info\"}"
```

```json
"returns": "{\"success\":true/false,\"message\":\"closed\"}"
```

```json
"returns": "{\"action\":\"wait\",\"durationMs\":number}"
```

```json
"returns": "{\"action\":\"done\",\"message\":\"task summary\"}"
```

```json
"returns": "{\"success\":true/false,\"output\":\"stdout text\",\"result\":\"returned value\",\"error\":\"error message if failed\"}"
```

---

#### `public/skills/office_doc.md` — 4 个工具

```json
"returns": "{\"path\":\"saved file path\",\"size\":number,\"format\":\"docx/xlsx/pptx\"} or {\"filename\":\"downloaded filename\",\"size\":number,\"format\":\"docx/xlsx/pptx\"}"
```

```json
"returns": "{\"available_apps\":{\"word\":{\"available\":true/false,\"documents\":[{\"name\":\"title\",\"path\":\"full path\",\"paragraphs\":number,\"pages\":number}]},\"excel\":{\"available\":true/false,\"workbooks\":[{\"name\":\"title\",\"path\":\"full path\",\"sheets\":[{\"name\":\"sheet name\",\"rows\":number,\"columns\":number}]}]},\"ppt\":{\"available\":true/false,\"presentations\":[{\"name\":\"title\",\"path\":\"full path\",\"slides\":number}]}}}"
```

```json
"returns": "For Word: {\"title\":\"doc title\",\"paragraphs\":[{\"index\":number,\"text\":\"paragraph text\"}],\"total_paragraphs\":number}. For Excel: {\"sheets\":[{\"name\":\"sheet name\",\"rows\":[[\"cell value\"]],\"range\":\"A1:Z99\"}],\"total_rows\":number}. For PPT: {\"slides\":[{\"index\":number,\"title\":\"slide title\",\"shapes\":[{\"name\":\"shape name\",\"text\":\"shape text\",\"type\":\"shape type\"}]}],\"total_slides\":number}"
```

```json
"returns": "{\"success\":true/false,\"message\":\"operation result description\",\"details\":{...}}"
```

---

#### `public/skills/app_builder.md` — 7 个工具

```json
"returns": "{\"id\":\"app-uuid\",\"name\":\"app name\",\"description\":\"description\",\"code\":\"HTML source\",\"created_at\":\"ISO timestamp\"}"
```

```json
"returns": "{\"id\":\"project-uuid\",\"name\":\"project name\",\"description\":\"description\",\"files\":{\"filename\":\"content\"},\"entry_file\":\"index.html\",\"created_at\":\"ISO timestamp\"}"
```

```json
"returns": "{\"apps\":[{\"id\":\"uuid\",\"name\":\"app name\",\"description\":\"description\",\"project_type\":\"single/multi\",\"entry_file\":\"index.html\",\"created_at\":\"ISO timestamp\"}],\"count\":number}"
```

```json
"returns": "{\"id\":\"uuid\",\"name\":\"app name\",\"description\":\"description\",\"code\":\"full HTML source\",\"project_type\":\"single/multi\",\"files\":{...},\"entry_file\":\"index.html\",\"created_at\":\"ISO timestamp\"}"
```

```json
"returns": "{\"id\":\"uuid\",\"name\":\"app name\",\"description\":\"description\",\"code\":\"updated HTML source\",\"project_type\":\"single/multi\",\"updated_at\":\"ISO timestamp\"}"
```

```json
"returns": "{\"success\":true,\"id\":\"deleted app id\",\"message\":\"deletion confirmation\"}"
```

```json
"returns": "{\"success\":true,\"id\":\"deleted project id\",\"message\":\"deletion confirmation\"}"
```

---

#### `public/skills/code_tools.md` — 10 个工具

```json
"returns": "{\"code\":\"generated source code\",\"allBlocks\":[\"individual code blocks\"],\"language\":\"the language used\",\"files\":{\"filepath\":\"content\"} (for multi-file generation),\"app_id\":\"uuid (if HTML auto-saved)\"}"
```

```json
"returns": "{\"success\":true/false,\"output\":\"stdout/stderr text\",\"result\":\"return value\",\"error\":\"error if failed\",\"duration_ms\":number}"
```

```json
"returns": "{\"success\":true/false,\"iterations\":number,\"final_code\":\"the fixed code after all iterations\",\"all_iterations\":[{\"iteration\":number,\"code\":\"code at this iteration\",\"success\":true/false,\"output\":\"execution output\",\"error\":\"error if any\"}]}"
```

```json
"returns": "{\"path\":\"absolute file path\",\"content\":\"file content string\",\"line_count\":number}"
```

```json
"returns": "{\"path\":\"absolute file path\",\"written\":true,\"size\":number (bytes written)}"
```

```json
"returns": "{\"files\":[{\"path\":\"matched file path\",\"matches\":[{\"line\":number,\"content\":\"matching line text\"}]}],\"total_matches\":number}"
```

```json
"returns": "{\"stdout\":\"command output\",\"stderr\":\"error output\",\"exit_code\":number}"
```

```json
"returns": "{\"results\":[{\"title\":\"page title\",\"url\":\"page URL\",\"snippet\":\"text snippet\"}],\"query\":\"the search query\"}"
```

```json
"returns": "{\"url\":\"the fetched URL\",\"content\":\"extracted text content (truncated to 50000 chars)\",\"title\":\"page title\",\"content_length\":number}"
```

```json
"returns": "{\"code_id\":\"uuid\",\"name\":\"code name\",\"language\":\"language\",\"tags\":[\"tag1\"]}"
```

```json
"returns": "{\"messages\":\"formatted chat history text\",\"total\":number}"
```

---

## 实现顺序

1. 改 `src/types/skill.ts` — 加 `returns?: string`
2. 改 `src/skills/skill.ts` — 加 `returns?: string` 到 `SkillTool`，修改 `toolToOpenAI()`
3. 检查 `src/skills/loader.ts` — 确保 `returns` 字段从 JSON 传递到 SkillTool
4. 逐个编辑 `public/skills/*.md` — 每个工具加 `returns` 行
5. 在 `toolToOpenAI` 中把 `returns` 注入 `description`，格式为 `"{原描述}\n\nReturn value: {returns JSON 描述}"`

## 不改什么

- 不添加 JSON Schema 输出验证
- 不改 `SkillResult` 类型
- 不改 `chat-service.ts` / `runner.ts` 的执行/序列化逻辑
- 不改 `desktop_service.ts` 等底层服务
