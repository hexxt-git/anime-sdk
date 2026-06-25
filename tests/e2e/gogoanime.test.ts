/**
 * E2E integration tests for GogoanimeSource (anineko.to backend).
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { GogoanimeSource } from '../../src/sources/gogoanime.js';
import { decodeId } from '../../src/internal/id.js';
import { captureStreamScreenshot, streamToPayload } from './screenshotHelper.js';

describe('GogoAnime E2E', () => {
  it('searches, fetches episodes, resolves a stream, and captures a screenshot', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new GogoanimeSource(http);

    const results = await source.search('Frieren', 'anime', {});
    expect(results.length).toBeGreaterThan(0);

    const target = results[0];
    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('gogoanime');
    console.log(`GogoAnime selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.episodes(decoded.r, {});
    expect(list.items.length).toBeGreaterThan(0);

    const streams = await source.stream(list.items[0].id, {});
    expect(streams.length).toBeGreaterThan(0);
    const stream = streams[0];
    expect(stream.url).toBeTruthy();
    expect(stream.source).toBe('gogoanime');
    console.log(`GogoAnime stream: ${stream.url.slice(0, 80)} (${stream.language})`);

    const result = await captureStreamScreenshot('gogoanime', streamToPayload(stream));
    expect(result.outputPath).toMatch(/screenshot_gogoanime\.png$/);
  }, 90000);
});
