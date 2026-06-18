/**
 * Generic retry-with-backoff helper.
 *
 * Wraps an async operation in an exponential-backoff loop, honoring `429`
 * Retry-After hints when present. Used by `HttpClient.request` to recover
 * from transient upstream errors without the caller writing the loop.
 *
 * Treated as retryable:
 *   - Network errors (`TypeError: fetch failed`, ECONNRESET, ETIMEDOUT, …).
 *   - Status codes in `retryStatuses` (default 408, 425, 429, 500, 502, 503, 504).
 *
 * Aborted signals short-circuit without retrying.
 */

export interface RetryConfig {
  /** Maximum number of attempts (including the first). Default 3. */
  maxAttempts?: number;
  /** Initial backoff in ms. Default 250. */
  initialDelayMs?: number;
  /** Cap on per-attempt backoff in ms. Default 8_000. */
  maxDelayMs?: number;
  /** Exponential factor; default 2. */
  factor?: number;
  /** Jitter as a 0..1 fraction added to each delay. Default 0.25. */
  jitter?: number;
  /** Status codes that signal "try again". */
  retryStatuses?: number[];
  /** Observer hook for each retry. */
  onRetry?: (info: { attempt: number; reason: string; delayMs: number }) => void;
  /** Custom predicate; combined OR-style with the status/error defaults. */
  isRetryableError?: (err: unknown) => boolean;
}

export const DEFAULT_RETRY_STATUSES = [408, 425, 429, 500, 502, 503, 504];

/** Used internally so the loop can read `Retry-After` off a successful-but-throttled response. */
export class HttpRetryableError extends Error {
  public readonly status: number;
  public readonly retryAfterMs?: number;
  constructor(status: number, retryAfterMs?: number) {
    super(`HTTP ${status}`);
    this.status = status;
    this.retryAfterMs = retryAfterMs;
    this.name = 'HttpRetryableError';
  }
}

export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  config: RetryConfig = {},
  signal?: AbortSignal,
): Promise<T> {
  const maxAttempts = config.maxAttempts ?? 3;
  const initial = config.initialDelayMs ?? 250;
  const max = config.maxDelayMs ?? 8_000;
  const factor = config.factor ?? 2;
  const jitter = clamp01(config.jitter ?? 0.25);

  let attempt = 0;
  let lastErr: unknown;
  while (attempt < maxAttempts) {
    if (signal?.aborted) throw abortError(signal);
    attempt += 1;
    try {
      return await fn(attempt);
    } catch (err) {
      lastErr = err;
      if (signal?.aborted) throw abortError(signal);
      if (!isRetryable(err, config)) throw err;
      if (attempt >= maxAttempts) throw err;

      const hinted = err instanceof HttpRetryableError ? err.retryAfterMs : undefined;
      const expBackoff = Math.min(max, initial * factor ** (attempt - 1));
      const noise = jitter > 0 ? expBackoff * jitter * Math.random() : 0;
      const delayMs = Math.max(0, hinted ?? expBackoff + noise);

      config.onRetry?.({
        attempt,
        reason: err instanceof Error ? err.message : String(err),
        delayMs,
      });
      await sleep(delayMs, signal);
    }
  }
  throw lastErr;
}

function isRetryable(err: unknown, config: RetryConfig): boolean {
  if (config.isRetryableError?.(err)) return true;
  if (err instanceof HttpRetryableError) {
    return (config.retryStatuses ?? DEFAULT_RETRY_STATUSES).includes(err.status);
  }
  // Network-level errors. The shape varies across Node versions/runtimes —
  // matching on name/message/code covers the common cases.
  if (err instanceof Error) {
    const name = err.name;
    if (name === 'AbortError') return false; // explicit aborts are not retryable
    if (name === 'TypeError' && /fetch failed|network/i.test(err.message)) return true;
    if (
      'code' in err &&
      typeof (err as { code?: unknown }).code === 'string' &&
      [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'EPIPE',
        'EHOSTUNREACH',
        'ENETUNREACH',
        'UND_ERR_SOCKET',
      ].includes((err as { code?: string }).code!)
    ) {
      return true;
    }
  }
  return false;
}

/** Parse `Retry-After` (seconds or HTTP date) to milliseconds. */
export function parseRetryAfter(value: string | null): number | undefined {
  if (!value) return undefined;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return seconds * 1000;
  const date = Date.parse(value);
  if (!Number.isNaN(date)) {
    const ms = date - Date.now();
    return ms > 0 ? ms : 0;
  }
  return undefined;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    timer.unref?.();
    const onAbort = () => {
      cleanup();
      reject(abortError(signal!));
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}
