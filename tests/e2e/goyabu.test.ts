/**
 * E2E integration tests for GoyabuSource.
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { GoyabuSource } from '../../src/sources/goyabu.js';
import { decodeId } from '../../src/internal/id.js';
import { captureStreamScreenshot, streamToPayload } from './screenshotHelper.js';

describe('Goyabu E2E', () => {
  it('searches, fetches episodes, resolves a stream, and captures a screenshot', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new GoyabuSource(http);

    const ping = await fetch('https://goyabu.io', {
      method: 'HEAD',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      signal: AbortSignal.timeout(8000),
    });
    expect(ping.status, 'goyabu.io must be reachable').toBeLessThan(500);

    const results = await source.search('Naruto', 'anime', {});
    expect(results.length).toBeGreaterThan(0);

    const target = results[0];
    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('goyabu');
    console.log(`Goyabu selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.episodes(decoded.r, {});
    expect(list.items.length).toBeGreaterThan(0);

    const stream = await source.stream(list.items[0].id, {});
    expect(stream.url).toBeTruthy();
    console.log(`Goyabu stream: ${stream.url.slice(0, 80)}`);

    const result = await captureStreamScreenshot('goyabu', streamToPayload(stream));
    expect(result.outputPath).toMatch(/screenshot_goyabu\.png$/);
  }, 90000);
});
