import type { Source, SourceCallOpts } from './sources/base.js';
import type { Media, Episode, Chapter, Stream, List, SourceInfo } from './types.js';
import { HealthTracker } from './health.js';
import { createProgressiveResult, type ProgressiveResult } from './progressive.js';
import { bestSimilarity } from './internal/similarity.js';
import { decodeId } from './internal/id.js';

const TITLE_MATCH_THRESHOLD = 0.7;

export class Registry {
  private sources: Source[] = [];
  private health = new HealthTracker();
  private mediaCache = new Map<string, Media>();
  private mappingCache = new Map<string, Map<string, string>>();

  register(...sources: Source[]): void {
    this.sources.push(...sources);
  }

  cacheMedia(media: Media): void {
    this.mediaCache.set(media.id, media);
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
    this.cacheMedia(media);
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
    this.cacheMedia(media);
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

  streamFromSource(episodeId: string, opts: SourceCallOpts): ProgressiveResult<Stream> {
    const decoded = decodeId(episodeId);
    const allStreamSources = this.sources.filter((s) => s.caps.stream);
    const src = allStreamSources.find((s) => s.id === decoded.s);
    if (!src?.stream) {
      return createProgressiveResult<Stream>(
        [
          async () => {
            throw new Error(`No stream-capable source for id: ${episodeId}`);
          },
        ],
        opts.signal,
      );
    }
    return createProgressiveResult<Stream>(
      [
        async (push, signal) => {
          const t0 = Date.now();
          try {
            const streams = await src.stream!(episodeId, { signal });
            this.health.record(src.id, true, Date.now() - t0);
            for (const s of streams) push(s);
          } catch (e) {
            this.health.record(src.id, false, Date.now() - t0);
            throw e;
          }
        },
      ],
      opts.signal,
    );
  }

  streamEpisode(episode: Episode, opts: SourceCallOpts): ProgressiveResult<Stream> {
    const decoded = decodeId(episode.id);
    const allStreamSources = this.sources.filter((s) => s.caps.stream);
    const primarySrc = allStreamSources.find((s) => s.id === decoded.s);
    const otherSrcs = allStreamSources.filter((s) => s.id !== decoded.s);

    const mediaId = decoded.m?.mediaId as string | undefined;
    const media = mediaId ? this.mediaCache.get(mediaId) : this.findCachedMediaForEpisode(episode);

    const producers = [];

    if (primarySrc?.stream) {
      producers.push(async (push: (item: Stream) => void, signal: AbortSignal) => {
        const t0 = Date.now();
        try {
          const streams = await primarySrc.stream!(episode.id, { signal });
          this.health.record(primarySrc.id, true, Date.now() - t0);
          for (const s of streams) push(s);
        } catch (e) {
          this.health.record(primarySrc.id, false, Date.now() - t0);
          throw e;
        }
      });
    }

    if (media) {
      for (const src of otherSrcs) {
        producers.push(async (push: (item: Stream) => void, signal: AbortSignal) => {
          const resolvedId = await this.resolveMediaId(media, src, { signal }).catch(() => null);
          if (!resolvedId) return;
          const epList = await src.episodes!(resolvedId, { signal }).catch(() => null);
          if (!epList) return;
          const ep = epList.items.find((e) => e.number === episode.number);
          if (!ep) return;
          const t0 = Date.now();
          try {
            const streams = await src.stream!(ep.id, { signal });
            this.health.record(src.id, true, Date.now() - t0);
            for (const s of streams) push(s);
          } catch (e) {
            this.health.record(src.id, false, Date.now() - t0);
          }
        });
      }
    }

    return createProgressiveResult<Stream>(producers, opts.signal);
  }

  async rankPlaybackSources(media: Media, opts: SourceCallOpts): Promise<SourceInfo[]> {
    const kind = media.kind;
    const sources = this.sourcesFor(kind, 'episodes').concat(this.sourcesFor(kind, 'chapters'));
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

  async resolveMediaId(media: Media, src: Source, opts: SourceCallOpts): Promise<string | null> {
    const perSource = this.mappingCache.get(media.id);
    const cached = perSource?.get(src.id);
    if (cached) return cached;

    const cacheAndReturn = (resolved: string) => {
      let map = this.mappingCache.get(media.id);
      if (!map) {
        map = new Map();
        this.mappingCache.set(media.id, map);
      }
      map.set(src.id, resolved);
      return resolved;
    };

    if (src.caps.mapping && src.lookupByMapping) {
      try {
        const resolved = await src.lookupByMapping(media.mappings as Record<string, unknown>, {
          signal: opts.signal,
        });
        if (resolved) return cacheAndReturn(resolved);
      } catch {
        // fall through
      }
    }

    if (src.caps.search && src.search) {
      const titles = collectTitles(media);
      for (const title of titles) {
        try {
          const candidates = await src.search(title, media.kind, { signal: opts.signal });
          const best = pickBestMatch(candidates, titles, media.year);
          if (best) {
            try {
              const raw = decodeId(best.id).r;
              return cacheAndReturn(raw);
            } catch {
              // best.id wasn't an opaque token
            }
          }
        } catch {
          // search failed; try the next title candidate
        }
      }
    }

    return null;
  }

  private findCachedMediaForEpisode(episode: Episode): Media | null {
    for (const media of this.mediaCache.values()) {
      const decoded = decodeId(episode.id);
      if (decoded.s) {
        const perSource = this.mappingCache.get(media.id);
        if (perSource?.has(decoded.s)) return media;
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
