import { HttpClient } from '../transport/http.js';
import {
  CallOptions,
  IMediaMetadata,
  IMediaRelation,
  IMetaSearchResult,
  IStreamingEpisode,
  MediaCatalogType,
  MediaFormat,
  MediaRelationType,
  MediaSeason,
  MediaStatus,
} from '../types/index.js';
import { buildTypedUrn } from '../utils/urn.js';
import {
  BaseMetadataProvider,
  BaseMetadataProviderOptions,
  BrowseKind,
  BrowseOptions,
} from './BaseMetadataProvider.js';

/**
 * MyAnimeList metadata provider, backed by the public Jikan API.
 *
 * Jikan v4 is unofficial but the de-facto MAL gateway used across the
 * community. No API key. Rate limit is 3 req/s, 60 req/min — modest, so
 * users hammering this in production should plug in a cache.
 *
 * Jikan splits anime and manga across `/anime` and `/manga` paths; both are
 * supported here. Native IDs are MAL IDs (numeric).
 */
export interface MalMetaOptions extends BaseMetadataProviderOptions {
  apiUrl?: string;
  /**
   * Which catalogue to query for the *search* endpoint when both are
   * supported. Defaults to `ANIME` — most consumers want anime. Per-record
   * fetches always honour the record's actual type.
   */
  defaultSearchType?: 'ANIME' | 'MANGA';
}

const JIKAN_API = 'https://api.jikan.moe/v4';

export class MalMeta extends BaseMetadataProvider {
  public readonly id = 'mal';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME', 'MANGA'];
  private apiUrl: string;
  private defaultSearchType: 'ANIME' | 'MANGA';

  constructor(http: HttpClient, options: MalMetaOptions = {}) {
    super(http, options);
    this.apiUrl = options.apiUrl ?? JIKAN_API;
    this.defaultSearchType = options.defaultSearchType ?? 'ANIME';
  }

