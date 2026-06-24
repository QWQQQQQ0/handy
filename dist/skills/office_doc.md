---
id: office_doc
name: Office Document
name_cn: 办公文档
category: Document
category_cn: 文档
description: Generate, read, and edit Word, Excel, and PowerPoint documents. Supports creating new files from Markdown/structured data and real-time editing of open documents via COM automation.
description_cn: 生成、读取和编辑 Word、Excel、PowerPoint 文档。支持从 Markdown/结构化数据创建新文件，以及通过 COM 自动化实时编辑已打开的文档。
usage: |
  ## Quick Start

  ### Generate Documents
  Use `generate_doc` with `type` to create Word, Excel, or PPT:
  ```
  generate_doc({type: "word", title: "报告", content: "## 第一章\n\n内容..."})
  generate_doc({type: "excel", title: "报表", sheets: [{name: "数据", headers: ["A","B"], rows: [[1,2]]}]})
  generate_doc({type: "ppt", title: "介绍", markdown: "## 背景\n\n要点"})
  ```

  ### Detect & Edit Open Documents
  Use `office_detect` → `com_edit(open)` → `com_read` → `com_edit`:
  ```
  office_detect()  // → {word: {available: true, ...}, excel: {...}, ppt: {...}}
  com_edit({app: "word", operation: "open", file_path: "C:/path/to/doc.docx"})
  com_read({app: "word", paragraph_start: 0, paragraph_end: 5})
  com_edit({app: "word", operation: "replace", find: "旧内容", replace: "新内容"})
  com_edit({app: "excel", operation: "open", file_path: "C:/path/to/data.xlsx"})
  com_read({app: "excel", range: "A1:G10"})
  com_edit({app: "excel", operation: "auto_fill", column: "G", formula_template: "=SUM(B{row}:F{row})", start_row: 2, end_row: 10})
  com_edit({app: "ppt", operation: "open", file_path: "C:/path/to/slides.pptx"})
  com_read({app: "ppt", slide_index: 0, slide_info: true})
  com_edit({app: "ppt", operation: "set_text", slide_index: 0, shape_name: "Title 1", text: "新标题"})
  ```

  ### Advanced: Code Execution
  Use `code_exec` ONLY for operations requiring programming logic (loops, conditionals, calculations).
  If a task needs understanding/reasoning (translate, summarize, classify, generate content...), do it step by step:
  1. `com_read` → get the data
  2. You (LLM) process the data with your own intelligence
  3. `com_edit` → write results back

  Use `code_exec` for complex operations that predefined tools can't handle:
  ```
  // Detect open documents
  code_exec({code: "result = detect_documents()"})

  // Generate Excel file (auto-download)
  code_exec({code: "result = generate_excel('Report', [{'name': 'Data', 'headers': ['A','B'], 'rows': [[1,2]]}])"})

  // COM: list all sheets
  code_exec({code: "wb = get_excel_app()._get_wb()\nresult = [wb.Worksheets(i+1).Name for i in range(wb.Worksheets.Count)]"})

  // COM: read range from specific sheet
  code_exec({code: "result = read_range('A1:G10', sheet='Sheet2')"})

  // openpyxl: create workbook offline
  code_exec({code: "from openpyxl import Workbook\nwb = Workbook()\nws = wb.active\nws['A1'] = 'Name'\nws['B1'] = 42\nwb.save('C:/output.xlsx')\nresult = 'saved'"})

  // python-docx: create Word document
  code_exec({code: "from docx import Document\ndoc = Document()\ndoc.add_heading('Title', 1)\ndoc.add_paragraph('Content')\ndoc.save('C:/output.docx')\nresult = 'saved'"})
  ```
