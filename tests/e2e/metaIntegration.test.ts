/**
 * End-to-end metadata → content → stream pipeline.
 *
 * Demonstrates the meta layer's value proposition:
 *   1. Search a catalogue (AniList) for a title.
 *   2. Pull full metadata + enrichments.
 *   3. Use the same AniList ID to list episodes on a content provider
 *      (`AllmangaProvider`) — the SDK resolves the cross-source mapping
 *      under the hood.
 *   4. Verify the per-episode metadata from AniList's `streamingEpisodes`
 *      is folded onto the content unit list.
 */
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { AnilistMeta } from '../../src/meta/AnilistMeta.js';
import { MappingClient } from '../../src/meta/MappingClient.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';

describe('Metadata → content integration (live)', () => {
  it('fetches AniList metadata for Cowboy Bebop and lists episodes on AllManga via mapping', async () => {
    const http = new HttpClient({ timeoutMs: 30_000 });
    const mapping = new MappingClient(http);
    const meta = new AnilistMeta(http, { mappingClient: mapping });
    const allmanga = new AllmangaProvider(http);

    // 1. Pull AniList metadata + enrichments.
    const info = await meta.fetchMediaInfo('anilist:1');
    expect(info.title.english).toBe('Cowboy Bebop');
    expect(info.episodeCount).toBe(26);
    // AniList carries per-episode metadata for Cowboy Bebop.
    expect((info.streamingEpisodes ?? []).length).toBeGreaterThan(0);

    // 2. List episodes on AllManga — mapping is resolved automatically.
    const units = await meta.fetchContentUnits('anilist:1', allmanga);
    expect(units.length).toBeGreaterThan(0);

    // 3. The meta layer folds AniList streamingEpisodes titles/thumbnails
    //    onto the content units that share an episode number.
    const enriched = units.filter((u) => u.thumbnailUrl);
    expect(enriched.length).toBeGreaterThan(0);
    // Ep 1's title should not be the bare "Episode 1" — AniList carries
    // "Asteroid Blues".
    const ep1 = units.find((u) => u.number === 1);
    expect(ep1).toBeDefined();
    expect(ep1!.title.toLowerCase()).toContain('asteroid');
  }, 90_000);

  it('lookupByMapping shortcut: MegaPlayProvider returns the AniList ID directly', async () => {
    const http = new HttpClient({ timeoutMs: 15_000 });
    const { MegaPlayProvider } = await import('../../src/providers/MegaPlayProvider.js');
    const megaplay = new MegaPlayProvider(http);
    // MegaPlayProvider opts into the lookupByMapping fast path — its
    // media ID *is* the AniList ID. No network calls should be needed.
    const raw = await megaplay.lookupByMapping!({ anilist: 1 });
    expect(raw).toBe('1');
    const none = await megaplay.lookupByMapping!({});
    expect(none).toBeNull();
  });
});
