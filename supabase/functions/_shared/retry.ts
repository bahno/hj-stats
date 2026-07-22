// Retry with exponential backoff for the undocumented third-party APIs the
// poller depends on. A single blip previously dropped an athlete for the whole
// run (or, for the ranking list, every athlete of that gender).

/** An HTTP status carried on the error, so retryability can be judged by code. */
export class HttpError extends Error {
  constructor(readonly status: number, message?: string) {
    super(message ?? `HTTP ${status}`);
    this.name = 'HttpError';
  }
}

/**
 * Whether a failure is worth another attempt. 429 and 5xx are transient; other
 * 4xx are permanent (a bad slug or a blocked client won't fix itself, and
 * hammering a 403 is exactly how a soft block becomes a hard one). Anything
 * that isn't an HttpError — a socket error, a timeout, malformed JSON — is
 * treated as transient.
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
