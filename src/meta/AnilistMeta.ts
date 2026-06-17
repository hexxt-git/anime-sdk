import { HttpClient } from '../transport/http.js';
import {
  CallOptions,
  IMediaCharacter,
  IMediaExternalLink,
  IMediaMetadata,
  IMediaRecommendation,
  IMediaRelation,
  IMediaStaff,
  IMetaSearchResult,
  IStreamingEpisode,
  MediaCatalogType,
  MediaFormat,
  MediaRelationType,
  MediaSeason,
  MediaStatus,
} from '../types/index.js';
import { buildUrn } from '../utils/urn.js';
import {
  BaseMetadataProvider,
  BaseMetadataProviderOptions,
  BrowseKind,
  BrowseOptions,
} from './BaseMetadataProvider.js';

const ANILIST_API = 'https://graphql.anilist.co';

/**
 * AniList GraphQL metadata provider.
 *
 * No API key required. We hit the public `https://graphql.anilist.co`
 * endpoint with a small, fixed query. The free-tier rate limit (90 req/min
 * per IP) is generous enough that we don't add an internal throttle —
 * consumers who need higher throughput should pass a shared `SdkCache` via
 * the meta server routes.
 */
export interface AnilistMetaOptions extends BaseMetadataProviderOptions {
  /**
   * Override the GraphQL endpoint. Useful for self-hosted mirrors or for
   * pointing at a local mock during tests.
   */
  apiUrl?: string;
}

export class AnilistMeta extends BaseMetadataProvider {
  public readonly id = 'anilist';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME', 'MANGA'];
  private apiUrl: string;

  constructor(http: HttpClient, options: AnilistMetaOptions = {}) {
    super(http, options);
    this.apiUrl = options.apiUrl ?? ANILIST_API;
  }

  public override supportsBrowseKind(kind: BrowseKind): boolean {
    return kind === 'trending' || kind === 'popular' || kind === 'seasonal' || kind === 'top';
  }

