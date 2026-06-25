/**
 * Verifies the proxy SSRF allowlist.
 *
 * A target hostname not covered by `allowedHosts` must return 403; a hostname
 * that suffix-matches an entry must succeed.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { startServer } from '../../src/server/index.js';
import { createSdk } from '../../src/sdk.js';

let server: http.Server;
let baseUrl: string;

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
    // Suffix-matched: covers s4.anilist.co (and every other *.anilist.co).
    proxy: { allowedHosts: ['anilist.co'] },
  });
  await new Promise<void>((r) => server.on('listening', r));
  const addr = server.address() as http.AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('proxy SSRF allowlist', () => {
  it('allows a target whose hostname suffix-matches the allowlist', async () => {
    const target = 'https://s4.anilist.co/file/anilistcdn/character/large/default.jpg';
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(target)}`);
    expect(res.status).toBe(200);
    await res.arrayBuffer();
  }, 20000);

  it('rejects a target whose hostname is outside the allowlist', async () => {
    const target = 'https://example.com/';
    const res = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(target)}`);
    expect(res.status).toBe(403);
  });

  it('rejects a malformed url', async () => {
    const res = await fetch(`${baseUrl}/proxy?url=not-a-url`);
    expect(res.status).toBe(400);
  });
});
