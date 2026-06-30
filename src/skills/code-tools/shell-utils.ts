// Shell/FS utilities for code-tools: command safety, execution, directory listing, file search, glob.

import { tryReadFile } from './helpers';

const isWindows = (typeof process !== 'undefined' && process.platform === 'win32') ||
  (typeof navigator !== 'undefined' && /Win/i.test(navigator.platform || ''));

/**
 * Resolve the user's home directory as default search root.
 * Tauri desktop agents should search from ~/ not the project directory.
 */
let _homeDir: string | null = null;
async function getHomeDir(): Promise<string> {
  if (_homeDir) return _homeDir;
  try {
    const { homeDir } = await import('@tauri-apps/api/path');
    _homeDir = await homeDir();
    return _homeDir;
  } catch { /* not in Tauri or path API unavailable */ }
  // Browser / Node fallback
  if (typeof process !== 'undefined' && process.env) {
    _homeDir = process.env.USERPROFILE || process.env.HOME || '';
    if (_homeDir) return _homeDir;
  }
  _homeDir = '.';
  return _homeDir;
}

/**
 * Resolve the workspace directory (where write_file stores relative paths).
 * Priority: 1) User-configured setting  2) Project root /workspace  3) home/workspace
 */
let _workspaceDir: string | null = null;
export function clearWorkspaceDirCache(): void {
  _workspaceDir = null;
}
export async function getWorkspaceDir(): Promise<string> {
  if (_workspaceDir) return _workspaceDir;

  // 1. 用户自定义工作目录（最高优先级）
  try {
    const { useSettingsStore } = await import('@/stores/settings-store');
    const userPath = useSettingsStore.getState().workspacePath;
    if (userPath) {
      // Normalize: ensure the path ends with the workspace directory name
      const normalized = userPath.replace(/\\/g, '/').replace(/\/+$/, '');
      _workspaceDir = normalized;
      console.log(`[workspace] Using user-configured path: ${_workspaceDir}`);
      return _workspaceDir;
    }
  } catch { /* settings store not available */ }

  // 2. 默认：项目根目录/workspace（后端通过 src-tauri/Cargo.toml 标记文件定位）
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const projectRoot = (await invoke<string>('get_project_dir')).replace(/\\/g, '/');
    _workspaceDir = projectRoot + '/workspace';
    console.log(`[workspace] Using project root workspace: ${_workspaceDir}`);
    return _workspaceDir;
  } catch { /* not in Tauri or path API unavailable */ }

  // 3. 兜底：用户主目录/workspace
  _workspaceDir = (await getHomeDir()).replace(/\\/g, '/').replace(/\/+$/, '') + '/workspace';
  console.log(`[workspace] Fallback to home dir: ${_workspaceDir}`);
  return _workspaceDir;
}

/**
 * Resolve a searchPath for glob/grep to an absolute path.
 * - No path → user home directory (legacy default)
 * - Absolute path → use as-is
 * - workspace/... → resolve to project root workspace/...
 * - Other relative → resolve relative to workspace
 */
export async function resolveSearchPath(searchPath?: string): Promise<string> {
  if (!searchPath) return getHomeDir();
  // Already absolute
  if (searchPath.includes(':') || searchPath.startsWith('/') || searchPath.startsWith('\\')) {
    return searchPath;
  }
  // workspace/ paths → resolve to actual workspace dir
  const wsDir = await getWorkspaceDir();
  const normalized = searchPath.replace(/\\/g, '/');
  if (normalized.startsWith('workspace/')) {
    return wsDir.replace(/\\/g, '/') + '/' + normalized.slice('workspace/'.length);
  }
  if (normalized === 'workspace') {
    return wsDir;
  }
  // Other relative paths → resolve relative to workspace
  return wsDir.replace(/\\/g, '/') + '/' + normalized;
}

// ---------------------------------------------------------------------------
// Command safety
// ---------------------------------------------------------------------------

