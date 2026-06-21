/**
 * HTML code sandbox.
 *
 * Creates an isolated HTML document suitable for iframe `srcdoc` rendering.
 * Features:
 *   - Extracts and processes HTML, CSS, and JavaScript from code blocks
 *   - Sanitizes dangerous patterns (inline event handlers, javascript: URLs)
 *   - Wraps JS in a sandboxed script with console capture
 *   - Returns a complete HTML document ready for iframe rendering
 *
 * Security model:
 *   - Scripts run inside a try-catch with console capture
 *   - Dangerous patterns are stripped (on* attributes, javascript: URLs)
 *   - External resources are blocked by default (allowExternalResources flag)
 *   - Content is rendered in a sandboxed iframe (frontend responsibility)
 */

import type { SandboxConfig, SandboxResult } from './sandbox-types';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_HTML_SIZE = 1_000_000; // 1MB limit

// Patterns to sanitize for security
const DANGEROUS_PATTERNS = [
  // Inline event handlers
  /\bon\w+\s*=\s*["'][^"']*["']/gi,
  /\bon\w+\s*=\s*\w+/gi,
  // javascript: URLs
  /href\s*=\s*["']javascript:[^"']*["']/gi,
  /src\s*=\s*["']javascript:[^"']*["']/gi,
  // data: URLs with script content
  /src\s*=\s*["']data:text\/html[^"']*["']/gi,
];

// ---------------------------------------------------------------------------
// HTML parsing helpers
// ---------------------------------------------------------------------------

interface ParsedHTML {
  head: string;
  body: string;
  styles: string[];
  scripts: string[];
  hasDoctype: boolean;
  hasHtmlTag: boolean;
}

/**
 * Extract components from HTML code.
 * Handles both full HTML documents and HTML fragments.
 */
function parseHTMLCode(code: string): ParsedHTML {
  const result: ParsedHTML = {
    head: '',
    body: '',
    styles: [],
    scripts: [],
    hasDoctype: false,
    hasHtmlTag: false,
  };

  // Check for doctype
  result.hasDoctype = /<!DOCTYPE\s+html/i.test(code);

  // Check for full HTML structure
  result.hasHtmlTag = /<html[\s>]/i.test(code);

  // Extract <style> blocks
  const styleRegex = /<style[^>]*>([\s\S]*?)<\/style>/gi;
  let match;
  while ((match = styleRegex.exec(code)) !== null) {
    result.styles.push(match[1]);
  }

  // Extract <script> blocks
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  while ((match = scriptRegex.exec(code)) !== null) {
    // Skip external scripts (src attribute)
    if (!/<script[^>]+src=/i.test(match[0])) {
      result.scripts.push(match[1]);
    }
  }

  // Extract head content
  const headMatch = code.match(/<head[^>]*>([\s\S]*?)<\/head>/i);
  if (headMatch) {
    result.head = headMatch[1];
  }

  // Extract body content (without scripts)
  const bodyMatch = code.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    result.body = bodyMatch[1].replace(scriptRegex, '').trim();
  } else if (!result.hasHtmlTag) {
    // Treat entire code as body content if no HTML structure
    result.body = code.replace(styleRegex, '').replace(scriptRegex, '').trim();
  }

  return result;
}

/**
 * Sanitize HTML to remove dangerous patterns.
 */
function sanitizeHTML(html: string): string {
  let sanitized = html;
  for (const pattern of DANGEROUS_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }
  return sanitized;
}

/**
 * Create a sandboxed JavaScript wrapper with console capture.
 */
