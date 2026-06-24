export type CodeLanguage = 'javascript' | 'python' | 'sql' | 'html';

export interface SandboxConfig {
  timeoutMs: number;
  allowNetwork?: boolean;
  allowDDL?: boolean;
  maxRows?: number;
  /** For Python sandbox: bypass SAFE_MODULES whitelist, allow all imports */
  allowAllImports?: boolean;
  /** For HTML sandbox: allow external resources (images, scripts, styles) */
  allowExternalResources?: boolean;
  /** For HTML sandbox: base URL for resolving relative paths */
  baseUrl?: string;
}

export interface SandboxResult {
  success: boolean;
  output: string;
  error?: string;
  result?: unknown;
  durationMs: number;
  truncated: boolean;
  /** For HTML sandbox: sanitized HTML content ready for iframe rendering */
  htmlContent?: string;
  /** For HTML sandbox: isolated document with all resources inlined */
  isolatedDocument?: string;
}
