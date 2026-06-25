import * as http from 'node:http';
import { createSdk, Sdk } from '../sdk.js';
import { buildRoutes, matchRoute } from './routes.js';
import { handleProxyRequest, ProxyOptions } from './proxy.js';

export interface ServerOptions {
  port?: number;
  sdk?: Sdk;
  /**
   * When set, exposes `/proxy` and rewrites every `Stream.url` /
   * `Pages.pages[].url` / subtitle URL in responses to route through it.
   * Browsers can then play streams that require custom headers or that
   * the CDN refuses to serve cross-origin.
   */
  proxy?: ProxyOptions;
}

export type { ProxyOptions };

export function startServer(opts: ServerOptions = {}): http.Server {
  const sdk = opts.sdk ?? createSdk();
  const routes = buildRoutes(sdk, opts.proxy);

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';

    if (method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': '*',
      });
      res.end();
      return;
    }

    if (opts.proxy && u.pathname === '/proxy') {
      handleProxyRequest(req, res, u.searchParams, opts.proxy).catch((e) => {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: (e as Error).message }));
        }
      });
      return;
    }

    const match = matchRoute(routes, method, u.pathname);
    if (!match) {
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const [handler, params] = match;
    handler(req, res, params, u.searchParams).catch((e) => {
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: (e as Error).message }));
      }
    });
  });

  server.listen(opts.port ?? 0);
  return server;
}
