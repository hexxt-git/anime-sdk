/**
 * Integration test for startServer — spawns a real server, hits each route.
 * Uses only AniList (fast, no screenshot needed) to keep runtime manageable.
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
      const port = (s.address() as http.AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

beforeAll(async () => {
  const port = await getFreePort();
  const sdk = createSdk({ sources: ['anilist'] });
  server = startServer({ port, sdk });
  await new Promise<void>((r) => server.on('listening', r));
  const addr = server.address() as http.AddressInfo;
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((r) => server.close(() => r()));
});

async function get(path: string) {
  const res = await fetch(`${baseUrl}${path}`);
  return { status: res.status, body: await res.json() };
}

describe('startServer — live integration', () => {
  it('GET /health returns source health array', async () => {
    const { status, body } = await get('/health');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /search?q=frieren&kind=anime returns Media array', async () => {
    const { status, body } = await get('/search?q=frieren&kind=anime');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as any[]).length).toBeGreaterThan(0);
    expect((body as any[])[0].kind).toBe('anime');
    expect((body as any[])[0].title.preferred).toBeTruthy();
  }, 30000);

  it('GET /browse?list=trending&kind=anime returns List<Media>', async () => {
    const { status, body } = await get('/browse?list=trending&kind=anime');
    expect(status).toBe(200);
    expect((body as any).items).toBeDefined();
    expect((body as any).items.length).toBeGreaterThan(0);
  }, 30000);

  it('GET /search with no q returns 400', async () => {
    const { status } = await get('/search');
    expect(status).toBe(400);
  });

  it('GET /unknown returns 404', async () => {
    const { status } = await get('/does-not-exist');
    expect(status).toBe(404);
  });
});
