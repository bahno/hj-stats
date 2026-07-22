import { describe, it, expect } from 'vitest';
import { HttpError, isRetryable, withRetry } from './retry.ts';

/** Collects the backoff delays instead of waiting them out. */
function recorder() {
  const delays: number[] = [];
  return { delays, sleep: async (ms: number) => void delays.push(ms) };
}

describe('isRetryable', () => {
  it('retries 429 and 5xx', () => {
    expect(isRetryable(new HttpError(429))).toBe(true);
    expect(isRetryable(new HttpError(500))).toBe(true);
    expect(isRetryable(new HttpError(503))).toBe(true);
  });

  it('does NOT retry other 4xx', () => {
    // Hammering a 403 is how a soft block becomes a hard one, and a 404 for a
    // bad slug will never start working.
    expect(isRetryable(new HttpError(403))).toBe(false);
    expect(isRetryable(new HttpError(404))).toBe(false);
    expect(isRetryable(new HttpError(400))).toBe(false);
  });

  it('retries non-HTTP failures (offline, timeout, bad JSON)', () => {
    expect(isRetryable(new TypeError('Failed to fetch'))).toBe(true);
    expect(isRetryable(new Error('Unexpected token'))).toBe(true);
  });
});

describe('withRetry', () => {
  it('returns the first success without sleeping', async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    const out = await withRetry(async () => (calls++, 'ok'), { sleep });
    expect(out).toBe('ok');
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('recovers from a transient failure', async () => {
    const { sleep } = recorder();
    let calls = 0;
    const out = await withRetry(
      async () => {
        if (++calls < 3) throw new HttpError(503);
        return 'recovered';
      },
      { sleep },
    );
    expect(out).toBe('recovered');
    expect(calls).toBe(3);
  });

  it('backs off exponentially', async () => {
    const { delays, sleep } = recorder();
    await expect(
      withRetry(
        async () => {
          throw new HttpError(500);
        },
        { attempts: 4, baseDelayMs: 300, sleep },
      ),
    ).rejects.toThrow('HTTP 500');
    expect(delays).toEqual([300, 600, 1200]); // no sleep after the final attempt
  });

  it('gives up after the configured attempts and rethrows the last error', async () => {
    const { sleep } = recorder();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError(500);
        },
        { attempts: 3, sleep },
      ),
    ).rejects.toThrow('HTTP 500');
    expect(calls).toBe(3);
  });

  it('fails fast on a permanent error — one attempt, no sleep', async () => {
    const { delays, sleep } = recorder();
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls++;
          throw new HttpError(403);
        },
        { sleep },
      ),
    ).rejects.toThrow('HTTP 403');
    expect(calls).toBe(1);
    expect(delays).toEqual([]);
  });

  it('preserves a custom message so the caller can report it', async () => {
    await expect(
      withRetry(async () => {
        throw new HttpError(400, 'getRanking: bad input');
      }),
    ).rejects.toThrow('getRanking: bad input');
  });
});
