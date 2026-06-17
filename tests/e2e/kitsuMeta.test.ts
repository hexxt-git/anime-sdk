/**
 * Live E2E for KitsuMeta — hits kitsu.io's JSON:API.
 *
 * No skip-on-unreachable: per CLAUDE.md, a test must either pass or
 * fail. If Kitsu is unreachable from this network, the test fails and
 * the operator either fixes the network path or removes the test.
 */
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { KitsuMeta } from '../../src/meta/KitsuMeta.js';

describe('KitsuMeta — live', () => {
  it('search emits typed anime URNs', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new KitsuMeta(http);
    const results = await meta.search('Cowboy Bebop');
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.title.english === 'Cowboy Bebop');
    expect(hit).toBeDefined();
    expect(hit!.id).toBe('kitsu:anime:1');
    expect(hit!.providerId).toBe('kitsu');
    expect(hit!.catalogType).toBe('ANIME');
  }, 40_000);

  it('fetchMediaInfo for kitsu:anime:1 maps core fields + cross-source mappings', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new KitsuMeta(http);
    const info = await meta.fetchMediaInfo('kitsu:anime:1');
    expect(info.id).toBe('kitsu:anime:1');
    expect(info.providerId).toBe('kitsu');
    expect(info.catalogType).toBe('ANIME');
    expect(info.status).toBe('FINISHED');
    expect(info.format).toBe('TV');
    expect(info.episodeCount).toBe(26);
    expect(info.year).toBe(1998);
    expect(info.title.english).toBe('Cowboy Bebop');
    expect(info.cover?.large).toMatch(/^https?:\/\//);
    expect(info.mappings?.kitsu).toBe(1);
    // Kitsu publishes mappings to MAL/AniList in its relationship graph.
    expect(typeof info.mappings?.mal).toBe('number');
    expect(typeof info.mappings?.anilist).toBe('number');
    expect((info.genres ?? []).length).toBeGreaterThan(0);
  }, 40_000);

  it('legacy bare URN (`kitsu:1`) still resolves to the anime endpoint', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new KitsuMeta(http);
    const info = await meta.fetchMediaInfo('kitsu:1');
    expect(info.id).toBe('kitsu:anime:1');
    expect(info.catalogType).toBe('ANIME');
  }, 40_000);
});
