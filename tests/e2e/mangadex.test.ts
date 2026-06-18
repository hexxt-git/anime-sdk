import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { MangadexSource } from '../../src/sources/mangadex.js';
import { decodeId } from '../../src/internal/id.js';

describe('Mangadex E2E', () => {
  it('searches, fetches all chapters, and resolves pages with accessible images', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new MangadexSource(http);

    const results = await source.search('Frieren', 'manga', {});
    expect(results.length).toBeGreaterThan(0);

    const target = results[0];
    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('mangadex');
    console.log(`Mangadex selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.chapters(decoded.r, {});
    expect(list.items.length).toBeGreaterThan(0);
    console.log(`Mangadex found ${list.items.length} chapters`);

    const ch1 = list.items[0];
    const pages = await source.pages(ch1.id, {});
    expect(pages.pages.length).toBeGreaterThan(0);

    const imgUrl = pages.pages[0].url;
    const imgRes = await http.get(imgUrl, {
      headers: { Referer: 'https://mangadex.org/' },
    });
    expect(imgRes.status).toBe(200);
    const contentType = imgRes.headers.get('content-type');
    expect(contentType).toMatch(/^image\//);

    console.log(
      `Mangadex resolved ${pages.pages.length} pages; top: ${imgUrl.slice(0, 80)} (${contentType})`,
    );
  }, 90000);
});
