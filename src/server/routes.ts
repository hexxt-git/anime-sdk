import type * as http from 'node:http';
import type { Sdk } from '../sdk.js';

type Handler = (
  req: http.IncomingMessage,
  res: http.ServerResponse,
  params: Record<string, string>,
  query: URLSearchParams,
) => Promise<void>;

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, {
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

export function buildRoutes(sdk: Sdk): Array<[string, string, Handler]> {
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
      '/episode/:id/stream',
      async (req, res, params, query) => {
        const ac = abort(req);
        try {
          const stream = await sdk.stream(decodeURIComponent(params.id), {
            language: (query.get('language') ?? 'sub') as 'sub' | 'dub' | 'raw',
            quality: query.get('quality') ?? undefined,
            adjacency: (query.get('adjacency') ?? 'walk-relations') as
              | 'within-media'
              | 'walk-relations',
            signal: ac.signal,
          });
          json(res, 200, stream);
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
          json(res, 200, pages);
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
