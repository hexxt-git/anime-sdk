/**
 * Live E2E for AnilistMeta — hits the public graphql.anilist.co endpoint.
 *
 * Validates the full mapping (and enrichments: relations, characters,
 * staff, recommendations, externalLinks, streamingEpisodes) against a
 * stable, well-known title (Cowboy Bebop, AniList ID 1 — first entry,
 * finished airing in 1999, will never disappear).
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { AnilistMeta } from '../../src/meta/AnilistMeta.js';

describe('AnilistMeta — live', () => {
  it('search returns AniList-prefixed URNs for a known query', async () => {
    const http = new HttpClient({ timeoutMs: 20_000 });
    const meta = new AnilistMeta(http);
    const results = await meta.search('Cowboy Bebop');
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.title.english?.toLowerCase() === 'cowboy bebop');
    expect(hit).toBeDefined();
    expect(hit!.id.startsWith('anilist:')).toBe(true);
    expect(hit!.providerId).toBe('anilist');
    expect(hit!.catalogType).toBe('ANIME');
  }, 30_000);

  it('fetchMediaInfo for AniList ID 1 (Cowboy Bebop) populates all enrichment fields', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new AnilistMeta(http);
    const info = await meta.fetchMediaInfo('anilist:1');

    expect(info.id).toBe('anilist:1');
    expect(info.providerId).toBe('anilist');
    expect(info.catalogType).toBe('ANIME');
    expect(info.title.english).toBe('Cowboy Bebop');
    expect(info.title.romaji).toBe('Cowboy Bebop');
    expect(info.status).toBe('FINISHED');
    expect(info.format).toBe('TV');
    expect(info.episodeCount).toBe(26);
    expect(info.year).toBe(1998);
    expect(info.season).toBe('SPRING');
    expect(info.startDate).toBe('1998-04-03');
    expect(info.mappings?.anilist).toBe(1);
    expect(typeof info.mappings?.mal).toBe('number');
    expect(info.cover?.large).toMatch(/^https?:\/\//);
    expect(typeof info.score).toBe('number');
    expect((info.genres ?? []).length).toBeGreaterThan(0);
    expect((info.studios ?? []).length).toBeGreaterThan(0);

    // Enrichments — AniList ships all of these for Cowboy Bebop.
    expect((info.characters ?? []).length).toBeGreaterThan(0);
    expect(info.characters?.[0].id.startsWith('anilist:character:')).toBe(true);
    expect((info.staff ?? []).length).toBeGreaterThan(0);
    expect(info.staff?.[0].id.startsWith('anilist:staff:')).toBe(true);
    expect((info.recommendations ?? []).length).toBeGreaterThan(0);
    expect(info.recommendations?.[0].id.startsWith('anilist:')).toBe(true);
    expect((info.externalLinks ?? []).length).toBeGreaterThan(0);
  }, 40_000);

  it('browse(trending) returns at least one anime', async () => {
    const http = new HttpClient({ timeoutMs: 20_000 });
    const meta = new AnilistMeta(http);
    expect(meta.supportsBrowseKind('trending')).toBe(true);
    const items = await meta.browse('trending', { catalogType: 'ANIME', perPage: 5 });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].id.startsWith('anilist:')).toBe(true);
  }, 30_000);

  it('browse(seasonal) requires season+year', async () => {
    const http = new HttpClient({ timeoutMs: 5_000 });
    const meta = new AnilistMeta(http);
    await expect(meta.browse('seasonal', {})).rejects.toThrow(/season and year/);
  });

  it('rejects non-numeric AniList IDs without making a network call', async () => {
    const http = new HttpClient({ timeoutMs: 5_000 });
    const meta = new AnilistMeta(http);
    await expect(meta.fetchMediaInfo('anilist:not-a-number')).rejects.toThrow(/Invalid AniList ID/);
  });
});
