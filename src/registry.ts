import type { Source, SourceCallOpts } from './sources/base.js';
import type { Media, Episode, Chapter, List, SourceInfo } from './types.js';
import { HealthTracker } from './health.js';
import { createProgressiveResult, type ProgressiveResult } from './progressive.js';
import { bestSimilarity } from './internal/similarity.js';
import { decodeId } from './internal/id.js';

/**
 * Minimum normalized similarity required for a fuzzy title match to count
 * as a valid cross-source resolution. Tuned empirically: 0.7 keeps obvious
 * matches ("Frieren" → "Frieren: Beyond Journey's End") and rejects unrelated
 * titles whose tokens partially overlap.
 */
const TITLE_MATCH_THRESHOLD = 0.7;

export class Registry {
  private sources: Source[] = [];
  private health = new HealthTracker();

  register(...sources: Source[]): void {
    this.sources.push(...sources);
  }

  sourcesFor(kind: 'anime' | 'manga', cap: keyof Source['caps']): Source[] {
    return this.sources.filter(
      (s) => s.kinds.includes(kind) && (s.caps as Record<string, unknown>)[cap],
    );
  }

  fanOutSearch(
    query: string,
    kind: 'anime' | 'manga',
    opts: SourceCallOpts,
  ): ProgressiveResult<Media> {
    const sources = this.sourcesFor(kind, 'search');
    return createProgressiveResult<Media>(
      sources.map((src) => async (push, signal) => {
        const t0 = Date.now();
        try {
          const results = await src.search!(query, kind, { signal });
          this.health.record(src.id, true, Date.now() - t0);
          for (const item of results) push(item);
        } catch (e) {
          this.health.record(src.id, false, Date.now() - t0);
          throw e;
        }
      }),
      opts.signal,
    );
  }

  async mergeEpisodes(
    media: Media,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const kind = media.kind;
    const sources = this.sourcesFor(kind, 'episodes');
    if (sources.length === 0) return { items: [] };

    const ranked = this.rankByHealth(sources);
    for (const src of ranked) {
      const mediaId = await this.resolveMediaId(media, src, opts);
      if (!mediaId) continue;
      const t0 = Date.now();
      try {
        const result = await src.episodes!(mediaId, opts);
        this.health.record(src.id, true, Date.now() - t0);
        return result;
      } catch {
        this.health.record(src.id, false, Date.now() - t0);
      }
    }
    return { items: [] };
  }