function wrapScriptInSandbox(script: string): string {
  return `
(function() {
  const __logs = [];
  const __console = {
    log: function() { __logs.push(Array.from(arguments).map(String).join(' ')); },
    info: function() { __logs.push('[INFO] ' + Array.from(arguments).map(String).join(' ')); },
    warn: function() { __logs.push('[WARN] ' + Array.from(arguments).map(String).join(' ')); },
    error: function() { __logs.push('[ERROR] ' + Array.from(arguments).map(String).join(' ')); },
    debug: function() { __logs.push('[DEBUG] ' + Array.from(arguments).map(String).join(' ')); },
    clear: function() { __logs.length = 0; },
    table: function(data) { __logs.push(JSON.stringify(data, null, 2)); },
  };

  // Override console in this scope
  const console = __console;

  // Capture errors
  window.__sandboxErrors = [];

  try {
    ${script}
  } catch (err) {
    window.__sandboxErrors.push(err.message || String(err));
    __console.error(err.message || String(err));
  }

  // Expose logs for parent to read
  window.__sandboxLogs = __logs;
})();`;
}

// ---------------------------------------------------------------------------
// Build isolated HTML document
// ---------------------------------------------------------------------------

interface BuildDocumentOptions {
  parsed: ParsedHTML;
  allowExternalResources: boolean;
  baseUrl?: string;
}

function buildIsolatedDocument(options: BuildDocumentOptions): string {
  const { parsed, allowExternalResources, baseUrl } = options;

  // Sanitize body content
  const sanitizedBody = sanitizeHTML(parsed.body);

  // Build CSP directives
  const cspDirectives = [
    "default-src 'self' 'unsafe-inline' 'unsafe-eval'",
    allowExternalResources
      ? "img-src * data: blob:"
      : "img-src 'self' data: blob:",
    allowExternalResources
      ? "font-src * data:"
      : "font-src 'self' data:",
    allowExternalResources
      ? "style-src 'self' 'unsafe-inline' *"
      : "style-src 'self' 'unsafe-inline'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
  ].join('; ');

  // Build base tag if provided
  const baseTag = baseUrl ? `<base href="${baseUrl}">` : '';

  // Combine all styles
  const allStyles = parsed.styles.join('\n');

  // Wrap all scripts
  const wrappedScripts = parsed.scripts.map(wrapScriptInSandbox).join('\n');

  // Build the complete document
  const document = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="${cspDirectives}">
  ${baseTag}
  <style>
    /* Reset and base styles */
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
      line-height: 1.6;
      color: #333;
      padding: 16px;
    }
    ${allStyles}
  </style>
  ${parsed.head}
</head>
<body>
  ${sanitizedBody}
  <script>
    ${wrappedScripts}
  </script>
</body>
</html>`;

  return document;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute HTML code in a sandboxed environment.
 *
 * @param code    - HTML source code (can be full document or fragment).
 * @param config  - Sandbox configuration overrides.
 * @returns SandboxResult with htmlContent for iframe rendering.
 */
export async function executeHTML(
  code: string,
  config?: Partial<SandboxConfig>,
): Promise<SandboxResult> {
  const startTime = performance.now();

  // Validate input size
  if (code.length > MAX_HTML_SIZE) {
    return {
      success: false,
      output: '',
      error: `HTML code exceeds maximum size of ${MAX_HTML_SIZE} bytes`,
      durationMs: Math.round(performance.now() - startTime),
      truncated: true,
    };
  }

  try {
    // Parse the HTML code
    const parsed = parseHTMLCode(code);

    // Build isolated document
    const isolatedDocument = buildIsolatedDocument({
      parsed,
      allowExternalResources: config?.allowExternalResources ?? false,
      baseUrl: config?.baseUrl,
    });

    const durationMs = Math.round(performance.now() - startTime);

    return {
      success: true,
      output: 'HTML document generated successfully',
      result: {
        hasStyles: parsed.styles.length > 0,
        hasScripts: parsed.scripts.length > 0,
        isFullDocument: parsed.hasHtmlTag,
      },
      durationMs,
      truncated: false,
      htmlContent: code,
      isolatedDocument,
    };
  } catch (err: unknown) {
    const durationMs = Math.round(performance.now() - startTime);
    const error = err instanceof Error ? err.message : String(err);

    return {
      success: false,
      output: '',
      error: `HTML processing failed: ${error}`,
      durationMs,
      truncated: false,
    };
  }
}
