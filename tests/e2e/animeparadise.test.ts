/**
 * E2E integration tests for AnimeParadiseSource.
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { AnimeParadiseSource } from '../../src/sources/animeparadise.js';
import { decodeId } from '../../src/internal/id.js';
import { captureStreamScreenshot, streamToPayload } from './screenshotHelper.js';

describe('AnimeParadise E2E', () => {
  it('searches, fetches episodes, resolves a stream, and captures a screenshot', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new AnimeParadiseSource(http);

    const results = await source.search('Frieren', 'anime', {});
    expect(results.length).toBeGreaterThan(0);

    const target =
      results.find((r) => !r.title.preferred.toLowerCase().includes('season 2')) ?? results[0];

    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('animeparadise');
    console.log(`AnimeParadise selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.episodes(decoded.r, {});
    expect(list.items.length).toBeGreaterThan(0);

    const stream = await source.stream(list.items[0].id, {});
    expect(stream.url).toBeTruthy();
    console.log(`AnimeParadise stream: ${stream.url.slice(0, 80)}`);

    const result = await captureStreamScreenshot('animeparadise', streamToPayload(stream));
    expect(result.outputPath).toMatch(/screenshot_animeparadise\.png$/);
  }, 90000);
});
