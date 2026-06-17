import {
  DEFAULT_RATE_LIMITS,
  PerHostRateLimits,
  RateLimitConfig,
  RateLimiter,
} from './rateLimiter.js';
import {
  DEFAULT_RETRY_STATUSES,
  HttpRetryableError,
  RetryConfig,
  parseRetryAfter,
  withRetry,
} from './retry.js';
import { CurlFallbackTransport, HttpTransport } from './transport.js';

export interface HttpClientConfig {
  proxyUrl?: string;
  proxyType?: 'prepend' | 'query';
  proxyQueryParam?: string;
  defaultHeaders?: Record<string, string>;
  timeoutMs?: number;
  /**
   * Per-host token-bucket rate limits. Merged on top of
   * {@link DEFAULT_RATE_LIMITS}, which covers AniList / Jikan / Kitsu /
   * MALSync / Anify / arm-server with their published quotas. Pass an
   * empty object to start blank.
   */
  rateLimits?: PerHostRateLimits;
  /** Optional default policy for hosts not in the per-host map. */
  defaultRateLimit?: RateLimitConfig;
  /** Disable rate limiting entirely (e.g. in tests). */
  disableRateLimit?: boolean;
  /**
   * Retry policy. Defaults to 3 attempts with exponential backoff (250ms
   * base) on 408/425/429/5xx and transient network errors. Honours
   * `Retry-After`.
   */
  retry?: RetryConfig | false;
  /**
   * Pluggable transport. Defaults to {@link CurlFallbackTransport} on
   * Node (fetch + curl fallback) and degrades to a plain `fetch` on
   * runtimes that don't expose `child_process`. Pass a {@link FetchTransport}
   * to disable the curl fallback explicitly, or any custom
   * {@link HttpTransport} for full control (e.g. an Undici dispatcher,
   * a Cloudflare-bypass proxy, or an in-process test transport).
   */
  transport?: HttpTransport;
}

export class HttpClient {
  private proxyUrl?: string;
  private proxyType: 'prepend' | 'query';
  private proxyQueryParam: string;
  private defaultHeaders: Record<string, string>;
  private timeoutMs: number;
  private rateLimiter?: RateLimiter;
  private retryConfig: RetryConfig | false;
  private transport: HttpTransport;

  constructor(config: HttpClientConfig = {}) {
    this.proxyUrl = config.proxyUrl;
    this.proxyType = config.proxyType || 'prepend';
    this.proxyQueryParam = config.proxyQueryParam || 'url';
    this.defaultHeaders = config.defaultHeaders || {};
    this.timeoutMs = config.timeoutMs || 10000;
    if (!config.disableRateLimit) {
      this.rateLimiter = new RateLimiter(
        { ...DEFAULT_RATE_LIMITS, ...(config.rateLimits ?? {}) },
        config.defaultRateLimit,
      );
    }
    this.retryConfig = config.retry === false ? false : (config.retry ?? {});
    this.transport = config.transport ?? new CurlFallbackTransport({ timeoutMs: this.timeoutMs });
  }

  /** Live rate-limiter; useful for tests and observability. May be undefined when disabled. */
  public getRateLimiter(): RateLimiter | undefined {
    return this.rateLimiter;
  }

  public getTransport(): HttpTransport {
    return this.transport;
  }

  public getProxyUrl(): string | undefined {
    return this.proxyUrl;
  }

  public getProxyType(): 'prepend' | 'query' {
    return this.proxyType;
  }

  public getProxyQueryParam(): string {
    return this.proxyQueryParam;
  }

  public getDefaultHeaders(): Record<string, string> {
    return this.defaultHeaders;
  }

  public requestUrl(url: string): string {
    if (!this.proxyUrl) return url;
    if (this.proxyType === 'prepend') {
      const base = this.proxyUrl.endsWith('/') ? this.proxyUrl : `${this.proxyUrl}/`;
      // Strip target protocol if the prepend proxy expects path prepending
      // e.g. proxy.com/target.com/path
      const target = url.replace(/^(https?:\/\/)/, '');
      return `${base}${target}`;
    } else {
      const separator = this.proxyUrl.includes('?') ? '&' : '?';
      return `${this.proxyUrl}${separator}${this.proxyQueryParam}=${encodeURIComponent(url)}`;
    }
  }