  async mergeChapters(
    media: Media,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Chapter>> {
    const kind = media.kind;
    const sources = this.sourcesFor(kind, 'chapters');
    if (sources.length === 0) return { items: [] };

    const ranked = this.rankByHealth(sources);
    for (const src of ranked) {
      const mediaId = await this.resolveMediaId(media, src, opts);
      if (!mediaId) continue;
      const t0 = Date.now();
      try {
        const result = await src.chapters!(mediaId, opts);
        this.health.record(src.id, true, Date.now() - t0);
        return result;
      } catch {
        this.health.record(src.id, false, Date.now() - t0);
      }
    }
    return { items: [] };
  }

  async rankPlaybackSources(media: Media, opts: SourceCallOpts): Promise<SourceInfo[]> {
    const kind = media.kind;
    const sources = this.sourcesFor(kind, 'episodes').concat(this.sourcesFor(kind, 'chapters'));
    // Parallel — each source may need a network search via the title-search
    // fallback, so a sequential loop would block the user on every uncached
    // source in turn.
    return Promise.all(
      sources.map(async (src): Promise<SourceInfo> => {
        const h = this.health.get(src.id);
        const mediaId = await this.resolveMediaId(media, src, opts).catch(() => null);
        return {
          id: src.id,
          status: mediaId ? 'available' : 'incompatible',
          successRate: h.successRate,
        };
      }),
    );
  }

  getHealthTracker(): HealthTracker {
    return this.health;
  }

  /**
   * Resolve the playback source's native media ID for a given Media record.
   * Checks cached mappings.sources first, then calls source.lookupByMapping()
   * if the source declares the mapping capability.
   */
  async resolveMediaId(media: Media, src: Source, opts: SourceCallOpts): Promise<string | null> {
    // 1. Cached in the media record (set by a prior resolution).
    const cached = media.mappings.sources?.[src.id];
    if (cached) return cached;

    const cacheAndReturn = (resolved: string) => {
      if (!media.mappings.sources) media.mappings.sources = {};
      media.mappings.sources[src.id] = resolved;
      return resolved;
    };

    // 2. Source-native lookup via cross-source mappings (AniList ID, MAL ID, …).
    //    Only sources that opt in with `caps.mapping`.
    if (src.caps.mapping && src.lookupByMapping) {
      try {
        const resolved = await src.lookupByMapping(media.mappings as Record<string, unknown>, {
          signal: opts.signal,
        });
        if (resolved) return cacheAndReturn(resolved);
      } catch {
        // fall through — source lookup failed
      }
    }

    // 3. Fuzzy title-search fallback. Most playback sources don't index by
    //    AniList/MAL ID natively (allmanga, animeparadise, anikoto, gogoanime,
    //    goyabu, mangadex, mangapill, weebcentral) — but they all expose
    //    search(). We search by title and pick the best match above a
    //    similarity threshold. This is what 1.x's MappingClient did.
    if (src.caps.search && src.search) {
      const titles = collectTitles(media);
      for (const title of titles) {
        try {
          const candidates = await src.search(title, media.kind, { signal: opts.signal });
          const best = pickBestMatch(candidates, titles, media.year);
          if (best) {
            // Source-native raw id lives in the encoded media id. We extract
            // it via decodeId so the registry stays generic.
            try {
              const raw = decodeId(best.id).r;
              return cacheAndReturn(raw);
            } catch {
              // best.id wasn't an opaque token — uncommon, but fall through.
            }
          }
        } catch {
          // search failed; try the next title candidate.
        }
      }
    }

    return null;
  }

  private rankByHealth(sources: Source[]): Source[] {
    return [...sources].sort((a, b) => {
      const ha = this.health.get(a.id);
      const hb = this.health.get(b.id);
      return hb.successRate - ha.successRate;
    });
  }
}

/**
 * Title candidates to try in order, most → least informative. We dedupe so a
 * Media that only carries an english/romaji title doesn't get queried twice.
 */
function collectTitles(media: Media): string[] {
  const t = media.title;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const cand of [t.english, t.romaji, t.preferred, t.native]) {
    if (!cand) continue;
    const k = cand.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cand);
  }
  return out;
}

/**
 * Pick the best Media from a source's `search()` candidates by fuzzy-matching
 * the candidate title against every known title of the reference media.
 * Returns null when no candidate clears `TITLE_MATCH_THRESHOLD`.
 *
 * When `referenceYear` is set, candidates whose year disagrees by more than
 * 1 are rejected even if their similarity is high — that keeps "Naruto" from
 * matching "Naruto: Shippuden" with a fluke high overlap.
 */
function pickBestMatch(
  candidates: Media[],
  referenceTitles: string[],
  referenceYear: number | undefined,
): Media | null {
  let best: Media | null = null;
  let bestScore = 0;
  for (const c of candidates) {
    if (referenceYear != null && c.year != null && Math.abs(c.year - referenceYear) > 1) {
      continue;
    }
    const candTitles = collectTitles(c);
    if (candTitles.length === 0) continue;
    let score = 0;
    for (const ref of referenceTitles) {
      const s = bestSimilarity(ref, candTitles);
      if (s > score) score = s;
    }
    if (score > bestScore && score >= TITLE_MATCH_THRESHOLD) {
      bestScore = score;
      best = c;
    }
  }
  return best;
}
