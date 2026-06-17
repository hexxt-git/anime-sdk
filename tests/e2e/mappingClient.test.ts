/**
 * Live E2E for MappingClient.
 *
 * Exercises the real resolution waterfall against real upstream services:
 *   - MALSync (api.malsync.moe) for `mangadex` (which has a stable
 *     MALSync alias).
 *   - Anify (api.anify.tv) as a parallel external source.
 *   - Fuzzy match against a real content provider (`AllmangaProvider`)
 *     when external APIs don't carry the alias.
 *
 * Tests use a real AniList metadata record as input (fetched from the
 * AniList GraphQL API) so the mapping calls have authentic mappings.
 */
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { MappingClient } from '../../src/meta/MappingClient.js';
import { AnilistMeta } from '../../src/meta/AnilistMeta.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';
import { MangadexProvider } from '../../src/providers/MangadexProvider.js';
import { SdkCache } from '../../src/types/index.js';

function memCache(): SdkCache & { snapshot(): Record<string, unknown> } {
  const store = new Map<string, unknown>();
  return {
    get: (k) => store.get(k),
    set: (k, v) => {
      store.set(k, v);
    },
    snapshot: () => Object.fromEntries(store),
  };
}

describe('MappingClient — live waterfall', () => {
  it('fuzzy-matches a real AniList title onto AllmangaProvider', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new AnilistMeta(http);
    const allmanga = new AllmangaProvider(http);
    const cache = memCache();
    const client = new MappingClient(http, { cache });

    // Cowboy Bebop (AniList id 1) — title is the same on every provider,
    // so the fuzzy path is almost guaranteed to find a match.
    const info = await meta.fetchMediaInfo('anilist:1');
    const r = await client.resolveProviderMediaId(info, allmanga);
    expect(r).not.toBeNull();
    expect(r!.providerId).toBe('allmanga');
    expect(r!.rawMediaId.length).toBeGreaterThan(0);
    // Either external lookup or fuzzy is acceptable — both are real hits.
    expect(['malsync', 'anify', 'fuzzy', 'provider']).toContain(r!.method);
    expect(cache.snapshot()[`mapping:anilist:1:allmanga`]).toBeDefined();

    // Second call must hit the SdkCache cheaply.
    const r2 = await client.resolveProviderMediaId(info, allmanga);
    expect(r2!.method).toBe('cached');
    expect(r2!.rawMediaId).toBe(r!.rawMediaId);
  }, 60_000);

  it('resolves a real AniList manga record onto MangadexProvider', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new AnilistMeta(http);
    const mangadex = new MangadexProvider(http);
    const cache = memCache();
    const client = new MappingClient(http, { cache });

    // Vinland Saga — AniList id 30642 (manga). MAL ID 642. Both the title
    // and the manga itself are unambiguous on MangaDex, so the resolution
    // is stable across runs.
    const info = await meta.fetchMediaInfo('anilist:30642');
    expect(info.catalogType).toBe('MANGA');

    const r = await client.resolveProviderMediaId(info, mangadex);
    expect(r).not.toBeNull();
    expect(r!.providerId).toBe('mangadex');
    // MangaDex IDs are UUIDs.
    expect(r!.rawMediaId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(['malsync', 'anify', 'fuzzy', 'provider']).toContain(r!.method);
  }, 60_000);

  it('does not mutate the input metadata record', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new AnilistMeta(http);
    const allmanga = new AllmangaProvider(http);
    const client = new MappingClient(http, { cache: memCache() });
    const info = await meta.fetchMediaInfo('anilist:1');
    const before = JSON.stringify(info.mappings);
    await client.resolveProviderMediaId(info, allmanga);
    expect(JSON.stringify(info.mappings)).toBe(before);
  }, 60_000);
});
