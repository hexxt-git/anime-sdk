import type { Source, SourceCallOpts } from './sources/base.js';
import type { Media, Episode, List, SourceInfo } from './types.js';
import { HealthTracker } from './health.js';
import { createProgressiveResult, type ProgressiveResult } from './progressive.js';

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
      const mediaId = media.mappings.sources?.[src.id];
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

  async rankPlaybackSources(media: Media, opts: SourceCallOpts): Promise<SourceInfo[]> {
    const kind = media.kind;
    const sources = this.sourcesFor(kind, 'episodes');
    return sources.map((src) => {
      const h = this.health.get(src.id);
      const mediaId = media.mappings.sources?.[src.id];
      return {
        id: src.id,
        status: mediaId ? 'available' : 'incompatible',
        successRate: h.successRate,
      } satisfies SourceInfo;
    });
  }

  getHealthTracker(): HealthTracker {
    return this.health;
  }

  private rankByHealth(sources: Source[]): Source[] {
    return [...sources].sort((a, b) => {
      const ha = this.health.get(a.id);
      const hb = this.health.get(b.id);
      return hb.successRate - ha.successRate;
    });
  }
}