usage_cn: |
  ## 快速开始

  ### 生成文档
  使用 `generate_doc` 配合 `type` 创建 Word、Excel 或 PPT：
  ```
  generate_doc({type: "word", title: "报告", content: "## 第一章\n\n内容..."})
  generate_doc({type: "excel", title: "报表", sheets: [{name: "数据", headers: ["A","B"], rows: [[1,2]]}]})
  generate_doc({type: "ppt", title: "介绍", markdown: "## 背景\n\n要点"})
  ```

  ### 检测并编辑已打开的文档
  使用 `office_detect` → `com_edit(open)` → `com_read` → `com_edit`：
  ```
  office_detect()  // → {word: {available: true, ...}, excel: {...}, ppt: {...}}
  com_edit({app: "word", operation: "open", file_path: "C:/path/to/doc.docx"})
  com_read({app: "word", paragraph_start: 0, paragraph_end: 5})
  com_edit({app: "word", operation: "replace", find: "旧内容", replace: "新内容"})
  com_edit({app: "excel", operation: "open", file_path: "C:/path/to/data.xlsx"})
  com_read({app: "excel", range: "A1:G10"})
  com_edit({app: "excel", operation: "auto_fill", column: "G", formula_template: "=SUM(B{row}:F{row})", start_row: 2, end_row: 10})
  com_edit({app: "ppt", operation: "open", file_path: "C:/path/to/slides.pptx"})
  com_read({app: "ppt", slide_index: 0, slide_info: true})
  com_edit({app: "ppt", operation: "set_text", slide_index: 0, shape_name: "Title 1", text: "新标题"})
  ```

  ### 高级：代码执行
  `code_exec` 仅用于需要编程逻辑的操作（循环、条件、计算）。
  如果任务需要理解/推理（翻译、总结、分类、内容生成……），请分步完成：
  1. `com_read` → 读取数据
  2. 你（LLM）用自己的智能处理数据
  3. `com_edit` → 写回结果

  使用 `code_exec` 处理预定义工具无法完成的复杂操作：
  ```
  // 检测已打开的文档
  code_exec({code: "result = detect_documents()"})

  // 生成 Excel 文件（自动下载）
  code_exec({code: "result = generate_excel('报表', [{'name': '数据', 'headers': ['A','B'], 'rows': [[1,2]]}])"})

  // COM：列出所有 sheet
  code_exec({code: "wb = get_excel_app()._get_wb()\nresult = [wb.Worksheets(i+1).Name for i in range(wb.Worksheets.Count)]"})

  // COM：读取指定 sheet 的范围
  code_exec({code: "result = read_range('A1:G10', sheet='Sheet2')"})

  // openpyxl：离线创建复杂 Excel
  code_exec({code: "from openpyxl import Workbook\nwb = Workbook()\nws = wb.active\nws['A1'] = '名称'\nws['B1'] = 42\nwb.save('C:/output.xlsx')\nresult = 'saved'"})

  // python-docx：创建 Word 文档
  code_exec({code: "from docx import Document\ndoc = Document()\ndoc.add_heading('标题', 1)\ndoc.add_paragraph('内容')\ndoc.save('C:/output.docx')\nresult = 'saved'"})
  ```
---

Generate, read, and edit Word, Excel, and PowerPoint documents.

## Tools

