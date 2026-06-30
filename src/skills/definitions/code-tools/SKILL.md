---
name: code-tools
description: >-
  Code generation, file I/O, and sandbox execution tools for Developer Agents.
  This skill should be used when the user needs to read, write, search files,
  execute code, run shell commands, generate multi-file projects, or search
  the web. Provides the full developer toolkit for code-related tasks.
license: MIT
compatibility: Requires Tauri v2+
usage: |-
  ## Quick Start

  1. **Write a file**: write_file({file_path, content}) — saves code to the project directory
  2. **Read a file**: read_file({file_path}) — loads file content from the project
  3. **Generate code**: generate_code({task, language, context?, constraints?}) — LLM generates code from a description
  4. **Execute code**: execute_code({code, language, timeout_ms?}) — runs code in a sandbox (JS/Python/SQL/HTML)
  5. **Save to registry**: save_code({name, code, language, description?, tags?}) — persist for reuse
  6. **Search registry**: list_code({search?, language?, tag?}) — find saved code snippets
  7. **Run shell command**: run_command({command, cwd?, timeout_ms?}) — execute any CLI tool
  8. **Find files**: glob_files({pattern, path?}) — match filenames by glob pattern
  9. **Search content**: grep_files({pattern, path?, glob?, case_sensitive?, max_results?}) — regex search file contents

  ## Execution Environment

  - JavaScript: sandboxed `new Function` with blocked globals
  - Python: sidecar python-engine
  - SQL: local SQLite via sql.js
  - HTML: iframe sandbox execution

  File I/O uses Tauri plugin-fs when available, falling back to in-memory cache.

tools:
  - name: generate_project
    description: >-
      Generate a complete multi-file project using the multi-agent pipeline
      (Architect → Developer → Reviewer → Integrator). Use this for complex
      tasks that require multiple files, architectural decisions, or a full
      project scaffold.
    parameters:
      type: object
      properties:
        request:
          type: string
          description: >-
            Detailed description of what to build. Be specific about features,
            tech stack, and requirements.
        project_name:
          type: string
          description: Project name (auto-generated from request if omitted)
      required: [request]
    returns: '{"project_id":"uuid","name":"project name","files":{"filename":"content"},"entry_file":"index.html"}'

  - name: write_file
    description: Write code content to a file in the project directory
    parameters:
      type: object
      properties:
        file_path:
          type: string
          description: Relative file path within the project (e.g. src/utils/helper.ts)
        content:
          type: string
          description: File content to write
      required: [file_path, content]
    returns: '{"path":"absolute file path","written":true,"size":number}'

  - name: read_file
    description: >-
      Read file content. For large files, use offset/limit to read specific
      line ranges. Returns total_line_count so you can plan further reads.
    parameters:
      type: object
      properties:
        file_path:
          type: string
          description: Relative file path within the project
        offset:
          type: number
          description: Start line number (0-based, inclusive). Default 0.
        limit:
          type: number
          description: Max number of lines to return. Default 2000.
      required: [file_path]
    returns: '{"path":"absolute file path","content":"file content string","line_count":number}'

  - name: generate_code
    description: >-
      Generate code using the LLM for a given task description. Returns
      extracted code blocks.
    parameters:
      type: object
      properties:
        task:
          type: string
          description: Description of the code to generate
        language:
          type: string
          description: >-
            Target programming language (javascript, python, typescript, etc.)
        context:
          type: string
          description: Additional context or existing code to build upon
        constraints:
          type: string
          description: Constraints or requirements the code must satisfy
      required: [task, language]
    returns: '{"code":"generated source code","allBlocks":["individual code blocks"],"language":"the language used","files":{"filepath":"content"},"app_id":"uuid"}'

  - name: execute_code
    description: Execute code in a sandboxed environment and return the result
    parameters:
      type: object
      properties:
        code:
          type: string
          description: Source code to execute
        language:
          type: string
          enum: [javascript, python, sql, html]
          description: Language (javascript, python, sql, html)
        timeout_ms:
          type: number
          description: Execution timeout in milliseconds (default 30000)
      required: [code, language]
    returns: '{"success":true/false,"output":"stdout/stderr text","result":"return value","error":"error if failed","duration_ms":number}'

  - name: save_code
    description: Save generated code to the code registry for future reuse
    parameters:
      type: object
      properties:
        name:
          type: string
          description: Name for the saved code
        code:
          type: string
          description: Source code to save
        language:
          type: string
          enum: [javascript, python, sql, html]
          description: Programming language
        description:
          type: string
          description: Optional description of the code
        tags:
          type: array
          items:
            type: string
          description: Optional tags for searching
      required: [name, code, language]
    returns: '{"code_id":"uuid","name":"code name","language":"language","tags":["tag1"]}'

  - name: list_code
    description: Search and list saved code entries from the code registry
    parameters:
      type: object
      properties:
        search:
          type: string
          description: Optional search term for name or description
        language:
          type: string
          description: Optional language filter
        tag:
          type: string
          description: Optional tag filter
    returns: '{"codes":[{"id":"uuid","name":"code name","language":"language","description":"...","tags":[...]}],"count":number}'

  - name: run_command
    description: >-
      Execute a shell command (cmd.exe on Windows, sh on Linux/Mac) and return
      stdout, stderr, and exit code.
    parameters:
      type: object
      properties:
        command:
          type: string
          description: Shell command to execute
        cwd:
          type: string
          description: Working directory (optional)
        timeout_ms:
          type: number
          description: Timeout in milliseconds (default 30000)
      required: [command]
    returns: '{"stdout":"command output","stderr":"error output","exit_code":number}'

  - name: grep_files
    description: >-
      Search file contents by regex pattern (like grep). Returns matching
      file paths, line numbers, and surrounding context.
    parameters:
      type: object
      properties:
        pattern:
          type: string
          description: Regex pattern to search for
        path:
          type: string
          description: Root directory (default: current)
        glob:
          type: string
          description: File filter glob (e.g. "*.ts")
        case_sensitive:
          type: boolean
          description: Case sensitive (default false)
        max_results:
          type: number
          description: Max results (default 100)
        context_lines:
          type: number
          description: Number of context lines before/after each match (default 0)
      required: [pattern]
    returns: '{"files":[{"path":"matched file path","matches":[{"line":number,"content":"matching line text"}]}],"total_matches":number}'

  - name: glob_files
    description: >-
      Find files by glob pattern (e.g. "**/*.ts", "src/**/*.test.*").
      Returns matching file paths sorted by modification time.
    parameters:
      type: object
      properties:
        pattern:
          type: string
          description: Glob pattern (e.g. "**/*.tsx", "src/**/README*")
        path:
          type: string
          description: Directory to search in (default: current directory)
      required: [pattern]
    returns: '{"files":["matched file path"],"count":number}'

