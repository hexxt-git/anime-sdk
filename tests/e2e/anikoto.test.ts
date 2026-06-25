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

    const streams = await source.stream(list.items[0].id, {});
    expect(streams.length).toBeGreaterThan(0);
    streams.forEach((s) => expect(s.source).toBe('anikoto'));
    const sub = streams.find((s) => s.language === 'sub') ?? streams[0];
    expect(sub.url).toBeTruthy();
    console.log(
      `Anikoto stream: ${sub.url.slice(0, 80)} (${streams.map((s) => s.language).join('+')})`,
    );

    const result = await captureStreamScreenshot('anikoto_sub', streamToPayload(sub));
    expect(result.outputPath).toMatch(/screenshot_anikoto_sub\.png$/);
  }, 90000);

  it('resolves streams for a known episode and finds sub or dub', async () => {
    const http = new HttpClient({ timeoutMs: 25000 });
    const source = new AnikotoSource(http);

    const list = await source.episodes('7457', {});
    expect(list.items.length).toBeGreaterThan(0);

    const streams = await source.stream(list.items[0].id, {});
    expect(streams.length).toBeGreaterThan(0);

    const dub = streams.find((s) => s.language === 'dub');
    if (dub) {
      const result = await captureStreamScreenshot('anikoto_dub', streamToPayload(dub));
      expect(result.outputPath).toMatch(/screenshot_anikoto_dub\.png$/);
    } else {
      const sub = streams.find((s) => s.language === 'sub') ?? streams[0];
      const result = await captureStreamScreenshot('anikoto_sub2', streamToPayload(sub));
      expect(result.outputPath).toMatch(/screenshot_anikoto_sub2\.png$/);
    }
  }, 90000);
});