```json
[
  {
    "name": "generate_doc",
    "description": "Generate a new Word (.docx), Excel (.xlsx), or PPT (.pptx) document and download it.",
    "name_cn": "生成文档",
    "description_cn": "生成新的 Word (.docx)、Excel (.xlsx) 或 PPT (.pptx) 文档并下载。",
    "parameters": {
      "type": "object",
      "properties": {
        "type": {
          "type": "string",
          "description": "Document type",
          "enum": ["word", "excel", "ppt"]
        },
        "title": {
          "type": "string",
          "description": "Document title (used as filename)"
        },
        "content": {
          "type": "string",
          "description": "Markdown content for Word body (type=word only)"
        },
        "subtitle": {
          "type": "string",
          "description": "Optional subtitle (type=word only)"
        },
        "sheets": {
          "type": "array",
          "description": "Sheet definitions (type=excel only). Each: {name, headers: [str], rows: [[values]]}",
          "items": {
            "type": "object",
            "properties": {
              "name": { "type": "string" },
              "headers": { "type": "array", "items": { "type": "string" } },
              "rows": { "type": "array", "items": { "type": "array", "items": {} } }
            },
            "required": ["name", "headers", "rows"]
          }
        },
        "slides": {
          "type": "array",
          "description": "Slide definitions (type=ppt only, use this OR markdown). Each: {title, content?, layout?: 'title'|'content'|'two_column'}",
          "items": {
            "type": "object",
            "properties": {
              "title": { "type": "string" },
              "content": { "type": "string" },
              "layout": { "type": "string", "enum": ["title", "content", "two_column"] }
            },
            "required": ["title"]
          }
        },
        "markdown": {
          "type": "string",
          "description": "Markdown for PPT (type=ppt only, use this OR slides). ## headings become slides."
        },
        "author": {
          "type": "string",
          "description": "Optional author name"
        }
      },
      "required": ["type", "title"]
    },
    "returns": "{\"path\":\"saved file path\",\"size\":number,\"format\":\"docx/xlsx/pptx\"} or {\"filename\":\"downloaded filename\",\"size\":number,\"format\":\"docx/xlsx/pptx\"}"
  },
  {
    "name": "office_detect",
    "description": "Detect Office/WPS COM availability. Reports what documents are open in WPS/Office windows. Use before com_read/com_edit. To see the user's screen (selected cells, visible content), use desktop_screenshot to capture the WPS window — COM's internal state (get_selection) does NOT reflect what the user sees on screen.",
    "name_cn": "检测Office文档",
    "description_cn": "检测桌面上当前打开的 Word、Excel 和 PowerPoint 文档。在使用 com_read/com_edit 前先调用此工具。要查看用户的屏幕内容（如选中的单元格），请使用 desktop_screenshot 截取 WPS 窗口——COM 的内部状态不反映用户屏幕上的实际选中区域。",
    "parameters": {
      "type": "object",
      "properties": {},
      "required": []
    },
    "returns": "{\"available_apps\":{\"word\":{\"available\":true/false,\"documents\":[{\"name\":\"title\",\"path\":\"full path\",\"paragraphs\":number,\"pages\":number}]},\"excel\":{\"available\":true/false,\"workbooks\":[{\"name\":\"title\",\"path\":\"full path\",\"sheets\":[{\"name\":\"sheet name\",\"rows\":number,\"columns\":number}]}]},\"ppt\":{\"available\":true/false,\"presentations\":[{\"name\":\"title\",\"path\":\"full path\",\"slides\":number}]}}"
  },
  {
    "name": "com_read",
    "description": "Read content from an active Word, Excel, or PowerPoint document via COM automation. The file stays open. Word: returns paragraphs with style. Excel: returns cell values. PPT: returns slide texts and shapes. IMPORTANT for WPS: COM runs in a separate background process — get_selection returns the COM server's internal selection, NOT what the user sees in WPS UI. To see the user's actual screen, use desktop_screenshot first, then call com_read with the specific range you see in the screenshot.",
    "name_cn": "读取文档内容",
    "description_cn": "通过 COM 自动化读取活动的 Word、Excel 或 PowerPoint 文档内容。文件保持打开状态。Word 返回段落和样式，Excel 返回单元格值，PPT 返回幻灯片文本和形状。【WPS 重要提示】COM 是独立后台进程，get_selection 返回的是 COM 服务器的选中状态，不是用户在 WPS 界面中看到的选中区域。要查看用户实际选中的单元格，请先用 desktop_screenshot 截图，再从截图中识别范围后用 com_read 读取。",
    "parameters": {
      "type": "object",
      "properties": {
        "app": {
          "type": "string",
          "description": "Which application to read from",
          "enum": ["word", "excel", "ppt"]
        },
        "paragraph_start": { "type": "number", "description": "[Word] 0-based start paragraph index. Default: 0" },
        "paragraph_end": { "type": "number", "description": "[Word] 0-based end paragraph index (exclusive). Default: all" },
        "range": { "type": "string", "description": "[Excel] Range notation, e.g. 'A1:G10'. Required unless using get_selection or sheet_info." },
        "sheet": { "type": "string", "[Excel] description": "Sheet name. Default: active sheet" },
        "get_selection": { "type": "boolean", "description": "[Excel] Read user's current selection" },
        "sheet_info": { "type": "boolean", "description": "[Excel] Get sheet dimensions and used range" },
        "slide_start": { "type": "number", "description": "[PPT] 0-based start slide index. Default: 0" },
        "slide_end": { "type": "number", "description": "[PPT] 0-based end slide index (exclusive). Default: all" },
        "slide_index": { "type": "number", "description": "[PPT] Read a single slide with shape details" },
        "slide_info": { "type": "boolean", "description": "[PPT] Read detailed shape info for slide_index" },
        "find_text": { "type": "boolean", "description": "[PPT] Find all text-containing shapes" }
      },
      "required": ["app"]
    },
    "returns": "For Word: {\"title\":\"doc title\",\"paragraphs\":[{\"index\":number,\"text\":\"paragraph text\"}],\"total_paragraphs\":number}. For Excel: {\"sheets\":[{\"name\":\"sheet name\",\"rows\":[[\"cell value\"]],\"range\":\"A1:Z99\"}],\"total_rows\":number}. For PPT: {\"slides\":[{\"index\":number,\"title\":\"slide title\",\"shapes\":[{\"name\":\"shape name\",\"text\":\"shape text\",\"type\":\"shape type\"}]}],\"total_slides\":number}"
  },
  {
    "name": "com_edit",
    "description": "Edit an active Word, Excel, or PowerPoint document via COM automation. The file stays open and changes are visible immediately.",
    "name_cn": "编辑文档",
    "description_cn": "通过 COM 自动化编辑活动的 Word、Excel 或 PowerPoint 文档。文件保持打开，修改立即可见。",
    "parameters": {
      "type": "object",
      "properties": {
        "app": {
          "type": "string",
          "description": "Which application to edit",
          "enum": ["word", "excel", "ppt"]
        },
        "operation": {
          "type": "string",
          "description": "Edit operation. ALL: open (open file by path). Word: replace, set_paragraph, insert, insert_heading, delete, format, get_selection. Excel: write, formula, auto_fill, set_value, format, insert_rows, insert_columns. PPT: set_text, add_slide, delete_slide, reorder."
        },
        "file_path": { "type": "string", "description": "[ALL:open] Absolute path to the document file (.docx/.xlsx/.pptx). Required for 'open' operation." },
        "find": { "type": "string", "description": "[Word:replace] Text to find" },
        "replace": { "type": "string", "description": "[Word:replace] Replacement text" },
        "paragraph_index": { "type": "number", "description": "[Word] 0-based paragraph index (for set_paragraph/delete/format)" },
        "text": { "type": "string", "description": "[Word/PPT] New text content" },
        "after_paragraph": { "type": "number", "description": "[Word:insert/insert_heading] Insert after this 0-based paragraph index" },
        "level": { "type": "number", "description": "[Word:insert_heading] Heading level 1-9. Default: 1" },
        "bold": { "type": "boolean", "description": "[Word:format] Set bold" },
        "italic": { "type": "boolean", "description": "[Word:format] Set italic" },
        "font_size": { "type": "number", "description": "[Word:format] Font size in points" },
        "range": { "type": "string", "description": "[Excel:write] Target range, e.g. 'G2:G10'" },
        "values": { "type": "array", "description": "[Excel:write] 2D array of values", "items": { "type": "array", "items": {} } },
        "cell": { "type": "string", "description": "[Excel:formula/set_value] Cell address, e.g. 'G2'" },
        "formula": { "type": "string", "description": "[Excel:formula] Formula, e.g. '=SUM(B2:F2)'" },
        "formula_template": { "type": "string", "description": "[Excel:auto_fill] Formula with {row} placeholder, e.g. '=SUM(B{row}:F{row})'" },
        "column": { "type": "string", "description": "[Excel:auto_fill/format] Column letter, e.g. 'G'" },
        "start_row": { "type": "number", "description": "[Excel:auto_fill] First data row (1-based)" },
        "end_row": { "type": "number", "description": "[Excel:auto_fill] Last data row (inclusive, 1-based)" },
        "value": { "description": "[Excel:set_value] Value to set" },
        "number_format": { "type": "string", "description": "[Excel:format] Number format, e.g. '#,##0.00'" },
        "bold_header": { "type": "boolean", "description": "[Excel:format] Bold the header row" },
        "after_row": { "type": "number", "description": "[Excel:insert_rows] Insert after this row (1-based)" },
        "after_col": { "type": "number", "description": "[Excel:insert_columns] Insert after this column (1=A, 2=B, ...)" },
        "count": { "type": "number", "description": "[Excel] Number of rows/columns to insert. Default: 1" },
        "sheet": { "type": "string", "description": "[Excel] Sheet name. Default: active sheet" },
        "slide_index": { "type": "number", "description": "[PPT] 0-based slide index" },
        "shape_name": { "type": "string", "description": "[PPT:set_text] Shape name, e.g. 'Title 1'. Use com_read with slide_info=true to find names." },
        "layout_index": { "type": "number", "description": "[PPT:add_slide] Layout index (1=Title, 2=Title+Content). Default: 1" },
        "title": { "type": "string", "description": "[PPT:add_slide] Title text" },
        "content": { "type": "string", "description": "[PPT:add_slide] Body text" },
        "after_slide": { "type": "number", "description": "[PPT:add_slide] Insert after this 0-based slide index" },
        "new_order": { "type": "array", "description": "[PPT:reorder] New slide order as 0-based indices, e.g. [2,0,1]", "items": { "type": "number" } }
      },
      "required": ["app", "operation"]
    },
    "returns": "{\"success\":true/false,\"message\":\"operation result description\",\"details\":{...}}"
  },
  {
    "name": "doc_code_exec",
    "description": "Execute Python 3.14 code to handle document operations that require PROGRAMMING LOGIC (loops, conditionals, calculations, data transformation). For simple read/write, prefer com_read/com_edit directly.\n\n## ⚠️ CRITICAL: Step-by-step for intelligent tasks\nIf a task requires UNDERSTANDING or REASONING (e.g. translate content, summarize text, classify data, generate descriptions, analyze and interpret), do NOT try to embed that logic in code. Instead:\n1. Use `com_read` to read the source data\n2. Process the data yourself — you are the LLM, use your intelligence\n3. Use `com_edit` to write the processed results back\n\nTrying to hardcode intelligence in Python code (mapping tables, regex rules, template fills) produces poor results. The LLM itself is the best processor for these tasks.\n\n## When to use code_exec vs com_read/com_edit\n- **Use com_read/com_edit** for: read range, write range, replace text, set formula, format cells, open/save\n- **Use code_exec** for: complex loops, conditional logic, multi-step data processing, calculations that can't be expressed as a formula\n\n## How to write code\n- Set a variable named `result` to return data to the LLM. Must be JSON-serializable (dict, list, str, number, None).\n- Use `print()` for debug output (shown separately from result).\n- Code runs in a thread with timeout (default 60s).\n- File paths: use absolute paths with forward slashes (e.g. `C:/Users/Desktop/file.xlsx`).\n\n## Available dependencies (pre-imported)\n\n### openpyxl 3.1.5 — Excel .xlsx read/write\n`from openpyxl import Workbook, load_workbook`\n`from openpyxl.styles import Font, Alignment, PatternFill, Border, Side`\n- Workbook(): create new workbook\n- load_workbook(path): open existing .xlsx\n- ws = wb.active / wb['sheetname'] / wb.worksheets[index]\n- ws['A1'].value, ws.cell(row, col).value\n- ws.max_row, ws.max_column, ws.title\n- wb.save(path)\n\n### python-docx 1.2.0 — Word .docx read/write\n`from docx import Document`\n- Document(): create new / Document(path): open existing\n- doc.add_heading(text, level), doc.add_paragraph(text)\n- doc.paragraphs, doc.tables\n- doc.save(path)\n\n### python-pptx 1.0.2 — PowerPoint .pptx read/write\n`from pptx import Presentation`\n- Presentation(): create new / Presentation(path): open existing\n- prs.slides, slide.shapes, shape.text_frame\n- prs.slides.add_slide(prs.slide_layouts[index])\n- prs.save(path)\n\n### COM automation (pywin32) — live edit open documents\nPre-injected convenience functions:\n- get_excel_app() → ExcelCOM instance (connects to user's open Excel/WPS)\n- get_word_app() → WordCOM instance\n- get_ppt_app() → PptCOM instance\n- read_range(addr, sheet=None, file_path=None) → shortcut for ExcelCOM.read_range\n- save_workbook() → shortcut for ExcelCOM.save
- save_document() → shortcut for WordCOM.save
- save_presentation() → shortcut for PptCOM.save\n- detect_documents() → detect open Office/WPS documents (replaces office_detect)\n- generate_excel(title, sheets, save_path?, author?) → generate .xlsx file (replaces generate_doc)\n- generate_word(title, content, save_path?, subtitle?, author?) → generate .docx file\n- generate_ppt(title, slides?, markdown?, save_path?, author?) → generate .pptx file\n\nCOM instance methods:\n- app._get_wb() → active workbook COM object\n- app._get_sheet(name) → worksheet COM object\n- app.read_range(addr, sheet, file_path)\n- app.write_range(addr, values, sheet)\n- app.set_formula(cell, formula, sheet)\n- app.get_sheet_info(sheet, file_path)\n- app.open(file_path), app.save(), app.sync()\n\nExcel COM object attributes (via _get_wb()):\n- wb.Worksheets.Count, wb.Worksheets(i)\n- wb.ActiveSheet, wb.Name, wb.FullName\n- ws.UsedRange, ws.Range(addr), ws.Cells(row, col)\n\n### Also available (Python stdlib)\njson, os, sys, re, math, datetime, collections, itertools, functools, copy, csv, io, pathlib, base64, hashlib, textwrap, typing, enum, decimal, fractions, statistics, uuid, time, threading, traceback\n\n## Code template\n```python\n# Access open Excel via COM\napp = get_excel_app()\nwb = app._get_wb()\nws = wb.ActiveSheet\n# ... do work ...\nresult = {'status': 'done', 'data': [...]}  # ← this is returned\n```",
    "name_cn": "执行文档代码",
    "description_cn": "执行 Python 3.14 代码处理需要编程逻辑的文档操作（循环、条件判断、计算、数据转换）。简单读写请直接用 com_read/com_edit。\n\n## ⚠️ 关键原则：需要理解/推理的任务必须分步执行\n如果任务需要「理解」或「推理」（如翻译内容、总结文本、分类数据、生成描述、分析解读），不要试图在代码里实现这些逻辑！正确做法：\n1. 用 `com_read` 读取源数据\n2. 你自己处理数据——你就是 LLM，用你的智能\n3. 用 `com_edit` 写回处理结果\n\n试图在 Python 代码里硬编码智能逻辑（映射表、正则规则、模板填充），效果会很差。LLM 本身就是这类任务的最佳处理器。\n\n## 什么时候用 code_exec vs com_read/com_edit\n- **用 com_read/com_edit**：读取范围、写入范围、替换文本、设置公式、格式化、打开/保存\n- **用 code_exec**：复杂循环、条件逻辑、多步数据处理、无法用公式表达的计算\n\n## 代码写法\n- 设置 `result` 变量返回数据给 LLM，必须是 JSON 可序列化类型（dict/list/str/number/None）。\n- 用 `print()` 输出调试信息（与 result 分开显示）。\n- 代码在线程中运行，有超时限制（默认 60 秒）。\n- 文件路径用绝对路径 + 正斜杠（如 `C:/Users/Desktop/file.xlsx`）。\n\n## 可用依赖（已预导入）\n\n### openpyxl 3.1.5 — Excel .xlsx 读写\n`from openpyxl import Workbook, load_workbook`\n`from openpyxl.styles import Font, Alignment, PatternFill, Border, Side`\n\n### python-docx 1.2.0 — Word .docx 读写\n`from docx import Document`\n\n### python-pptx 1.0.2 — PowerPoint .pptx 读写\n`from pptx import Presentation`\n\n### COM 自动化（pywin32）— 实时编辑已打开的文档\n预注入便捷函数：\n- get_excel_app() → ExcelCOM 实例（连接用户已打开的 Excel/WPS）\n- get_word_app() → WordCOM 实例\n- get_ppt_app() → PptCOM 实例\n- read_range(addr, sheet?, file_path?) → ExcelCOM.read_range 快捷调用\n- save_workbook() → ExcelCOM.save 快捷调用
