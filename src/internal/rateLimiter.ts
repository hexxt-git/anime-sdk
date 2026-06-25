/**
 * Per-host token-bucket rate limiter.
 *
 * Public catalogue APIs (AniList: 90 req/min, Jikan: 60 req/min + 3 req/s,
 * MALSync: undocumented but courteous) need careful pacing in a server
 * environment. This limiter answers `await acquire(hostname)` after waking
 * any callers that have been queued past their bucket's capacity.
 *
 * Design notes:
 *  - Buckets are created lazily on first acquire so unknown hosts get the
 *    default policy. Unknown hosts can also fall through with no limit when
 *    no default is configured (current SDK default — limits only apply to
 *    metadata-layer hosts so we don't accidentally throttle stream CDNs).
 *  - The bucket's queue is FIFO. We could prioritize, but starvation is more
 *    of a risk than starvation-avoidance is a win here.
 *  - The implementation never busy-waits — sleeping waiters are resumed by
 *    `setTimeout`s scheduled at the precise moment the bucket regenerates.
 */

export interface RateLimitConfig {
  /** Maximum requests allowed in each `intervalMs` window. */
  capacity: number;
  /** Window length in milliseconds. */
  intervalMs: number;
  /** Optional secondary "burst" cap, e.g. Jikan's 3 req/s on top of 60/min. */
  burst?: { capacity: number; intervalMs: number };
}

export type PerHostRateLimits = Record<string, RateLimitConfig>;

interface BucketState {
  tokens: number;
  windowStart: number;
  config: RateLimitConfig;
  burstTokens?: number;
  burstWindowStart?: number;
  queue: Array<{ resolve: () => void; reject: (e: unknown) => void; signal?: AbortSignal }>;
  scheduled: boolean;
}

export class RateLimiter {
  private buckets = new Map<string, BucketState>();
  private defaultConfig?: RateLimitConfig;
  private perHost: PerHostRateLimits;

  constructor(perHost: PerHostRateLimits = {}, defaultConfig?: RateLimitConfig) {
    this.perHost = perHost;
    this.defaultConfig = defaultConfig;
  }

  /**
   * Wait until a token is available for `hostname`. Resolves immediately if
   * no policy applies (no per-host entry and no default).
   *
   * Honors `signal`: when aborted, the wait rejects with the signal's reason
   * (or an AbortError) and the slot in the queue is released without
   * granting a token.
   */
  public async acquire(hostname: string, signal?: AbortSignal): Promise<void> {
    const cfg = this.perHost[hostname] ?? this.defaultConfig;
    if (!cfg) return; // unlimited
    if (signal?.aborted) throw abortError(signal);

    const bucket = this.getOrCreate(hostname, cfg);
    this.refill(bucket);

    if (this.tryConsume(bucket)) return;

    return new Promise<void>((resolve, reject) => {
      const entry = { resolve, reject, signal };
      bucket.queue.push(entry);
      if (signal) {
        const onAbort = () => {
          const idx = bucket.queue.indexOf(entry);
          if (idx >= 0) bucket.queue.splice(idx, 1);
          reject(abortError(signal));
        };
        if (signal.aborted) return onAbort();
        signal.addEventListener('abort', onAbort, { once: true });
      }
      this.schedulePump(bucket);
    });
  }

  /**
   * Snapshot of the live state, useful for tests and observability.
   */
  public snapshot(hostname: string): { tokens: number; queued: number } | null {
    const bucket = this.buckets.get(hostname);
    if (!bucket) return null;
    this.refill(bucket);
    return { tokens: bucket.tokens, queued: bucket.queue.length };
  }

  // ── internals ─────────────────────────────────────────────────────────────

  private getOrCreate(hostname: string, config: RateLimitConfig): BucketState {
    let bucket = this.buckets.get(hostname);
    if (!bucket) {
      bucket = {
        tokens: config.capacity,
        windowStart: Date.now(),
        config,
        burstTokens: config.burst?.capacity,
        burstWindowStart: config.burst ? Date.now() : undefined,
        queue: [],
        scheduled: false,
      };
      this.buckets.set(hostname, bucket);
    }
    return bucket;
  }

  /** Top up tokens whose window has elapsed. */
  private refill(b: BucketState): void {
    const now = Date.now();
    if (now - b.windowStart >= b.config.intervalMs) {
      b.tokens = b.config.capacity;
      b.windowStart = now;
    }
    if (b.config.burst && b.burstWindowStart != null) {
      if (now - b.burstWindowStart >= b.config.burst.intervalMs) {
        b.burstTokens = b.config.burst.capacity;
        b.burstWindowStart = now;
      }
    }
  }

  private tryConsume(b: BucketState): boolean {
    if (b.tokens <= 0) return false;
    if (b.config.burst && (b.burstTokens ?? 0) <= 0) return false;
    b.tokens -= 1;
    if (b.config.burst) b.burstTokens = (b.burstTokens ?? 0) - 1;
    return true;
  }

  /** Schedule a wake-up at the next time we'd hand out at least one token. */
  private schedulePump(b: BucketState): void {
    if (b.scheduled) return;
    b.scheduled = true;
    const now = Date.now();
    const waitMain = Math.max(0, b.config.intervalMs - (now - b.windowStart));
    const waitBurst =
      b.config.burst && b.burstWindowStart != null
        ? Math.max(0, b.config.burst.intervalMs - (now - b.burstWindowStart))
        : 0;
    const wait = Math.max(1, Math.min(waitMain || 1, waitBurst || waitMain || 1));
    setTimeout(() => this.pump(b), wait).unref?.();
  }

  /** Drain as many waiters as the refilled bucket can satisfy. */
  private pump(b: BucketState): void {
    b.scheduled = false;
    this.refill(b);
    while (b.queue.length > 0 && this.tryConsume(b)) {
      const entry = b.queue.shift()!;
      entry.resolve();
    }
    if (b.queue.length > 0) this.schedulePump(b);
  }
}

function abortError(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const e = new Error('Aborted');
  e.name = 'AbortError';
  return e;
}

/**
 * Default policies for catalogue + mapping APIs we ship support for.
 * Stream CDNs are deliberately *not* listed — they have their own pacing
 * needs that the provider/extractor knows better than us.
 */
export const DEFAULT_RATE_LIMITS: PerHostRateLimits = {
  'graphql.anilist.co': { capacity: 85, intervalMs: 60_000 },
  'api.jikan.moe': {
    capacity: 55,
    intervalMs: 60_000,
    burst: { capacity: 3, intervalMs: 1_000 },
  },
  'kitsu.io': { capacity: 100, intervalMs: 60_000 },
  'api.malsync.moe': { capacity: 30, intervalMs: 60_000 },
  'api.anify.tv': { capacity: 30, intervalMs: 60_000 },
  'arm.haglund.dev': { capacity: 60, intervalMs: 60_000 },
};
