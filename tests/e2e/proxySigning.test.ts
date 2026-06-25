/**
 * Live test of the `/proxy` HMAC-signing scheme.
 *
 * Spawns a real server with proxy.signSecret and verifies:
 *   - A valid `sig` proxies the upstream byte stream.
 *   - An invalid `sig` returns 401.
 *   - A missing `sig` returns 401.
 *
 * The upstream target is a small static asset (AniList CDN). Hitting it is
 * cheap and never touches a real stream provider.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import * as crypto from 'node:crypto';
import { startServer } from '../../src/server/index.js';
import { createSdk } from '../../src/sdk.js';

let server: http.Server;
let baseUrl: string;
const SECRET = 'super-secret-key';
const TARGET = 'https://s4.anilist.co/file/anilistcdn/character/large/default.jpg';

async function getFreePort(): Promise<number> {
  return new Promise((resolve) => {
    const s = http.createServer();
    s.listen(0, () => {
      const p = (s.address() as http.AddressInfo).port;
      s.close(() => resolve(p));
    });
  });
}

beforeAll(async () => {
  const port = await getFreePort();
  server = startServer({
    port,
    sdk: createSdk({ sources: ['anilist'] }),
    proxy: { signSecret: SECRET },
  });
  await new Promise<void>((r) => server.on('listening', r));
  const addr = server.address() as http.AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function sign(url: string, h?: string): string {
  const hmac = crypto.createHmac('sha256', SECRET);
  hmac.update(url);
  if (h) hmac.update('|h=' + h);
  return hmac.digest('hex');
}

describe('proxy HMAC signing', () => {
  it('accepts a request with a valid signature', async () => {
    const sig = sign(TARGET);
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(TARGET)}&sig=${sig}`);
    expect(res.status).toBe(200);
    // Drain so we don't leak a half-open response.
    await res.arrayBuffer();
  }, 20000);

  it('rejects a request with an invalid signature', async () => {
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(TARGET)}&sig=deadbeef`);
    expect(res.status).toBe(401);
  });

  it('rejects a request with no signature', async () => {
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(TARGET)}`);
    expect(res.status).toBe(401);
  });
});