  protected async searchRawNative(
    query: string,
    options: CallOptions = {},
  ): Promise<IMetaSearchResult[]> {
    const path = this.defaultSearchType === 'MANGA' ? 'manga' : 'anime';
    const url = `${this.apiUrl}/${path}?q=${encodeURIComponent(query)}&limit=20`;
    const res = await this.http.get(url, {
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    if (res.status !== 200) {
      throw new Error(`Jikan search failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const data: any[] = json?.data ?? [];
    return data.map((m) => ({
      id: `${path}:${m.mal_id}`,
      providerId: this.id,
      catalogType: path === 'manga' ? 'MANGA' : 'ANIME',
      title: malTitles(m),
      cover: m.images
        ? {
            large: m.images.jpg?.large_image_url ?? undefined,
            medium: m.images.jpg?.image_url ?? undefined,
            small: m.images.jpg?.small_image_url ?? undefined,
          }
        : undefined,
      year: m.year ?? (m.aired?.from ? new Date(m.aired.from).getUTCFullYear() : undefined),
      format: malFormat(m.type),
      score: typeof m.score === 'number' ? Math.round(m.score * 10) : undefined,
      isAdult: !!m.rating?.startsWith?.('Rx'),
      mappings: { mal: m.mal_id },
    }));
  }

  protected async fetchMediaInfoRawNative(
    nativeId: string,
    options: CallOptions = {},
  ): Promise<IMediaMetadata> {
    // `nativeId` arrives as either the typed form `"anime:21"` or the bare
    // numeric form `"21"` (legacy). Honour the typed form when present —
    // otherwise fall back to the anime-first / manga-second probe.
    let path: 'anime' | 'manga' = 'anime';
    let numericId: string;
    const sep = nativeId.indexOf(':');
    if (sep >= 0) {
      const prefix = nativeId.slice(0, sep);
      if (prefix === 'anime' || prefix === 'manga') {
        path = prefix;
        numericId = nativeId.slice(sep + 1);
      } else {
        numericId = nativeId;
      }
    } else {
      numericId = nativeId;
    }
    const id = Number(numericId);
    if (!Number.isFinite(id)) {
      throw new Error(`Invalid MAL ID: ${nativeId}`);
    }
    let res = await this.http.get(`${this.apiUrl}/${path}/${id}/full`, {
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    if (res.status === 404 && sep < 0) {
      // Untyped legacy IDs only: probe the other catalogue.
      path = 'manga';
      res = await this.http.get(`${this.apiUrl}/${path}/${id}/full`, {
        headers: { Accept: 'application/json' },
        signal: options.signal,
      });
    }
    if (res.status !== 200) {
      throw new Error(`Jikan fetchMediaInfo failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const m = json?.data;
    if (!m) throw new Error(`MAL: no media for id ${id}`);

    const trailerUrl =
      m.trailer?.youtube_id != null
        ? `https://www.youtube.com/watch?v=${m.trailer.youtube_id}`
        : undefined;

    const relations = mapJikanRelations(this.id, m.relations);
    const streamingEpisodes =
      path === 'anime' ? await this.fetchAnimeEpisodes(id, options.signal) : undefined;
    return {
      id: `${path}:${m.mal_id}`,
      providerId: this.id,
      catalogType: path === 'manga' ? 'MANGA' : 'ANIME',
      title: malTitles(m),
      description: m.synopsis ?? undefined,
      cover: m.images
        ? {
            large: m.images.jpg?.large_image_url ?? undefined,
            medium: m.images.jpg?.image_url ?? undefined,
            small: m.images.jpg?.small_image_url ?? undefined,
          }
        : undefined,
      banner: undefined,
      status: malStatus(m.status, path),
      format: malFormat(m.type),
      episodeCount: m.episodes ?? undefined,
      chapterCount: m.chapters ?? undefined,
      durationMinutes: parseDurationMinutes(m.duration),
      genres:
        Array.isArray(m.genres) && m.genres.length > 0
          ? m.genres.map((g: any) => g.name).filter(Boolean)
          : undefined,
      tags:
        Array.isArray(m.themes) && m.themes.length > 0
          ? m.themes.map((t: any) => t.name).filter(Boolean)
          : undefined,
      studios:
        Array.isArray(m.studios) && m.studios.length > 0
          ? m.studios.map((s: any) => s.name).filter(Boolean)
          : undefined,
      year: m.year ?? (m.aired?.from ? new Date(m.aired.from).getUTCFullYear() : undefined),
      season: malSeason(m.season),
      startDate: m.aired?.from?.slice(0, 10) ?? m.published?.from?.slice(0, 10) ?? undefined,
      endDate: m.aired?.to?.slice(0, 10) ?? m.published?.to?.slice(0, 10) ?? undefined,
      score: typeof m.score === 'number' ? Math.round(m.score * 10) : undefined,
      trailer: trailerUrl,
      isAdult: !!m.rating?.startsWith?.('Rx'),
      synonyms: Array.isArray(m.title_synonyms) ? m.title_synonyms.filter(Boolean) : undefined,
      mappings: { mal: m.mal_id },
      relations,
      streamingEpisodes,
    };
  }

  /**
   * Fetch episode-level metadata (filler/recap flags + episode titles)
   * from Jikan's `/anime/{id}/episodes` paginated endpoint. We page until
   * exhausted (Jikan returns 100 per page).
   *
   * Best-effort — returns `undefined` if any page fails so the parent
   * call doesn't blow up on a flaky upstream.
   */
  private async fetchAnimeEpisodes(
    malId: number,
    signal?: AbortSignal,
  ): Promise<IStreamingEpisode[] | undefined> {
    const out: IStreamingEpisode[] = [];
    let page = 1;
    let hasNext = true;
    try {
      while (hasNext && page <= 10) {
        const res = await this.http.get(`${this.apiUrl}/anime/${malId}/episodes?page=${page}`, {
          headers: { Accept: 'application/json' },
          signal,
        });
        if (res.status !== 200) break;
        const data = (await res.json()) as {
          data?: Array<{
            mal_id?: number;
            title?: string;
            filler?: boolean;
            recap?: boolean;
            aired?: string;
          }>;
          pagination?: { has_next_page?: boolean };
        };
        for (const ep of data.data ?? []) {
          if (typeof ep.mal_id === 'number') {
            out.push({
              number: ep.mal_id,
              title: ep.title || undefined,
              isFiller: typeof ep.filler === 'boolean' ? ep.filler : undefined,
              isRecap: typeof ep.recap === 'boolean' ? ep.recap : undefined,
              airDate: ep.aired ? ep.aired.slice(0, 10) : undefined,
            });
          }
        }
        hasNext = !!data.pagination?.has_next_page;
        page += 1;
      }
    } catch {
      return out.length > 0 ? out : undefined;
    }
    return out.length > 0 ? out : undefined;
  }

  public override supportsBrowseKind(kind: BrowseKind): boolean {
    return kind === 'top' || kind === 'popular' || kind === 'seasonal';
  }

  protected override async browseRawNative(
    kind: BrowseKind,
    options: BrowseOptions,
  ): Promise<IMetaSearchResult[]> {
    const catalogType = options.catalogType ?? 'ANIME';
    const path = catalogType === 'MANGA' ? 'manga' : 'anime';
    const page = options.page ?? 1;
    const perPage = Math.min(options.perPage ?? 20, 25);

    let url: string;
    if (kind === 'seasonal') {
      if (path !== 'anime') {
        throw new Error('Jikan browse(seasonal): only ANIME is supported');
      }
      if (!options.season || !options.year) {
        throw new Error('Jikan browse(seasonal): season and year are required');
      }
      const season = options.season.toLowerCase();
      url = `${this.apiUrl}/seasons/${options.year}/${season}?page=${page}&limit=${perPage}`;
    } else if (kind === 'top') {
      url = `${this.apiUrl}/top/${path}?page=${page}&limit=${perPage}`;
    } else {
      // popular — Jikan's `/top/{anime,manga}` sorted by popularity
      url = `${this.apiUrl}/top/${path}?filter=bypopularity&page=${page}&limit=${perPage}`;
    }

    const res = await this.http.get(url, {
      headers: { Accept: 'application/json' },
      signal: options.signal,
    });
    if (res.status !== 200) throw new Error(`Jikan browse failed with status ${res.status}`);
    const json = (await res.json()) as { data?: any[] };
    const data = json?.data ?? [];
    return data.map((m) => ({
      id: `${path}:${m.mal_id}`,
      providerId: this.id,
      catalogType: path === 'manga' ? 'MANGA' : 'ANIME',
      title: malTitles(m),
      cover: m.images
        ? {
            large: m.images.jpg?.large_image_url ?? undefined,
            medium: m.images.jpg?.image_url ?? undefined,
            small: m.images.jpg?.small_image_url ?? undefined,
          }
        : undefined,
      year: m.year ?? (m.aired?.from ? new Date(m.aired.from).getUTCFullYear() : undefined),
      format: malFormat(m.type),
      score: typeof m.score === 'number' ? Math.round(m.score * 10) : undefined,
      isAdult: !!m.rating?.startsWith?.('Rx'),
      mappings: { mal: m.mal_id },
    }));
  }
}

/**
 * Map Jikan's `relations` array (in `/anime/{id}/full`) onto
 * {@link IMediaRelation}[]. Jikan uses verbose human strings like
 * "Sequel"/"Prequel"/"Side story"/"Spin-off"/"Adaptation" which we
 * normalize into the SDK's enum.
 */
function mapJikanRelations(
  metaProviderId: string,
  relations: unknown,
): IMediaRelation[] | undefined {
  if (!Array.isArray(relations) || relations.length === 0) return undefined;
  const out: IMediaRelation[] = [];
  for (const block of relations as Array<{
    relation?: string;
    entry?: Array<{ mal_id?: number; type?: string; name?: string; url?: string }>;
  }>) {
    const rt = normalizeRelation(block.relation);
    for (const entry of block.entry ?? []) {
      if (!entry.mal_id || !entry.type) continue;
      const kind = entry.type.toLowerCase() === 'manga' ? 'manga' : 'anime';
      out.push({
        id: buildTypedUrn(metaProviderId, kind, entry.mal_id),
        relationType: rt,
        catalogType: kind === 'manga' ? 'MANGA' : 'ANIME',
        title: { userPreferred: entry.name ?? undefined, romaji: entry.name ?? undefined },
      });
    }
  }
  return out.length > 0 ? out : undefined;
}

function normalizeRelation(s: unknown): MediaRelationType {
  if (typeof s !== 'string') return 'OTHER';
  const v = s.toLowerCase();
  if (v.includes('sequel')) return 'SEQUEL';
  if (v.includes('prequel')) return 'PREQUEL';
  if (v.includes('side')) return 'SIDE_STORY';
  if (v.includes('spin')) return 'SPIN_OFF';
  if (v.includes('adaptation')) return 'ADAPTATION';
  if (v.includes('alternative')) return 'ALTERNATIVE';
  if (v.includes('summary')) return 'SUMMARY';
  if (v.includes('character')) return 'CHARACTER';
  if (v.includes('parent')) return 'PARENT';
  if (v.includes('full')) return 'PARENT';
  return 'OTHER';
}

function malTitles(m: any) {
  const titles: Record<string, string> = {};
  if (Array.isArray(m.titles)) {
    for (const t of m.titles) {
      const type = String(t?.type ?? '').toLowerCase();
      if (t?.title) titles[type] = t.title;
    }
  }
  return {
    romaji: titles['default'] ?? m.title ?? undefined,
    english: titles['english'] ?? m.title_english ?? undefined,
    native: titles['japanese'] ?? m.title_japanese ?? undefined,
    userPreferred: titles['english'] ?? m.title_english ?? m.title ?? undefined,
  };
}

function malFormat(t: unknown): MediaFormat | undefined {
  if (typeof t !== 'string') return undefined;
  switch (t) {
    case 'TV':
      return 'TV';
    case 'Movie':
      return 'MOVIE';
    case 'OVA':
      return 'OVA';
    case 'ONA':
      return 'ONA';
    case 'Special':
      return 'SPECIAL';
    case 'Music':
      return 'MUSIC';
    case 'Manga':
      return 'MANGA';
    case 'Novel':
    case 'Light Novel':
      return 'NOVEL';
    case 'One-shot':
      return 'ONE_SHOT';
    default:
      return 'UNKNOWN';
  }
}

function malStatus(s: unknown, _kind: 'anime' | 'manga'): MediaStatus | undefined {
  if (typeof s !== 'string') return undefined;
  if (s === 'Finished Airing' || s === 'Finished' || s === 'Complete') return 'FINISHED';
  if (s === 'Currently Airing' || s === 'Publishing') return 'RELEASING';
  if (s === 'Not yet aired' || s === 'Not yet published') return 'NOT_YET_RELEASED';
  if (s === 'On Hiatus') return 'HIATUS';
  if (s === 'Discontinued') return 'CANCELLED';
  return 'UNKNOWN';
}

function malSeason(s: unknown): MediaSeason | undefined {
  if (typeof s !== 'string') return undefined;
  const v = s.toUpperCase();
  if (v === 'WINTER' || v === 'SPRING' || v === 'SUMMER' || v === 'FALL') return v;
  return undefined;
}

function parseDurationMinutes(d: unknown): number | undefined {
  // Jikan returns strings like "24 min per ep" / "1 hr 32 min" / "Unknown"
  if (typeof d !== 'string') return undefined;
  const m = d.match(/(\d+)\s*hr/);
  const mins = d.match(/(\d+)\s*min/);
  let total = 0;
  if (m) total += parseInt(m[1], 10) * 60;
  if (mins) total += parseInt(mins[1], 10);
  return total > 0 ? total : undefined;
}
