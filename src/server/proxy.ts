import * as crypto from 'node:crypto';
import * as http from 'node:http';
import { Readable } from 'node:stream';
import type { Stream, Pages, Subtitle } from '../types.js';

export interface ProxyOptions {
  /**
   * Public base URL the proxy is reachable at. When omitted, derived per
   * request from the incoming `Host` header (and `x-forwarded-proto`).
   * Set when the public URL differs from what Node sees — e.g. behind a
   * reverse proxy where Node listens on `:3030` but clients hit
   * `https://api.example.com`.
   */
  base?: string;
  /**
   * When set, the proxy requires every request to carry an HMAC-SHA256
   * `sig` parameter computed over the target URL (and the `h` payload
   * when present). Unsigned requests return 401. The server signs the
   * URLs it emits, so most consumers don't have to do anything beyond
   * setting this option.
   */
  signSecret?: string;
  /**
   * Suffix-matched hostname allowlist. When non-empty, the proxy refuses
   * to fetch upstream URLs whose host isn't covered. Defends against SSRF
   * — the proxy is otherwise an open HTTP relay.
   */
  allowedHosts?: string[];
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

const UPSTREAM_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function computeSignature(targetUrl: string, hParam: string | undefined, secret: string): string {
  const h = crypto.createHmac('sha256', secret);
  h.update(targetUrl);
  if (hParam) h.update('|h=' + hParam);
  return h.digest('hex');
}

function encodeHeaders(headers: Record<string, string> | undefined): string | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return Buffer.from(JSON.stringify(headers)).toString('base64');
}

