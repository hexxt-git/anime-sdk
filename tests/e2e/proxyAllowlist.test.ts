/**
 * Live test of the `/proxy` SSRF allowlist. Spawns a real server with
 * `proxyAllowedHosts: ['example.com']` and verifies:
 *   - allowed hosts are proxied successfully,
 *   - any other host is rejected with 403.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { HttpClient } from '../../src/transport/http.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';
import { startServer } from '../../src/server/index.js';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const httpClient = new HttpClient({ timeoutMs: 20_000 });
  server = startServer({
    providers: [new AllmangaProvider(httpClient)],
    proxy: true,
    proxyAllowedHosts: ['example.com'],
    port: await freePort(),
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('/proxy SSRF allowlist', () => {
  it('allows example.com and any of its subdomains', async () => {
    const r = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent('https://example.com/')}`);
    expect(r.status).toBe(200);
  }, 30_000);

  it('rejects requests outside the allowlist with 403', async () => {
    const r = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent('https://wikipedia.org/')}`);
    expect(r.status).toBe(403);
    const body = (await r.json()) as { error: string };
    expect(body.error).toMatch(/allowlist/);
  });

  it('rejects 400 on a malformed url', async () => {
    const r = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent('not a url')}`);
    expect(r.status).toBe(400);
  });
});

async function freePort(): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const s = http.createServer();
    s.listen(0, () => {
      const addr = s.address();
      if (!addr || typeof addr === 'string') {
        reject(new Error('no address'));
        return;
      }
      const port = addr.port;
      s.close(() => resolve(port));
    });
  });
}
