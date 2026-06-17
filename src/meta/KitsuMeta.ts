import { HttpClient } from '../transport/http.js';
import {
  CallOptions,
  IMediaMetadata,
  IMetaSearchResult,
  MediaCatalogType,
  MediaFormat,
  MediaSeason,
  MediaStatus,
} from '../types/index.js';
import { BaseMetadataProvider, BaseMetadataProviderOptions } from './BaseMetadataProvider.js';

/**
 * Kitsu metadata provider (JSON:API).
 *
 * Kitsu has smaller catalogue coverage than AniList/MAL but a fast,
 * keyless JSON:API at `https://kitsu.io/api/edge`. We use it as a
 * tertiary option — primarily useful when callers already have Kitsu IDs.
 *
 * Native IDs are Kitsu IDs (numeric strings).
 */
export interface KitsuMetaOptions extends BaseMetadataProviderOptions {
  apiUrl?: string;
  defaultSearchType?: 'ANIME' | 'MANGA';
}

const KITSU_API = 'https://kitsu.io/api/edge';

export class KitsuMeta extends BaseMetadataProvider {
  public readonly id = 'kitsu';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME', 'MANGA'];
  private apiUrl: string;
  private defaultSearchType: 'ANIME' | 'MANGA';

  constructor(http: HttpClient, options: KitsuMetaOptions = {}) {
    super(http, options);
    this.apiUrl = options.apiUrl ?? KITSU_API;
    this.defaultSearchType = options.defaultSearchType ?? 'ANIME';
  }

