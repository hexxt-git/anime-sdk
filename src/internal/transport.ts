/**
 * Pluggable transport interface for `HttpClient`.
 *
 * The default {@link FetchTransport} is `fetch` with a curl fallback for
 * Node — but the contract is just `(url, init) → Promise<Response>` so
 * consumers can substitute anything they like (a custom Undici dispatcher,
 * a Cloudflare-bypass service, an in-process test transport).
 *
 * Keeping the curl fallback behind this interface lets it be swapped out
 * cleanly when it's not wanted — e.g. on Workers / Deno where `child_process`
 * isn't available, or in tests that want to assert deterministic transport
 * behaviour.
 */
export interface HttpTransport {
  /**
   * Perform one HTTP request. Implementations must:
   *   - honour `init.signal` (cancellation)
   *   - apply `init.headers` literally
   *   - return a real `Response` (or compatible shape) regardless of HTTP status
   */
  fetch(url: string, init: RequestInit): Promise<Response>;
}

/**
 * Default browser-style transport — wraps the platform `fetch`. No fallback,
 * no curl. Used in browsers and in Node when the caller opts out of the
 * curl fallback via `HttpClientConfig.transport`.
 */
export class FetchTransport implements HttpTransport {
  fetch(url: string, init: RequestInit): Promise<Response> {
    return fetch(url, init);
  }
}

/**
 * Fetch-with-curl-fallback transport. Tries `fetch` first; on network
 * error (timeout, TLS quirk, anti-bot rejection) falls back to spawning
 * `curl` via `child_process` and synthesising a `Response`-shaped object
 * from its output.
 *
 * Only available in Node — `child_process` isn't usable in the browser,
 * Workers, or Deno's sandboxed runtimes. The fallback no-ops in those
 * environments and the original `fetch` error propagates.
 *
 * Per-instance cookie jar (`cookieFile`) is reused across calls so a site
 * that sets a cookie on call 1 carries it on call 2.
 */
export class CurlFallbackTransport implements HttpTransport {
  private cookieFile?: string;
  private readonly timeoutMs: number;

  constructor(options: { timeoutMs?: number } = {}) {
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async fetch(url: string, init: RequestInit): Promise<Response> {
    try {
      return await fetch(url, init);
    } catch (err: any) {
      // Explicit aborts must propagate immediately.
      if (init.signal?.aborted || (err?.name === 'AbortError' && init.signal)) {
        throw err;
      }
      // Only attempt curl in Node.
      if (typeof process === 'undefined' || !process.versions?.node) {
        throw err;
      }
      try {
        return await this.curlFetch(url, init);
      } catch {
        throw err;
      }
    }
  }

  private async curlFetch(targetUrl: string, options: RequestInit): Promise<Response> {
    const cp = await import('child_process');
    const execSync = cp.execSync;

    if (!this.cookieFile) {
      try {
        const os = await import('os');
        const path = await import('path');
        this.cookieFile = path.join(
          os.tmpdir(),
          `ani-sdk-cookie-${Math.random().toString(36).substring(2)}.txt`,
        );
      } catch {
        this.cookieFile = `/tmp/ani-sdk-cookie-${Math.random().toString(36).substring(2)}.txt`;
      }
    }

    const method = options.method || 'GET';
    const headers: Record<string, string> = {};
    if (options.headers instanceof Headers) {
      options.headers.forEach((v, k) => {
        headers[k] = v;
      });
    } else if (Array.isArray(options.headers)) {
      for (const [k, v] of options.headers) headers[k] = v;
    } else if (options.headers) {
      Object.assign(headers, options.headers);
    }
    if (options.body instanceof URLSearchParams && !headers['Content-Type']) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    }

    let headerArgs = '';
    for (const [key, val] of Object.entries(headers)) {
      headerArgs += ` -H ${JSON.stringify(`${key}: ${val}`)}`;
    }

    let bodyArg = '';
    if (options.body) {
      let bodyStr = '';
      if (typeof options.body === 'string') {
        bodyStr = options.body;
      } else if (options.body instanceof URLSearchParams) {
        bodyStr = options.body.toString();
      } else {
        bodyStr = JSON.stringify(options.body);
      }
      bodyArg = ` -d ${JSON.stringify(bodyStr)}`;
    }

    const methodArg = method !== 'GET' && method !== 'POST' ? ` -X ${method}` : '';
    const cookieArg = ` -c ${JSON.stringify(this.cookieFile)} -b ${JSON.stringify(this.cookieFile)}`;
    const cmd = `curl -sL --max-time ${Math.ceil(this.timeoutMs / 1000)}${methodArg}${headerArgs}${bodyArg}${cookieArg} -i ${JSON.stringify(targetUrl)}`;
    const output = execSync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    return parseCurlResponse(output.toString('binary'), targetUrl);
  }
}

/**
 * Parse curl's `-i` (include headers) response into something
 * `Response`-shaped. Handles 1xx/redirect chains by keeping only the
 * last HTTP block.
 */
function parseCurlResponse(raw: string, targetUrl: string): Response {
  const parts = raw.split('\r\n\r\n');
  let headerSection = '';
  let body = '';
  for (let i = 0; i < parts.length; i++) {
    if (parts[i].startsWith('HTTP/')) {
      headerSection = parts[i];
      body = parts.slice(i + 1).join('\r\n\r\n');
    }
  }
  const headerLines = headerSection.split('\r\n');
  const statusLine = headerLines[0];
  const m = statusLine.match(/HTTP\/\d+(\.\d+)?\s+(\d+)/);
  const status = m ? parseInt(m[2], 10) : 200;

  const responseHeaders = new Headers();
  for (let i = 1; i < headerLines.length; i++) {
    const line = headerLines[i];
    const idx = line.indexOf(':');
    if (idx !== -1) {
      responseHeaders.append(line.substring(0, idx).trim(), line.substring(idx + 1).trim());
    }
  }

  // Follow Location across the redirect chain for `Response.url`.
  let finalUrl = targetUrl;
  for (const part of parts) {
    const lines = part.split('\r\n');
    if (lines[0].startsWith('HTTP/')) {
      for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const key = line.substring(0, idx).trim().toLowerCase();
        if (key !== 'location') continue;
        const val = line.substring(idx + 1).trim();
        try {
          finalUrl = val.startsWith('http') ? val : new URL(val, finalUrl).toString();
        } catch {
          /* leave finalUrl as-is */
        }
      }
    }
  }

  return {
    status,
    statusText: 'OK',
    ok: status >= 200 && status < 300,
    headers: responseHeaders,
    url: finalUrl,
    text: async () => body,
    json: async () => JSON.parse(body),
    arrayBuffer: async () => {
      const buf = Buffer.from(body, 'binary');
      return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
    },
  } as unknown as Response;
}
