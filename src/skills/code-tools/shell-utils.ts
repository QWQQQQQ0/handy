// Shell/FS utilities for code-tools: command safety, execution, directory listing, file search, glob.

import { tryReadFile } from './helpers';

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
export async function trySearchFiles(
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

// ---------------------------------------------------------------------------
// Glob
// ---------------------------------------------------------------------------

/**
 * Find files matching a glob pattern — shells out to rg --files or find/dir.
 */
export async function tryGlob(
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