x-i18n:
  name_cn: 代码工具
  description_cn: 开发者代理的代码生成、文件 I/O 和沙箱执行工具。
  category_cn: 代码生成
  usage_cn: |-
    ## 快速开始

    1. **写入文件**：write_file({file_path, content}) — 将代码保存到项目目录
    2. **读取文件**：read_file({file_path}) — 从项目加载文件内容
    3. **生成代码**：generate_code({task, language, context?, constraints?}) — LLM 根据描述生成代码
    4. **执行代码**：execute_code({code, language, timeout_ms?}) — 在沙箱中运行代码
    5. **保存到注册表**：save_code({name, code, language, description?, tags?}) — 持久化以供重用
    6. **搜索注册表**：list_code({search?, language?, tag?}) — 查找已保存的代码片段
    7. **执行命令**：run_command({command, cwd?, timeout_ms?}) — 执行任意 CLI 工具
    8. **查找文件**：glob_files({pattern, path?}) — 按 glob 模式匹配文件名
    9. **搜索内容**：grep_files({pattern, path?, glob?, case_sensitive?, max_results?}) — 类 grep 内容搜索

    ## 执行环境

    - JavaScript：沙箱 `new Function`，阻止危险全局变量
    - Python：侧车 python-engine
    - SQL：通过 sql.js 的本地 SQLite
    - HTML：iframe 沙箱执行

    文件 I/O 优先使用 Tauri plugin-fs，回退到内存缓存。
  tools:
    generate_project:
      name_cn: 生成项目
      description_cn: 使用多 Agent 流水线生成完整的多文件项目。
    write_file:
      name_cn: 写入文件
      description_cn: 将代码内容写入项目目录中的文件
    read_file:
      name_cn: 读取文件
      description_cn: 读取文件内容。大文件请用 offset/limit 分页读取。
    generate_code:
      name_cn: 生成代码
      description_cn: 根据任务描述使用 LLM 生成代码
    execute_code:
      name_cn: 执行代码
      description_cn: 在沙箱环境中执行代码并返回结果
    save_code:
      name_cn: 保存代码
      description_cn: 将生成的代码保存到代码注册表以供将来重用
    list_code:
      name_cn: 列出代码
      description_cn: 从代码注册表搜索并列出已保存的代码条目
    run_command:
      name_cn: 执行命令
      description_cn: 执行 shell 命令，返回 stdout、stderr 和退出码
    grep_files:
      name_cn: 内容搜索
      description_cn: 按正则表达式搜索文件内容（类似 grep）
    glob_files:
      name_cn: 文件名搜索
      description_cn: 按 glob 模式查找文件
---
