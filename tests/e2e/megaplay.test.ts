import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import { HttpClient } from '../../src/internal/http.js';
import { MegaPlaySource } from '../../src/sources/megaplay.js';
import { decodeId } from '../../src/internal/id.js';
import { captureStreamScreenshot, streamToPayload } from './screenshotHelper.js';

describe('MegaPlaySource E2E', () => {
  const http = new HttpClient({ timeoutMs: 30000 });
  const source = new MegaPlaySource(http);

  it('should search for Frieren', async () => {
    const results = await source.search('Frieren', 'anime', {});
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].title.preferred.toLowerCase()).toContain('frieren');
    const decoded = decodeId(results[0].id);
    expect(decoded.r).toBe('154587');
  });

  it('should fetch episodes for Frieren (anilist 154587)', async () => {
    const list = await source.episodes('154587', {});
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].number).toBe(1);
  });

  it('should resolve and capture sub+dub streams for Frieren episode 1', async () => {
    const ep1Id = (await source.episodes('154587', {})).items[0].id;
    const streams = await source.stream(ep1Id, {});
    expect(streams.length).toBeGreaterThan(0);
    streams.forEach((s) => expect(s.source).toBe('megaplay'));
    const sub = streams.find((s) => s.language === 'sub');
    if (sub) {
      const result = await captureStreamScreenshot('megaplay_sub', streamToPayload(sub));
      expect(fs.existsSync(result.outputPath)).toBe(true);
      expect(fs.statSync(result.outputPath).size).toBeGreaterThan(1024);
    }
    const dub = streams.find((s) => s.language === 'dub');
    if (dub) {
      const result = await captureStreamScreenshot('megaplay_dub', streamToPayload(dub));
      expect(fs.existsSync(result.outputPath)).toBe(true);
      expect(fs.statSync(result.outputPath).size).toBeGreaterThan(1024);
    }
  }, 60000);
});