/** Dangerous command patterns — blocked outright, never executed. */
export const DANGEROUS_PATTERNS: Array<{ pattern: RegExp; reason: string }> = [
  { pattern: /\brm\s+(-[rRf]+\s+|--recursive)/i, reason: '递归删除文件（rm -rf）' },
  { pattern: /\brmdir\s+\/s/i, reason: '递归删除目录（rmdir /s）' },
  { pattern: /\bdel\s+\/s/i, reason: '递归删除文件（del /s）' },
  { pattern: /\bformat\s+[a-z]:/i, reason: '格式化磁盘' },
  { pattern: /\breg\s+delete\b/i, reason: '删除注册表项' },
  { pattern: /\bregedit\b/i, reason: '注册表编辑器' },
  { pattern: /\bshutdown\b/i, reason: '关机/重启' },
  { pattern: /\breboot\b/i, reason: '重启系统' },
  { pattern: /\btaskkill\b/i, reason: '终止进程（taskkill）' },
  { pattern: /\btskill\b/i, reason: '终止进程（tskill）' },
  { pattern: /\bStop-Process\b/i, reason: '终止进程（PowerShell）' },
  { pattern: /\bwmic\b.*\b(delete|terminate|call)\b/i, reason: '终止进程（WMI）' },
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
export function checkCommandSafety(command: string): string | null {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Command execution
// ---------------------------------------------------------------------------

/** Execute a shell command via backend API. Returns stdout+stderr+exitCode. */
export async function tryRunCommand(
  command: string,
  cwd?: string,
  timeoutMs = 30000,
): Promise<{ ok: boolean; stdout: string; stderr: string; exitCode: number; method: string; cwd?: string }> {
  // Resolve workspace-relative cwd to absolute path; default to workspace dir
  const resolvedCwd = cwd ? await resolveSearchPath(cwd) : await getWorkspaceDir();
  try {
    const t0 = Date.now();
    const { getApiBaseUrl } = await import('@/api/client');
    const url = `${getApiBaseUrl()}/api/agent/run-command`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        params: { command, cwd: resolvedCwd, timeout_ms: timeoutMs },
      }),
    });
    const json = await response.json() as { ok: boolean; data?: { ok: boolean; stdout: string; stderr: string; exitCode: number; method: string }; error?: string };
    const elapsed = Date.now() - t0;
    if (!json.ok || !json.data) {
      console.log(`[tryRunCommand] FAIL ${elapsed}ms cmd="${command}" error="${json.error || 'no data'}"`);
      return { ok: false, stdout: '', stderr: json.error ?? 'Backend request failed', exitCode: -1, method: 'error', cwd: resolvedCwd };
    }
    const outLen = json.data.stdout?.length ?? 0;
    const errLen = json.data.stderr?.length ?? 0;
    console.log(`[tryRunCommand] OK ${elapsed}ms cmd="${command}" exit=${json.data.exitCode} stdout=${outLen}B stderr=${errLen}B cwd=${resolvedCwd || '(default)'}`);
    return { ...json.data, cwd: resolvedCwd };
  } catch (e) {
    return {
      ok: false,
      stdout: '',
      stderr: e instanceof Error ? e.message : String(e),
      exitCode: -1,
      method: 'error',
      cwd: resolvedCwd,
    };
  }
}

// ---------------------------------------------------------------------------
// Directory listing
// ---------------------------------------------------------------------------

