// Built-in skill providing Developer Agent code generation tools.
// Pattern follows AppBuilderSkill and OfficeDocSkill.

import type { Skill, SkillTool } from './skill';
import { SkillOk, SkillFail } from './skill';
import type { SkillResult } from '@/types/skill';
import { codeSandboxService } from '@/services/code-sandbox';
import { CodeRegistryDB } from '@/services/code-registry';
import type { LLMMessage } from '@/types/message';
import type { IModelService } from '@/interfaces/model-service';
import { addMemory, formatMemoriesForPrompt } from '@/services/agent-memory';
import type { ProviderConfig } from '@/types/provider';
import { ModelScenario } from '@/services/llm-gateway/gateway';
import { appEvents, APP_EVENTS } from '@/services/app-events';
import { getDB } from '@/db';
// codeGateway is dynamically imported in handleGenerateProject to avoid
// pulling in node:fs/promises (via agent-runner) into the browser bundle.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** In-memory fallback for file operations when Tauri backend is not wired. */
const fileCache = new Map<string, string>();

/** Try to write a file via Tauri plugin-fs, falling back to memory cache. */
async function tryWriteFile(filePath: string, content: string): Promise<{ ok: boolean; path: string; method: string }> {
  fileCache.set(filePath, content);

  // Attempt 1: @tauri-apps/plugin-fs (optional dependency, not guaranteed to be installed)
  try {
    // @ts-ignore — plugin-fs is optional; failure is caught at runtime
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(filePath, content);
    return { ok: true, path: filePath, method: 'plugin-fs' };
  } catch {
    // fall through
  }

  // Attempt 2: @tauri-apps/api/core invoke (Rust command may not exist)
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_file', { path: filePath, content });
    return { ok: true, path: filePath, method: 'invoke' };
  } catch {
    // fall through — file is still in memory cache
  }

  return { ok: true, path: filePath, method: 'memory-cache' };
}

/** Try to read a file via Tauri plugin-fs, falling back to memory cache. */
async function tryReadFile(filePath: string): Promise<{ ok: boolean; content: string; method: string }> {
  // Check memory cache first
  const cached = fileCache.get(filePath);
  if (cached !== undefined) {
    return { ok: true, content: cached, method: 'memory-cache' };
  }

  // Attempt 1: @tauri-apps/plugin-fs
  try {
    // @ts-ignore — plugin-fs is optional; failure is caught at runtime
    const { readTextFile } = await import('@tauri-apps/plugin-fs');
    const content = await readTextFile(filePath);
    fileCache.set(filePath, content);
    return { ok: true, content, method: 'plugin-fs' };
  } catch {
    // fall through
  }

  // Attempt 2: @tauri-apps/api/core invoke
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const content = await invoke<string>('read_file', { path: filePath });
    fileCache.set(filePath, content);
    return { ok: true, content, method: 'invoke' };
  } catch {
    // fall through
  }

  return { ok: false, content: '', method: 'none' };
}

/** Extract code blocks from markdown content (```lang ... ```). */
function extractCodeBlocks(text: string): string[] {
  const blocks: string[] = [];
  const regex = /```(?:\w+)?\s*\n?([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(text)) !== null) {
    const code = match[1].trim();
    if (code.length > 0) blocks.push(code);
  }
  return blocks;
}

/** Build a code-generation prompt. */
function buildCodeGenPrompt(task: string, language: string, context?: string, constraints?: string): string {
  const parts: string[] = [
    `You are a code generation assistant. Generate ${language} code for the following task:`,
    '',
    task,
  ];
  if (context) {
    parts.push('', '## Context', '', context);
  }
  if (constraints) {
    parts.push('', '## Constraints', '', constraints);
  }
  parts.push('', '## Output Format', '', 'Output ONLY the code inside a single markdown code block:');
  parts.push('', `\`\`\`${language}`, '// your code here', '```');
  parts.push('', 'Do NOT include any explanation outside the code block.');
  return parts.join('\n');
}

/** Build a code-iteration (fix) prompt. */
function buildCodeIterPrompt(task: string, code: string, language: string, error: string): string {
  return [
    `You are fixing ${language} code. The original task:`,
    '',
    task,
    '',
    'Current code:',
    '',
    `\`\`\`${language}`,
    code,
    '```',
    '',
    'The code produced the following error when executed:',
    '',
    error,
    '',
    'Fix the code so it runs without errors. Output ONLY the fixed code inside a markdown code block.',
    `\`\`\`${language}`,
    '// fixed code here',
    '```',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Shell / FS helpers
// ---------------------------------------------------------------------------

/** Dangerous command patterns — blocked outright, never executed. */
const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[rRf]+\s+|--recursive)/i, reason: '递归删除文件（rm -rf）' },
  { pattern: /\brmdir\s+\/s/i, reason: '递归删除目录（rmdir /s）' },
  { pattern: /\bdel\s+\/s/i, reason: '递归删除文件（del /s）' },
  { pattern: /\bformat\s+[a-z]:/i, reason: '格式化磁盘' },
  { pattern: /\breg\s+delete\b/i, reason: '删除注册表项' },
  { pattern: /\bregedit\b/i, reason: '注册表编辑器' },
  { pattern: /\bshutdown\b/i, reason: '关机/重启' },
  { pattern: /\breboot\b/i, reason: '重启系统' },
  { pattern: /\btaskkill\b.*\/f/i, reason: '强制终止进程' },
  { pattern: /\bnet\s+user\b.*\b\/delete\b/i, reason: '删除用户账户' },
  { pattern: /\bcacls\b|\bicacls\b.*\/g/i, reason: '修改文件权限' },
  { pattern: /\|\s*(sh|bash|cmd|powershell)\b/i, reason: '管道注入到 shell' },
  { pattern: /\bcurl\b.*\|\s*(sh|bash)\b/i, reason: '下载并执行（curl|sh）' },
  { pattern: /\bpowershell\b.*\b(iex|invoke-expression)\b/i, reason: 'PowerShell 远程执行' },
  { pattern: /\beval\s*\(/i, reason: 'eval 执行' },
  { pattern: /\bC:\\Windows\b/i, reason: '操作系统目录' },
  { pattern: /\bC:\\System32\b/i, reason: '系统目录' },
];