  protected async searchRawNative(
    query: string,
    options: CallOptions = {},
  ): Promise<IMetaSearchResult[]> {
    const path = this.defaultSearchType === 'MANGA' ? 'manga' : 'anime';
    const url = `${this.apiUrl}/${path}?filter[text]=${encodeURIComponent(query)}&page[limit]=20`;
    const res = await this.http.get(url, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: options.signal,
    });
    if (res.status !== 200) {
      throw new Error(`Kitsu search failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const data: any[] = json?.data ?? [];
    return data.map((r) => mapToSearchResult(r, path === 'manga' ? 'MANGA' : 'ANIME', path));
  }

  protected async fetchMediaInfoRawNative(
    nativeId: string,
    options: CallOptions = {},
  ): Promise<IMediaMetadata> {
    // Accept typed (`anime:11013` / `manga:13`) or bare (`11013`) inputs.
    let path: 'anime' | 'manga' = 'anime';
    let rawId = nativeId;
    const sep = nativeId.indexOf(':');
    if (sep >= 0) {
      const prefix = nativeId.slice(0, sep);
      if (prefix === 'anime' || prefix === 'manga') {
        path = prefix;
        rawId = nativeId.slice(sep + 1);
      }
    }
    let url = `${this.apiUrl}/${path}/${rawId}?include=genres,categories,mappings,animeProductions.producer`;
    let res = await this.http.get(url, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: options.signal,
    });
    if (res.status === 404 && sep < 0) {
      path = 'manga';
      url = `${this.apiUrl}/${path}/${rawId}?include=genres,categories,mappings`;
      res = await this.http.get(url, {
        headers: { Accept: 'application/vnd.api+json' },
        signal: options.signal,
      });
    }
    if (res.status !== 200) {
      throw new Error(`Kitsu fetchMediaInfo failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const r = json?.data;
    if (!r) throw new Error(`Kitsu: no media for id ${nativeId}`);

    const included: any[] = json?.included ?? [];
    const genres = pickNames(included, r.relationships?.genres?.data, 'genres');
    const tags = pickNames(included, r.relationships?.categories?.data, 'categories');
    const studios = pickProducers(included, r.relationships?.animeProductions?.data);
    const mappings = pickMappings(included, r.relationships?.mappings?.data);

    const a = r.attributes ?? {};
    const catalog = path === 'manga' ? 'MANGA' : 'ANIME';
    return {
      id: `${path}:${r.id}`,
      providerId: this.id,
      catalogType: catalog,
      title: kitsuTitles(a),
      description: a.synopsis ?? a.description ?? undefined,
      cover: a.posterImage
        ? {
            large: a.posterImage.large ?? a.posterImage.original ?? undefined,
            medium: a.posterImage.medium ?? undefined,
            small: a.posterImage.small ?? undefined,
          }
        : undefined,
      banner: a.coverImage?.large ?? a.coverImage?.original ?? undefined,
      status: kitsuStatus(a.status),
      format: kitsuFormat(a.subtype),
      episodeCount: a.episodeCount ?? undefined,
      chapterCount: a.chapterCount ?? undefined,
      durationMinutes: a.episodeLength ?? undefined,
      genres: genres.length > 0 ? genres : undefined,
      tags: tags.length > 0 ? tags : undefined,
      studios: studios.length > 0 ? studios : undefined,
      year: parseYear(a.startDate),
      season: undefined, // Kitsu doesn't expose a season enum
      startDate: a.startDate ?? undefined,
      endDate: a.endDate ?? undefined,
      score:
        typeof a.averageRating === 'string' ? Math.round(parseFloat(a.averageRating)) : undefined,
      trailer: a.youtubeVideoId ? `https://www.youtube.com/watch?v=${a.youtubeVideoId}` : undefined,
      isAdult: a.ageRating === 'R18' || a.ageRating === 'R18+' || a.nsfw === true,
      synonyms: Array.isArray(a.abbreviatedTitles)
        ? a.abbreviatedTitles.filter(Boolean)
        : undefined,
      // `mappings` first so the primary key wins on conflict — Kitsu's own
      // ID is authoritative here.
      mappings: { ...mappings, kitsu: Number(rawId) },
    };
  }
}

function mapToSearchResult(
  r: any,
  catalog: MediaCatalogType,
  path: 'anime' | 'manga',
): IMetaSearchResult {
  const a = r.attributes ?? {};
  return {
    id: `${path}:${r.id}`,
    providerId: 'kitsu',
    catalogType: catalog,
    title: kitsuTitles(a),
    cover: a.posterImage
      ? {
          large: a.posterImage.large ?? a.posterImage.original ?? undefined,
          medium: a.posterImage.medium ?? undefined,
          small: a.posterImage.small ?? undefined,
        }
      : undefined,
    year: parseYear(a.startDate),
    format: kitsuFormat(a.subtype),
    score:
      typeof a.averageRating === 'string' ? Math.round(parseFloat(a.averageRating)) : undefined,
    isAdult: a.ageRating === 'R18' || a.ageRating === 'R18+' || a.nsfw === true,
    mappings: { kitsu: Number(r.id) },
  };
}

function kitsuTitles(a: any) {
  const t = a?.titles ?? {};
  return {
    romaji: t.en_jp ?? a?.canonicalTitle ?? undefined,
    english: t.en ?? undefined,
    native: t.ja_jp ?? undefined,
    userPreferred: a?.canonicalTitle ?? t.en_jp ?? t.en ?? undefined,
  };
}

function kitsuStatus(s: unknown): MediaStatus | undefined {
  if (typeof s !== 'string') return undefined;
  switch (s) {
    case 'finished':
      return 'FINISHED';
    case 'current':
      return 'RELEASING';
    case 'upcoming':
    case 'tba':
      return 'NOT_YET_RELEASED';
    case 'unreleased':
      return 'CANCELLED';
    default:
      return 'UNKNOWN';
  }
}

function kitsuFormat(s: unknown): MediaFormat | undefined {
  if (typeof s !== 'string') return undefined;
  switch (s) {
    case 'TV':
      return 'TV';
    case 'movie':
      return 'MOVIE';
    case 'OVA':
      return 'OVA';
    case 'ONA':
      return 'ONA';
    case 'special':
      return 'SPECIAL';
    case 'music':
      return 'MUSIC';
    case 'manga':
      return 'MANGA';
    case 'novel':
      return 'NOVEL';
    case 'oneshot':
      return 'ONE_SHOT';
    default:
      return 'UNKNOWN';
  }
}

function parseYear(d: unknown): number | undefined {
  if (typeof d !== 'string') return undefined;
  const m = d.match(/^(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

function pickNames(
  included: any[],
  refs: Array<{ id: string; type: string }> | undefined,
  expectedType: string,
): string[] {
  if (!Array.isArray(refs)) return [];
  const lookup = new Map(included.map((i) => [`${i.type}:${i.id}`, i]));
  const out: string[] = [];
  for (const ref of refs) {
    const node = lookup.get(`${expectedType}:${ref.id}`);
    if (node?.attributes?.name) out.push(node.attributes.name);
  }
  return out;
}

function pickProducers(
  included: any[],
  refs: Array<{ id: string; type: string }> | undefined,
): string[] {
  if (!Array.isArray(refs)) return [];
  const productions = included.filter((i) => i.type === 'animeProductions');
  const producers = new Map(
    included.filter((i) => i.type === 'producers').map((i) => [i.id, i.attributes?.name]),
  );
  const out: string[] = [];
  for (const ref of refs) {
    const prod = productions.find((p) => p.id === ref.id);
    const producerId = prod?.relationships?.producer?.data?.id;
    const name = producerId ? producers.get(producerId) : undefined;
    if (name) out.push(name);
  }
  return out;
}

/**
 * Pull the cross-source `mappings` records (MAL / AniList / etc.) that
 * Kitsu's `relationships.mappings` exposes. This is what makes Kitsu
 * usable as an alternative entry point — even if the user knows only a
 * Kitsu ID, we can route to MALSync via the AniList/MAL crosslink.
 */
function pickMappings(
  included: any[],
  refs: Array<{ id: string; type: string }> | undefined,
): { anilist?: number; mal?: number; anidb?: number; thetvdb?: number } {
  if (!Array.isArray(refs)) return {};
  const out: { anilist?: number; mal?: number; anidb?: number; thetvdb?: number } = {};
  for (const ref of refs) {
    const node = included.find((i) => i.type === 'mappings' && i.id === ref.id);
    const site = node?.attributes?.externalSite as string | undefined;
    const externalId = node?.attributes?.externalId as string | undefined;
    if (!site || !externalId) continue;
    const num = Number(externalId);
    if (!Number.isFinite(num)) continue;
    if (site === 'myanimelist/anime' || site === 'myanimelist/manga') out.mal = num;
    else if (site === 'anilist/anime' || site === 'anilist/manga') out.anilist = num;
    else if (site === 'anidb') out.anidb = num;
    else if (site === 'thetvdb') out.thetvdb = num;
  }
  return out;
}
