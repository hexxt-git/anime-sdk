import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { WeebcentralSource } from '../../src/sources/weebcentral.js';
import { decodeId } from '../../src/internal/id.js';

describe('Weebcentral E2E', () => {
  it('searches, fetches chapters, and resolves pages with accessible images', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new WeebcentralSource(http);

    const results = await source.search('Frieren', 'manga', {});
    expect(results.length).toBeGreaterThan(0);

    const target = results[0];
    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('weebcentral');
    console.log(`Weebcentral selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.chapters(decoded.r, {});
    expect(list.items.length).toBeGreaterThan(0);

    const pages = await source.pages(list.items[0].id, {});
    expect(pages.pages.length).toBeGreaterThan(0);

    const imgUrl = pages.pages[0].url;
    const imgRes = await http.get(imgUrl, {
      headers: {
        Referer: 'https://google.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    expect(imgRes.status).toBe(200);
    expect(imgRes.headers.get('content-type')).toMatch(/^image\//);

    console.log(`Weebcentral resolved ${pages.pages.length} pages; top: ${imgUrl.slice(0, 80)}`);
  }, 90000);
});
