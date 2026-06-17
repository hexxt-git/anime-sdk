/**
 * Live verification of provider URN round-trip.
 *
 * Confirms that:
 *   1. `BaseProvider.search()` emits URN-prefixed IDs (`allmanga:...`).
 *   2. `BaseProvider.fetchContentUnits(URN)` accepts the URN unchanged
 *      and re-emits unit IDs that are also URN-prefixed.
 *   3. Each step round-trips against the *real* AllAnime upstream.
 *
 * Uses the well-known stable title "Frieren" — its search hit set is
 * large enough to consistently include the mainline series.
 */
import { describe, expect, it } from 'vitest';
import { HttpClient } from '../../src/transport/http.js';
import { AllmangaProvider } from '../../src/providers/AllmangaProvider.js';

describe('Allmanga URN round-trip — live', () => {
  it('search → fetchContentUnits → IDs are URN-prefixed end to end', async () => {
    const http = new HttpClient({ timeoutMs: 30_000 });
    const allmanga = new AllmangaProvider(http);

    const hits = await allmanga.search('Frieren');
    expect(hits.length).toBeGreaterThan(0);
    const target =
      hits.find((r) => r.title.toLowerCase().includes("beyond journey's end")) ?? hits[0];
    expect(target.id.startsWith('allmanga:')).toBe(true);
    expect(target.providerId).toBe('allmanga');

    // Pass the URN form straight back in — provider must unwrap it.
    const units = await allmanga.fetchContentUnits(target.id);
    expect(units.length).toBeGreaterThan(0);
    expect(units[0].id.startsWith('allmanga:')).toBe(true);

    // Sanity check: the raw underlying ID (after URN strip) must still
    // be a non-empty string with the `${showId}/${epStr}` shape.
    const raw = units[0].id.slice('allmanga:'.length);
    expect(raw).toMatch(/.+\/.+/);
  }, 60_000);
});
