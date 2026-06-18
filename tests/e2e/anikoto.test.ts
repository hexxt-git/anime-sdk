/**
 * E2E integration tests for AnikotoSource (anikototv.to backend).
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { AnikotoSource } from '../../src/sources/anikoto.js';
import { decodeId } from '../../src/internal/id.js';
import { captureStreamScreenshot, streamToPayload } from './screenshotHelper.js';

describe('Anikoto E2E', () => {
  it('searches, fetches episodes, resolves a sub stream, and captures a screenshot', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new AnikotoSource(http);

    const results = await source.search('Solo Leveling', 'anime', {});
    expect(results.length).toBeGreaterThan(0);

    const target = results[0];
    const decoded = decodeId(target.id);
    expect(decoded.s).toBe('anikoto');
    console.log(`Anikoto selected: ${target.title.preferred} (${decoded.r})`);

    const list = await source.episodes(decoded.r, {});
    expect(list.items.length).toBeGreaterThan(0);

    const stream = await source.stream(list.items[0].id, { language: 'sub' });
    expect(stream.url).toBeTruthy();
    console.log(`Anikoto (sub) stream: ${stream.url.slice(0, 80)}`);

    const result = await captureStreamScreenshot('anikoto_sub', streamToPayload(stream));
    expect(result.outputPath).toMatch(/screenshot_anikoto_sub\.png$/);
  }, 90000);

  it('resolves a dub stream for known ID, and captures a screenshot', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new AnikotoSource(http);

    const list = await source.episodes('7457', {});
    expect(list.items.length).toBeGreaterThan(0);

    const dubEp = list.items.find((ep) => ep.languages.includes('dub'));
    if (!dubEp) {
      console.warn('Dub not available for this title, skipping dub test');
      return;
    }

    const stream = await source.stream(dubEp.id, { language: 'dub' });
    expect(stream.url).toBeTruthy();

    const result = await captureStreamScreenshot('anikoto_dub', streamToPayload(stream));
    expect(result.outputPath).toMatch(/screenshot_anikoto_dub\.png$/);
  }, 90000);
});
