// Built-in skill providing Developer Agent code generation tools.
// Pattern follows AppBuilderSkill and OfficeDocSkill.
//
// Structure:
//   index.ts         — CodeToolsSkill class + tool definitions + execute dispatch
//   helpers.ts       — Shared file I/O, code block extraction, prompt builders
//   shell-utils.ts   — Command safety, shell execution, directory listing, file search, glob
//   file-ops.ts      — write_file / read_file handlers
//   code-gen.ts      — generate_code / execute_code handlers
//   registry.ts      — save_code / list_code / generate_project handlers
//   shell-cmd.ts     — run_command handler
//   file-search.ts   — grep_files / glob_files handlers
//   web-tools.ts     — web_search / web_fetch handlers
// (memory/history/recall tools moved to ../chat-tools.ts)

import type { Skill, SkillTool } from '../skill';
import { SkillOk, SkillFail } from '../skill';
import type { SkillResult } from '@/types/skill';
import type { LLMMessage } from '@/types/message';
import type { IModelService } from '@/interfaces/model-service';
import type { ProviderConfig } from '@/types/provider';
import { ModelScenario } from '@/services/llm-gateway/gateway';

// Handler imports
import { handleWriteFile, handleReadFile } from './file-ops';
import { handleGenerateCode, handleExecuteCode } from './code-gen';
import type { CodeGenEnv } from './code-gen';
import { handleSaveCode, handleListCode, handleGenerateProject } from './registry';
import type { RegistryEnv } from './registry';
import { handleRunCommand } from './shell-cmd';
import { handleSearchFiles, handleGlob } from './file-search';
import { handleWebSearch, handleWebFetch } from './web-tools';
// agent_memory_update, search_chat_history, recall_memory → ../chat-tools.ts

// Re-export for convenience
export type CodeEntryLanguage = 'javascript' | 'python' | 'sql' | 'html';

export class CodeToolsSkill implements Skill {
  id = 'code_tools';
  name = 'Code Tools';
  nameCn = '代码工具';
  category = 'Code Generation';
  categoryCn = '代码生成';
  description = 'Code generation, file I/O, and sandbox execution tools for Developer Agents';
  descriptionCn = '开发者代理的代码生成、文件 I/O 和沙箱执行工具';

