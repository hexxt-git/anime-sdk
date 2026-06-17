/**
 * Live E2E for MalMeta (Jikan v4).
 *
 * Validates typed-URN behaviour and field mapping against MAL ID 1
 * (Cowboy Bebop, anime — stable forever) and an arbitrary manga.
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { MalMeta } from '../../src/meta/MalMeta.js';

describe('MalMeta — live (Jikan)', () => {
  it('search emits typed anime URNs', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new MalMeta(http);
    const results = await meta.search('Cowboy Bebop');
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.title.english === 'Cowboy Bebop');
    expect(hit).toBeDefined();
    expect(hit!.id).toBe('mal:anime:1');
    expect(hit!.providerId).toBe('mal');
    expect(hit!.catalogType).toBe('ANIME');
    expect(typeof hit!.score).toBe('number');
  }, 40_000);

  it('fetchMediaInfo for mal:anime:1 maps all primary fields', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new MalMeta(http);
    const info = await meta.fetchMediaInfo('mal:anime:1');
    expect(info.id).toBe('mal:anime:1');
    expect(info.providerId).toBe('mal');
    expect(info.catalogType).toBe('ANIME');
    expect(info.format).toBe('TV');
    expect(info.status).toBe('FINISHED');
    expect(info.episodeCount).toBe(26);
    expect(info.year).toBe(1998);
    expect(info.season).toBe('SPRING');
    expect(info.startDate).toMatch(/^1998-/);
    expect(info.title.english).toBe('Cowboy Bebop');
    expect(typeof info.score).toBe('number');
    expect((info.genres ?? []).length).toBeGreaterThan(0);
    expect((info.studios ?? []).length).toBeGreaterThan(0);
    expect(info.cover?.large).toMatch(/^https?:\/\//);
    expect(info.mappings?.mal).toBe(1);
  }, 40_000);

  it('legacy bare URN (`mal:1`) probes anime first and still works', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new MalMeta(http);
    const info = await meta.fetchMediaInfo('mal:1');
    // Legacy URN: id retains anime: prefix after round-trip.
    expect(info.id).toBe('mal:anime:1');
    expect(info.catalogType).toBe('ANIME');
  }, 40_000);

  it('fetchMediaInfo for an explicit manga URN routes to the manga endpoint', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const meta = new MalMeta(http);
    // MAL manga ID 1 = Monster (Naoki Urasawa) — finished long ago, stable.
    const info = await meta.fetchMediaInfo('mal:manga:1');
    expect(info.id).toBe('mal:manga:1');
    expect(info.catalogType).toBe('MANGA');
    expect(info.status).toBe('FINISHED');
    expect(typeof info.chapterCount).toBe('number');
    expect(info.title.english).toBeDefined();
  }, 40_000);

  it('anime fetchMediaInfo carries Jikan filler/recap flags via streamingEpisodes', async () => {
    const http = new HttpClient({ timeoutMs: 60_000 });
    const meta = new MalMeta(http);
    // Cowboy Bebop (26 episodes, all canonical = no filler) — small
    // enough to fully fetch but its filler flags are well-defined.
    const info = await meta.fetchMediaInfo('mal:anime:1');
    expect(Array.isArray(info.streamingEpisodes)).toBe(true);
    expect((info.streamingEpisodes ?? []).length).toBeGreaterThan(0);
    const ep1 = info.streamingEpisodes!.find((e) => e.number === 1);
    expect(ep1).toBeDefined();
    expect(typeof ep1!.isFiller).toBe('boolean');
    expect(typeof ep1!.isRecap).toBe('boolean');
    expect(ep1!.title).toBeDefined();
  }, 90_000);

  it('browse(top) returns a paginated top list', async () => {
    const http = new HttpClient({ timeoutMs: 30_000 });
    const meta = new MalMeta(http);
    expect(meta.supportsBrowseKind('top')).toBe(true);
    const items = await meta.browse('top', { catalogType: 'ANIME', perPage: 5 });
    expect(items.length).toBeGreaterThan(0);
    expect(items[0].id.startsWith('mal:anime:')).toBe(true);
  }, 40_000);
});
