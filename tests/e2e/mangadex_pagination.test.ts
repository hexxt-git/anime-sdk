import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { MangadexSource } from '../../src/sources/mangadex.js';
import { decodeId } from '../../src/internal/id.js';

describe('Mangadex E2E Pagination', () => {
  it('fetches more than 500 chapters for Kaguya-sama', async () => {
    const http = new HttpClient({ timeoutMs: 30000 });
    const source = new MangadexSource(http);

    const results = await source.search('Kaguya-sama', 'manga', {});
    expect(results.length).toBeGreaterThan(0);

    const target = results.find((r) => r.title.preferred.includes('Kaguya-sama')) ?? results[0];
    const decoded = decodeId(target.id);
    console.log(`Mangadex selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.chapters(decoded.r, {});
    console.log(`Mangadex found ${list.items.length} chapters for Kaguya-sama`);

    expect(list.items.length).toBeGreaterThan(500);
  }, 120000);
});
