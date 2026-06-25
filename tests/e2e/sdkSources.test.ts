/**
 * Live E2E for the full search → sources path with the title-search fallback
 * enabled. Verifies that playback sources without a native cross-source
 * mapping (allmanga, animeparadise, anikoto, gogoanime) become reachable
 * from a catalogue search result.
 */
import { describe, expect, it } from 'vitest';
import { createSdk } from '../../src/sdk.js';

describe('Sdk.sources — title-search fallback makes non-mapping sources available', () => {
  it('AllManga resolves a popular AniList result via title search', async () => {
    const sdk = createSdk({
      sources: ['anilist', 'allmanga'],
      http: { timeoutMs: 25_000 },
    });
    const results = await sdk.search('Frieren', { kind: 'anime' });
    const hit = results.find((r) => r.mappings.anilist === 154587);
    expect(hit).toBeDefined();

    const sources = await sdk.sources(hit!);
    const allmanga = sources.find((s) => s.id === 'allmanga');
    expect(allmanga).toBeDefined();
    expect(allmanga!.status).toBe('available');
  }, 90_000);

  it('Anikoto resolves the same title via fallback', async () => {
    const sdk = createSdk({
      sources: ['anilist', 'anikoto'],
      http: { timeoutMs: 25_000 },
    });
    const results = await sdk.search('Frieren', { kind: 'anime' });
    const hit = results.find((r) => r.mappings.anilist === 154587);
    expect(hit).toBeDefined();

    const sources = await sdk.sources(hit!);
    const ak = sources.find((s) => s.id === 'anikoto');
    expect(ak).toBeDefined();
    expect(ak!.status).toBe('available');
  }, 90_000);

  it('MangaDex resolves a popular manga via fallback', async () => {
    const sdk = createSdk({
      sources: ['anilist', 'mangadex'],
      http: { timeoutMs: 25_000 },
    });
    const results = await sdk.search('Chainsaw Man', { kind: 'manga' });
    expect(results.length).toBeGreaterThan(0);
    const hit = results[0];

    const sources = await sdk.sources(hit);
    const md = sources.find((s) => s.id === 'mangadex');
    expect(md).toBeDefined();
    expect(md!.status).toBe('available');
  }, 90_000);
});
