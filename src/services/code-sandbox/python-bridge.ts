/**
 * Python-engine bridge.
 *
 * This module provides the communication layer between the TypeScript
 * code-sandbox and the Python sidecar (python-engine/main.py).
 *
 * Calls are routed through the Tauri bridge (Rust IPC → Python child process).
 */

export interface PythonExecParams {
  code: string;
  timeoutSec?: number;
  params?: Record<string, unknown>;
  /** Bypass SAFE_MODULES whitelist, allow all Python imports */
  allowAllImports?: boolean;
}

export interface PythonExecResult {
  success: boolean;
  output: string;
  error?: string;
  result?: unknown;
  durationMs: number;
  truncated: boolean;
}

/**
 * Execute Python code via the python-engine sidecar.
 *
 * Routes through Tauri invoke → Rust bridge → Python child process.
 * The python-engine/main.py handles "exec_python" with a restricted
 * sandbox (SAFE_MODULES whitelist, no os/subprocess/ctypes).
 */
export async function bridgeExecPython(params: PythonExecParams): Promise<PythonExecResult> {
  // Dynamic import so the module works outside Tauri (e.g. test env)
  const { invoke } = await import('@tauri-apps/api/core');

  const result = await invoke<PythonExecResult>('exec_python', {
    code: params.code,
    timeoutSec: params.timeoutSec ?? 30,
    params: params.params ?? {},
    allowAllImports: params.allowAllImports ?? false,
  });

  return result;
}
