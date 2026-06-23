import * as http from 'node:http';
import { createSdk, Sdk } from '../sdk.js';
import { buildRoutes, matchRoute } from './routes.js';

export interface ServerOptions {
  port?: number;
  sdk?: Sdk;
}

export function startServer(opts: ServerOptions = {}): http.Server {
  const sdk = opts.sdk ?? createSdk();
  const routes = buildRoutes(sdk);

  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    const method = req.method ?? 'GET';
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
