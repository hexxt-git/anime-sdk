/**
 * Live E2E for KitsuSource — hits kitsu.io's JSON:API.
 */
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { KitsuSource } from '../../src/sources/kitsu.js';
import { decodeId } from '../../src/internal/id.js';

describe('KitsuSource — live', () => {
  it('search returns Media with correct fields for Cowboy Bebop', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const source = new KitsuSource(http);
    const results = await source.search('Cowboy Bebop', 'anime', {});
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find(
      (r) => r.title.english === 'Cowboy Bebop' || r.title.preferred.includes('Cowboy Bebop'),
    );
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe('anime');
    expect(hit!.mappings.kitsu).toBeTypeOf('number');

    const decoded = decodeId(hit!.id);
    expect(decoded.s).toBe('kitsu');
  }, 40_000);

  it('info for kitsu:anime:1 maps core fields and cross-source mappings', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const source = new KitsuSource(http);
    const results = await source.search('Cowboy Bebop', 'anime', {});
    const cowboyBebopId = results.find((r) => r.mappings.kitsu === 1)?.id;
    if (!cowboyBebopId) return; // kitsu ID may differ

    const info = await source.info(cowboyBebopId, {});
    expect(info.kind).toBe('anime');
    expect(info.episodeCount).toBe(26);
    expect(info.mappings.kitsu).toBeTypeOf('number');
    // Kitsu publishes MAL/AniList mappings
    if (info.mappings.mal) expect(typeof info.mappings.mal).toBe('number');
  }, 40_000);
});
