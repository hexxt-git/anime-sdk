import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { AnilistSource } from '../../src/sources/anilist.js';
import { decodeId } from '../../src/internal/id.js';

describe('AnilistSource (live)', () => {
  const http = new HttpClient({ timeoutMs: 20_000 });
  const source = new AnilistSource(http);

  it('search returns Media items with opaque IDs and correct fields', async () => {
    const results = await source.search('frieren', 'anime', {});
    expect(results.length).toBeGreaterThan(0);
    const first = results[0];
    expect(first.kind).toBe('anime');
    expect(first.title.preferred).toBeTruthy();
    expect(first.catalogues).toContain('anilist');
    expect(first.mappings.anilist).toBeTypeOf('number');

    const decoded = decodeId(first.id);
    expect(decoded.s).toBe('anilist');
    expect(decoded.t).toBe('media');
  }, 30000);

  it('info returns full Media for a known ID (Frieren = 154587)', async () => {
    const media = await source.info('154587', {});
    expect(media.kind).toBe('anime');
    expect(media.title.preferred).toBeTruthy();
    expect(media.episodeCount).toBeGreaterThan(0);
    expect(media.mappings.anilist).toBe(154587);
    expect(media.score?.scale).toBe(100);
  }, 30000);

  it('browse(trending) returns a list of Media', async () => {
    const list = await source.browse({ list: 'trending', kind: 'anime' });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].kind).toBe('anime');
  }, 30000);

  it('browse(seasonal) requires season and year', async () => {
    await expect(source.browse({ list: 'seasonal', kind: 'anime' })).rejects.toThrow(
      'season and year required',
    );
  });
});
