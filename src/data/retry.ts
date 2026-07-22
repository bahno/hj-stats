/**
 * Retry with exponential backoff for the two undocumented third-party APIs the
 * app reads (see rankingApi.ts and athleteResultsApi.ts). A single blip
 * otherwise surfaces to the user as a failed lookup.
 *
 * Deliberately separate from the edge functions' `_shared/retry.ts`: that one
 * runs under Deno and belongs to the poller, and importing across the boundary
 * would pull server-side code into the browser bundle.
 */

/** An HTTP status carried on the error, so retryability can be judged by code. */
export class HttpError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/**
 * 429 and 5xx are transient. Other 4xx are permanent — a bad id or a blocked
 * client won't fix itself, and retrying a 403 risks turning a soft block into a
 * hard one. Non-HTTP failures (offline, timeout, bad JSON) are transient.
 */
export function isRetryable(e: unknown): boolean {
  if (e instanceof HttpError) return e.status === 429 || e.status >= 500;
  return true;
}

export interface RetryOptions {
  attempts?: number;
  /** Delay before retry n (0-based): 300ms, 600ms, 1200ms… */
  baseDelayMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Run `fn`, retrying transient failures. Throws the last error if all fail. */
export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 300;
  const sleep = opts.sleep ?? defaultSleep;

  let lastError: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (!isRetryable(e) || attempt === attempts - 1) throw e;
      await sleep(baseDelayMs * 2 ** attempt);
    }
  }
  throw lastError;
}