  public async request(url: string, options: RequestInit = {}): Promise<Response> {
    const signal = options.signal as AbortSignal | null | undefined;
    const host = safeHostname(this.requestUrl(url));

    if (this.retryConfig === false) {
      if (this.rateLimiter && host) await this.rateLimiter.acquire(host, signal ?? undefined);
      return this.requestOnce(url, options);
    }
    return withRetry(
      async () => {
        // Re-acquire on every attempt — each fetch is a billable upstream
        // call and must respect the per-host budget independently. Doing
        // this outside the retry loop would let a noisy retry-storm
        // silently blow past the configured rate limit.
        if (this.rateLimiter && host) await this.rateLimiter.acquire(host, signal ?? undefined);
        const res = await this.requestOnce(url, options);
        const retryStatuses =
          this.retryConfig === false
            ? DEFAULT_RETRY_STATUSES
            : (this.retryConfig.retryStatuses ?? DEFAULT_RETRY_STATUSES);
        if (retryStatuses.includes(res.status)) {
          const ra = parseRetryAfter(res.headers.get('retry-after'));
          throw new HttpRetryableError(res.status, ra);
        }
        return res;
      },
      this.retryConfig,
      signal ?? undefined,
    );
  }

  private async requestOnce(url: string, options: RequestInit = {}): Promise<Response> {
    const targetUrl = this.requestUrl(url);
    const headers: Record<string, string> = { ...this.defaultHeaders };
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [key, value] of options.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }

    // Compose the timeout signal with the caller's signal (if any) so a
    // caller-supplied AbortSignal still cancels the in-flight request.
    const callerSignal = options.signal as AbortSignal | null | undefined;
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(new Error('Request timed out')), this.timeoutMs);
    let onCallerAbort: (() => void) | undefined;
    if (callerSignal) {
      if (callerSignal.aborted) {
        clearTimeout(id);
        throw abortReason(callerSignal);
      }
      onCallerAbort = () => controller.abort(callerSignal.reason);
      callerSignal.addEventListener('abort', onCallerAbort, { once: true });
    }
    const cleanup = () => {
      clearTimeout(id);
      if (onCallerAbort) callerSignal!.removeEventListener('abort', onCallerAbort);
    };

    try {
      const res = await this.transport.fetch(targetUrl, {
        ...options,
        headers,
        signal: controller.signal,
      });
      cleanup();
      return res;
    } catch (err) {
      cleanup();
      throw err;
    }
  }

  public async get(url: string, options: RequestInit = {}): Promise<Response> {
    return this.request(url, { ...options, method: 'GET' });
  }

  public async post(url: string, body?: any, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {};
    if (options.headers) {
      if (options.headers instanceof Headers) {
        options.headers.forEach((value, key) => {
          headers[key] = value;
        });
      } else if (Array.isArray(options.headers)) {
        for (const [key, value] of options.headers) {
          headers[key] = value;
        }
      } else {
        Object.assign(headers, options.headers);
      }
    }
    let finalBody = body;
    if (
      body &&
      typeof body === 'object' &&
      !(body instanceof FormData) &&
      !(body instanceof URLSearchParams)
    ) {
      if (!headers['Content-Type']) {
        headers['Content-Type'] = 'application/json';
      }
      finalBody = JSON.stringify(body);
    }
    return this.request(url, { ...options, method: 'POST', headers, body: finalBody });
  }

  public setCookie(name: string, value: string): void {
    const existingCookie = this.defaultHeaders['Cookie'] || '';
    const cookies = existingCookie ? existingCookie.split(';').map((c) => c.trim()) : [];
    const newCookies = cookies.filter((c) => !c.startsWith(`${name}=`));
    newCookies.push(`${name}=${value}`);
    this.defaultHeaders['Cookie'] = newCookies.join('; ');
  }

  public setUserAgent(userAgent: string): void {
    this.defaultHeaders['User-Agent'] = userAgent;
  }
}

/**
 * Extract the hostname from a URL for rate-limiter bucketing. Returns
 * `undefined` if the URL is relative or unparseable — those calls aren't
 * rate-limited.
 */
function safeHostname(url: string): string | undefined {
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}

function abortReason(signal: AbortSignal): Error {
  if (signal.reason instanceof Error) return signal.reason;
  const e = new Error(typeof signal.reason === 'string' ? signal.reason : 'Aborted');
  e.name = 'AbortError';
  return e;
}
