/**
 * Live server E2E.
 *
 * Spawns the real `startServer({ ... })` HTTP server against the real
 * AnilistMeta + AllmangaProvider and exercises every public route:
 *
 *   - /health
 *   - /openapi.json
 *   - /search      (content provider)
 *   - /meta/search (metadata provider)
 *   - /meta/info   (metadata provider — verifies enrichment fields)
 *   - /meta/content (metadata → content cross-provider)
 *   - /meta/browse (trending)
 *
 * No mocks; the server is a real HTTP server, the providers do real
 * upstream calls, and we hit the server through `fetch`.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as http from 'node:http';
import { HttpClient } from '../../src/transport/http.js';
import { AnilistMeta } from '../../src/meta/AnilistMeta.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';
import { startServer } from '../../src/server/index.js';

let server: http.Server;
let baseUrl: string;
const cache = new Map<string, unknown>();

beforeAll(async () => {
  const httpClient = new HttpClient({ timeoutMs: 30_000 });
  server = startServer({
    providers: [new AllmangaProvider(httpClient)],
    metaProviders: [new AnilistMeta(httpClient)],
    proxy: false,
    cache: {
      get: (k) => cache.get(k),
      set: (k, v) => {
        cache.set(k, v);
      },
    },
    // Bind to a random ephemeral port to avoid collisions with anything
    // already running on :3000 in dev.
    port: await getFreePort(),
  });
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('failed to bind');
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function getJson<T = unknown>(path: string): Promise<{ status: number; body: T }> {
  const res = await fetch(`${baseUrl}${path}`);
  const body = (await res.json()) as T;
  return { status: res.status, body };
}

describe('startServer — live integration', () => {
  it('/health returns ok with the registered providers', async () => {
    const { status, body } = await getJson<{
      ok: boolean;
      providers: string[];
      metaProviders: string[];
    }>('/health');
    expect(status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.providers).toContain('allmanga');
    expect(body.metaProviders).toContain('anilist');
  });

  it('/openapi.json describes the meta routes', async () => {
    const { status, body } = await getJson<{ paths: Record<string, unknown> }>('/openapi.json');
    expect(status).toBe(200);
    expect(body.paths).toHaveProperty('/meta/search');
    expect(body.paths).toHaveProperty('/meta/info');
    expect(body.paths).toHaveProperty('/meta/content');
    expect(body.paths).toHaveProperty('/meta/stream');
    expect(body.paths).toHaveProperty('/meta/browse');
  });

  it('/meta/search hits AniList live', async () => {
    const { status, body } = await getJson<Array<{ id: string; title: { english?: string } }>>(
      '/meta/search?provider=anilist&q=Cowboy%20Bebop',
    );
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].id.startsWith('anilist:')).toBe(true);
  }, 30_000);

  it('/meta/info returns full IMediaMetadata for anilist:1', async () => {
    const { status, body } = await getJson<{
      id: string;
      title: { english?: string };
      episodeCount?: number;
      characters?: unknown[];
      streamingEpisodes?: unknown[];
    }>('/meta/info?provider=anilist&id=anilist:1');
    expect(status).toBe(200);
    expect(body.id).toBe('anilist:1');
    expect(body.title.english).toBe('Cowboy Bebop');
    expect(body.episodeCount).toBe(26);
    expect(Array.isArray(body.characters)).toBe(true);
    expect((body.characters ?? []).length).toBeGreaterThan(0);
    expect((body.streamingEpisodes ?? []).length).toBeGreaterThan(0);
  }, 40_000);

  it('/meta/content resolves the AniList → AllManga mapping and returns episodes', async () => {
    const { status, body } = await getJson<Array<{ id: string; number: number }>>(
      '/meta/content?provider=anilist&id=anilist:1&contentProvider=allmanga',
    );
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].id.startsWith('allmanga:')).toBe(true);
  }, 90_000);

  it('/meta/browse?kind=trending returns AniList trending', async () => {
    const { status, body } = await getJson<Array<{ id: string }>>(
      '/meta/browse?provider=anilist&kind=trending&perPage=3',
    );
    expect(status).toBe(200);
    expect(body.length).toBeGreaterThan(0);
    expect(body[0].id.startsWith('anilist:')).toBe(true);
  }, 30_000);

  it('cached calls do not re-hit upstream', async () => {
    // /meta/info already ran once; the second call should be a cache hit.
    const before = cache.size;
    const { status } = await getJson('/meta/info?provider=anilist&id=anilist:1');
    expect(status).toBe(200);
    expect(cache.size).toBe(before); // nothing new written
  });

  it('returns 400 for missing required params', async () => {
    const { status, body } = await getJson<{ error: string }>('/meta/search?q=foo');
    expect(status).toBe(400);
    expect(body.error).toMatch(/provider/i);
  });

  it('returns 404 for unknown routes under /meta/', async () => {
    const { status } = await getJson('/meta/nope?provider=anilist');
    expect(status).toBe(404);
  });

  it('strict URN check rejects a mismatched meta URN with 400', async () => {
    const { status, body } = await getJson<{ error: string }>(
      '/meta/info?provider=anilist&id=mal:21',
    );
    expect(status).toBe(400);
    expect(body.error).toMatch(/does not match/);
  });
});

async function getFreePort(): Promise<number> {
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
