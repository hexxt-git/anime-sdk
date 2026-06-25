import { describe, it, expect } from 'vitest';
import { Registry } from '../src/registry.js';
import type { Source } from '../src/sources/base.js';
import type { Media } from '../src/types.js';
import { encodeId } from '../src/internal/id.js';

function makeStubSource(id: string, kinds: ('anime' | 'manga')[], results: Media[]): Source {
  return {
    id,
    kinds,
    caps: { search: true },
    async search(_q, _kind, _opts) {
      return results;
    },
  };
}

const FAKE_MEDIA: Media = {
  id: 'test-id',
  kind: 'anime',
  title: { preferred: 'Test Show' },
  source: 'stub',
  mappings: {},
};

describe('Registry', () => {
  it('sourcesFor filters by kind and cap', () => {
    const reg = new Registry();
    const a = makeStubSource('a', ['anime'], []);
    const b = makeStubSource('b', ['manga'], []);
    reg.register(a, b);

    expect(reg.sourcesFor('anime', 'search')).toEqual([a]);
    expect(reg.sourcesFor('manga', 'search')).toEqual([b]);
    expect(reg.sourcesFor('anime', 'info')).toEqual([]);
  });

  it('fanOutSearch yields results from all matching sources', async () => {
    const reg = new Registry();
    const m1 = { ...FAKE_MEDIA, id: 'id1' };
    const m2 = { ...FAKE_MEDIA, id: 'id2', title: { preferred: 'Other' } };
    reg.register(makeStubSource('src1', ['anime'], [m1]), makeStubSource('src2', ['anime'], [m2]));

    const results: Media[] = [];
    for await (const item of reg.fanOutSearch('test', 'anime', {})) {
      results.push(item);
    }
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.id)).toContain('id1');
    expect(results.map((r) => r.id)).toContain('id2');
  });

  it('fanOutSearch ignores sources without search cap', async () => {
    const reg = new Registry();
    const noSearchSource: Source = {
      id: 'no-search',
      kinds: ['anime'],
      caps: { info: true },
    };
    reg.register(makeStubSource('with-search', ['anime'], [FAKE_MEDIA]), noSearchSource);

    const results: Media[] = [];
    for await (const item of reg.fanOutSearch('x', 'anime', {})) {
      results.push(item);
    }
    expect(results).toHaveLength(1);
  });

  it('rankPlaybackSources marks sources without media mapping as incompatible', async () => {
    const reg = new Registry();
    const epSource: Source = {
      id: 'ep-src',
      kinds: ['anime'],
      caps: { episodes: true },
      async episodes() {
        return { items: [] };
      },
    };
    reg.register(epSource);

    const media: Media = { ...FAKE_MEDIA, mappings: {} };
    const ranked = await reg.rankPlaybackSources(media, {});
    expect(ranked).toHaveLength(1);
    expect(ranked[0].status).toBe('incompatible');
  });

  it('resolveMediaId falls back to title search when lookupByMapping returns null', async () => {
    const reg = new Registry();
    const calls: { query: string }[] = [];
    const playback: Source = {
      id: 'play',
      kinds: ['anime'],
      caps: { search: true, episodes: true, mapping: true },
      async lookupByMapping() {
        return null;
      },
      async search(q) {
        calls.push({ query: q });
        return [
          {
            id: encodeId({ t: 'media', s: 'play', r: 'native-id-42' }),
            kind: 'anime',
            title: { preferred: "Frieren: Beyond Journey's End" },
            source: 'play',
            mappings: {},
            year: 2023,
          },
          {
            id: encodeId({ t: 'media', s: 'play', r: 'wrong-show' }),
            kind: 'anime',
            title: { preferred: 'Totally Unrelated Show' },
            source: 'play',
            mappings: {},
            year: 2023,
          },
        ];
      },
      async episodes() {
        return { items: [] };
      },
    };
    reg.register(playback);

    const media: Media = {
      ...FAKE_MEDIA,
      title: {
        preferred: "Frieren: Beyond Journey's End",
        english: "Frieren: Beyond Journey's End",
      },
      year: 2023,
      mappings: { anilist: 154587 },
    };

    const resolved = await reg.resolveMediaId(media, playback, {});
    expect(resolved).toBe('native-id-42');
    expect(calls.length).toBeGreaterThan(0);
    // Result is cached internally — subsequent calls skip the search.
    const resolved2 = await reg.resolveMediaId(media, playback, {});
    expect(resolved2).toBe('native-id-42');
  });

  it('resolveMediaId rejects fuzzy matches whose year disagrees by more than 1', async () => {
    const reg = new Registry();
    const playback: Source = {
      id: 'play',
      kinds: ['anime'],
      caps: { search: true, episodes: true },
      async search() {
        return [
          {
            // Same title, but wrong year — should be rejected.
            id: encodeId({ t: 'media', s: 'play', r: 'wrong-year' }),
            kind: 'anime',
            title: { preferred: 'Naruto' },
            source: 'play',
            mappings: {},
            year: 2007,
          },
        ];
      },
      async episodes() {
        return { items: [] };
      },
    };
    reg.register(playback);

    const media: Media = {
      ...FAKE_MEDIA,
      title: { preferred: 'Naruto' },
      year: 2002,
    };

    const resolved = await reg.resolveMediaId(media, playback, {});
    expect(resolved).toBeNull();
  });

  it('HealthTracker records and returns stats', () => {
    const reg = new Registry();
    const ht = reg.getHealthTracker();
    ht.record('src1', true, 100);
    ht.record('src1', false, 200);
    ht.record('src1', true, 150);
    const h = ht.get('src1');
    expect(h.calls).toBe(3);
    expect(h.successRate).toBeCloseTo(2 / 3);
  });
});
