/**
 * Live E2E for MalSource (Jikan v4).
 */
import { describe, it, expect } from 'vitest';
import { HttpClient } from '../../src/internal/http.js';
import { MalSource } from '../../src/sources/mal.js';
import { decodeId } from '../../src/internal/id.js';

describe('MalSource — live (Jikan)', () => {
  it('search returns Media with correct fields for Cowboy Bebop', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const source = new MalSource(http);
    const results = await source.search('Cowboy Bebop', 'anime', {});
    expect(results.length).toBeGreaterThan(0);
    const hit = results.find((r) => r.title.english === 'Cowboy Bebop');
    expect(hit).toBeDefined();
    expect(hit!.kind).toBe('anime');
    expect(hit!.mappings.mal).toBeTypeOf('number');
    expect(hit!.score?.scale).toBe(100);

    const decoded = decodeId(hit!.id);
    expect(decoded.s).toBe('mal');
    expect(decoded.r).toBe('anime:1');
  }, 40_000);

  it('info for Cowboy Bebop maps primary fields', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const source = new MalSource(http);
    // Sdk.info passes the decoded `r` field. Mirror that contract here.
    const info = await source.info('anime:1', {});
    expect(info.kind).toBe('anime');
    expect(info.episodeCount).toBe(26);
    expect(info.year).toBe(1998);
    expect(info.mappings.mal).toBe(1);
  }, 40_000);

  it('browse(top) returns a list of anime', async () => {
    const http = new HttpClient({ timeoutMs: 25_000 });
    const source = new MalSource(http);
    const list = await source.browse({ list: 'top', kind: 'anime' });
    expect(list.items.length).toBeGreaterThan(0);
    expect(list.items[0].kind).toBe('anime');
  }, 40_000);
});
