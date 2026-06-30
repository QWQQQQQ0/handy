---
name: office-doc
description: >-
  Generate, read, and edit Word, Excel, and PowerPoint documents. Supports
  creating new files from Markdown/structured data and real-time editing of
  open documents via COM automation. This skill should be used when the user
  needs to create, read, or edit Office documents (docx, xlsx, pptx).
license: MIT
compatibility: Requires Tauri v2+, Python engine, pywin32 (COM)
usage: |-
  ## Quick Start

  ### Generate Documents
  ```
  generate_doc({type: "word", title: "报告", content: "## 第一章\n\n内容..."})
  generate_doc({type: "excel", title: "报表", sheets: [{name: "数据", headers: ["A","B"], rows: [[1,2]]}]})
  generate_doc({type: "ppt", title: "介绍", markdown: "## 背景\n\n要点"})
  ```

  ### Detect & Edit Open Documents
  Use `office_detect` → `com_edit(open)` → `com_read` → `com_edit`:
  ```
  office_detect()
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
  If a task needs understanding/reasoning (translate, summarize, classify...), do it step by step:
  1. `com_read` → get the data
  2. You (LLM) process the data with your own intelligence
  3. `com_edit` → write results back

tools:
  - name: generate_doc
    description: Generate a new Word (.docx), Excel (.xlsx), or PPT (.pptx) document and download it.
    parameters:
      type: object
      properties:
        type:
          type: string
          enum: [word, excel, ppt]
          description: Document type
        title:
          type: string
          description: Document title (used as filename)
        content:
          type: string
          description: Markdown content for Word body (type=word only)
        subtitle:
          type: string
          description: Optional subtitle (type=word only)
        sheets:
          type: array
          items:
            type: object
            properties:
              name: { type: string }
              headers: { type: array, items: { type: string } }
              rows: { type: array, items: { type: array, items: {} } }
            required: [name, headers, rows]
          description: Sheet definitions (type=excel only)
        slides:
          type: array
          items:
            type: object
            properties:
              title: { type: string }
              content: { type: string }
              layout: { type: string, enum: [title, content, two_column] }
            required: [title]
          description: Slide definitions (type=ppt only)
        markdown:
          type: string
          description: Markdown for PPT (type=ppt only)
        author:
          type: string
          description: Optional author name
      required: [type, title]
    returns: '{"path":"saved file path","size":number,"format":"docx/xlsx/pptx"}'

  - name: office_detect
    description: >-
      Detect Office/WPS COM availability. Reports what documents are open in
      WPS/Office windows. Use before com_read/com_edit.
    parameters:
      type: object
      properties: {}
      required: []
    returns: '{"available_apps":{"word":{"available":true/false,"documents":[...]},"excel":{...},"ppt":{...}}}'

  - name: com_read
    description: >-
      Read content from an active Word, Excel, or PowerPoint document via COM
      automation. The file stays open. Word: paragraphs with style. Excel: cell
      values. PPT: slide texts and shapes.
    parameters:
      type: object
      properties:
        app:
          type: string
          enum: [word, excel, ppt]
          description: Which application to read from
        paragraph_start:
          type: number
          description: '[Word] 0-based start paragraph index'
        paragraph_end:
          type: number
          description: '[Word] 0-based end paragraph index (exclusive)'
        range:
          type: string
          description: '[Excel] Range notation, e.g. "A1:G10"'
        sheet:
          type: string
          description: '[Excel] Sheet name. Default: active sheet'
        get_selection:
          type: boolean
          description: '[Excel] Read user current selection'
        sheet_info:
          type: boolean
          description: '[Excel] Get sheet dimensions and used range'
        slide_start:
          type: number
          description: '[PPT] 0-based start slide index'
        slide_end:
          type: number
          description: '[PPT] 0-based end slide index (exclusive)'
        slide_index:
          type: number
          description: '[PPT] Read a single slide with shape details'
        slide_info:
          type: boolean
          description: '[PPT] Read detailed shape info for slide_index'
        find_text:
          type: boolean
          description: '[PPT] Find all text-containing shapes'
      required: [app]
    returns: See tool usage docs for full per-app return format.

  - name: com_edit
    description: >-
      Edit an active Word, Excel, or PowerPoint document via COM automation.
      The file stays open and changes are visible immediately.
    parameters:
      type: object
      properties:
        app:
          type: string
          enum: [word, excel, ppt]
          description: Which application to edit
        operation:
          type: string
          description: >-
            Edit operation. ALL: open. Word: replace, set_paragraph, insert,
            insert_heading, delete, format. Excel: write, formula, auto_fill,
            set_value, format, insert_rows, insert_columns. PPT: set_text,
            add_slide, delete_slide, reorder.
        file_path:
          type: string
          description: '[ALL:open] Absolute path to the document file'
        find:
          type: string
          description: '[Word:replace] Text to find'
        replace:
          type: string
          description: '[Word:replace] Replacement text'
        paragraph_index:
          type: number
          description: '[Word] 0-based paragraph index'
        text:
          type: string
          description: '[Word/PPT] New text content'
        range:
          type: string
          description: '[Excel:write] Target range, e.g. "G2:G10"'
        values:
          type: array
          items:
            type: array
            items: {}
          description: '[Excel:write] 2D array of values'
        cell:
          type: string
          description: '[Excel:formula/set_value] Cell address, e.g. "G2"'
        formula:
          type: string
          description: '[Excel:formula] Formula, e.g. "=SUM(B2:F2)"'
        formula_template:
          type: string
          description: '[Excel:auto_fill] Formula with {row} placeholder'
        column:
          type: string
          description: '[Excel:auto_fill/format] Column letter'
        start_row:
          type: number
          description: '[Excel:auto_fill] First data row (1-based)'
        end_row:
          type: number
          description: '[Excel:auto_fill] Last data row (inclusive, 1-based)'
        value:
          description: '[Excel:set_value] Value to set'
        number_format:
          type: string
          description: '[Excel:format] Number format'
        sheet:
          type: string
          description: '[Excel] Sheet name. Default: active sheet'
        slide_index:
          type: number
          description: '[PPT] 0-based slide index'
        shape_name:
          type: string
          description: '[PPT:set_text] Shape name'
        title:
          type: string
          description: '[PPT:add_slide] Title text'
        content:
          type: string
          description: '[PPT:add_slide] Body text'
      required: [app, operation]
    returns: '{"success":true/false,"message":"operation result description","details":{...}}'

  - name: doc_code_exec
    description: >-
      Execute Python 3.14 code to handle document operations that require
      PROGRAMMING LOGIC. For simple read/write, prefer com_read/com_edit directly.
      Set `result` variable to return data. See usage docs for full API reference.
    parameters:
      type: object
      properties:
        code:
          type: string
          description: Python 3.14 code to execute. Set 'result' variable to return data.
        timeout_sec:
          type: number
          description: Execution timeout in seconds. Default: 60.
      required: [code]
    returns: '{"success":true/false,"result":"return value","output":"stdout text","error":"error message","duration_ms":number}'

x-i18n:
  name_cn: 办公文档
  description_cn: 生成、读取和编辑 Word、Excel、PowerPoint 文档。支持从 Markdown/结构化数据创建新文件，以及通过 COM 自动化实时编辑已打开的文档。
  category_cn: 文档
  usage_cn: |-
    ## 快速开始

    ### 生成文档
    generate_doc({type: "word", title: "报告", content: "## 第一章\n\n内容..."})
    generate_doc({type: "excel", title: "报表", sheets: [{name: "数据", headers: ["A","B"], rows: [[1,2]]}]})
    generate_doc({type: "ppt", title: "介绍", markdown: "## 背景\n\n要点"})

    ### 检测并编辑已打开的文档
    office_detect() → com_edit(open) → com_read → com_edit

    ### 高级：代码执行
    doc_code_exec 仅用于需要编程逻辑的操作。需要理解/推理的任务请分步完成：com_read → LLM 处理 → com_edit
  tools:
    generate_doc:
      name_cn: 生成文档
      description_cn: 生成新的 Word/Excel/PPT 文档并下载。
    office_detect:
      name_cn: 检测Office文档
      description_cn: 检测桌面上当前打开的 Word、Excel 和 PowerPoint 文档。
    com_read:
      name_cn: 读取文档内容
      description_cn: 通过 COM 自动化读取活动的 Word、Excel 或 PowerPoint 文档内容。
    com_edit:
      name_cn: 编辑文档
      description_cn: 通过 COM 自动化编辑活动的 Word、Excel 或 PowerPoint 文档。
    doc_code_exec:
      name_cn: 执行文档代码
      description_cn: 执行 Python 3.14 代码处理需要编程逻辑的文档操作。
---