/** Check if a command is dangerous. Returns null if safe, or a reason string if dangerous. */
function checkCommandSafety(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

/** Execute a shell command via backend API. Returns stdout+stderr+exitCode. */
async function tryRunCommand(
  command: string,
  cwd?: string,
  timeoutMs = 30000,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; method: string }> {
  try {
    const { getApiBaseUrl } = await import('@/api/client');
    const url = `${getApiBaseUrl()}/api/agent/run-command`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: { command, cwd, timeout_ms: timeoutMs },
      }),
    });
    const json = await response.json() as { ok: boolean; data?: { ok: boolean; stdout: string; stderr: string; exitCode: number; method: string }; error?: string };
    if (!json.ok || !json.data) {
      return { ok: false, stdout: '', stderr: json.error ?? 'Backend request failed', exitCode: -1, method: 'error' };
    }
    return json.data;
  } catch (e) {
    return {
      ok: false,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
      exitCode: -1,
      method: 'error',
    };
  }
}

/** List directory entries via Tauri fs plugin. */
async function tryListDir(
  dirPath: string,
  recursive = false,
  pattern?: string,
): Promise<{ ok: boolean; entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean; size?: number; mtime?: string }>; method: string }> {
  try {
    // @ts-ignore — plugin-fs optional
    const { readDir, stat } = await import('@tauri-apps/plugin-fs');
    const entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean; size?: number; mtime?: string }> = [];

    async function scan(dir: string, depth: number) {
      const items = await readDir(dir);
      for (const item of items) {
        const fullPath = dir.replace(/[\\/]+$/, '') + '/' + item.name;
        let isDir = item.isDirectory;
        let isFile = item.isFile;
        let size: number | undefined;
        let mtime: string | undefined;
        try {
          const s = await stat(fullPath);
          isDir = s.isDirectory;
          isFile = s.isFile;
          size = Number(s.size);
          mtime = s.mtime ? new Date(s.mtime).toISOString() : undefined;
        } catch { /* ignore */ }

        // Pattern filter (simple glob: *.ext or exact match)
        if (pattern && isFile) {
          const re = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
          if (!re.test(item.name)) continue;
        }

        entries.push({ name: item.name, path: fullPath, isDirectory: isDir, isFile, size, mtime });

        if (recursive && isDir) {
          await scan(fullPath, depth + 1);
        }
      }
    }

    await scan(dirPath, 0);
    return { ok: true, entries, method: 'plugin-fs' };
  } catch (e) {
    return { ok: false, entries: [], method: 'error' };
  }
}

/**
 * Search file contents — shells out to rg/grep/findstr for speed.
 * Tries rg first (fastest, native context support), then platform fallback.
 */
async function trySearchFiles(
  pattern: string,
  searchPath?: string,
  glob?: string,
  caseSensitive = false,
  maxResults = 100,
  contextLines = 0,
): Promise<{ ok: boolean; matches: Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] } }>; method: string }> {
  const cwd = searchPath ?? '.';
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

  // ── Strategy 1: ripgrep (fastest, works on all platforms) ──
  try {
    const rgArgs: string[] = ['--no-heading', '-n'];
    if (!caseSensitive) rgArgs.push('-i');
    if (contextLines > 0) rgArgs.push('-C', String(contextLines));
    if (glob) rgArgs.push('-g', glob);
    rgArgs.push('-m', String(maxResults));
    rgArgs.push('--', pattern);

    const rgResult = await tryRunCommand(`rg ${rgArgs.join(' ')}`, cwd, 15000);
    if (rgResult.ok && rgResult.exitCode === 0 && rgResult.stdout.trim()) {
      const matches = parseRgOutput(rgResult.stdout, contextLines);
      return { ok: true, matches, method: 'rg' };
    }
  } catch { /* rg not available, fall through */ }

  // ── Strategy 2: platform fallback ──
  try {
    if (isWindows) {
      // findstr /s = recursive, /n = line numbers
      const fsArgs = ['/s', '/n'];
      if (!caseSensitive) fsArgs.push('/i');
      const fileFilter = glob ? glob.replace(/\*\*/g, '*').replace(/\*/g, '*') : '*';
      const cmd = `findstr ${fsArgs.join(' ')} /c:"${pattern}" ${fileFilter}`;
      const result = await tryRunCommand(cmd, cwd, 15000);
      if (result.ok && result.exitCode === 0 && result.stdout.trim()) {
        const matches = parseFindstrOutput(result.stdout, maxResults);
        return { ok: true, matches, method: 'findstr' };
      }
    } else {
      // grep -rn = recursive + line numbers
      const grepArgs = ['-rn', '-n'];
      if (!caseSensitive) grepArgs.push('-i');
      if (contextLines > 0) grepArgs.push('-C', String(contextLines));
      grepArgs.push('-m', String(maxResults));
      grepArgs.push('--include', glob ?? '*');
      grepArgs.push('--', pattern);

      const result = await tryRunCommand(`grep ${grepArgs.join(' ')}`, cwd, 15000);
      if (result.ok && result.exitCode === 0 && result.stdout.trim()) {
        const matches = parseGrepOutput(result.stdout, contextLines);
        return { ok: true, matches, method: 'grep' };
      }
    }
  } catch { /* fall through */ }

  // ── Strategy 3: JS fallback (slow but always works) ──
  try {
    const dirResult = await tryListDir(cwd, true, glob);
    if (!dirResult.ok) return { ok: false, matches: [], method: 'error' };

    const flags = caseSensitive ? 'g' : 'gi';
    const regex = new RegExp(pattern, flags);
    const matches: Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] } }> = [];
    const MAX_FILE_SIZE = 2 * 1024 * 1024;

    for (const entry of dirResult.entries) {
      if (!entry.isFile) continue;
      if (matches.length >= maxResults) break;
      if (/\.(png|jpg|jpeg|gif|bmp|ico|svg|woff2?|ttf|eot|mp[34]|wav|zip|tar|gz|exe|dll|so|dylib|pdf)$/i.test(entry.path)) continue;
      if (entry.size !== undefined && entry.size > MAX_FILE_SIZE) continue;

      try {
        const readResult = await tryReadFile(entry.path);
        if (!readResult.ok) continue;
        const lines = readResult.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            const match: { file: string; line: number; text: string; context?: { before: string[]; after: string[] } } = {
              file: entry.path, line: i + 1, text: lines[i].trim(),
            };
            if (contextLines > 0) {
              match.context = {
                before: lines.slice(Math.max(0, i - contextLines), i).map(l => l.trimEnd()),
                after: lines.slice(i + 1, i + 1 + contextLines).map(l => l.trimEnd()),
              };
            }
            matches.push(match);
          }
        }
      } catch { /* skip */ }
    }
    return { ok: true, matches, method: 'js-fallback' };
  } catch (e) {
    return { ok: false, matches: [], method: 'error' };
  }
}

