import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import * as nodeCrypto from 'node:crypto';
import { Readable } from 'node:stream';
import { BaseProvider } from '../providers/BaseProvider.js';
import { BaseMetadataProvider, BrowseKind } from '../meta/BaseMetadataProvider.js';
import {
  ContentLanguage,
  IUnitTracks,
  MediaCatalogType,
  MediaFormat,
  MediaSeason,
  ResolvedMediaStream,
  SdkCache,
} from '../types/index.js';
import { proxifySubtitleUrl } from '../utils/subtitles.js';
import { strictUnwrapUrn } from '../utils/urn.js';
import {
  downloadVideo,
  downloadMangaPage,
  downloadMangaChapter,
  detectImageExtension,
} from '../download/index.js';

export interface ServerOptions {
  providers: BaseProvider[];
  /**
   * Metadata providers exposed under `/meta/*`. AniList, MAL (Jikan), and
   * Kitsu providers all implement {@link BaseMetadataProvider} — pass any
   * combination, and `/meta/*` callers select with `?provider=<id>`.
   */
  metaProviders?: BaseMetadataProvider[];
  port?: number;
  auth?: { token: string };
  /**
   * Enable the `/proxy` endpoint and automatically rewrite stream `sourceUrl` values
   * to go through it — so browsers can play streams that require custom headers.
   */
  proxy?: boolean;
  /**
   * Explicit `proxyBase` URL. When omitted (default), the server derives
   * the base from each incoming request's `Host` header — so the SDK
   * works behind reverse proxies / on cloud hosts without configuration.
   * Set this when the public URL differs from what `Host` reports
   * (e.g. `https://api.example.com` proxied to an internal `:3000`).
   */
  proxyBase?: string;
  /**
   * When set, `/proxy` requires every `url` query param to be accompanied
   * by an HMAC-SHA256 signature in `sig` (computed over `url` and `h`,
   * keyed by this secret, hex-encoded). The proxy rewriter in this server
   * automatically signs URLs it emits, so most callers don't need to do
   * anything beyond setting this option. Unsigned/invalid-signature
   * requests are rejected with 401.
   */
  proxySignSecret?: string;
  /**
   * Optional allowlist of upstream hostnames the `/proxy` endpoint is
   * permitted to fetch. Each entry is matched as a *suffix* of the target
   * URL's hostname, so `"wixstatic.com"` covers `static.wixstatic.com`
   * and friends. When set, targets outside the list are rejected with 403
   * — defends against SSRF (the proxy otherwise turns the server into an
   * open HTTP relay). When omitted, all hosts are allowed.
   */
  proxyAllowedHosts?: string[];
  /**
   * Optional read/write cache for provider responses. When set, `/search`,
   * `/content`, `/stream`, `/tracks`, and `/meta/*` results are looked up
   * by a stable key before invoking the provider. See {@link SdkCache} for
   * the contract and the key namespacing used.
   */
  cache?: SdkCache;
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function err(res: http.ServerResponse, status: number, message: string): void {
  json(res, status, { error: message });
}

function timingSafeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  try {
    return nodeCrypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

function computeProxySignature(
  targetUrl: string,
  hParam: string | undefined,
  secret: string,
): string {
  const h = nodeCrypto.createHmac('sha256', secret);
  h.update(targetUrl);
  if (hParam) h.update('|h=' + hParam);
  return h.digest('hex');
}

function buildProxyUrl(
  proxyBase: string,
  targetUrl: string,
  hParam: string | undefined,
  secret: string | undefined,
): string {
  const parts = [`url=${encodeURIComponent(targetUrl)}`];
  if (hParam) parts.push(`h=${encodeURIComponent(hParam)}`);
  if (secret) parts.push(`sig=${computeProxySignature(targetUrl, hParam, secret)}`);
  return `${proxyBase}?${parts.join('&')}`;
}

/**
 * Rewrite every URI in an HLS manifest so each segment/key/sub-playlist
 * is fetched through the proxy endpoint, preserving the original headers param.
 */
function rewriteHls(manifest: string, baseUrl: string, proxyBase: string, hParam?: string): string {
  const h = hParam ? `&h=${encodeURIComponent(hParam)}` : '';
  const wrap = (uri: string) => {
    try {
      const abs = new URL(uri, baseUrl).href;
      return `${proxyBase}?url=${encodeURIComponent(abs)}${h}`;
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

/**
 * Rewrite video stream `sourceUrl` fields (and subtitle URLs) to route through
 * the proxy, with any required headers encoded in the `h` query param.
 */
function proxyifyStream(
  stream: ResolvedMediaStream,
  proxyBase: string,
  signSecret: string | undefined,
): ResolvedMediaStream {
  if (stream.type === 'manga') {
    const hParam =
      stream.pages.headers && Object.keys(stream.pages.headers).length > 0
        ? Buffer.from(JSON.stringify(stream.pages.headers)).toString('base64')
        : undefined;
    return {
      type: 'manga',
      pages: {
        ...stream.pages,
        imageUrls: stream.pages.imageUrls.map((url) =>
          buildProxyUrl(proxyBase, url, hParam, signSecret),
        ),
      },
    };
  }

  if (stream.type !== 'video') return stream;
  return {
    type: 'video',
    streams: stream.streams.map((s) => {
      const hParam =
        s.headers && Object.keys(s.headers).length > 0
          ? Buffer.from(JSON.stringify(s.headers)).toString('base64')
          : undefined;
      const subtitles = s.subtitles?.map((t) => ({
        ...t,
        url: proxifySubtitleUrl(proxyBase, t, { headers: s.headers, signSecret }),
      }));
      return {
        ...s,
        sourceUrl: buildProxyUrl(proxyBase, s.sourceUrl, hParam, signSecret),
        ...(subtitles ? { subtitles } : {}),
      };
    }),
  };
}

/** Wrap the subtitle URLs returned by `fetchUnitTracks` through `/proxy`. */
function proxyifyTracks(
  tracks: IUnitTracks,
  proxyBase: string,
  signSecret: string | undefined,
): IUnitTracks {
  return {
    ...tracks,
    subtitles: tracks.subtitles.map((t) => ({
      ...t,
      url: proxifySubtitleUrl(proxyBase, t, { headers: tracks.headers, signSecret }),
    })),
  };
}

export function startServer(options: ServerOptions): http.Server {
  const {
    providers,
    metaProviders = [],
    port = 3000,
    auth,
    proxy = false,
    cache,
    proxyBase: configuredProxyBase,
    proxySignSecret,
    proxyAllowedHosts,
  } = options;

  // Token → completed download, cleaned up after 10 minutes or on serve
  const pendingDownloads = new Map<
    string,
    {
      filePath: string;
      tmpDir: string;
      filename: string;
    }
  >();

  function storePending(filePath: string, tmpDir: string, filename: string): string {
    const token = crypto.randomUUID();
    pendingDownloads.set(token, { filePath, tmpDir, filename });
    setTimeout(
      () => {
        const info = pendingDownloads.get(token);
        if (info) {
          try {
            fs.unlinkSync(info.filePath);
          } catch {
            /* ignore */
          }
          try {
            fs.rmdirSync(info.tmpDir);
          } catch {
            /* ignore */
          }
          pendingDownloads.delete(token);
        }
      },
      10 * 60 * 1000,
    );
    return token;
  }

  function servePending(
    res: http.ServerResponse,
    token: string | null,
    contentType: string,
  ): boolean {
    if (!token) {
      err(res, 400, 'Missing param: token');
      return true;
    }
    const info = pendingDownloads.get(token);
    if (!info) {
      err(res, 404, 'Download expired or not found');
      return true;
    }
    pendingDownloads.delete(token);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(info.filePath);
    } catch {
      err(res, 500, 'File missing after download');
      return true;
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${info.filename}"`,
    });
    const rs = fs.createReadStream(info.filePath);
    const cleanup = () => {
      try {
        fs.unlinkSync(info.filePath);
      } catch {
        /* ignore */
      }
      try {
        fs.rmdirSync(info.tmpDir);
      } catch {
        /* ignore */
      }
    };
    rs.on('end', cleanup);
    rs.on('error', cleanup);
    rs.pipe(res);
    return true;
  }

  function openSse(res: http.ServerResponse): (data: unknown) => void {
    res.writeHead(200, {
      ...CORS,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });
    return (data) => {
      if (!res.writableEnded) res.write(`data: ${JSON.stringify(data)}\n\n`);
    };
  }

  async function cached<T>(key: string, compute: () => Promise<T>): Promise<T> {
    if (!cache) return compute();
    const hit = await cache.get(key);
    if (hit !== undefined) return hit as T;
    const value = await compute();
    await cache.set(key, value);
    return value;
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost`);
    const q = url.searchParams;
    // Derive the public base from the configured override or the Host header
    // so URLs the SDK rewrites are reachable from the same host the caller
    // is using.
    const hostHeader = req.headers.host ?? `localhost:${port}`;
    const scheme =
      (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() ?? 'http';
    const proxyBase = configuredProxyBase ?? `${scheme}://${hostHeader}/proxy`;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }

    if (auth) {
      const header = req.headers['authorization'] ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      if (token !== auth.token) return err(res, 401, 'Unauthorized');
    }

    if (req.method !== 'GET') return err(res, 405, 'Method not allowed');

    // ── Discovery ────────────────────────────────────────────────────────
    if (url.pathname === '/openapi.json') {
      const spec = buildOpenApiSpec({
        providerIds: providers.map((p) => p.id),
        metaProviderIds: metaProviders.map((p) => p.id),
        proxy,
        proxyBase,
      });
      return json(res, 200, spec);
    }

    if (url.pathname === '/health') {
      return json(res, 200, {
        ok: true,
        providers: providers.map((p) => p.id),
        metaProviders: metaProviders.map((p) => p.id),
        proxy,
      });
    }

    const findProvider = (id: string | null): BaseProvider | null =>
      id ? (providers.find((p) => p.id === id) ?? null) : null;

    const findMetaProvider = (id: string | null): BaseMetadataProvider | null =>
      id ? (metaProviders.find((p) => p.id === id) ?? null) : null;

    try {
      // ── Proxy ──────────────────────────────────────────────────────────
      if (url.pathname === '/proxy') {
        if (!proxy)
          return err(res, 404, 'Proxy not enabled — set proxy: true in startServer options');

        const targetUrl = q.get('url');
        if (!targetUrl) return err(res, 400, 'Missing param: url');

        // SSRF guard
        if (proxyAllowedHosts && proxyAllowedHosts.length > 0) {
          let targetHost: string;
          try {
            targetHost = new URL(targetUrl).hostname;
          } catch {
            return err(res, 400, 'Invalid url');
          }
          const ok = proxyAllowedHosts.some(
            (h) => targetHost === h || targetHost.endsWith(`.${h}`),
          );
          if (!ok) return err(res, 403, `Target host ${targetHost} not in allowlist`);
        }

        const hParam = q.get('h');
        if (proxySignSecret) {
          const sig = q.get('sig');
          if (!sig) return err(res, 401, 'Missing required `sig` query parameter');
          const expected = computeProxySignature(targetUrl, hParam ?? undefined, proxySignSecret);
          if (!timingSafeEquals(sig, expected)) {
            return err(res, 401, 'Invalid proxy signature');
          }
        }
        const upstreamHeaders: Record<string, string> = {
          Accept: '*/*',
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          'Accept-Language': 'en-US,en;q=0.9',
          'Accept-Encoding': 'identity',
        };
        if (hParam) {
          try {
            Object.assign(
              upstreamHeaders,
              JSON.parse(Buffer.from(hParam, 'base64').toString('utf8')),
            );
          } catch {
            /* ignore malformed headers param */
          }
        }
        // Forward Range header for video seeking
        if (req.headers.range) upstreamHeaders['Range'] = req.headers.range;

        // Abort the upstream fetch when the client disconnects to avoid leaking connections
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
          console.error(`Proxy fetch failed for ${targetUrl}: ${msg}`);
          return err(res, 502, `Upstream fetch failed: ${msg}`);
        }

        if (!upstream.ok) {
          const text = await upstream.text().catch(() => 'No body');
          console.error(
            `Proxy upstream error ${upstream.status} for ${targetUrl}: ${text.slice(0, 200)}`,
          );
          return err(
            res,
            upstream.status === 404 ? 404 : 502,
            `Upstream returned ${upstream.status}: ${text.slice(0, 100)}`,
          );
        }

        const ct = upstream.headers.get('content-type') ?? '';

        // Detect HLS by Content-Type, URL extension, or body peek (#EXTM3U)
        const looksLikeHls =
          ct.toLowerCase().includes('mpegurl') || targetUrl.split('?')[0].endsWith('.m3u8');

        if (looksLikeHls) {
          const text = await upstream.text();
          // Also check by body content in case Content-Type is wrong
          if (!text.trim().startsWith('#EXTM3U') && !looksLikeHls) {
            // Not actually an HLS manifest — fall through to stream it
          } else {
            const rewritten = rewriteHls(text, targetUrl, proxyBase, hParam ?? undefined);
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

        // For non-HLS (segments, MP4, etc.) — stream without buffering
        // Some CDNs disguise .ts segments as image/* or text/* — override the type
        const ctOverride = q.get('ct');
        let contentType = ct || 'application/octet-stream';
        if (ctOverride) {
          contentType = ctOverride;
        } else if (
          targetUrl.split('?')[0].toLowerCase().endsWith('.ts') &&
          (ct.startsWith('image/') || (ct.startsWith('text/') && !ct.includes('html')))
        ) {
          contentType = 'video/mp2t';
        }
        // mp4upload and similar CDNs return application/octet-stream for .mp4 files
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
          const readable = Readable.fromWeb(
            upstream.body as Parameters<typeof Readable.fromWeb>[0],
          );
          readable.on('error', () => {});
          res.on('close', () => readable.destroy());
          readable.pipe(res);
        } else {
          res.end();
        }
        return;
      }

      // ── API ────────────────────────────────────────────────────────────
      // Each handler runs its provider call through the optional `cache`.
      // Keys are namespaced by endpoint + provider so the consumer's cache
      // can apply different TTLs per kind if it wants to.
      if (url.pathname === '/search') {
        const query = q.get('q');
        const provider = findProvider(q.get('provider'));
        if (!query) return err(res, 400, 'Missing param: q');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        const items = await cached(`search:${provider.id}:${query}`, () => provider.search(query));
        return json(res, 200, items);
      }

      if (url.pathname === '/content') {
        const mediaId = q.get('mediaId');
        const provider = findProvider(q.get('provider'));
        if (!mediaId) return err(res, 400, 'Missing param: mediaId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        // One call returns all episodes; each unit advertises its available
        // translations. Callers pick the language at /stream time.
        const units = await cached(`content:${provider.id}:${mediaId}`, () =>
          provider.fetchContentUnits(mediaId),
        );
        return json(res, 200, units);
      }

      if (url.pathname === '/stream') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        let stream = await cached(`stream:${provider.id}:${unitId}:${language ?? ''}`, () =>
          provider.resolveStream(unitId, language ?? undefined),
        );
        if (proxy) stream = proxyifyStream(stream, proxyBase, proxySignSecret);
        return json(res, 200, stream);
      }

      if (url.pathname === '/tracks') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');
        // Only the cheap metadata path. Providers without `fetchUnitTracks`
        // return 501 — clients should fall back to /stream's subtitle info
        // rather than pay the resolveStream cost twice.
        if (!provider.fetchUnitTracks) {
          return err(
            res,
            501,
            `Provider "${provider.id}" does not expose track metadata; read subtitles from /stream instead`,
          );
        }
        let tracks = await cached(`tracks:${provider.id}:${unitId}:${language ?? ''}`, () =>
          provider.fetchUnitTracks!(unitId, language ?? undefined),
        );
        if (proxy) tracks = proxyifyTracks(tracks, proxyBase, proxySignSecret);
        return json(res, 200, tracks);
      }

      // ── Download: Video — SSE progress ───────────────────────────────
      if (url.pathname === '/download/video/progress') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');

        const send = openSse(res);
        try {
          send({ type: 'progress', phase: 'resolving', detail: 'Resolving stream…' });
          const stream = await cached(`stream:${provider.id}:${unitId}:${language ?? ''}`, () =>
            provider.resolveStream(unitId, language ?? undefined),
          );
          if (stream.type !== 'video') {
            send({ type: 'error', message: `Content is not video (type: ${stream.type})` });
            res.end();
            return;
          }
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sdk-dl-'));
          const safeUnit = unitId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const filename = `${provider.id}_${safeUnit}.mp4`;
          const tmpFile = path.join(tmpDir, filename);
          try {
            await downloadVideo(stream.streams, tmpFile, {
              timeoutMs: 1_200_000,
              onProgress: ({ phase, detail }) => send({ type: 'progress', phase, detail }),
            });
            send({ type: 'complete', token: storePending(tmpFile, tmpDir, filename) });
          } catch (dlErr) {
            try {
              fs.unlinkSync(tmpFile);
            } catch {
              /* ignore */
            }
            try {
              fs.rmdirSync(tmpDir);
            } catch {
              /* ignore */
            }
            send({
              type: 'error',
              message: dlErr instanceof Error ? dlErr.message : String(dlErr),
            });
          }
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        res.end();
        return;
      }

      // ── Download: Video — serve completed file ────────────────────────
      if (url.pathname === '/download/video/file') {
        servePending(res, q.get('token'), 'video/mp4');
        return;
      }

      // ── Download: Manga Chapter — SSE progress ────────────────────────
      if (url.pathname === '/download/manga/chapter/progress') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');

        const send = openSse(res);
        try {
          send({ type: 'progress', downloaded: 0, total: 0 });
          const stream = await cached(`stream:${provider.id}:${unitId}:`, () =>
            provider.resolveStream(unitId),
          );
          if (stream.type !== 'manga') {
            send({ type: 'error', message: `Content is not manga (type: ${stream.type})` });
            res.end();
            return;
          }
          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sdk-dl-'));
          const safeUnit = unitId.replace(/[^a-zA-Z0-9_-]/g, '_');
          const filename = `${provider.id}_${safeUnit}.zip`;
          const tmpFile = path.join(tmpDir, filename);
          try {
            await downloadMangaChapter(stream.pages, tmpFile, {
              onProgress: ({ downloaded, total }) => send({ type: 'progress', downloaded, total }),
            });
            send({ type: 'complete', token: storePending(tmpFile, tmpDir, filename) });
          } catch (dlErr) {
            try {
              fs.unlinkSync(tmpFile);
            } catch {
              /* ignore */
            }
            try {
              fs.rmdirSync(tmpDir);
            } catch {
              /* ignore */
            }
            send({
              type: 'error',
              message: dlErr instanceof Error ? dlErr.message : String(dlErr),
            });
          }
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        res.end();
        return;
      }

      // ── Download: Manga Chapter — serve completed file ────────────────
      if (url.pathname === '/download/manga/chapter/file') {
        servePending(res, q.get('token'), 'application/zip');
        return;
      }

      // ── Download: Video ───────────────────────────────────────────────
      if (url.pathname === '/download/video') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const language = q.get('language') as ContentLanguage | null;
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');

        let stream = await cached(`stream:${provider.id}:${unitId}:${language ?? ''}`, () =>
          provider.resolveStream(unitId, language ?? undefined),
        );
        if (stream.type !== 'video') {
          return err(res, 400, `Content is not video (type: ${stream.type})`);
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sdk-dl-'));
        const tmpFile = path.join(tmpDir, `${provider.id}_${unitId.replace(/\//g, '_')}.mp4`);

        try {
          await downloadVideo(stream.streams, tmpFile, { timeoutMs: 1_200_000 });

          const stat = fs.statSync(tmpFile);
          const safeUnit = unitId.replace(/[^a-zA-Z0-9_-]/g, '_');
          res.writeHead(200, {
            ...CORS,
            'Content-Type': 'video/mp4',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${provider.id}_${safeUnit}.mp4"`,
          });

          const readStream = fs.createReadStream(tmpFile);
          readStream.pipe(res);
          readStream.on('end', () => {
            try {
              fs.unlinkSync(tmpFile);
              fs.rmdirSync(tmpDir);
            } catch {
              /* ignore */
            }
          });
          readStream.on('error', () => {
            try {
              fs.unlinkSync(tmpFile);
              fs.rmdirSync(tmpDir);
            } catch {
              /* ignore */
            }
          });
        } catch (dlErr) {
          try {
            fs.unlinkSync(tmpFile);
            fs.rmdirSync(tmpDir);
          } catch {
            /* ignore */
          }
          throw dlErr;
        }
        return;
      }

      // ── Download: Manga Page ────────────────────────────────────────────
      if (url.pathname === '/download/manga/page') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        const pageParam = q.get('page');
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');

        const pageIndex = pageParam !== null ? parseInt(pageParam, 10) : 0;
        if (isNaN(pageIndex) || pageIndex < 0) {
          return err(res, 400, 'Invalid page index');
        }

        let stream = await cached(`stream:${provider.id}:${unitId}:`, () =>
          provider.resolveStream(unitId),
        );
        if (stream.type !== 'manga') {
          return err(res, 400, `Content is not manga (type: ${stream.type})`);
        }
        if (pageIndex >= stream.pages.imageUrls.length) {
          return err(
            res,
            400,
            `Page index ${pageIndex} out of range (0-${stream.pages.imageUrls.length - 1})`,
          );
        }

        // Proxy the image to the client
        const imgUrl = stream.pages.imageUrls[pageIndex];
        const imgHeaders: Record<string, string> = {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
          ...(stream.pages.headers ?? {}),
        };

        const abortCtrl = new AbortController();
        req.on('close', () => abortCtrl.abort());

        const upstream = await fetch(imgUrl, {
          headers: imgHeaders,
          redirect: 'follow',
          signal: abortCtrl.signal,
        });
        if (!upstream.ok) {
          return err(res, 502, `Upstream returned ${upstream.status}`);
        }

        const ct = upstream.headers.get('content-type') ?? 'image/jpeg';
        const ext = detectImageExtension(ct);
        const paddedPage = String(pageIndex + 1).padStart(3, '0');
        const safeUnit = unitId.replace(/[^a-zA-Z0-9_-]/g, '_');

        const outHeaders: Record<string, string> = {
          ...CORS,
          'Content-Type': ct,
          'Content-Disposition': `attachment; filename="${provider.id}_${safeUnit}_page_${paddedPage}${ext}"`,
        };
        const cl = upstream.headers.get('content-length');
        if (cl) outHeaders['Content-Length'] = cl;

        res.writeHead(200, outHeaders);
        if (upstream.body) {
          const readable = Readable.fromWeb(
            upstream.body as Parameters<typeof Readable.fromWeb>[0],
          );
          readable.on('error', () => {});
          res.on('close', () => readable.destroy());
          readable.pipe(res);
        } else {
          res.end();
        }
        return;
      }

      // ── Download: Manga Chapter (ZIP) ──────────────────────────────────
      if (url.pathname === '/download/manga/chapter') {
        const unitId = q.get('unitId');
        const provider = findProvider(q.get('provider'));
        if (!unitId) return err(res, 400, 'Missing param: unitId');
        if (!provider) return err(res, 400, 'Missing or unknown param: provider');

        let stream = await cached(`stream:${provider.id}:${unitId}:`, () =>
          provider.resolveStream(unitId),
        );
        if (stream.type !== 'manga') {
          return err(res, 400, `Content is not manga (type: ${stream.type})`);
        }

        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sdk-dl-'));
        const tmpFile = path.join(tmpDir, `${provider.id}_${unitId.replace(/\//g, '_')}.zip`);

        try {
          await downloadMangaChapter(stream.pages, tmpFile, { timeoutMs: 300_000 });

          const stat = fs.statSync(tmpFile);
          const safeUnit = unitId.replace(/[^a-zA-Z0-9_-]/g, '_');
          res.writeHead(200, {
            ...CORS,
            'Content-Type': 'application/zip',
            'Content-Length': stat.size,
            'Content-Disposition': `attachment; filename="${provider.id}_${safeUnit}.zip"`,
          });

          const readStream = fs.createReadStream(tmpFile);
          readStream.pipe(res);
          readStream.on('end', () => {
            try {
              fs.unlinkSync(tmpFile);
              fs.rmdirSync(tmpDir);
            } catch {
              /* ignore */
            }
          });
          readStream.on('error', () => {
            try {
              fs.unlinkSync(tmpFile);
              fs.rmdirSync(tmpDir);
            } catch {
              /* ignore */
            }
          });
        } catch (dlErr) {
          try {
            fs.unlinkSync(tmpFile);
            fs.rmdirSync(tmpDir);
          } catch {
            /* ignore */
          }
          throw dlErr;
        }
        return;
      }

      // ── Metadata layer ───────────────────────────────────────────────
      // Routes:
      //   /meta/search   ?provider=anilist&q=<query>
      //   /meta/info     ?provider=anilist&id=<metaUrn>
      //   /meta/content  ?provider=anilist&id=<metaUrn>&contentProvider=<id>
      //   /meta/stream   ?provider=anilist&id=<metaUrn>&episode=<n>&contentProvider=<id>[&language=]
      //   /meta/tracks   ?provider=anilist&id=<metaUrn>&episode=<n>&contentProvider=<id>[&language=]
      //   /meta/browse   ?provider=anilist&kind=trending|popular|seasonal|top[&catalogType=&page=&perPage=&season=&year=&format=]
      if (url.pathname.startsWith('/meta/')) {
        const meta = findMetaProvider(q.get('provider'));
        if (!meta) return err(res, 400, 'Missing or unknown param: provider');

        if (url.pathname === '/meta/search') {
          const query = q.get('q');
          if (!query) return err(res, 400, 'Missing param: q');
          const items = await cached(`meta:search:${meta.id}:${query}`, () => meta.search(query));
          return json(res, 200, items);
        }

        if (url.pathname === '/meta/info') {
          const id = q.get('id');
          if (!id) return err(res, 400, 'Missing param: id');
          try {
            strictUnwrapUrn(meta.id, id);
          } catch (e) {
            return err(res, 400, e instanceof Error ? e.message : String(e));
          }
          const info = await cached(`meta:info:${meta.id}:${id}`, () => meta.fetchMediaInfo(id));
          return json(res, 200, info);
        }

        const contentProvider = findProvider(q.get('contentProvider'));

        if (url.pathname === '/meta/content') {
          const id = q.get('id');
          if (!id) return err(res, 400, 'Missing param: id');
          if (!contentProvider) return err(res, 400, 'Missing or unknown param: contentProvider');
          const units = await cached(`meta:content:${meta.id}:${id}:${contentProvider.id}`, () =>
            meta.fetchContentUnits(id, contentProvider),
          );
          return json(res, 200, units);
        }

        if (url.pathname === '/meta/stream') {
          const id = q.get('id');
          const episode = q.get('episode');
          const language = q.get('language') as ContentLanguage | null;
          if (!id) return err(res, 400, 'Missing param: id');
          if (!episode) return err(res, 400, 'Missing param: episode');
          if (!contentProvider) return err(res, 400, 'Missing or unknown param: contentProvider');
          const epNum = parseFloat(episode);
          if (!Number.isFinite(epNum)) return err(res, 400, 'Param `episode` must be numeric');
          let stream = await cached(
            `meta:stream:${meta.id}:${id}:${contentProvider.id}:${epNum}:${language ?? ''}`,
            () => meta.resolveStream(id, epNum, contentProvider, language ?? undefined),
          );
          if (proxy) stream = proxyifyStream(stream, proxyBase, proxySignSecret);
          return json(res, 200, stream);
        }

        if (url.pathname === '/meta/tracks') {
          const id = q.get('id');
          const episode = q.get('episode');
          const language = q.get('language') as ContentLanguage | null;
          if (!id) return err(res, 400, 'Missing param: id');
          if (!episode) return err(res, 400, 'Missing param: episode');
          if (!contentProvider) return err(res, 400, 'Missing or unknown param: contentProvider');
          if (!contentProvider.supportsUnitTracks) {
            return err(res, 501, `Provider "${contentProvider.id}" does not expose track metadata`);
          }
          const epNum = parseFloat(episode);
          if (!Number.isFinite(epNum)) return err(res, 400, 'Param `episode` must be numeric');
          let tracks = await cached(
            `meta:tracks:${meta.id}:${id}:${contentProvider.id}:${epNum}:${language ?? ''}`,
            () => meta.fetchUnitTracks(id, epNum, contentProvider, language ?? undefined),
          );
          if (proxy) tracks = proxyifyTracks(tracks, proxyBase, proxySignSecret);
          return json(res, 200, tracks);
        }

        if (url.pathname === '/meta/browse') {
          const kind = q.get('kind') as BrowseKind | null;
          if (!kind || !['trending', 'popular', 'seasonal', 'top'].includes(kind)) {
            return err(res, 400, 'Param `kind` must be one of: trending, popular, seasonal, top');
          }
          if (!meta.supportsBrowseKind(kind)) {
            return err(res, 501, `Provider "${meta.id}" does not support browse('${kind}')`);
          }
          const catalogType = (q.get('catalogType') as MediaCatalogType | null) ?? 'ANIME';
          const page = q.get('page') ? Math.max(1, parseInt(q.get('page')!, 10) || 1) : 1;
          const perPage = q.get('perPage') ? parseInt(q.get('perPage')!, 10) : undefined;
          const season = q.get('season') as MediaSeason | null;
          const year = q.get('year') ? parseInt(q.get('year')!, 10) : undefined;
          const format = q.get('format') as MediaFormat | null;
          const cacheKey = `meta:browse:${meta.id}:${kind}:${catalogType}:${page}:${perPage ?? ''}:${season ?? ''}:${year ?? ''}:${format ?? ''}`;
          const items = await cached(cacheKey, () =>
            meta.browse(kind, {
              catalogType,
              page,
              perPage,
              season: season ?? undefined,
              year,
              format: format ?? undefined,
            }),
          );
          return json(res, 200, items);
        }

        return err(res, 404, 'Not found');
      }

      return err(res, 404, 'Not found');
    } catch (e) {
      console.log(e);
      return err(res, 500, e instanceof Error ? e.message : String(e));
    }
  });

