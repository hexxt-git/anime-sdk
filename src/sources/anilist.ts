import { HttpClient } from '../internal/http.js';
import { encodeId } from '../internal/id.js';
import type { Media, List } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const ANILIST_API = 'https://graphql.anilist.co';

const SEARCH_FIELDS = /* GraphQL */ `
  id type format seasonYear startDate { year }
  averageScore isAdult idMal
  title { romaji english native userPreferred }
  coverImage { extraLarge large medium color }
`;

const INFO_FIELDS = /* GraphQL */ `
  id type format status episodes chapters duration season
  seasonYear startDate { year month day } endDate { year month day }
  averageScore isAdult idMal description synonyms genres
  studios(isMain: true) { nodes { name } }
  tags { name }
  title { romaji english native userPreferred }
  coverImage { extraLarge large medium color }
  bannerImage
`;

function toKind(type: string): 'anime' | 'manga' {
  return type === 'MANGA' ? 'manga' : 'anime';
}

function toScore(v: unknown): { value: number; scale: number } | undefined {
  if (typeof v !== 'number') return undefined;
  return { value: v, scale: 100 };
}

function mapTitle(t: any): Media['title'] {
  return {
    preferred: t?.userPreferred ?? t?.romaji ?? t?.english ?? '',
    english: t?.english ?? undefined,
    romaji: t?.romaji ?? undefined,
    native: t?.native ?? undefined,
  };
}

function mapCover(c: any): Media['cover'] {
  if (!c) return undefined;
  const url = c.extraLarge ?? c.large ?? c.medium;
  if (!url) return undefined;
  return { url, color: c.color ?? undefined };
}

function formatDate(d: any): string | undefined {
  if (!d?.year) return undefined;
  const y = String(d.year).padStart(4, '0');
  if (!d.month) return y;
  const m = String(d.month).padStart(2, '0');
  if (!d.day) return `${y}-${m}`;
  return `${y}-${m}-${String(d.day).padStart(2, '0')}`;
}

function mapNode(m: any, sourceId: string): Media {
  const kind = toKind(m.type);
  return {
    id: encodeId({ t: 'media', s: sourceId, r: String(m.id), m: { al: m.id, mal: m.idMal } }),
    kind,
    title: mapTitle(m.title),
    cover: mapCover(m.coverImage),
    banner: m.bannerImage ?? undefined,
    score: toScore(m.averageScore),
    year: m.seasonYear ?? m.startDate?.year ?? undefined,
    season: m.season ?? undefined,
    status: m.status ?? undefined,
    format: m.format ?? undefined,
    episodeCount: m.episodes ?? undefined,
    chapterCount: m.chapters ?? undefined,
    description: m.description ?? undefined,
    source: sourceId,
    mappings: {
      anilist: m.id,
      mal: m.idMal ?? undefined,
    },
  };
}

export class AnilistSource implements Source {
  readonly id = 'anilist';
  readonly kinds = ['anime', 'manga'] as const;
  readonly caps = { search: true, info: true, browse: true } as const;

  private http: HttpClient;
  private apiUrl: string;

  constructor(http: HttpClient, apiUrl = ANILIST_API) {
    this.http = http;
    this.apiUrl = apiUrl;
  }

  async search(query: string, kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const type = kind === 'manga' ? 'MANGA' : 'ANIME';
    const gql = `query($q:String,$type:MediaType,$perPage:Int){Page(perPage:$perPage){media(search:$q,type:$type,sort:SEARCH_MATCH){${SEARCH_FIELDS}}}}`;
    const res = await this.http.post(
      this.apiUrl,
      { query: gql, variables: { q: query, type, perPage: 25 } },
      { signal: opts.signal },
    );
    if (res.status !== 200) throw new Error(`AniList search failed: ${res.status}`);
    const json = (await res.json()) as any;
    return ((json?.data?.Page?.media as any[]) ?? []).map((m) => mapNode(m, this.id));
  }

  async info(id: string, opts: SourceCallOpts): Promise<Media> {
    const gql = `query($id:Int){Media(id:$id){${INFO_FIELDS}}}`;
    const res = await this.http.post(
      this.apiUrl,
      { query: gql, variables: { id: Number(id) } },
      { signal: opts.signal },
    );
    if (res.status !== 200) throw new Error(`AniList info failed: ${res.status}`);
    const json = (await res.json()) as any;
    const m = json?.data?.Media;
    if (!m) throw new Error(`AniList: no media for id ${id}`);
    return mapNode(m, this.id);
  }

  async browse(
    opts: SourceCallOpts & {
      list: 'trending' | 'popular' | 'seasonal' | 'top';
      kind: 'anime' | 'manga';
      page?: number;
      perPage?: number;
      season?: string;
      year?: number;
    },
  ): Promise<List<Media>> {
    const type = opts.kind === 'manga' ? 'MANGA' : 'ANIME';
    const sortMap: Record<string, string> = {
      trending: 'TRENDING_DESC',
      popular: 'POPULARITY_DESC',
      seasonal: 'POPULARITY_DESC',
      top: 'SCORE_DESC',
    };
    const sort = sortMap[opts.list];
    const vars: Record<string, unknown> = {
      type,
      sort,
      page: opts.page ?? 1,
      perPage: Math.min(opts.perPage ?? 20, 50),
    };
    if (opts.list === 'seasonal') {
      if (!opts.season || !opts.year) throw new Error('browse(seasonal): season and year required');
      vars.season = opts.season;
      vars.seasonYear = opts.year;
    }
    const gql = `query($type:MediaType,$sort:[MediaSort],$page:Int,$perPage:Int,$season:MediaSeason,$seasonYear:Int){Page(page:$page,perPage:$perPage){media(type:$type,sort:$sort,season:$season,seasonYear:$seasonYear){${SEARCH_FIELDS}}}}`;
    const res = await this.http.post(
      this.apiUrl,
      { query: gql, variables: vars },
      { signal: opts.signal },
    );
    if (res.status !== 200) throw new Error(`AniList browse failed: ${res.status}`);
    const json = (await res.json()) as any;
    const items = ((json?.data?.Page?.media as any[]) ?? []).map((m) => mapNode(m, this.id));
    return { items };
  }
}
