// 来源: Phase 10.3 — Exponential backoff retry for network failures

export interface RetryOptions {
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  shouldRetry?: (error: unknown) => boolean;
}

const defaults: Required<RetryOptions> = {
  maxAttempts: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30000,
  shouldRetry: (e: unknown) => {
    if (e instanceof TypeError) return true; // Network error (fetch failed)
    if (e instanceof DOMException) return true; // AbortError, etc.
    const msg = String(e);
    if (msg.includes('network') || msg.includes('fetch')) return true;
    if (msg.includes('timeout') || msg.includes('ECONNREFUSED')) return true;
    // Retry on 5xx, 429
    if (msg.includes('503') || msg.includes('502') || msg.includes('504') || msg.includes('429')) return true;
    return false;
  },
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts?: RetryOptions,
): Promise<T> {
  const { maxAttempts, baseDelayMs, maxDelayMs, shouldRetry } = { ...defaults, ...opts };

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < maxAttempts && shouldRetry(e)) {
        const delay = Math.min(baseDelayMs * Math.pow(2, attempt - 1), maxDelayMs);
        const jitter = delay * (0.5 + Math.random() * 0.5); // 50%-100% of delay
        console.debug(`[retry] attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(jitter)}ms:`, e);
        await new Promise((r) => setTimeout(r, jitter));
        continue;
      }
      throw e;
    }
  }

  throw lastError;
}
