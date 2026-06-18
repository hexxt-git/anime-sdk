import { HttpClient } from './internal/http.js';
import { Registry } from './registry.js';
import type { ProgressiveResult } from './progressive.js';
import type { Media, Episode, Chapter, Stream, Pages, List, SourceInfo } from './types.js';
import type { SdkOptions } from './config.js';
import { resolveOptions } from './config.js';
import { decodeId } from './internal/id.js';
import { AnilistSource } from './sources/anilist.js';
import { MalSource } from './sources/mal.js';
import { KitsuSource } from './sources/kitsu.js';
import { AllmangaSource } from './sources/allmanga.js';
import { MegaPlaySource } from './sources/megaplay.js';
import { AnimeParadiseSource } from './sources/animeparadise.js';
import { AnikotoSource } from './sources/anikoto.js';
import { GogoanimeSource } from './sources/gogoanime.js';
import { GoyabuSource } from './sources/goyabu.js';
import { MangadexSource } from './sources/mangadex.js';
import { MangapillSource } from './sources/mangapill.js';
import { WeebcentralSource } from './sources/weebcentral.js';
import type { SourceHealth } from './health.js';

export type { ProgressiveResult };

const ALL_SOURCE_IDS = [
  'anilist',
  'mal',
  'kitsu',
  'allmanga',
  'megaplay',
  'animeparadise',
  'anikoto',
  'gogoanime',
  'goyabu',
  'mangadex',
  'mangapill',
  'weebcentral',
] as const;

export type SourceId = (typeof ALL_SOURCE_IDS)[number];

function buildSources(http: HttpClient, enabled: ReadonlyArray<string>) {
  const set = new Set(enabled);
  const all = [
    new AnilistSource(http),
    new MalSource(http),
    new KitsuSource(http),
    new AllmangaSource(http),
    new MegaPlaySource(http),
    new AnimeParadiseSource(http),
    new AnikotoSource(http),
    new GogoanimeSource(http),
    new GoyabuSource(http),
    new MangadexSource(http),
    new MangapillSource(http),
    new WeebcentralSource(http),
  ];
  return all.filter((s) => set.has(s.id));
}

export class Sdk {
  private registry: Registry;
  private http: HttpClient;

  constructor(opts?: SdkOptions) {
    const resolved = resolveOptions(opts);
    this.http = new HttpClient({
      timeoutMs: resolved.http.timeoutMs,
      ...(resolved.http.userAgent
        ? { defaultHeaders: { 'User-Agent': resolved.http.userAgent } }
        : {}),
    });

    this.registry = new Registry();
    const disabled = new Set(resolved.disabled ?? []);
    const enabled = (resolved.sources ?? [...ALL_SOURCE_IDS]).filter((id) => !disabled.has(id));
    this.registry.register(...buildSources(this.http, enabled));
  }

  search(
    query: string,
    opts?: { kind?: 'anime' | 'manga'; signal?: AbortSignal },
  ): ProgressiveResult<Media> {
    const kind = opts?.kind ?? 'anime';
    return this.registry.fanOutSearch(query, kind, { signal: opts?.signal });
  }

  async info(media: Media | string, opts?: { signal?: AbortSignal }): Promise<Media> {
    const id = typeof media === 'string' ? media : media.id;
    const decoded = decodeId(id);
    const sources = this.registry
      .sourcesFor('anime', 'info')
      .concat(this.registry.sourcesFor('manga', 'info'));
    const src = sources.find((s) => s.id === decoded.s);
    if (!src?.info) throw new Error(`No source with info capability for id: ${id}`);
    return src.info(decoded.r, { signal: opts?.signal });
  }

  async sources(media: Media | string, opts?: { signal?: AbortSignal }): Promise<SourceInfo[]> {
    const m = typeof media === 'string' ? await this.info(media, opts) : media;
    return this.registry.rankPlaybackSources(m, { signal: opts?.signal });
  }

  async episodes(
    media: Media | string,
    opts?: { signal?: AbortSignal; cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const m = typeof media === 'string' ? await this.info(media, opts) : media;
    return this.registry.mergeEpisodes(m, {
      signal: opts?.signal,
      cursor: opts?.cursor,
      limit: opts?.limit,
    });
  }

  async chapters(
    media: Media | string,
    opts?: { signal?: AbortSignal; cursor?: string; limit?: number },
  ): Promise<List<Chapter>> {
    const m = typeof media === 'string' ? await this.info(media, opts) : media;
    return this.registry.mergeChapters(m, {
      signal: opts?.signal,
      cursor: opts?.cursor,
      limit: opts?.limit,
    });
  }

  async stream(
    episode: Episode | string,
    opts?: {
      language?: 'sub' | 'dub' | 'raw';
      quality?: string;
      adjacency?: 'within-media' | 'walk-relations';
      signal?: AbortSignal;
    },
  ): Promise<Stream> {
    const id = typeof episode === 'string' ? episode : episode.id;
    const decoded = decodeId(id);
    const sources = this.registry
      .sourcesFor('anime', 'stream')
      .concat(this.registry.sourcesFor('manga', 'stream'));
    const src = sources.find((s) => s.id === decoded.s);
    if (!src?.stream) throw new Error(`No source with stream capability for id: ${id}`);
    return src.stream(id, {
      language: opts?.language,
      quality: opts?.quality,
      adjacency: opts?.adjacency,
      signal: opts?.signal,
    });
  }

  async pages(chapter: Chapter | string, opts?: { signal?: AbortSignal }): Promise<Pages> {
    const id = typeof chapter === 'string' ? chapter : chapter.id;
    const decoded = decodeId(id);
    const sources = this.registry.sourcesFor('manga', 'pages');
    const src = sources.find((s) => s.id === decoded.s);
    if (!src?.pages) throw new Error(`No source with pages capability for id: ${id}`);
    return src.pages(id, { signal: opts?.signal });
  }

  async browse(opts: {
    list: 'trending' | 'popular' | 'seasonal' | 'top';
    kind: 'anime' | 'manga';
    signal?: AbortSignal;
    page?: number;
    perPage?: number;
    season?: string;
    year?: number;
  }): Promise<List<Media>> {
    const kind = opts.kind;
    const sources = this.registry.sourcesFor(kind, 'browse');
    if (sources.length === 0) return { items: [] };
    return sources[0].browse!({
      list: opts.list,
      kind,
      page: opts.page,
      perPage: opts.perPage,
      season: opts.season,
      year: opts.year,
      signal: opts.signal,
    });
  }

  health(): SourceHealth[] {
    return this.registry.getHealthTracker().snapshot();
  }
}

export function createSdk(opts?: SdkOptions): Sdk {
  return new Sdk(opts);
}