// ── Output parsers ──

/** Parse rg output (file:line:content or file-line-content for context). */
function parseRgOutput(
  output: string,
  contextLines: number,
): Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] } }> {
  const lines = output.split('\n').filter(l => l.length > 0);
  const matches: Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] } }> = [];
  let current: { file: string; line: number; text: string; before: string[]; after: string[] } | null = null;

  for (const line of lines) {
    // Context separator
    if (line === '--') {
      if (current) {
        matches.push({ file: current.file, line: current.line, text: current.text, context: { before: current.before, after: current.after } });
        current = null;
      }
      continue;
    }

    // Match line: file:linenum:content
    const matchHit = line.match(/^(.+?):(\d+):(.*)$/);
    if (matchHit) {
      if (current) {
        matches.push({ file: current.file, line: current.line, text: current.text, context: { before: current.before, after: current.after } });
      }
      current = { file: matchHit[1], line: parseInt(matchHit[2], 10), text: matchHit[3].trimEnd(), before: [], after: [] };
      continue;
    }

    // Context line: file-linenum-content (dash instead of colon after line num)
    const ctxMatch = line.match(/^(.+?)-(\d+)-(.*)$/);
    if (ctxMatch && current) {
      const ctxLineNum = parseInt(ctxMatch[2], 10);
      if (ctxLineNum < current.line) {
        current.before.push(ctxMatch[3].trimEnd());
      } else {
        current.after.push(ctxMatch[3].trimEnd());
      }
    }
  }
  if (current) {
    matches.push({ file: current.file, line: current.line, text: current.text, context: { before: current.before, after: current.after } });
  }

  // If no context, strip context field
  if (contextLines <= 0) {
    for (const m of matches) delete m.context;
  }
  return matches;
}

/** Parse findstr output (file:linenum:content). */
function parseFindstrOutput(
  output: string,
  maxResults: number,
): Array<{ file: string; line: number; text: string }> {
  const matches: Array<{ file: string; line: number; text: string }> = [];
  for (const line of output.split('\n')) {
    if (matches.length >= maxResults) break;
    const m = line.match(/^(.+?):(\d+):(.*)$/);
    if (m) matches.push({ file: m[1], line: parseInt(m[2], 10), text: m[3].trimEnd() });
  }
  return matches;
}

/** Parse grep -rn output (file:linenum:content). */
function parseGrepOutput(
  output: string,
  contextLines: number,
): Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] } }> {
  // grep output format is same as rg for basic usage
  return parseRgOutput(output, contextLines);
}

/**
 * Find files matching a glob pattern — shells out to rg --files or find/dir.
 */
