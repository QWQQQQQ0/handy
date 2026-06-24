// Shared helpers for code-tools skill: file I/O, code block extraction, prompt builders.

/** In-memory fallback for file operations when Tauri backend is not wired. */
export const fileCache = new Map<string, string>();

/** Try to write a file via Tauri plugin-fs, falling back to memory cache. */
export async function tryWriteFile(filePath: string, content: string): Promise<{ ok: boolean; path: string; method: string }> {
  // Resolve relative paths to workspace/ unless already there or absolute
  const resolved = filePath.startsWith('workspace/') || filePath.startsWith('workspace\\') || filePath.includes(':')
    ? filePath
    : `workspace/${filePath.startsWith('/') ? filePath.slice(1) : filePath}`;
  fileCache.set(resolved, content);

  // Attempt 1: @tauri-apps/plugin-fs (optional dependency, not guaranteed to be installed)
  try {
    // @ts-ignore — plugin-fs is optional; failure is caught at runtime
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(resolved, content);
    return { ok: true, path: resolved, method: 'plugin-fs' };
  } catch {
    // fall through
  }

  // Attempt 2: @tauri-apps/api/core invoke (Rust command may not exist)
  try {
    const { invoke } = await import('@tauri-apps/api/core');
    await invoke('write_file', { path: resolved, content });
    return { ok: true, path: resolved, method: 'invoke' };
  } catch {
    // fall through — file is still in memory cache
  }

  return { ok: true, path: resolved, method: 'memory-cache' };
}

/** Try to read a file via Tauri plugin-fs, falling back to memory cache. */
export async function tryReadFile(filePath: string): Promise<{ ok: boolean; content: string; method: string }> {
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
export function extractCodeBlocks(text: string): string[] {
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
export function buildCodeGenPrompt(task: string, language: string, context?: string, constraints?: string): string {
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
