import { describe, it, expect, vi } from 'vitest';
import { withRetry, HttpRetryableError, parseRetryAfter } from '../src/transport/retry.js';

describe('parseRetryAfter', () => {
  it('parses seconds', () => {
    expect(parseRetryAfter('30')).toBe(30_000);
  });
  it('parses HTTP-date', () => {
    const future = new Date(Date.now() + 60_000).toUTCString();
    const ms = parseRetryAfter(future);
    expect(ms).toBeGreaterThanOrEqual(50_000);
    expect(ms).toBeLessThanOrEqual(70_000);
  });
  it('returns undefined for nonsense', () => {
    expect(parseRetryAfter('not-a-date')).toBeUndefined();
    expect(parseRetryAfter(null)).toBeUndefined();
  });
});

describe('withRetry', () => {
  it('retries retryable HTTP errors and surfaces the eventual success', async () => {
    let calls = 0;
    const out = await withRetry(
      async () => {
        calls += 1;
        if (calls < 3) throw new HttpRetryableError(503);
        return 'ok';
      },
      { initialDelayMs: 1, factor: 1, jitter: 0, maxAttempts: 5 },
    );
    expect(out).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    const fn = vi.fn(async () => {
      throw new Error('hard failure');
    });
    await expect(
      withRetry(fn, { initialDelayMs: 1, factor: 1, jitter: 0, maxAttempts: 3 }),
    ).rejects.toThrow('hard failure');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('honours Retry-After hint over backoff', async () => {
    let firstAt = 0;
    let secondAt = 0;
    let calls = 0;
    await withRetry(
      async () => {
        calls += 1;
        if (calls === 1) {
          firstAt = Date.now();
          throw new HttpRetryableError(429, 120); // hint: 120ms
        }
        secondAt = Date.now();
        return 'ok';
      },
      { initialDelayMs: 1000, factor: 2, jitter: 0, maxAttempts: 3 },
    );
    const delay = secondAt - firstAt;
    expect(delay).toBeGreaterThanOrEqual(100);
    expect(delay).toBeLessThan(400);
  });

  it('aborts immediately when signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(withRetry(async () => 'never', { maxAttempts: 3 }, ac.signal)).rejects.toThrow();
  });

  it('throws the last error after exhausting attempts', async () => {
    let calls = 0;
    await expect(
      withRetry(
        async () => {
          calls += 1;
          throw new HttpRetryableError(503);
        },
        { initialDelayMs: 1, factor: 1, jitter: 0, maxAttempts: 3 },
      ),
    ).rejects.toBeInstanceOf(HttpRetryableError);
    expect(calls).toBe(3);
  });
});