async function tryGlob(
  pattern: string,
  searchPath?: string,
): Promise<{ ok: boolean; files: string[]; method: string }> {
  const cwd = searchPath ?? '.';
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

  // ── Try rg --files (fast) ──
  try {
    const rgResult = await tryRunCommand(`rg --files -g "${pattern}"`, cwd, 10000);
    if (rgResult.ok && rgResult.exitCode === 0 && rgResult.stdout.trim()) {
      return { ok: true, files: rgResult.stdout.split('\n').filter(f => f.length > 0), method: 'rg' };
    }
  } catch { /* rg not available */ }

  // ── Platform fallback ──
  try {
    if (isWindows) {
      // dir /s /b = recursive bare listing
      const result = await tryRunCommand(`dir /s /b`, cwd, 10000);
      if (result.ok && result.exitCode === 0) {
        const globRegex = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`)
          .replace(/\*\*/g, '<<GLOBSTAR>>')
          .replace(/\*/g, '[^/\\\\]*')
          .replace(/\?/g, '[^/\\\\]')
          .replace(/<<GLOBSTAR>>/g, '.*');
        const regex = new RegExp(`^${globRegex}$`, 'i');
        const files = result.stdout.split('\n').filter(f => f.trim() && regex.test(f.trim()));
        return { ok: true, files, method: 'dir' };
      }
    } else {
      const result = await tryRunCommand(`find . -type f`, cwd, 10000);
      if (result.ok && result.exitCode === 0) {
        const globRegex = pattern
          .replace(/[.+^${}()|[\]\\]/g, '\\$&')
          .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`)
          .replace(/\*\*/g, '<<GLOBSTAR>>')
          .replace(/\*/g, '[^/\\\\]*')
          .replace(/\?/g, '[^/\\\\]')
          .replace(/<<GLOBSTAR>>/g, '.*');
        const regex = new RegExp(`^${globRegex}$`, 'i');
        const files = result.stdout.split('\n').filter(f => f.trim() && regex.test(f.trim()));
        return { ok: true, files, method: 'find' };
      }
    }
  } catch { /* fall through */ }

  // ── JS fallback ──
  try {
    const dirResult = await tryListDir(cwd, true);
    if (!dirResult.ok) return { ok: false, files: [], method: 'error' };
    const globRegex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`)
      .replace(/\*\*/g, '<<GLOBSTAR>>')
      .replace(/\*/g, '[^/\\\\]*')
      .replace(/\?/g, '[^/\\\\]')
      .replace(/<<GLOBSTAR>>/g, '.*');
    const regex = new RegExp(`^${globRegex}$`, 'i');
    const files = dirResult.entries.filter(e => e.isFile && regex.test(e.path)).map(e => e.path);
    return { ok: true, files, method: 'js-fallback' };
  } catch {
    return { ok: false, files: [], method: 'error' };
  }
}

// ---------------------------------------------------------------------------
// Skill
// ---------------------------------------------------------------------------

const codeRegistry = new CodeRegistryDB();

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
      description: 'Write code content to a file in the project directory',
      nameCn: '写入文件',
      descriptionCn: '将代码内容写入项目目录中的文件',
      parameters: {
        type: 'object',
        properties: {
          file_path: {
            type: 'string',
            description: 'Relative file path within the project (e.g. src/utils/helper.ts)',
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
      name: 'glob',
      description: 'Find files matching a glob pattern (e.g. "**/*.ts", "src/**/*.test.*"). Returns matching file paths sorted by modification time.',
      nameCn: '文件名匹配',
      descriptionCn: '按 glob 模式查找文件（如 "**/*.ts"），返回匹配的文件路径（按修改时间排序）。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Glob pattern (e.g. "**/*.tsx", "src/**/README*")' },
          path: { type: 'string', description: 'Directory to search in (default: current directory)' },
        },
        required: ['pattern'],
      },
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
          timeout_ms: { type: 'number', description: 'Execution timeout in milliseconds (default 30000)' },
        },
        required: ['code', 'language'],
      },
    },
    {
      name: 'iterate_code',
      description: 'Execute code in a loop, fixing errors via LLM up to 3 iterations. Returns final result and fixed code.',
      nameCn: '迭代代码',
      descriptionCn: '循环执行代码，通过 LLM 修复错误（最多 3 次迭代），返回最终结果和修复后的代码',
      parameters: {
        type: 'object',
        properties: {
          task: { type: 'string', description: 'Original task description' },
          code: { type: 'string', description: 'Initial code to execute and iterate on' },
          language: {
            type: 'string',
            description: 'Language (javascript, python, sql, html)',
            enum: ['javascript', 'python', 'sql', 'html'],
          },
          max_iterations: { type: 'number', description: 'Maximum fix iterations (default 3)' },
        },
        required: ['task', 'code', 'language'],
      },
    },
    {
      name: 'save_code',
      description: 'Save tested, reusable code to the code registry for future cross-project reuse. Only save code that has been verified to work — do not save untested or one-off code.',
      nameCn: '保存可复用代码',
      descriptionCn: '将经过测试的可复用代码保存到代码注册表，供跨项目复用。只保存已验证可用的代码，不要保存未测试或一次性的代码。',
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
          timeout_ms: { type: 'number', description: 'Timeout in milliseconds (default 30000)' },
        },
        required: ['command'],
      },
    },
    {
      name: 'search_files',
      description: 'Search file contents by regex pattern (like grep). Returns matching file paths, line numbers, and surrounding context. For large codebases, use glob filter to narrow scope.',
      nameCn: '搜索文件',
      descriptionCn: '按正则表达式搜索文件内容（类似 grep），返回匹配的文件路径、行号和上下文。大型代码库建议用 glob 过滤。',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Regex pattern to search for' },
          path: { type: 'string', description: 'Root directory to search in (default: current directory)' },
          glob: { type: 'string', description: 'File filter glob (e.g. "*.ts", "*.tsx")' },
          case_sensitive: { type: 'boolean', description: 'Case sensitive search (default false)' },
          max_results: { type: 'number', description: 'Maximum number of results (default 100)' },
          context_lines: { type: 'number', description: 'Number of context lines before/after each match (default 0)' },
        },
        required: ['pattern'],
      },
    },
    // --- Web Search ---
    {
      name: 'web_search',
      description: 'Search the web via DuckDuckGo and return title, URL, and snippet for each result. Use this to find current information, documentation, or answers that you don\'t already know. After getting search results, you may want to call web_fetch on interesting URLs to read full page content.',
      nameCn: '联网搜索',
      descriptionCn: '通过 DuckDuckGo 搜索网络，返回标题、URL 和摘要。用于查找你不知道的当前信息、文档或答案。获取搜索结果后可调用 web_fetch 深入阅读感兴趣的 URL。',
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
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to fetch (e.g. https://example.com/article)' },
          timeout: { type: 'number', description: 'Request timeout in seconds (default 25)' },
        },
        required: ['url'],
      },
    },
    // --- Agent Memory ---
    {
      name: 'agent_memory_update',
      description: 'Update long-term memory for an agent. The memory content will be injected into the agent\'s system prompt on subsequent interactions. Use this to remember user preferences, important context, or recurring patterns. Only use when there is genuinely important information worth remembering across sessions.',
      nameCn: '更新Agent记忆',
      descriptionCn: '更新 agent 的长期记忆。记忆内容会被注入到对应 agent 的系统提示词中。用于记住用户偏好、重要上下文或重复出现的模式。仅在确实有值得跨会话记住的重要信息时使用。',
      parameters: {
        type: 'object',
        properties: {
          agent_name: { type: 'string', description: 'Agent name to update memory for (e.g., "chat", "desktopAutomation")' },
          content: { type: 'string', description: 'Memory content — what should be remembered' },
          reason: { type: 'string', description: 'Brief reason why this memory is important' },
          memory_time: { type: 'string', description: 'When the remembered event occurred (e.g., "2026-06-16")' },
        },
        required: ['agent_name', 'content', 'reason', 'memory_time'],
      },
    },
  ];

  private llmCaller: ((messages: LLMMessage[]) => AsyncGenerator<string>) | null = null;
  private modelService: IModelService | null = null;
  private provider: ProviderConfig | null = null;
  private apiKey: string | null = null;

  /**
   * Set the LLM calling function used by generate_code and iterate_code.
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

  // -----------------------------------------------------------------------
  // Execute dispatch
  // -----------------------------------------------------------------------

  async execute(toolName: string, params: Record<string, unknown>): Promise<SkillResult> {
    try {
      switch (toolName) {
        case 'write_file':
          return await this.handleWriteFile(params);
        case 'read_file':
          return await this.handleReadFile(params);
        case 'generate_code':
          return await this.handleGenerateCode(params);
        case 'execute_code':
          return await this.handleExecuteCode(params);
        case 'iterate_code':
          return await this.handleIterateCode(params);
        case 'save_code':
          return await this.handleSaveCode(params);
        case 'list_code':
          return await this.handleListCode(params);
        case 'generate_project':
          return await this.handleGenerateProject(params);
        case 'run_command':
          return await this.handleRunCommand(params);
        case 'search_files':
          return await this.handleSearchFiles(params);
        case 'glob':
          return await this.handleGlob(params);
        case 'web_search':
          return await this.handleWebSearch(params);
        case 'web_fetch':
          return await this.handleWebFetch(params);
        case 'agent_memory_update':
          return await this.handleAgentMemoryUpdate(params);
        default:
          return SkillFail(`Unknown tool: ${toolName}`);
      }
    } catch (e) {
      return SkillFail(`Tool "${toolName}" failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // write_file
  // -----------------------------------------------------------------------

  private async handleWriteFile(params: Record<string, unknown>): Promise<SkillResult> {
    const filePath = params['file_path'] as string;
    const content = params['content'] as string;

    if (!filePath) return SkillFail('file_path is required');
    if (content === undefined) return SkillFail('content is required');

    const result = await tryWriteFile(filePath, content);

    if (result.method === 'memory-cache') {
      return SkillOk(`File written to memory cache: ${filePath}`, {
        file_path: filePath,
        method: result.method,
        note: 'Tauri file-system plugin is not available. Content is cached in memory only.',
      });
    }

    return SkillOk(`File written successfully: ${filePath} (via ${result.method})`, {
      file_path: filePath,
      method: result.method,
    });
  }

  // -----------------------------------------------------------------------
  // read_file
  // -----------------------------------------------------------------------

  private async handleReadFile(params: Record<string, unknown>): Promise<SkillResult> {
    const filePath = params['file_path'] as string;
    if (!filePath) return SkillFail('file_path is required');

    const offset = (params['offset'] as number) ?? 0;
    const limit = (params['limit'] as number) ?? 2000;

    const result = await tryReadFile(filePath);
    if (!result.ok) {
      return SkillFail(`File not found: ${filePath}`, { file_path: filePath });
    }

    const lines = result.content.split('\n');
    const totalLines = lines.length;
    const sliced = lines.slice(offset, offset + limit);

    return SkillOk(`File read: ${filePath} (lines ${offset}-${offset + sliced.length} of ${totalLines})`, {
      file_path: filePath,
      content: sliced.join('\n'),
      total_line_count: totalLines,
      offset,
      limit,
      method: result.method,
    });
  }

  // -----------------------------------------------------------------------
  // generate_code
  // -----------------------------------------------------------------------

  private async handleGenerateCode(params: Record<string, unknown>): Promise<SkillResult> {
    const task = params['task'] as string;
    const language = params['language'] as string;
    const context = params['context'] as string | undefined;
    const constraints = params['constraints'] as string | undefined;
    const appName = params['app_name'] as string | undefined;
    // HTML 默认自动保存以触发实时预览
    const autoSave = (params['auto_save'] as boolean) ?? (language === 'html');

    if (!task) return SkillFail('task is required');
    if (!language) return SkillFail('language is required');

    let llmCaller: (messages: LLMMessage[]) => AsyncGenerator<string>;
    try {
      llmCaller = this.getLlmCaller();
    } catch (e) {
      return SkillFail(e instanceof Error ? e.message : String(e));
    }

    const prompt = buildCodeGenPrompt(task, language, context, constraints);
    const messages: LLMMessage[] = [
      { role: 'system', content: 'You are a code generation assistant. Output only code blocks.' },
      { role: 'user', content: prompt },
    ];

    let fullResponse = '';
    const stream = llmCaller(messages);
    for await (const chunk of stream) {
      fullResponse += chunk;
    }

    const codeBlocks = extractCodeBlocks(fullResponse);
    if (codeBlocks.length === 0) {
      return SkillFail('No code blocks found in LLM response', { response: fullResponse });
    }

    const generatedCode = codeBlocks.join('\n\n');

    // For HTML code, auto-save to apps database if requested
    if (language === 'html' && autoSave) {
      try {
        const db = await getDB();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const name = appName || `Generated App ${new Date().toLocaleTimeString()}`;

        await db.execute(
          'INSERT INTO savedApps (id, name, code, created_at) VALUES (?, ?, ?, ?)',
          [id, name, generatedCode, now],
        );

        // Emit event for real-time preview update
        appEvents.emit(APP_EVENTS.HTML_GENERATED, {
          appId: id,
          name,
          code: generatedCode,
          autoSave: true,
        });

        appEvents.emit(APP_EVENTS.APP_CREATED, {
          id,
          name,
          code: generatedCode,
          created_at: now,
        });

        return SkillOk(`Generated and saved HTML app "${name}"`, {
          code: generatedCode,
          allBlocks: codeBlocks,
          language,
          task,
          appId: id,
          appName: name,
          saved: true,
        });
      } catch (err) {
        console.error('[CodeToolsSkill] Failed to auto-save generated HTML:', err);
      }
    }

    return SkillOk(`Generated ${codeBlocks.length} code block(s)`, {
      code: generatedCode,
      allBlocks: codeBlocks,
      language,
      task,
    });
  }

  // -----------------------------------------------------------------------
  // execute_code
  // -----------------------------------------------------------------------

  private async handleExecuteCode(params: Record<string, unknown>): Promise<SkillResult> {
    const code = params['code'] as string;
    const language = params['language'] as string;
    const timeoutMs = (params['timeout_ms'] as number) ?? 30000;
    const appName = params['app_name'] as string | undefined;
    // HTML 默认自动保存以触发实时预览
    const autoSave = (params['auto_save'] as boolean) ?? (language === 'html');

    if (!code) return SkillFail('code is required');
    if (!language) return SkillFail('language is required');

    const result = await codeSandboxService.execute(
      language as Parameters<typeof codeSandboxService.execute>[0],
      code,
      undefined,
      { timeoutMs },
    );

    // For HTML code, auto-save to apps database if requested
    if (language === 'html' && result.success && autoSave) {
      try {
        const db = await getDB();
        const id = crypto.randomUUID();
        const now = new Date().toISOString();
        const name = appName || `Generated App ${new Date().toLocaleTimeString()}`;

        await db.execute(
          'INSERT INTO savedApps (id, name, code, created_at) VALUES (?, ?, ?, ?)',
          [id, name, code, now],
        );

        // Emit event for real-time preview update
        appEvents.emit(APP_EVENTS.HTML_GENERATED, {
          appId: id,
          name,
          code,
          autoSave: true,
        });

        appEvents.emit(APP_EVENTS.APP_CREATED, {
          id,
          name,
          code,
          created_at: now,
        });

        return SkillOk(
          'HTML code executed and saved to apps',
          {
            success: true,
            output: result.output,
            result: result.result,
            durationMs: result.durationMs,
            truncated: result.truncated,
            htmlContent: result.htmlContent,
            isolatedDocument: result.isolatedDocument,
            appId: id,
            appName: name,
            saved: true,
          },
        );
      } catch (err) {
        // Fall through to normal response if save fails
        console.error('[CodeToolsSkill] Failed to auto-save HTML:', err);
      }
    }

    return SkillOk(
      result.success ? 'Code executed successfully' : 'Code execution failed',
      {
        success: result.success,
        output: result.output,
        error: result.error,
        result: result.result,
        durationMs: result.durationMs,
        truncated: result.truncated,
        htmlContent: result.htmlContent,
        isolatedDocument: result.isolatedDocument,
      },
    );
  }

  // -----------------------------------------------------------------------
  // iterate_code
  // -----------------------------------------------------------------------

  private async handleIterateCode(params: Record<string, unknown>): Promise<SkillResult> {
    const task = params['task'] as string;
    const language = params['language'] as string;
    const maxIterations = Math.min(params['max_iterations'] as number ?? 3, 3);
    let code = params['code'] as string;

    if (!task) return SkillFail('task is required');
    if (!language) return SkillFail('language is required');
    if (!code) return SkillFail('code is required');

    let llmCaller: (messages: LLMMessage[]) => AsyncGenerator<string>;
    try {
      llmCaller = this.getLlmCaller();
    } catch (e) {
      return SkillFail(e instanceof Error ? e.message : String(e));
    }

    for (let i = 0; i < maxIterations; i++) {
      // Execute current code
      const result = await codeSandboxService.execute(
        language as Parameters<typeof codeSandboxService.execute>[0],
        code,
      );

      if (result.success) {
        return SkillOk(`Code executed successfully on iteration ${i + 1}`, {
          code,
          iteration: i + 1,
          output: result.output,
          result: result.result,
          durationMs: result.durationMs,
        });
      }

      // If this was the last iteration, return the error
      if (i >= maxIterations - 1) {
        return SkillFail(`Code failed after ${maxIterations} iterations`, {
          code,
          iteration: i + 1,
          error: result.error ?? 'Unknown error',
          output: result.output,
        });
      }

      // Try to fix via LLM
      const fixPrompt = buildCodeIterPrompt(task, code, language, result.error ?? 'Unknown error');
      const messages: LLMMessage[] = [
        { role: 'system', content: 'You are a code debugging assistant. Fix the code.' },
        { role: 'user', content: fixPrompt },
      ];

      let fixResponse = '';
      const stream = llmCaller(messages);
      for await (const chunk of stream) {
        fixResponse += chunk;
      }

      const fixedBlocks = extractCodeBlocks(fixResponse);
      if (fixedBlocks.length > 0) {
        code = fixedBlocks[0];
      }
      // If no code blocks, keep the original code and loop again
    }

    // Shouldn't reach here, but just in case
    return SkillFail('Code iteration did not produce a successful result');
  }

  // -----------------------------------------------------------------------
  // save_code
  // -----------------------------------------------------------------------

  private async handleSaveCode(params: Record<string, unknown>): Promise<SkillResult> {
    const name = params['name'] as string;
    const code = params['code'] as string;
    const language = params['language'] as string;
    const description = (params['description'] as string) ?? '';
    const tags = (params['tags'] as string[]) ?? [];

    if (!name) return SkillFail('name is required');
    if (!code) return SkillFail('code is required');
    if (!language) return SkillFail('language is required');

    try {
      const id = crypto.randomUUID();
      const now = new Date().toISOString();
      await codeRegistry.save({
        id,
        name,
        description,
        language: language as CodeEntryLanguage,
        code,
        params: [],
        tags,
        createdAt: now,
        updatedAt: now,
        hitCount: 0,
      });

      return SkillOk(`Code "${name}" saved successfully`, { id, name, language });
    } catch (e) {
      return SkillFail(`Failed to save code: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // list_code
  // -----------------------------------------------------------------------

  private async handleListCode(params: Record<string, unknown>): Promise<SkillResult> {
    const search = params['search'] as string | undefined;
    const language = params['language'] as string | undefined;
    const tag = params['tag'] as string | undefined;

    try {
      const entries = await codeRegistry.list({ search, language, tag });
      return SkillOk(`Found ${entries.length} code entr${entries.length === 1 ? 'y' : 'ies'}`, {
        entries: entries.map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          language: e.language,
          tags: e.tags,
          createdAt: e.createdAt,
          hitCount: e.hitCount,
        })),
        count: entries.length,
      });
    } catch (e) {
      return SkillFail(`Failed to list code: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // generate_project (multi-agent pipeline)
  // -----------------------------------------------------------------------

  private async handleGenerateProject(params: Record<string, unknown>): Promise<SkillResult> {
    const request = params['request'] as string;
    if (!request) return SkillFail('request is required');

    if (!this.modelService || !this.provider || !this.apiKey) {
      return SkillFail('ModelService is not configured. Call setModelService() first.');
    }

    // Auto-generate project name from request
    const rawName = (params['project_name'] as string) ?? '';
    const projectName = rawName.trim() || `project-${Date.now().toString(36)}`;

    try {
      // Dynamic import: codeGateway → Orchestrator → AgentRunner → node:fs/promises
      // Must not be statically imported or Vite externalizes it for browser.
      const { codeGateway } = await import('@/services/code-gateway');
      const result = await codeGateway.handleRequest({
        userRequest: request,
        projectName,
        modelService: this.modelService,
        provider: this.provider,
        apiKey: this.apiKey,
      });

      if (!result.success) {
        return SkillFail(`Project generation failed: ${result.error}`, {
          project_name: projectName,
          error: result.error,
        });
      }

      // Result may be a text (simple path) or array of file paths (complex path)
      const files = Array.isArray(result.result) ? result.result as string[] : [];
      const textResult = typeof result.result === 'object' && result.result !== null && 'type' in result.result
        ? (result.result as { type: string; content?: string; blocks?: unknown[] })
        : null;

      // Try to read generated file contents
      const fileContents: Array<{ path: string; content: string }> = [];
      for (const f of files) {
        const readResult = await tryReadFile(f);
        if (readResult.ok) {
          fileContents.push({ path: f, content: readResult.content });
        }
      }

      if (fileContents.length > 0) {
        return SkillOk(`Project "${projectName}" generated successfully with ${fileContents.length} file(s)`, {
          project_name: projectName,
          files: fileContents.map(f => f.path),
          file_contents: fileContents,
          complexity: files.length > 1 ? 'complex' : 'simple',
        });
      }

      // Simple path returned text
      if (textResult?.type === 'code' && textResult.blocks) {
        return SkillOk(`Code generated for project "${projectName}"`, {
          project_name: projectName,
          blocks: textResult.blocks,
        });
      }

      if (textResult?.type === 'text' && textResult.content) {
        return SkillOk(`Response for project "${projectName}"`, {
          project_name: projectName,
          content: textResult.content,
        });
      }

      return SkillOk(`Project "${projectName}" generation completed`, {
        project_name: projectName,
        result: result.result,
      });
    } catch (e) {
      return SkillFail(`Project generation error: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // run_command
  // -----------------------------------------------------------------------

  private async handleRunCommand(params: Record<string, unknown>): Promise<SkillResult> {
    const command = params['command'] as string;
    if (!command) return SkillFail('command is required');

    // Dangerous command check — block outright
    const dangerReason = checkCommandSafety(command);
    if (dangerReason) {
      return SkillFail(`⚠️ 命令被拦截：${dangerReason}。出于安全考虑，此命令需要你在终端中手动执行。`);
    }

    const cwd = params['cwd'] as string | undefined;
    const timeoutMs = (params['timeout_ms'] as number) ?? 30000;

    const result = await tryRunCommand(command, cwd, timeoutMs);

    return SkillOk(
      result.ok ? `Command exited with code ${result.exitCode}` : `Command failed with code ${result.exitCode}`,
      {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
        method: result.method,
      },
    );
  }

  // -----------------------------------------------------------------------
  // search_files
  // -----------------------------------------------------------------------

  private async handleSearchFiles(params: Record<string, unknown>): Promise<SkillResult> {
    const pattern = params['pattern'] as string;
    if (!pattern) return SkillFail('pattern is required');

    const searchPath = params['path'] as string | undefined;
    const glob = params['glob'] as string | undefined;
    const caseSensitive = (params['case_sensitive'] as boolean) ?? false;
    const maxResults = (params['max_results'] as number) ?? 100;
    const contextLines = (params['context_lines'] as number) ?? 0;

    const result = await trySearchFiles(pattern, searchPath, glob, caseSensitive, maxResults, contextLines);
    if (!result.ok) return SkillFail('Search failed');

    return SkillOk(`Found ${result.matches.length} match(es) for pattern "${pattern}"`, {
      matches: result.matches,
      count: result.matches.length,
      method: result.method,
    });
  }

  // -----------------------------------------------------------------------
  // glob
  // -----------------------------------------------------------------------

  private async handleGlob(params: Record<string, unknown>): Promise<SkillResult> {
    const pattern = params['pattern'] as string;
    if (!pattern) return SkillFail('pattern is required');

    const searchPath = (params['path'] as string) ?? '.';

    const result = await tryGlob(pattern, searchPath);
    if (!result.ok) return SkillFail('Glob search failed');

    return SkillOk(`Found ${result.files.length} file(s) matching "${pattern}" (via ${result.method})`, {
      files: result.files.slice(0, 200),
      count: result.files.length,
      method: result.method,
    });
  }

  // -----------------------------------------------------------------------
  // web_search
  // -----------------------------------------------------------------------

  private async handleWebSearch(params: Record<string, unknown>): Promise<SkillResult> {
    const query = params['query'] as string;
    if (!query) return SkillFail('query is required');

    const maxResults = Math.min((params['max_results'] as number) ?? 10, 20);

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{
        success: boolean;
        query?: string;
        results?: Array<{ title: string; url: string; snippet: string }>;
        count?: number;
        error?: string;
      }>('web_search', { query, maxResults });

      if (!result.success) {
        return SkillFail(result.error ?? 'Search failed');
      }

      const results = result.results ?? [];
      // Format as readable text for LLM consumption
      const textResults = results
        .map((r, i) => `${i + 1}. **${r.title}**\n   ${r.snippet}\n   ${r.url}`)
        .join('\n\n');

      return SkillOk(
        `Found ${results.length} result(s) for "${result.query ?? query}"${textResults ? ':\n\n' + textResults : ''}`,
        {
          query: result.query ?? query,
          results,
          count: results.length,
        },
      );
    } catch (e) {
      return SkillFail(`web_search failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // web_fetch
  // -----------------------------------------------------------------------

  private async handleWebFetch(params: Record<string, unknown>): Promise<SkillResult> {
    const url = params['url'] as string;
    if (!url) return SkillFail('url is required');

    const timeout = (params['timeout'] as number) ?? 25;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      const result = await invoke<{
        success: boolean;
        url?: string;
        status_code?: number;
        content?: string;
        content_length?: number;
        truncated?: boolean;
        error?: string;
      }>('web_fetch', { url, timeout });

      if (!result.success) {
        return SkillFail(result.error ?? 'Fetch failed');
      }

      const truncatedNote = result.truncated ? '\n[Content truncated at 50000 characters]' : '';

      return SkillOk(
        `Fetched ${result.url ?? url} (${result.content_length ?? 0} chars)${truncatedNote}\n\n${result.content ?? ''}`,
        {
          url: result.url ?? url,
          status_code: result.status_code,
          content_length: result.content_length,
          truncated: result.truncated,
          content: result.content,
        },
      );
    } catch (e) {
      return SkillFail(`web_fetch failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // -----------------------------------------------------------------------
  // agent_memory_update
  // -----------------------------------------------------------------------

  private async handleAgentMemoryUpdate(params: Record<string, unknown>): Promise<SkillResult> {
    const agentName = params['agent_name'] as string;
    const content = params['content'] as string;
    const reason = params['reason'] as string;
    const memoryTime = params['memory_time'] as string;

    if (!agentName) return SkillFail('agent_name is required');
    if (!content) return SkillFail('content is required');
    if (!reason) return SkillFail('reason is required');
    if (!memoryTime) return SkillFail('memory_time is required');

    try {
      const entry = addMemory(agentName, content, reason, memoryTime);
      return SkillOk(
        `Memory updated for agent "${agentName}". ID: ${entry.id}\n\n当前已有的记忆：\n${formatMemoriesForPrompt(agentName)}`,
        { memory: entry },
      );
    } catch (e) {
      return SkillFail(`agent_memory_update failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

// Re-export for convenience
type CodeEntryLanguage = 'javascript' | 'python' | 'sql' | 'html';