  protected override async browseRawNative(
    kind: BrowseKind,
    options: BrowseOptions,
  ): Promise<IMetaSearchResult[]> {
    const catalogType = options.catalogType ?? 'ANIME';
    const type = catalogType === 'MANGA' ? 'MANGA' : 'ANIME';
    const sort = browseSort(kind);
    if (kind === 'seasonal' && (!options.season || !options.year)) {
      throw new Error('AniList browse(seasonal): season and year are required');
    }
    const gql = /* GraphQL */ `
      query (
        $page: Int
        $perPage: Int
        $type: MediaType
        $sort: [MediaSort]
        $season: MediaSeason
        $seasonYear: Int
        $format: MediaFormat
      ) {
        Page(page: $page, perPage: $perPage) {
          media(
            type: $type
            sort: $sort
            season: $season
            seasonYear: $seasonYear
            format: $format
          ) {
            id
            type
            format
            seasonYear
            startDate {
              year
            }
            averageScore
            isAdult
            idMal
            title {
              romaji
              english
              native
              userPreferred
            }
            coverImage {
              extraLarge
              large
              medium
              color
            }
          }
        }
      }
    `;
    const variables: Record<string, unknown> = {
      page: options.page ?? 1,
      perPage: Math.min(options.perPage ?? 20, 50),
      type,
      sort,
    };
    if (kind === 'seasonal') {
      variables.season = options.season;
      variables.seasonYear = options.year;
    }
    if (options.format) variables.format = options.format;

    const res = await this.http.post(
      this.apiUrl,
      { query: gql, variables },
      { signal: options.signal },
    );
    if (res.status !== 200) {
      throw new Error(`AniList browse failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const media: any[] = json?.data?.Page?.media ?? [];
    return media.map((m) => ({
      id: String(m.id),
      providerId: this.id,
      catalogType: anilistTypeToCatalog(m.type),
      title: {
        romaji: m.title?.romaji ?? undefined,
        english: m.title?.english ?? undefined,
        native: m.title?.native ?? undefined,
        userPreferred: m.title?.userPreferred ?? undefined,
      },
      cover: m.coverImage
        ? {
            large: m.coverImage.extraLarge ?? m.coverImage.large ?? undefined,
            medium: m.coverImage.medium ?? undefined,
            color: m.coverImage.color ?? undefined,
          }
        : undefined,
      year: m.seasonYear ?? m.startDate?.year ?? undefined,
      format: anilistFormat(m.format),
      score: typeof m.averageScore === 'number' ? m.averageScore : undefined,
      isAdult: !!m.isAdult,
      mappings: { anilist: m.id, mal: m.idMal ?? undefined },
    }));
  }

  protected async searchRawNative(
    query: string,
    options: CallOptions = {},
  ): Promise<IMetaSearchResult[]> {
    const gql = /* GraphQL */ `
      query ($q: String, $perPage: Int) {
        Page(page: 1, perPage: $perPage) {
          media(search: $q, sort: SEARCH_MATCH) {
            id
            type
            format
            seasonYear
            startDate {
              year
            }
            averageScore
            isAdult
            idMal
            title {
              romaji
              english
              native
              userPreferred
            }
            coverImage {
              extraLarge
              large
              medium
              color
            }
          }
        }
      }
    `;
    const res = await this.http.post(
      this.apiUrl,
      { query: gql, variables: { q: query, perPage: 25 } },
      { signal: options.signal },
    );
    if (res.status !== 200) {
      throw new Error(`AniList search failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const media: any[] = json?.data?.Page?.media ?? [];
    return media.map((m) => ({
      id: String(m.id),
      providerId: this.id,
      catalogType: anilistTypeToCatalog(m.type),
      title: {
        romaji: m.title?.romaji ?? undefined,
        english: m.title?.english ?? undefined,
        native: m.title?.native ?? undefined,
        userPreferred: m.title?.userPreferred ?? undefined,
      },
      cover: m.coverImage
        ? {
            large: m.coverImage.extraLarge ?? m.coverImage.large ?? undefined,
            medium: m.coverImage.medium ?? undefined,
            color: m.coverImage.color ?? undefined,
          }
        : undefined,
      year: m.seasonYear ?? m.startDate?.year ?? undefined,
      format: anilistFormat(m.format),
      score: typeof m.averageScore === 'number' ? m.averageScore : undefined,
      isAdult: !!m.isAdult,
      mappings: {
        anilist: m.id,
        mal: m.idMal ?? undefined,
      },
    }));
  }

  protected async fetchMediaInfoRawNative(
    nativeId: string,
    options: CallOptions = {},
  ): Promise<IMediaMetadata> {
    const id = Number(nativeId);
    if (!Number.isFinite(id)) {
      throw new Error(`Invalid AniList ID: ${nativeId}`);
    }
    const gql = /* GraphQL */ `
      query ($id: Int) {
        Media(id: $id) {
          id
          type
          format
          status
          episodes
          chapters
          duration
          season
          seasonYear
          startDate {
            year
            month
            day
          }
          endDate {
            year
            month
            day
          }
          averageScore
          isAdult
          idMal
          description(asHtml: false)
          synonyms
          genres
          studios(isMain: true) {
            nodes {
              name
            }
          }
          tags {
            name
            rank
          }
          title {
            romaji
            english
            native
            userPreferred
          }
          coverImage {
            extraLarge
            large
            medium
            color
          }
          bannerImage
          trailer {
            id
            site
          }
          externalLinks {
            site
            url
            language
            type
          }
          streamingEpisodes {
            title
            thumbnail
            url
            site
          }
          relations {
            edges {
              relationType(version: 2)
              node {
                id
                type
                format
                status
                title {
                  romaji
                  english
                  native
                  userPreferred
                }
                coverImage {
                  extraLarge
                  large
                  medium
                  color
                }
              }
            }
          }
          characters(sort: [ROLE, RELEVANCE, ID], perPage: 25) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                image {
                  large
                  medium
                }
              }
              voiceActors(sort: [RELEVANCE, ID]) {
                id
                name {
                  full
                  native
                }
                language: languageV2
                image {
                  large
                  medium
                }
              }
            }
          }
          staff(sort: [RELEVANCE, ID], perPage: 25) {
            edges {
              role
              node {
                id
                name {
                  full
                  native
                }
                image {
                  large
                  medium
                }
              }
            }
          }
          recommendations(sort: [RATING_DESC], perPage: 12) {
            nodes {
              rating
              mediaRecommendation {
                id
                type
                format
                title {
                  romaji
                  english
                  native
                  userPreferred
                }
                coverImage {
                  extraLarge
                  large
                  medium
                  color
                }
              }
            }
          }
        }
      }
    `;
    const res = await this.http.post(
      this.apiUrl,
      { query: gql, variables: { id } },
      { signal: options.signal },
    );
    if (res.status !== 200) {
      throw new Error(`AniList fetchMediaInfo failed with status ${res.status}`);
    }
    const json = (await res.json()) as any;
    const m = json?.data?.Media;
    if (!m) throw new Error(`AniList: no media for id ${id}`);

    const trailerUrl =
      m.trailer && m.trailer.site === 'youtube'
        ? `https://www.youtube.com/watch?v=${m.trailer.id}`
        : undefined;

    return {
      id: String(m.id),
      providerId: this.id,
      catalogType: anilistTypeToCatalog(m.type),
      title: {
        romaji: m.title?.romaji ?? undefined,
        english: m.title?.english ?? undefined,
        native: m.title?.native ?? undefined,
        userPreferred: m.title?.userPreferred ?? undefined,
      },
      description: m.description ?? undefined,
      cover: m.coverImage
        ? {
            large: m.coverImage.extraLarge ?? m.coverImage.large ?? undefined,
            medium: m.coverImage.medium ?? undefined,
            color: m.coverImage.color ?? undefined,
          }
        : undefined,
      banner: m.bannerImage ?? undefined,
      status: anilistStatus(m.status),
      format: anilistFormat(m.format),
      episodeCount: m.episodes ?? undefined,
      chapterCount: m.chapters ?? undefined,
      durationMinutes: m.duration ?? undefined,
      genres: m.genres ?? undefined,
      tags:
        Array.isArray(m.tags) && m.tags.length > 0
          ? m.tags.map((t: any) => t.name).filter(Boolean)
          : undefined,
      studios:
        m.studios?.nodes && m.studios.nodes.length > 0
          ? m.studios.nodes.map((n: any) => n.name).filter(Boolean)
          : undefined,
      year: m.seasonYear ?? m.startDate?.year ?? undefined,
      season: anilistSeason(m.season),
      startDate: formatDate(m.startDate),
      endDate: formatDate(m.endDate),
      score: typeof m.averageScore === 'number' ? m.averageScore : undefined,
      trailer: trailerUrl,
      isAdult: !!m.isAdult,
      synonyms: Array.isArray(m.synonyms) ? m.synonyms.filter(Boolean) : undefined,
      mappings: {
        anilist: m.id,
        mal: m.idMal ?? undefined,
      },
      relations: this.mapRelations(m.relations?.edges),
      characters: this.mapCharacters(m.characters?.edges),
      staff: this.mapStaff(m.staff?.edges),
      recommendations: this.mapRecommendations(m.recommendations?.nodes),
      externalLinks: this.mapExternalLinks(m.externalLinks),
      streamingEpisodes: this.mapStreamingEpisodes(m.streamingEpisodes),
    };
  }

  // ── AniList enrichment mappers ──────────────────────────────────────────

  private mapRelations(edges: unknown): IMediaRelation[] | undefined {
    if (!Array.isArray(edges) || edges.length === 0) return undefined;
    const out: IMediaRelation[] = [];
    for (const e of edges) {
      const node = (e as any)?.node;
      if (!node?.id) continue;
      out.push({
        id: buildUrn(this.id, String(node.id)),
        relationType: anilistRelationType((e as any).relationType),
        catalogType: anilistTypeToCatalog(node.type),
        format: anilistFormat(node.format),
        status: anilistStatus(node.status),
        title: {
          romaji: node.title?.romaji ?? undefined,
          english: node.title?.english ?? undefined,
          native: node.title?.native ?? undefined,
          userPreferred: node.title?.userPreferred ?? undefined,
        },
        cover: node.coverImage
          ? {
              large: node.coverImage.extraLarge ?? node.coverImage.large ?? undefined,
              medium: node.coverImage.medium ?? undefined,
              color: node.coverImage.color ?? undefined,
            }
          : undefined,
      });
    }
    return out.length > 0 ? out : undefined;
  }

  private mapCharacters(edges: unknown): IMediaCharacter[] | undefined {
    if (!Array.isArray(edges) || edges.length === 0) return undefined;
    const out: IMediaCharacter[] = [];
    for (const e of edges) {
      const node = (e as any)?.node;
      if (!node?.id) continue;
      out.push({
        id: buildUrn(this.id, `character:${node.id}`),
        name: node.name?.full ?? node.name?.native ?? '',
        role: (e as any).role ?? undefined,
        image: node.image
          ? { large: node.image.large ?? undefined, medium: node.image.medium ?? undefined }
          : undefined,
        voiceActors: Array.isArray((e as any).voiceActors)
          ? (e as any).voiceActors.slice(0, 5).map((va: any) => ({
              id: buildUrn(this.id, `staff:${va.id}`),
              name: va.name?.full ?? va.name?.native ?? '',
              language: va.language ?? undefined,
              image: va.image
                ? { large: va.image.large ?? undefined, medium: va.image.medium ?? undefined }
                : undefined,
            }))
          : undefined,
      });
    }
    return out.length > 0 ? out : undefined;
  }

  private mapStaff(edges: unknown): IMediaStaff[] | undefined {
    if (!Array.isArray(edges) || edges.length === 0) return undefined;
    const out: IMediaStaff[] = [];
    for (const e of edges) {
      const node = (e as any)?.node;
      if (!node?.id) continue;
      out.push({
        id: buildUrn(this.id, `staff:${node.id}`),
        name: node.name?.full ?? node.name?.native ?? '',
        role: (e as any).role ?? undefined,
        image: node.image
          ? { large: node.image.large ?? undefined, medium: node.image.medium ?? undefined }
          : undefined,
      });
    }
    return out.length > 0 ? out : undefined;
  }

  private mapRecommendations(nodes: unknown): IMediaRecommendation[] | undefined {
    if (!Array.isArray(nodes) || nodes.length === 0) return undefined;
    const out: IMediaRecommendation[] = [];
    for (const n of nodes) {
      const rec = (n as any)?.mediaRecommendation;
      if (!rec?.id) continue;
      out.push({
        id: buildUrn(this.id, String(rec.id)),
        catalogType: anilistTypeToCatalog(rec.type),
        format: anilistFormat(rec.format),
        title: {
          romaji: rec.title?.romaji ?? undefined,
          english: rec.title?.english ?? undefined,
          native: rec.title?.native ?? undefined,
          userPreferred: rec.title?.userPreferred ?? undefined,
        },
        cover: rec.coverImage
          ? {
              large: rec.coverImage.extraLarge ?? rec.coverImage.large ?? undefined,
              medium: rec.coverImage.medium ?? undefined,
              color: rec.coverImage.color ?? undefined,
            }
          : undefined,
        rating: typeof (n as any).rating === 'number' ? (n as any).rating : undefined,
      });
    }
    return out.length > 0 ? out : undefined;
  }

  private mapExternalLinks(links: unknown): IMediaExternalLink[] | undefined {
    if (!Array.isArray(links) || links.length === 0) return undefined;
    const out: IMediaExternalLink[] = [];
    for (const l of links) {
      const site = (l as any)?.site;
      const url = (l as any)?.url;
      if (!site || !url) continue;
      out.push({
        site,
        url,
        language: (l as any).language ?? undefined,
        type: anilistExternalLinkType((l as any).type),
      });
    }
    return out.length > 0 ? out : undefined;
  }

  private mapStreamingEpisodes(eps: unknown): IStreamingEpisode[] | undefined {
    if (!Array.isArray(eps) || eps.length === 0) return undefined;
    const out: IStreamingEpisode[] = [];
    for (const ep of eps) {
      const title = (ep as any)?.title as string | undefined;
      if (!title) continue;
      // AniList streamingEpisodes encodes episode number in the title prefix
      // like "Episode 1 - Romance Dawn". Parse it; fall through silently
      // when the format is unfamiliar.
      const numMatch = title.match(/^Episode\s+(\d+(?:\.\d+)?)\b/i);
      const number = numMatch ? parseFloat(numMatch[1]) : NaN;
      if (!Number.isFinite(number)) continue;
      const cleanTitle = title.replace(/^Episode\s+\d+(?:\.\d+)?\s*[-—–:]?\s*/i, '').trim();
      out.push({
        number,
        title: cleanTitle || undefined,
        thumbnail: (ep as any).thumbnail ?? undefined,
        externalUrl: (ep as any).url ?? undefined,
      });
    }
    return out.length > 0 ? out : undefined;
  }
}

function anilistRelationType(s: unknown): MediaRelationType {
  if (typeof s !== 'string') return 'OTHER';
  switch (s) {
    case 'SEQUEL':
    case 'PREQUEL':
    case 'PARENT':
    case 'SIDE_STORY':
    case 'SPIN_OFF':
    case 'ADAPTATION':
    case 'CHARACTER':
    case 'SUMMARY':
    case 'COMPILATION':
    case 'CONTAINS':
    case 'OTHER':
      return s as MediaRelationType;
    case 'ALTERNATIVE':
      return 'ALTERNATIVE';
    case 'CHILD':
      return 'CHILD';
    default:
      return 'OTHER';
  }
}

function browseSort(kind: BrowseKind): string[] {
  switch (kind) {
    case 'trending':
      return ['TRENDING_DESC', 'POPULARITY_DESC'];
    case 'popular':
      return ['POPULARITY_DESC'];
    case 'seasonal':
      return ['POPULARITY_DESC'];
    case 'top':
      return ['SCORE_DESC'];
  }
}

function anilistExternalLinkType(t: unknown): IMediaExternalLink['type'] | undefined {
  if (typeof t !== 'string') return undefined;
  if (t === 'STREAMING') return 'STREAMING';
  if (t === 'INFO') return 'INFO';
  if (t === 'SOCIAL') return 'SOCIAL';
  return undefined;
}

function anilistTypeToCatalog(t: unknown): MediaCatalogType {
  return t === 'MANGA' ? 'MANGA' : 'ANIME';
}

function anilistStatus(s: unknown): MediaStatus | undefined {
  if (!s || typeof s !== 'string') return undefined;
  // AniList uses the same constant names we do.
  if (
    s === 'FINISHED' ||
    s === 'RELEASING' ||
    s === 'NOT_YET_RELEASED' ||
    s === 'CANCELLED' ||
    s === 'HIATUS'
  ) {
    return s;
  }
  return 'UNKNOWN';
}

function anilistFormat(f: unknown): MediaFormat | undefined {
  if (!f || typeof f !== 'string') return undefined;
  switch (f) {
    case 'TV':
    case 'TV_SHORT':
    case 'MOVIE':
    case 'SPECIAL':
    case 'OVA':
    case 'ONA':
    case 'MUSIC':
    case 'MANGA':
    case 'NOVEL':
    case 'ONE_SHOT':
      return f as MediaFormat;
    default:
      return 'UNKNOWN';
  }
}

function anilistSeason(s: unknown): MediaSeason | undefined {
  if (s === 'WINTER' || s === 'SPRING' || s === 'SUMMER' || s === 'FALL') return s;
  return undefined;
}

function formatDate(d: unknown): string | undefined {
  if (!d || typeof d !== 'object') return undefined;
  const o = d as { year?: number; month?: number; day?: number };
  if (!o.year) return undefined;
  const y = String(o.year).padStart(4, '0');
  const m = o.month ? String(o.month).padStart(2, '0') : undefined;
  const day = o.day ? String(o.day).padStart(2, '0') : undefined;
  if (m && day) return `${y}-${m}-${day}`;
  if (m) return `${y}-${m}`;
  return y;
}