/** List directory entries via Tauri fs plugin. */
export async function tryListDir(
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

// ---------------------------------------------------------------------------
// Output parsers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// File search
// ---------------------------------------------------------------------------

/**
 * Search file contents — shells out to rg/grep/findstr for speed.
 * Tries rg first (fastest, native context support), then platform fallback.
 */
/**
 * Find the surrounding "block" (paragraph / code block) boundaries for a line.
 * Blocks are delimited by empty lines. Returns 1-based line numbers.
 */
function findBlock(lines: string[], matchIdx: number): { start_line: number; end_line: number } {
  let start = matchIdx;
  let end = matchIdx;
  while (start > 0 && lines[start - 1].trim() !== '') start--;
  while (end < lines.length - 1 && lines[end + 1].trim() !== '') end++;
  return { start_line: start + 1, end_line: end + 1 };
}

export async function trySearchFiles(
  pattern: string,
  searchPath?: string,
  glob?: string,
  caseSensitive = false,
  maxResults = 100,
  contextLines = 2,
): Promise<{ ok: boolean; matches: Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] }; block?: { start_line: number; end_line: number } }>; method: string; error?: string }> {
  const cwd = await resolveSearchPath(searchPath);
  const errors: string[] = [];
  console.log(`[grep_files] pattern="${pattern}" searchPath="${searchPath || '(default)'}" glob="${glob || ''}"`);

  // ── Single-file mode: searchPath looks like a file path ──
  const looksLikeFile = searchPath && /\.[a-zA-Z0-9]{1,10}$/.test(searchPath);
  if (looksLikeFile && !glob) {
    console.log(`[grep_files] → file-read: "${searchPath}"`);
    try {
      const t0 = Date.now();
      const result = await tryReadFile(searchPath);
      if (result.ok) {
        const flags = caseSensitive ? 'g' : 'gi';
        const regex = new RegExp(pattern, flags);
        const matches: Array<{ file: string; line: number; text: string; context?: { before: string[]; after: string[] }; block?: { start_line: number; end_line: number } }> = [];
        const lines = result.content.split('\n');
        for (let i = 0; i < lines.length; i++) {
          if (matches.length >= maxResults) break;
          regex.lastIndex = 0;
          if (regex.test(lines[i])) {
            const m: typeof matches[0] = {
              file: searchPath, line: i + 1, text: lines[i].trim(),
              block: findBlock(lines, i),
            };
            if (contextLines > 0) {
              m.context = {
                before: lines.slice(Math.max(0, i - contextLines), i).map(l => l.trimEnd()),
                after: lines.slice(i + 1, i + 1 + contextLines).map(l => l.trimEnd()),
              };
            }
            matches.push(m);
          }
        }
        console.log(`[grep_files] ✓ file-read: ${matches.length} matches (${Date.now() - t0}ms)`);
        return { ok: true, matches, method: 'file-read' };
      }
    } catch (e) { errors.push(`file-read: ${e instanceof Error ? e.message : String(e)}`); }
  }

  // ── Strategy 1: ripgrep (fastest, works on all platforms) ──
  try {
    const rgArgs: string[] = ['--no-heading', '-n'];
    if (!caseSensitive) rgArgs.push('-i');
    if (contextLines > 0) rgArgs.push('-C', String(contextLines));
    if (glob) rgArgs.push('-g', glob);
    rgArgs.push('-m', String(maxResults));
    rgArgs.push('--', pattern);
    const rgCmd = `rg ${rgArgs.join(' ')}`;
    console.log(`[grep_files] → rg: ${rgCmd}`);

    const rgResult = await tryRunCommand(rgCmd, cwd, 60000);
    if (rgResult.ok && rgResult.exitCode === 0 && rgResult.stdout.trim()) {
      const matches = parseRgOutput(rgResult.stdout, contextLines);
      console.log(`[grep_files] ✓ rg: ${matches.length} matches`);
      return { ok: true, matches, method: 'rg' };
    }
    const rgDetail = `ok=${rgResult.ok} exit=${rgResult.exitCode} stderr=${rgResult.stderr?.slice(0, 100) || '(empty)'}`;
    if (rgResult.stderr) errors.push(`rg: ${rgResult.stderr.slice(0, 200)}`);
    console.log(`[grep_files] ✗ rg: ${rgDetail}`);
  } catch { errors.push('rg: not available'); console.log(`[grep_files] ✗ rg: not installed`); }

  // ── Strategy 2: platform fallback ──
  try {
    if (isWindows) {
      // findstr /s = recursive, /n = line numbers
      const fsArgs = ['/s', '/n'];
      if (!caseSensitive) fsArgs.push('/i');
      const fileFilter = glob ? glob.replace(/\*\*/g, '*').replace(/\*/g, '*') : '*';
      const cmd = `findstr ${fsArgs.join(' ')} /c:"${pattern}" ${fileFilter}`;
      console.log(`[grep_files] → findstr: ${cmd} in ${cwd}`);
      const result = await tryRunCommand(cmd, cwd, 30000);
      if (result.ok && result.exitCode === 0 && result.stdout.trim()) {
        const matches = parseFindstrOutput(result.stdout, maxResults);
        console.log(`[grep_files] ✓ findstr: ${matches.length} matches`);
        return { ok: true, matches, method: 'findstr' };
      }
      const fsDetail = `ok=${result.ok} exit=${result.exitCode} stderr=${result.stderr?.slice(0, 100) || '(empty)'}`;
      if (result.stderr) errors.push(`findstr: ${result.stderr.slice(0, 200)}`);
      console.log(`[grep_files] ✗ findstr failed (${fsDetail})`);
    } else {
      // grep -rn = recursive + line numbers
      const grepArgs = ['-rn', '-n'];
      if (!caseSensitive) grepArgs.push('-i');
      if (contextLines > 0) grepArgs.push('-C', String(contextLines));
      grepArgs.push('-m', String(maxResults));
      grepArgs.push('--include', glob ?? '*');
      grepArgs.push('--', pattern);
      const grepCmd = `grep ${grepArgs.join(' ')}`;
      console.log(`[grep_files] → grep: ${grepCmd}`);

      const result = await tryRunCommand(grepCmd, cwd, 30000);
      if (result.ok && result.exitCode === 0 && result.stdout.trim()) {
        const matches = parseGrepOutput(result.stdout, contextLines);
        console.log(`[grep_files] ✓ grep: ${matches.length} matches`);
        return { ok: true, matches, method: 'grep' };
      }
      const grepDetail = `ok=${result.ok} exit=${result.exitCode} stderr=${result.stderr?.slice(0, 100) || '(empty)'}`;
      if (result.stderr) errors.push(`grep: ${result.stderr.slice(0, 200)}`);
      console.log(`[grep_files] ✗ grep failed (${grepDetail})`);
    }
  } catch (e) { errors.push('system command: failed'); console.log(`[grep_files] ✗ system command failed: ${e instanceof Error ? e.message : String(e)}`); }

  return { ok: false, matches: [], method: 'error', error: errors.join(' | ') };
}

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------

