import * as http from 'node:http';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Sdk } from '../sdk.js';
import type { Stream, Pages } from '../types.js';
import { downloadVideo, downloadMangaChapter } from '../download/index.js';
import { ProxyOptions, proxifyStream, proxifyPages, deriveProxyBase } from './proxy.js';

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  query: URLSearchParams,
) => Promise<void>;

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Access-Control-Expose-Headers': '*',
};

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...CORS,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function abort(req: http.IncomingMessage): AbortController {
  const ac = new AbortController();
  req.on('close', () => ac.abort());
  return ac;
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

export function buildRoutes(sdk: Sdk, proxyOpts?: ProxyOptions): Array<[string, string, Handler]> {
  // Token → completed download, cleaned up after 10 minutes or on serve.
  const pendingDownloads = new Map<
    string,
    { filePath: string; tmpDir: string; filename: string }
  >();

  function storePending(filePath: string, tmpDir: string, filename: string): string {
    const token = randomUUID();
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

  function servePending(res: http.ServerResponse, token: string | null, contentType: string): void {
    if (!token) return json(res, 400, { error: 'Missing param: token' });
    const info = pendingDownloads.get(token);
    if (!info) return json(res, 404, { error: 'Download expired or not found' });
    pendingDownloads.delete(token);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(info.filePath);
    } catch {
      return json(res, 500, { error: 'File missing after download' });
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
  }

  // Stream/Pages-bound proxy rewrite that derives the public base per request.
  function maybeProxifyStream(req: http.IncomingMessage, stream: Stream): Stream {
    if (!proxyOpts) return stream;
    return proxifyStream(stream, deriveProxyBase(req, proxyOpts.base), proxyOpts.signSecret);
  }
  function maybeProxifyPages(req: http.IncomingMessage, pages: Pages): Pages {
    if (!proxyOpts) return pages;
    return proxifyPages(pages, deriveProxyBase(req, proxyOpts.base), proxyOpts.signSecret);
  }

  return [
    [
      'GET',
      '/health',
      async (_req, res) => {
        json(res, 200, sdk.health());
      },
    ],

    [
      'GET',
      '/search',
      async (req, res, _p, query) => {
        const q = query.get('q') ?? '';
        const kind = (query.get('kind') ?? 'anime') as 'anime' | 'manga';
        if (!q) return json(res, 400, { error: 'q is required' });
        const ac = abort(req);
        const results = await sdk.search(q, { kind, signal: ac.signal });
        json(res, 200, results);
      },
    ],

    [
      'GET',
      '/media/:id',
      async (req, res, params) => {
        const ac = abort(req);
        try {
          const media = await sdk.info(decodeURIComponent(params.id), { signal: ac.signal });
          json(res, 200, media);
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      },
    ],

    [
      'GET',
      '/media/:id/episodes',
      async (req, res, params, query) => {
        const ac = abort(req);
        try {
          const media = await sdk.info(decodeURIComponent(params.id), { signal: ac.signal });
          const list = await sdk.episodes(media, {
            cursor: query.get('cursor') ?? undefined,
            signal: ac.signal,
          });
          json(res, 200, list);
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      },
    ],

    [
      'GET',
      '/media/:id/chapters',
      async (req, res, params, query) => {
        const ac = abort(req);
        try {
          const media = await sdk.info(decodeURIComponent(params.id), { signal: ac.signal });
          const list = await sdk.chapters(media, {
            cursor: query.get('cursor') ?? undefined,
            signal: ac.signal,
          });
          json(res, 200, list);
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      },
    ],

    [
      'GET',
      '/media/:id/sources',
      async (req, res, params) => {
        const ac = abort(req);
        try {
          const media = await sdk.info(decodeURIComponent(params.id), { signal: ac.signal });
          const sources = await sdk.sources(media, { signal: ac.signal });
          json(res, 200, sources);
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      },
    ],

    [
      'GET',
      '/episode/:id/streams',
      async (req, res, params) => {
        const ac = abort(req);
        const send = openSse(res);
        try {
          const result = sdk.stream(decodeURIComponent(params.id), { signal: ac.signal });
          for await (const stream of result) {
            send(maybeProxifyStream(req, stream));
          }
        } catch (e) {
          send({ error: (e as Error).message });
        }
        res.end();
      },
    ],

    [
      'GET',
      '/episode/:id/stream',
      async (req, res, params, query) => {
        const ac = abort(req);
        const lang = (query.get('language') ?? 'sub') as 'sub' | 'dub' | 'raw';
        try {
          const streams = await sdk.stream(decodeURIComponent(params.id), { signal: ac.signal });
          const pick =
            streams.find((s) => s.language === lang) ??
            streams.find((s) => s.language === 'sub') ??
            streams[0];
          if (!pick) throw new Error('No streams available');
          json(res, 200, maybeProxifyStream(req, pick));
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      },
    ],

    [
      'GET',
      '/chapter/:id/pages',
      async (req, res, params) => {
        const ac = abort(req);
        try {
          const pages = await sdk.pages(decodeURIComponent(params.id), { signal: ac.signal });
          json(res, 200, maybeProxifyPages(req, pages));
        } catch (e) {
          json(res, 404, { error: (e as Error).message });
        }
      },
    ],

    [
      'GET',
      '/browse',
      async (req, res, _p, query) => {
        const ac = abort(req);
        const list = (query.get('list') ?? 'trending') as
          | 'trending'
          | 'popular'
          | 'seasonal'
          | 'top';
        const kind = (query.get('kind') ?? 'anime') as 'anime' | 'manga';
        try {
          const result = await sdk.browse({
            list,
            kind,
            page: query.get('page') ? Number(query.get('page')) : undefined,
            season: query.get('season') ?? undefined,
            year: query.get('year') ? Number(query.get('year')) : undefined,
            signal: ac.signal,
          });
          json(res, 200, result);
        } catch (e) {
          json(res, 500, { error: (e as Error).message });
        }
      },
    ],

    // ── Downloads ────────────────────────────────────────────────────────
    // Two-step flow: client opens an SSE connection on /progress to watch
    // the download complete, then GETs /file with the returned token to
    // pull the bytes. Avoids tying up a long-lived response with both
    // progress events and the final blob.

    [
      'GET',
      '/download/video/progress',
      async (req, res, _p, query) => {
        const episodeId = query.get('episodeId');
        const language = (query.get('language') ?? 'sub') as 'sub' | 'dub' | 'raw';
        if (!episodeId) {
          res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing param: episodeId' }));
          return;
        }

        const send = openSse(res);
        const ac = abort(req);
        try {
          send({ type: 'progress', phase: 'resolving', detail: 'Resolving stream…' });
          const allStreams = await sdk.stream(decodeURIComponent(episodeId), { signal: ac.signal });
          const candidates = allStreams.filter((s) => s.language === language);
          if (candidates.length === 0)
            candidates.push(...allStreams.filter((s) => s.language === 'sub'));
          if (candidates.length === 0) candidates.push(...allStreams);
          if (candidates.length === 0) throw new Error('No streams available');

          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sdk-dl-'));
          const safeId = episodeId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
          const filename = `${safeId}.mp4`;
          const tmpFile = path.join(tmpDir, filename);

          let downloaded = false;
          for (const stream of candidates) {
            try {
              await downloadVideo(stream, tmpFile, {
                timeoutMs: 1_200_000,
                onProgress: ({ phase, detail }) => send({ type: 'progress', phase, detail }),
              });
              send({ type: 'complete', token: storePending(tmpFile, tmpDir, filename) });
              downloaded = true;
              break;
            } catch {
              // try next candidate
            }
          }
          if (!downloaded) {
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
            send({ type: 'error', message: 'All stream candidates failed to download' });
          }
        } catch (e) {
          send({ type: 'error', message: e instanceof Error ? e.message : String(e) });
        }
        res.end();
      },
    ],

    [
      'GET',
      '/download/video/file',
      async (_req, res, _p, query) => {
        servePending(res, query.get('token'), 'video/mp4');
      },
    ],

    [
      'GET',
      '/download/manga/chapter/progress',
      async (req, res, _p, query) => {
        const chapterId = query.get('chapterId');
        if (!chapterId) {
          res.writeHead(400, { ...CORS, 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Missing param: chapterId' }));
          return;
        }

        const send = openSse(res);
        const ac = abort(req);
        try {
          const pages = await sdk.pages(decodeURIComponent(chapterId), { signal: ac.signal });

          const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'anime-sdk-dl-'));
          const safeId = chapterId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 32);
          const filename = `${safeId}.zip`;
          const tmpFile = path.join(tmpDir, filename);
          try {
            send({ type: 'progress', downloaded: 0, total: pages.pages.length });
            await downloadMangaChapter(pages, tmpFile, {
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
      },
    ],

    [
      'GET',
      '/download/manga/chapter/file',
      async (_req, res, _p, query) => {
        servePending(res, query.get('token'), 'application/zip');
      },
    ],
  ];
}

export function matchRoute(
  routes: Array<[string, string, Handler]>,
  method: string,
  pathname: string,
): [Handler, Record<string, string>] | null {
  for (const [m, pattern, handler] of routes) {
    if (m !== method) continue;
    const params = matchPattern(pattern, pathname);
    if (params !== null) return [handler, params];
  }
  return null;
}

function matchPattern(pattern: string, pathname: string): Record<string, string> | null {
  const patternParts = pattern.split('/');
  const pathParts = pathname.split('/');
  if (patternParts.length !== pathParts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < patternParts.length; i++) {
    const pp = patternParts[i];
    const vp = pathParts[i];
    if (pp.startsWith(':')) {
      params[pp.slice(1)] = vp;
    } else if (pp !== vp) {
      return null;
    }
  }
  return params;
}
