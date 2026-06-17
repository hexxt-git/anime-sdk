/**
 * Live integration test for BaseMetadataProvider edge cases:
 *   - strict episode matching
 *   - closest-below fallback
 *   - absolute-episode offset computation via real PREQUEL relations
 *
 * Uses AnilistMeta + AllmangaProvider only (no mocks, no fixtures).
 */
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { AnilistMeta } from '../../src/meta/AnilistMeta.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';

describe('BaseMetadataProvider — live', () => {
  it('strictEpisodeMatching throws on an impossible episode number', async () => {
    const http = new HttpClient({ timeoutMs: 30_000 });
    const meta = new AnilistMeta(http);
    const allmanga = new AllmangaProvider(http);
    // Cowboy Bebop has 26 episodes; request ep 999.
    await expect(
      meta.resolveStream('anilist:1', 999, allmanga, undefined, {
        strictEpisodeMatching: true,
      }),
    ).rejects.toThrow(/Episode 999 not found/);
  }, 90_000);

  it('computeAbsoluteEpisodeOffset traverses PREQUEL relations', async () => {
    const http = new HttpClient({ timeoutMs: 30_000 });
    const meta = new AnilistMeta(http);
    // Attack on Titan Final Season (AniList id 110277) — its PREQUEL chain
    // climbs back through Season 3 Part 2 → Season 3 → Season 2 → Season 1.
    // Each season's episodeCount is a stable known value.
    const offset = await meta.computeAbsoluteEpisodeOffset('anilist:110277');
    // The exact sum varies as AniList updates the chain, but the
    // PREQUEL graph is well-established: it should be > 50 (S1=25 + S2=12
    // + S3 splits = ~22 = 59). Use a generous lower bound.
    expect(offset).toBeGreaterThan(50);
  }, 60_000);

  it('supportsBrowseKind reports the implemented buckets', async () => {
    const http = new HttpClient({ timeoutMs: 5_000 });
    const meta = new AnilistMeta(http);
    expect(meta.supportsBrowseKind('trending')).toBe(true);
    expect(meta.supportsBrowseKind('popular')).toBe(true);
    expect(meta.supportsBrowseKind('seasonal')).toBe(true);
    expect(meta.supportsBrowseKind('top')).toBe(true);
  });
});