  tools: SkillTool[] = [
    {
      name: 'write_file',
      description: 'Write a file to the workspace/ directory. For project code files, scripts, and configs. NOT for complete web applications — use save_app to deliver finished apps to the user.',
      nameCn: '写入文件',
      descriptionCn: '将文件写入 workspace/ 目录。用于项目代码文件和脚本。完整 Web 应用请用 save_app 交付。',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'File path under workspace/ (e.g. workspace/my-project/index.html, workspace/scripts/helper.py)',
          },
          content: { type: 'string', description: 'File content to write' },
        },
        required: ['file_path', 'content'],
      },
    },
    {
      name: 'read_file',
      description: 'Read file content. For large files, use offset/limit to read specific line ranges. Returns total_line_count so you can plan further reads.',
      nameCn: '读取文件',
      descriptionCn: '读取文件内容。大文件请用 offset/limit 分页读取，返回 total_line_count 便于规划后续读取。',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'File path to read' },
          offset: { type: 'number', description: 'Start line number (0-based, inclusive). Default 0.' },
          limit: { type: 'number', description: 'Max number of lines to return. Default 2000.' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'glob_files',
      description: 'Find files by glob pattern (e.g. "*.md", "*report*", "**/*.csv"). Matches filenames, returns matching file paths. Default search root is user home directory. ⚠️ To avoid timeout, always specify "path" when you know where to look — searching the entire home directory is slow.',
      nameCn: '文件名搜索',
      descriptionCn: '按 glob 模式匹配文件名（如 "*.md"、"*报告*"、"**/*.csv"），返回匹配的文件路径。默认搜索用户主目录。⚠️ 为避免超时，建议指定 path 缩小搜索范围——全盘搜索主目录会很慢。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern for filenames (e.g. "*report*" to find files containing "report" in name)' },
          path: { type: 'string', description: 'Directory to search in. ⚠️ Always specify this when you have a rough idea where the file might be. Defaults to the entire user home directory (~) which is slow and may timeout.' },
        },
        required: ['pattern'],
      },
      returns: '{"files":["C:/Users/.../sales.csv","..."],"count":2,"method":"rg|dir|find|js-fallback"}',
    },
    {
      name: 'generate_code',
      description: 'Generate code using the LLM for a given task description. Returns extracted code blocks.',
      nameCn: '生成代码',
      descriptionCn: '根据任务描述使用 LLM 生成代码，返回提取到的代码块',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Description of the code to generate' },
          language: { type: 'string', description: 'Target programming language (javascript, python, typescript, etc.)' },
          context: { type: 'string', description: 'Additional context or existing code to build upon' },
          constraints: { type: 'string', description: 'Constraints or requirements the code must satisfy' },
        },
        required: ['task', 'language'],
      },
    },
    {
      name: 'execute_code',
      description: 'Execute code in a sandboxed environment and return the result. Python sandbox supports safe modules (json, math, re, hashlib, datetime, etc.) — os, subprocess, ctypes are blocked. Use this for computation, data processing, or quick prototyping. For CLI tools (npm, git, pip), use run_command instead.',
      nameCn: '执行代码',
      descriptionCn: '在沙箱环境中执行代码并返回结果。Python 沙箱支持安全模块（json, math, re, hashlib, datetime 等），禁止 os/subprocess/ctypes。适合计算、数据处理、快速验证。CLI 工具（npm, git, pip）请使用 run_command。',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Source code to execute' },
          language: {
            type: 'string',
            description: 'Language (javascript, python, sql, html)',
            enum: ['javascript', 'python', 'sql', 'html'],
          },
          timeout_ms: { type: 'number', description: 'Execution timeout in milliseconds (default 30000, minimum 15000)' },
        },
        required: ['code', 'language'],
      },
    },
    {
      name: 'save_code',
      description: 'Save tested, reusable utility code to the code registry for cross-project reuse. Only for verified, general-purpose functions/classes. NOT for complete apps — use save_app to deliver finished applications to the user.',
      nameCn: '保存可复用代码',
      descriptionCn: '将已验证的可复用工具代码保存到代码注册表。只用于通用的函数/类，完整应用请用 save_app 交付。',
      parameters: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Name for the saved code' },
          code: { type: 'string', description: 'Source code to save' },
          language: {
            type: 'string',
            description: 'Language (javascript, python, sql, html)',
            enum: ['javascript', 'python', 'sql', 'html'],
          },
          description: { type: 'string', description: 'Optional description of the code' },
          tags: {
            type: 'array',
            items: { type: 'string' },
            description: 'Optional tags for searching',
          },
        },
        required: ['name', 'code', 'language'],
      },
    },
    {
      name: 'list_code',
      description: 'Search and list saved code entries from the code registry',
      nameCn: '列出代码',
      descriptionCn: '从代码注册表搜索并列出已保存的代码条目',
      parameters: {
        type: 'object',
        properties: {
          search: { type: 'string', description: 'Optional search term for name or description' },
          language: { type: 'string', description: 'Optional language filter' },
          tag: { type: 'string', description: 'Optional tag filter' },
        },
      },
    },
    {
      name: 'generate_project',
      description: 'Generate a complete multi-file project using the multi-agent pipeline (Architect → Developer → Reviewer → Integrator). Use this for complex tasks that require multiple files, architectural decisions, or a full project scaffold. For simple single-file code generation, use generate_code instead.',
      nameCn: '生成项目',
      descriptionCn: '使用多 Agent 流水线（架构师→开发者→审查员→集成者）生成完整的多文件项目。适用于需要多个文件、架构决策或完整项目脚手架的复杂任务。简单单文件代码生成请用 generate_code。',
      parameters: {
        type: 'object',
        properties: {
          request: { type: 'string', description: 'Detailed description of what to build. Be specific about features, tech stack, and requirements.' },
          project_name: { type: 'string', description: 'Project name (auto-generated from request if omitted)' },
        },
        required: ['request'],
      },
    },
    // --- Shell / FS / Search tools ---
    {
      name: 'run_command',
      description: 'Execute a shell command (cmd.exe on Windows, sh on Linux/Mac) and return stdout, stderr, and exit code. Use this to run npm, git, python, or any CLI tool.',
      nameCn: '执行命令',
      descriptionCn: '执行 shell 命令（Windows 用 cmd.exe，Linux/Mac 用 sh），返回 stdout、stderr 和退出码。可用于运行 npm、git、python 等 CLI 工具。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Shell command to execute (e.g. "npm install", "git status", "python script.py")' },
          cwd: { type: 'string', description: 'Working directory for the command (optional)' },
          timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 60000, minimum 15000). For slow operations like file search, use ≥ 60000.' },
        },
        required: ['command'],
      },
    },
    {
      name: 'grep_files',
      description: 'Search file contents by regex pattern (like grep). If path is a directory, recursively search with optional glob. If path is a specific file (has extension like .csv/.py), search only that file. Returns matching file paths, line numbers, and surrounding context. ⚠️ To avoid timeout, always specify "path" when you know where to look.',
      nameCn: '内容搜索',
      descriptionCn: '按正则表达式搜索文件内容（类似 grep）。若 path 是目录则递归搜索（可配合 glob 过滤），若 path 是具体文件（有扩展名如 .csv/.py）则只搜索该文件。返回匹配的文件路径、行号和上下文。⚠️ 为避免超时，建议指定 path 缩小搜索范围。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Directory to search in, OR a specific file path (auto-detected by extension). ⚠️ Always specify when you have a rough idea where. Default: user home directory (slow, may timeout).' },
          glob: { type: 'string', description: 'File name filter glob (e.g. "*.md", "*report*"). Use * to match any characters. Ignored when path is a specific file.' },
          case_sensitive: { type: 'boolean', description: 'Case sensitive search (default false)' },
          max_results: { type: 'number', description: 'Maximum number of results (default 100)' },
          context_lines: { type: 'number', description: 'Number of context lines before/after each match (default 2)' },
        },
        required: ['pattern'],
      },
      returns: '{"matches":[{"file":"path","line":42,"text":"matching line","context":{"before":["line 40","line 41"],"after":["line 43","line 44"]},"block":{"start_line":38,"end_line":46}}],"count":5,"method":"file-read"}',
    },
    // --- Web Search ---
    {
      name: 'web_search',
      description: 'Search the web via DuckDuckGo and return title, URL, and snippet for each result. Use this to find current information, documentation, or answers that you don\'t already know. After getting search results, you may want to call web_fetch on interesting URLs to read full page content.',
      nameCn: '联网搜索',
      descriptionCn: '通过 DuckDuckGo 搜索网络，返回标题、URL 和摘要。用于查找你不知道的当前信息、文档或答案。获取搜索结果后可调用 web_fetch 深入阅读感兴趣的 URL。',
      returns: '{"results":[{"title":"page title","url":"page URL","snippet":"text snippet"}],"query":"the search query"}',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Search query string' },
          max_results: { type: 'number', description: 'Maximum number of results (default 10, max 20)' },
        },
        required: ['query'],
      },
    },
    {
      name: 'web_fetch',
      description: 'Fetch and extract text content from a URL. Use this after web_search to read a specific page in detail. Returns clean text (HTML tags stripped). Max 50000 chars.',
      nameCn: '抓取网页',
      descriptionCn: '从 URL 抓取并提取文本内容。在 web_search 后使用此工具详细阅读特定页面。返回清理后的文本（已去除 HTML 标签），最多 50000 字符。',
      returns: '{"url":"the fetched URL","content":"extracted text content (truncated to 50000 chars)","title":"page title","content_length":number}',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch (e.g. https://example.com/article)' },
          timeout: { type: 'number', description: 'Request timeout in seconds (default 25)' },
        },
        required: ['url'],
      },
    },
    // (agent_memory_update, search_chat_history, recall_memory → ../chat-tools.ts)
  ];

  // -----------------------------------------------------------------------
  // LLM caller management
  // -----------------------------------------------------------------------

  private llmCaller: ((messages: LLMMessage[]) => AsyncGenerator<string>) | null = null;
  private modelService: IModelService | null = null;
  private provider: ProviderConfig | null = null;
  private apiKey: string | null = null;

  /**
   * Set the LLM calling function used by generate_code.
   * Called by AgentRunner before agents are dispatched.
   * @deprecated Use setModelService() instead for unified LLM access.
   */
  setLlmCaller(fn: (messages: LLMMessage[]) => AsyncGenerator<string>): void {
    this.llmCaller = fn;
  }

  /**
   * Set ModelService for unified LLM access.
   * When set, llmCaller becomes optional.
   */
  setModelService(modelService: IModelService, provider: ProviderConfig, apiKey: string): void {
    this.modelService = modelService;
    this.provider = provider;
    this.apiKey = apiKey;
  }

  /**
   * Get the LLM caller: prefer modelService, fallback to llmCaller.
   */
  private getLlmCaller(): (messages: LLMMessage[]) => AsyncGenerator<string> {
    if (this.llmCaller) return this.llmCaller;

    if (this.modelService && this.provider && this.apiKey) {
      const { modelService, provider, apiKey } = this;
      return async function* (messages: LLMMessage[]) {
        const stream = modelService.chatStream({
          scenario: ModelScenario.codeGeneration,
          messages,
          provider,
          apiKey,
        });

        for await (const chunk of stream) {
          if (chunk.startsWith('__ERROR__:')) {
            throw new Error(chunk.substring(10));
          }
          if (chunk.startsWith('__REASONING__:')) continue;
          if (chunk.startsWith('__TOOLS__:')) continue;
          yield chunk;
        }
      };
    }

    throw new Error('LLM caller is not configured. Call setModelService() or setLlmCaller() first.');
  }

  /** Build the code-generation env for handlers that need LLM calling. */
  private getCodeGenEnv(): CodeGenEnv {
    return { getLlmCaller: () => this.getLlmCaller() };
  }

  /** Build the registry env for handlers that need ModelService. */
  private getRegistryEnv(): RegistryEnv {
    return {
      modelService: this.modelService,
      provider: this.provider,
      apiKey: this.apiKey,
    };
  }

  // -----------------------------------------------------------------------
  // Execute dispatch
  // -----------------------------------------------------------------------

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      switch (toolName) {
        case 'write_file':
          return await handleWriteFile(params);
        case 'read_file':
          return await handleReadFile(params);
        case 'generate_code':
          return await handleGenerateCode(params, this.getCodeGenEnv());
        case 'execute_code':
          return await handleExecuteCode(params);
        case 'save_code':
          return await handleSaveCode(params);
        case 'list_code':
          return await handleListCode(params);
        case 'generate_project':
          return await handleGenerateProject(params, this.getRegistryEnv());
        case 'run_command':
          return await handleRunCommand(params);
        case 'grep_files':
        case 'search_files': // legacy alias
          return await handleSearchFiles(params);
        case 'glob_files':
        case 'find_files': // legacy alias
        case 'glob': // legacy alias
          return await handleGlob(params);
        case 'web_search':
          return await handleWebSearch(params);
        case 'web_fetch':
          return await handleWebFetch(params);
        // agent_memory_update, search_chat_history, recall_memory → ../chat-tools.ts
        default:
          return SkillFail(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return SkillFail(`Tool "${toolName}" failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /**
   * 设置工作区根目录路径，更新 write_file 和 run_command 的工具描述。
   * 在 initBuiltinExecutor 中调用，传入运行时解析的实际路径。
   */
  setWorkspacePath(workspacePath: string): void {
    // 绝对路径放在描述里。用户修改工作目录后 updateWorkspacePath() 会重新调用此方法更新。
    const wsNote = `\n工作区绝对路径：${workspacePath}`;
    const wsRule = ' 路径规则：工作区内传 "workspace"，其他位置传绝对路径，不传则默认用户主目录。';

    for (const tool of this.tools) {
      // 通用：剥离旧的工作区信息，追加新的
      const strip = (s: string) => s.split('\n工作区绝对路径：')[0].split(' 路径规则：')[0];

      if (tool.name === 'write_file') {
        tool.description = strip(tool.description) + wsNote;
        if (tool.descriptionCn) tool.descriptionCn = strip(tool.descriptionCn) + wsNote;
      }
      if (tool.name === 'read_file') {
        tool.description = strip(tool.description) + wsNote;
        if (tool.descriptionCn) tool.descriptionCn = strip(tool.descriptionCn) + wsNote;
      }
      if (tool.name === 'run_command') {
        tool.description = strip(tool.description) + wsNote;
        if (tool.descriptionCn) tool.descriptionCn = strip(tool.descriptionCn) + wsNote;
      }
      if (tool.name === 'glob_files') {
        tool.description = strip(tool.description) + wsNote + wsRule;
        if (tool.descriptionCn) tool.descriptionCn = strip(tool.descriptionCn) + wsNote + wsRule;
      }
      if (tool.name === 'grep_files') {
        tool.description = strip(tool.description) + wsNote + wsRule;
        if (tool.descriptionCn) tool.descriptionCn = strip(tool.descriptionCn) + wsNote + wsRule;
      }
    }
  }
}
