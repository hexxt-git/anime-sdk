/**
 * SDK-level live tests for the search → info → sources path.
 *
 * Catches the class of bug where Sdk.info passes the raw `r` field to a
 * source whose info() implementation tries to base64-decode it again —
 * which is what crashed /media/:id when clicking a MAL or Kitsu search
 * result with id "anime:<n>".
 */
import { describe, expect, it } from 'vitest';
import { createSdk } from '../../src/sdk.js';

describe('Sdk.info(string) round-trips opaque search ids', () => {
  it('MAL: search → info', async () => {
    const sdk = createSdk({ sources: ['mal'], http: { timeoutMs: 25_000 } });
    const results = await sdk.search('Cowboy Bebop', { kind: 'anime' });
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.mappings.mal === 1);
    expect(hit).toBeDefined();

    const info = await sdk.info(hit!.id);
    expect(info.kind).toBe('anime');
    expect(info.mappings.mal).toBe(1);
    expect(info.episodeCount).toBe(26);
  }, 60_000);

  it('Kitsu: search → info', async () => {
    const sdk = createSdk({ sources: ['kitsu'], http: { timeoutMs: 25_000 } });
    const results = await sdk.search('Cowboy Bebop', { kind: 'anime' });
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.mappings.kitsu === 1);
    expect(hit).toBeDefined();

    const info = await sdk.info(hit!.id);
    expect(info.kind).toBe('anime');
    expect(info.mappings.kitsu).toBe(1);
  }, 60_000);

  it('AniList: search → info', async () => {
    const sdk = createSdk({ sources: ['anilist'], http: { timeoutMs: 25_000 } });
    const results = await sdk.search('Frieren', { kind: 'anime' });
    expect(results.length).toBeGreaterThan(0);
    const hit = results[0];

    const info = await sdk.info(hit.id);
    expect(info.kind).toBe('anime');
    expect(info.title.preferred).toBeTruthy();
  }, 60_000);
});

describe('Sdk.sources(string) round-trips opaque search ids', () => {
  it('does not crash when fed a MAL search result id', async () => {
    const sdk = createSdk({ sources: ['mal', 'megaplay'], http: { timeoutMs: 25_000 } });
    const results = await sdk.search('Cowboy Bebop', { kind: 'anime' });
    const hit = results.find((r) => r.mappings.mal === 1);
    expect(hit).toBeDefined();

    const sources = await sdk.sources(hit!.id);
    expect(Array.isArray(sources)).toBe(true);
    // megaplay should be a candidate since it can resolve via MAL/AniList
    expect(sources.length).toBeGreaterThan(0);
  }, 60_000);
});