function deriveProxyBase(req: http.IncomingMessage, configured?: string): string {
  if (configured) return configured.replace(/\/$/, '');
  const host = req.headers.host ?? 'localhost';
  const proto =
    (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? 'http';
  return `${proto}://${host}`;
}

/** Build a proxy URL pointing at `/proxy?url=...&h=...&sig=...`. */
export function buildProxyUrl(
  proxyBase: string,
  targetUrl: string,
  hParam: string | undefined,
  signSecret: string | undefined,
  contentType?: string,
): string {
  const parts = [`url=${encodeURIComponent(targetUrl)}`];
  if (hParam) parts.push(`h=${encodeURIComponent(hParam)}`);
  if (contentType) parts.push(`ct=${encodeURIComponent(contentType)}`);
  if (signSecret) parts.push(`sig=${computeSignature(targetUrl, hParam, signSecret)}`);
  return `${proxyBase}/proxy?${parts.join('&')}`;
}

function proxifySubtitle(
  proxyBase: string,
  subtitle: Subtitle,
  headers: Record<string, string> | undefined,
  signSecret: string | undefined,
): Subtitle {
  const hParam = encodeHeaders(headers);
  const ct =
    subtitle.format === 'vtt' || /\.vtt(?:\?|$)/i.test(subtitle.url) ? 'text/vtt' : undefined;
  return { ...subtitle, url: buildProxyUrl(proxyBase, subtitle.url, hParam, signSecret, ct) };
}

/** Rewrite every URL in a `Stream` to route through `/proxy`. */
export function proxifyStream(
  stream: Stream,
  proxyBase: string,
  signSecret: string | undefined,
): Stream {
  const hParam = encodeHeaders(stream.headers);
  return {
    ...stream,
    url: buildProxyUrl(proxyBase, stream.url, hParam, signSecret),
    subtitles: stream.subtitles.map((s) =>
      proxifySubtitle(proxyBase, s, stream.headers, signSecret),
    ),
  };
}

/** Rewrite every page URL in a `Pages` to route through `/proxy`. */
export function proxifyPages(
  pages: Pages,
  proxyBase: string,
  signSecret: string | undefined,
  headers?: Record<string, string>,
): Pages {
  const hParam = encodeHeaders(headers);
  return {
    ...pages,
    pages: pages.pages.map((p) => ({
      ...p,
      url: buildProxyUrl(proxyBase, p.url, hParam, signSecret),
    })),
  };
}

/**
 * Rewrite every URI in an HLS manifest so each segment, key, and sub-playlist
 * is fetched through `/proxy`, carrying the same headers payload.
 */
function rewriteHlsManifest(
  manifest: string,
  manifestUrl: string,
  proxyBase: string,
  hParam: string | undefined,
  signSecret: string | undefined,
): string {
  const wrap = (uri: string) => {
    try {
      const abs = new URL(uri, manifestUrl).href;
      return buildProxyUrl(proxyBase, abs, hParam, signSecret);
    } catch {
      return uri;
    }
  };
  return manifest
    .split(/\r?\n/)
    .map((line) => {
      const t = line.trim();
      if (!t) return line;
      if (t.startsWith('#'))
        return t.replace(/URI=(["'])(.*?)\1/g, (_, q, u) => `URI=${q}${wrap(u)}${q}`);
      return wrap(t);
    })
    .join('\n');
}

/** Handle a single `/proxy` request. Returns `true` when it consumed the response. */
export async function handleProxyRequest(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  query: URLSearchParams,
  options: ProxyOptions,
): Promise<void> {
  const targetUrl = query.get('url');
  if (!targetUrl) {
    res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Missing param: url' }));
    return;
  }

  if (options.allowedHosts && options.allowedHosts.length > 0) {
    let host: string;
    try {
      host = new URL(targetUrl).hostname;
    } catch {
      res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid url' }));
      return;
    }
    const ok = options.allowedHosts.some((h) => host === h || host.endsWith(`.${h}`));
    if (!ok) {
      res.writeHead(403, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Target host ${host} not in allowlist` }));
      return;
    }
  }

  const hParam = query.get('h');
  if (options.signSecret) {
    const sig = query.get('sig');
    if (!sig) {
      res.writeHead(401, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing required `sig` query parameter' }));
      return;
    }
    const expected = computeSignature(targetUrl, hParam ?? undefined, options.signSecret);
    if (!timingSafeEquals(sig, expected)) {
      res.writeHead(401, { ...CORS, 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid proxy signature' }));
      return;
    }
  }

  const upstreamHeaders: Record<string, string> = {
    Accept: '*/*',
    'User-Agent': UPSTREAM_UA,
    'Accept-Language': 'en-US,en;q=0.9',
    'Accept-Encoding': 'identity',
  };
  if (hParam) {
    try {
      Object.assign(
        upstreamHeaders,
        JSON.parse(Buffer.from(hParam, 'base64').toString('utf8')) as Record<string, string>,
      );
    } catch {
      // ignore malformed headers payload
    }
  }
  if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

  const abortCtrl = new AbortController();
  req.on('close', () => abortCtrl.abort());

  let upstream: Response;
  try {
    upstream = await fetch(targetUrl, {
      headers: upstreamHeaders,
      redirect: 'follow',
      signal: abortCtrl.signal,
    });
  } catch (fetchErr) {
    const msg = fetchErr instanceof Error ? fetchErr.message : String(fetchErr);
    res.writeHead(502, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Upstream fetch failed: ${msg}` }));
    return;
  }

  if (!upstream.ok) {
    const text = await upstream.text().catch(() => '');
    res.writeHead(upstream.status === 404 ? 404 : 502, {
      ...CORS,
      'Content-Type': 'application/json',
    });
    res.end(
      JSON.stringify({ error: `Upstream returned ${upstream.status}: ${text.slice(0, 100)}` }),
    );
    return;
  }

  const ct = upstream.headers.get('content-type') ?? '';
  const looksLikeHls =
    ct.toLowerCase().includes('mpegurl') || targetUrl.split('?')[0].endsWith('.m3u8');

  if (looksLikeHls) {
    const text = await upstream.text();
    if (text.trim().startsWith('#EXTM3U') || looksLikeHls) {
      const proxyBase = deriveProxyBase(req, options.base);
      const rewritten = rewriteHlsManifest(
        text,
        targetUrl,
        proxyBase,
        hParam ?? undefined,
        options.signSecret,
      );
      const buf = Buffer.from(rewritten, 'utf8');
      res.writeHead(upstream.status, {
        ...CORS,
        'Content-Type': 'application/vnd.apple.mpegurl',
        'Content-Length': buf.length,
      });
      res.end(buf);
      return;
    }
  }

  const ctOverride = query.get('ct');
  let contentType = ct || 'application/octet-stream';
  if (ctOverride) {
    contentType = ctOverride;
  } else if (
    targetUrl.split('?')[0].toLowerCase().endsWith('.ts') &&
    (ct.startsWith('image/') || (ct.startsWith('text/') && !ct.includes('html')))
  ) {
    contentType = 'video/mp2t';
  }
  if (
    contentType === 'application/octet-stream' &&
    targetUrl.split('?')[0].toLowerCase().endsWith('.mp4')
  ) {
    contentType = 'video/mp4';
  }

  const outHeaders: Record<string, string> = { ...CORS, 'Content-Type': contentType };
  const cl = upstream.headers.get('content-length');
  if (cl) outHeaders['Content-Length'] = cl;
  const cr = upstream.headers.get('content-range');
  if (cr) outHeaders['Content-Range'] = cr;
  const ar = upstream.headers.get('accept-ranges');
  outHeaders['Accept-Ranges'] = ar ?? 'bytes';

  res.writeHead(upstream.status, outHeaders);

  if (upstream.body) {
    const readable = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
    readable.on('error', () => {});
    res.on('close', () => readable.destroy());
    readable.pipe(res);
  } else {
    res.end();
  }
}

export { deriveProxyBase };