  server.listen(port, () => console.log(`anime-sdk server listening on http://localhost:${port}`));
  return server;
}

/**
 * Build a minimal OpenAPI 3.1 spec describing every route the server
 * exposes. Returned as a JSON object; the server serves it under
 * `/openapi.json`. Tools like Swagger UI / Redoc can consume it directly.
 */
function buildOpenApiSpec(args: {
  providerIds: string[];
  metaProviderIds: string[];
  proxy: boolean;
  proxyBase: string;
}): Record<string, unknown> {
  const providerEnum = args.providerIds.length > 0 ? args.providerIds : ['<none>'];
  const metaEnum = args.metaProviderIds.length > 0 ? args.metaProviderIds : ['<none>'];
  const paths: Record<string, unknown> = {
    '/search': {
      get: {
        summary: 'Search a content provider for a title',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
        ],
        responses: { '200': { description: 'IMediaSearchResult[]' } },
      },
    },
    '/content': {
      get: {
        summary: 'List episodes/chapters for a media URN',
        parameters: [
          { name: 'mediaId', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
        ],
        responses: { '200': { description: 'IContentUnit[]' } },
      },
    },
    '/stream': {
      get: {
        summary: 'Resolve a playable stream for a unit URN',
        parameters: [
          { name: 'unitId', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
          {
            name: 'language',
            in: 'query',
            schema: { type: 'string', enum: ['sub', 'dub', 'raw'] },
          },
        ],
        responses: { '200': { description: 'ResolvedMediaStream' } },
      },
    },
    '/tracks': {
      get: {
        summary: 'Cheap-path: subtitles/qualities without resolving a stream',
        parameters: [
          { name: 'unitId', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
          {
            name: 'language',
            in: 'query',
            schema: { type: 'string', enum: ['sub', 'dub', 'raw'] },
          },
        ],
        responses: {
          '200': { description: 'IUnitTracks' },
          '501': { description: 'Provider does not expose tracks' },
        },
      },
    },
    '/health': {
      get: { summary: 'Health + capability check', responses: { '200': { description: 'OK' } } },
    },
  };
  if (args.metaProviderIds.length > 0) {
    paths['/meta/search'] = {
      get: {
        summary: 'Search a metadata catalogue (AniList/MAL/Kitsu)',
        parameters: [
          { name: 'q', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: metaEnum },
          },
        ],
        responses: { '200': { description: 'IMetaSearchResult[]' } },
      },
    };
    paths['/meta/info'] = {
      get: {
        summary: 'Full metadata for a meta URN (e.g. `anilist:21`)',
        parameters: [
          { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: metaEnum },
          },
        ],
        responses: { '200': { description: 'IMediaMetadata' } },
      },
    };
    paths['/meta/content'] = {
      get: {
        summary: 'Episode list for a meta URN, resolved via a content provider',
        parameters: [
          { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: metaEnum },
          },
          {
            name: 'contentProvider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
        ],
        responses: { '200': { description: 'IContentUnit[]' } },
      },
    };
    paths['/meta/stream'] = {
      get: {
        summary: 'Resolve a stream by episode number on a content provider',
        parameters: [
          { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'episode', in: 'query', required: true, schema: { type: 'number' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: metaEnum },
          },
          {
            name: 'contentProvider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
          {
            name: 'language',
            in: 'query',
            schema: { type: 'string', enum: ['sub', 'dub', 'raw'] },
          },
        ],
        responses: { '200': { description: 'ResolvedMediaStream' } },
      },
    };
    paths['/meta/tracks'] = {
      get: {
        summary: 'Cheap-path: tracks for an episode, by meta URN + content provider',
        parameters: [
          { name: 'id', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'episode', in: 'query', required: true, schema: { type: 'number' } },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: metaEnum },
          },
          {
            name: 'contentProvider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: providerEnum },
          },
          {
            name: 'language',
            in: 'query',
            schema: { type: 'string', enum: ['sub', 'dub', 'raw'] },
          },
        ],
        responses: {
          '200': { description: 'IUnitTracks' },
          '501': { description: 'Provider does not expose tracks' },
        },
      },
    };
    paths['/meta/browse'] = {
      get: {
        summary: 'Browse the catalogue (trending/popular/seasonal/top)',
        parameters: [
          {
            name: 'kind',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: ['trending', 'popular', 'seasonal', 'top'] },
          },
          {
            name: 'provider',
            in: 'query',
            required: true,
            schema: { type: 'string', enum: metaEnum },
          },
          {
            name: 'catalogType',
            in: 'query',
            schema: { type: 'string', enum: ['ANIME', 'MANGA'] },
          },
          { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
          { name: 'perPage', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50 } },
          {
            name: 'season',
            in: 'query',
            schema: { type: 'string', enum: ['WINTER', 'SPRING', 'SUMMER', 'FALL'] },
          },
          { name: 'year', in: 'query', schema: { type: 'integer' } },
          { name: 'format', in: 'query', schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'IMetaSearchResult[]' },
          '501': { description: 'Browse kind not supported' },
        },
      },
    };
  }
  if (args.proxy) {
    paths['/proxy'] = {
      get: {
        summary: 'CORS-friendly upstream proxy for stream/subtitle URLs',
        parameters: [
          { name: 'url', in: 'query', required: true, schema: { type: 'string' } },
          {
            name: 'h',
            in: 'query',
            schema: { type: 'string', description: 'base64-JSON headers' },
          },
          {
            name: 'ct',
            in: 'query',
            schema: { type: 'string', description: 'Content-Type override' },
          },
          {
            name: 'sig',
            in: 'query',
            schema: {
              type: 'string',
              description: 'HMAC signature (required when proxySignSecret is configured)',
            },
          },
        ],
        responses: {
          '200': { description: 'Streamed upstream body' },
          '401': { description: 'Bad/missing signature' },
          '403': { description: 'Host not in allowlist' },
        },
      },
    };
  }
  return {
    openapi: '3.1.0',
    info: { title: 'anime-sdk', version: '1.0.1', description: 'Universal media SDK server' },
    servers: [{ url: args.proxyBase.replace(/\/proxy$/, '') }],
    paths,
  };
}