- save_document() → WordCOM.save 快捷调用
- save_presentation() → PptCOM.save 快捷调用\n- detect_documents() → 检测已打开的 Office/WPS 文档（替代 office_detect）\n- generate_excel(title, sheets, save_path?, author?) → 生成 .xlsx 文件（替代 generate_doc）\n- generate_word(title, content, save_path?, subtitle?, author?) → 生成 .docx 文件\n- generate_ppt(title, slides?, markdown?, save_path?, author?) → 生成 .pptx 文件\n\nCOM 实例方法：\n- app._get_wb() → 活动工作簿 COM 对象\n- app._get_sheet(name) → 工作表 COM 对象\n- app.read_range / write_range / set_formula / get_sheet_info / open / save / sync\n\nExcel COM 对象属性（通过 _get_wb()）：\n- wb.Worksheets.Count, wb.Worksheets(i), wb.ActiveSheet\n- ws.UsedRange, ws.Range(addr), ws.Cells(row, col)\n\n### Python 标准库\njson, os, sys, re, math, datetime, collections, itertools, functools, copy, csv, io, pathlib, base64, hashlib, textwrap, typing, enum, decimal, fractions, statistics, uuid, time, threading, traceback\n\n## 代码模板\n```python\n# 通过 COM 访问已打开的 Excel\napp = get_excel_app()\nwb = app._get_wb()\nws = wb.ActiveSheet\n# ... 执行操作 ...\nresult = {'status': 'done', 'data': [...]}  # ← 这个会被返回\n```",
    "parameters": {
      "type": "object",
      "properties": {
        "code": {
          "type": "string",
          "description": "Python 3.14 code to execute. Set 'result' variable to return JSON-serializable data. Use print() for debug output. See tool description for full dependency list and API reference."
        },
        "timeout_sec": {
          "type": "number",
          "description": "Execution timeout in seconds. Default: 60. Increase for large file operations."
        }
      },
      "required": ["code"]
    },
    "returns": "{\"success\":true/false,\"result\":\"return value from result variable\",\"output\":\"stdout text\",\"error\":\"error message if failed\",\"duration_ms\":number}"
  }
]
```
