/**
 * E2E integration tests for AllmangaSource.
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { AllmangaSource } from '../../src/sources/allmanga.js';
import { decodeId } from '../../src/internal/id.js';
import { captureStreamScreenshot, streamToPayload } from './screenshotHelper.js';

describe('AllManga E2E', () => {
  it('searches, fetches episodes, resolves a stream, and captures a screenshot', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new AllmangaSource(http);

    const query = 'Frieren';
    const results = await source.search(query, 'anime', {});
    expect(results.length).toBeGreaterThan(0);

    const target =
      results.find(
        (r) =>
          r.title.preferred.toLowerCase().includes("beyond journey's end") &&
          !r.title.preferred.toLowerCase().includes('mini'),
      ) ?? results[0];

    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('allmanga');
    console.log(`AllManga selected: ${target.title.preferred} (${decoded.r})`);

    const mediaId = decoded.r;
    const list = await source.episodes(mediaId, {});
    expect(list.items.length).toBeGreaterThan(0);

    const ep1 = list.items[0];
    const stream = await source.stream(ep1.id, { language: 'sub' });
    expect(stream.url).toBeTruthy();
    expect(stream.isHls !== undefined).toBe(true);
    console.log(`AllManga stream: ${stream.url.slice(0, 80)}`);

    const result = await captureStreamScreenshot('allmanga', streamToPayload(stream));
    expect(result.outputPath).toMatch(/screenshot_allmanga\.png$/);
  }, 90000);
});