/**
 * Find files matching a glob pattern — shells out to rg --files or find/dir.
 */
export async function tryGlob(
  pattern: string,
  searchPath?: string,
): Promise<{ ok: boolean; files: string[]; method: string; error?: string }> {
  const cwd = await resolveSearchPath(searchPath);
  const errors: string[] = [];
  console.log(`[glob_files] pattern="${pattern}" searchPath="${searchPath || '(default)'}" cwd="${cwd}"`);

  // ── Try Everything Search (es.exe) — sub-second via NTFS MFT ──
  console.log(`[glob_files] → es: es.exe "${pattern}"`);
  try {
    const esResult = await tryRunCommand(`es.exe "${pattern}"`, cwd, 30000);
    if (esResult.ok && esResult.exitCode === 0 && esResult.stdout.trim()) {
      const files = esResult.stdout.split('\n').filter(f => f.trim().length > 0);
      console.log(`[glob_files] ✓ es: ${files.length} files`);
      return { ok: true, files, method: 'es' };
    }
    if (esResult.stderr) console.log(`[glob_files] ✗ es: ${esResult.stderr.slice(0, 100)}`);
    else console.log(`[glob_files] ✗ es: not installed or no results`);
  } catch { console.log(`[glob_files] ✗ es: error`); }

  // ── Try rg --files (fast) ──
  const rgCmd = `rg --files -g "${pattern}"`;
  console.log(`[glob_files] → rg: ${rgCmd}`);
  try {
    const rgResult = await tryRunCommand(rgCmd, cwd, 60000);
    if (rgResult.ok && rgResult.exitCode === 0 && rgResult.stdout.trim()) {
      const files = rgResult.stdout.split('\n').filter(f => f.length > 0);
      console.log(`[glob_files] ✓ rg: ${files.length} files`);
      return { ok: true, files, method: 'rg' };
    }
    const rgDetail = `ok=${rgResult.ok} exit=${rgResult.exitCode} stderr=${rgResult.stderr?.slice(0, 100) || '(empty)'}`;
    if (rgResult.stderr) errors.push(`rg: ${rgResult.stderr.slice(0, 200)}`);
    console.log(`[glob_files] ✗ rg: ${rgDetail}`);
  } catch { errors.push('rg: not available'); console.log(`[glob_files] ✗ rg: not installed`); }

  // ── Platform fallback ──
  try {
    if (isWindows) {
      // Translate simple glob to dir wildcard to filter at OS level (avoid stdout overflow)
      // Extract leaf filename filter for dir — dir /s is already recursive,
      // so **/ and path components are redundant for OS-level filtering.
      // e.g. "**/*.xlsx" → "*.xlsx",  "src/**/固定*" → "固定*"
      const leafPattern = pattern.replace(/^.*[\\/]/, '').replace(/^\*\*\//, '');
      // Always pass a filename filter to dir — exact names work too (e.g. "固定资产.xlsx")
      const dirFilter = leafPattern || null;
      const dirCmd = dirFilter
        ? `dir /s /b ${dirFilter} 2>nul`
        : `dir /s /b 2>nul`;
      console.log(`[glob_files] → dir: ${dirCmd} (pattern="${pattern}" → leafFilter="${dirFilter || 'none'}")`);
      const result = await tryRunCommand(dirCmd, cwd, 60000);
      if (result.ok && result.exitCode === 0 && result.stdout.trim()) {
        let files: string[];
        if (dirFilter && leafPattern === pattern) {
          // Exact match — no extra post-filter needed
          files = result.stdout.split('\n').filter(f => f.trim().length > 0);
        } else {
          const globRegex = pattern
            .replace(/[.+^${}()|[\]\\]/g, '\\$&')
            .replace(/\{([^}]+)\}/g, (_, alts: string) => `(${alts.split(',').join('|')})`)
            .replace(/\*\*/g, '<<GLOBSTAR>>')
            .replace(/\*/g, '[^/\\\\]*')
            .replace(/\?/g, '[^/\\\\]')
            .replace(/<<GLOBSTAR>>/g, '.*');
          const regex = new RegExp(`^${globRegex}$`, 'i');
          files = result.stdout.split('\n').filter(f => f.trim() && regex.test(f.trim()));
        }
        console.log(`[glob_files] ✓ dir: ${files.length} files`);
        return { ok: true, files, method: 'dir' };
      }
      const timedOut = !result.ok && result.exitCode === 0 && !result.stderr;
      const dirDetail = `ok=${result.ok} exit=${result.exitCode}${timedOut ? ' (likely timeout)' : ''} stderr=${result.stderr?.slice(0, 100) || '(empty)'}`;
      if (result.stderr) errors.push(`dir: ${result.stderr.slice(0, 200)}`);
      console.log(`[glob_files] ✗ dir: ${dirDetail}`);
    } else {
      const result = await tryRunCommand(`find . -type f`, cwd, 30000);
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
        console.log(`[glob_files] ✓ find: ${files.length} files`);
        return { ok: true, files, method: 'find' };
      }
      const findDetail = `ok=${result.ok} exit=${result.exitCode} stderr=${result.stderr?.slice(0, 100) || '(empty)'}`;
      if (result.stderr) errors.push(`find: ${result.stderr.slice(0, 200)}`);
      console.log(`[glob_files] ✗ find failed (${findDetail})`);
    }
  } catch { errors.push('system command: failed'); console.log(`[glob_files] ✗ system command failed`); }

  return { ok: false, files: [], method: 'error', error: errors.join(' | ') };
}
