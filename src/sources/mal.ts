import { HttpClient } from '../internal/http.js';
import { encodeId } from '../internal/id.js';
import type { Media, List } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const JIKAN_API = 'https://api.jikan.moe/v4';

function malTitles(m: any): Media['title'] {
  const titles: Record<string, string> = {};
  if (Array.isArray(m.titles)) {
    for (const t of m.titles) {
      const type = String(t?.type ?? '').toLowerCase();
      if (t?.title) titles[type] = t.title;
    }
  }
  return {
    preferred: titles['english'] ?? m.title_english ?? m.title ?? '',
    english: titles['english'] ?? m.title_english ?? undefined,
    romaji: titles['default'] ?? m.title ?? undefined,
    native: titles['japanese'] ?? m.title_japanese ?? undefined,
  };
}

function malScore(s: unknown): Media['score'] {
  if (typeof s !== 'number') return undefined;
  return { value: Math.round(s * 10), scale: 100 };
}

function mapNode(m: any, path: 'anime' | 'manga', sourceId: string): Media {
  return {
    id: encodeId({
      t: 'media',
      s: sourceId,
      r: `${path}:${m.mal_id}`,
      m: { mal: m.mal_id },
    }),
    kind: path === 'manga' ? 'manga' : 'anime',
    title: malTitles(m),
    cover: m.images?.jpg?.large_image_url
      ? { url: m.images.jpg.large_image_url }
      : m.images?.jpg?.image_url
        ? { url: m.images.jpg.image_url }
        : undefined,
    score: malScore(m.score),
    year: m.year ?? (m.aired?.from ? new Date(m.aired.from).getUTCFullYear() : undefined),
    format: m.type ?? undefined,
    status: m.status ?? undefined,
    episodeCount: m.episodes ?? undefined,
    chapterCount: m.chapters ?? undefined,
    catalogues: [sourceId],
    playbackSources: [],
    mappings: { mal: m.mal_id },
  };
}

export class MalSource implements Source {
  readonly id = 'mal';
  readonly kinds = ['anime', 'manga'] as const;
  readonly caps = { search: true, info: true, browse: true } as const;

  private http: HttpClient;
  private apiUrl: string;

  constructor(http: HttpClient, apiUrl = JIKAN_API) {
    this.http = http;
    this.apiUrl = apiUrl;
  }

  async search(query: string, kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const path = kind === 'manga' ? 'manga' : 'anime';
    const url = `${this.apiUrl}/${path}?q=${encodeURIComponent(query)}&limit=20`;
    const res = await this.http.get(url, {
      headers: { Accept: 'application/json' },
      signal: opts.signal,
    });
    if (res.status !== 200) throw new Error(`Jikan search failed: ${res.status}`);
    const json = (await res.json()) as any;
    return ((json?.data as any[]) ?? []).map((m) => mapNode(m, path, this.id));
  }

  async info(rawId: string, opts: SourceCallOpts): Promise<Media> {
    // Sdk.info passes the decoded `r` field. Raw is "<kind>:<malId>"
    // (set in mapNode) or, for legacy callers, a bare numeric id.
    const sep = rawId.indexOf(':');
    let path: 'anime' | 'manga' = 'anime';
    let numericId: number;
    if (sep >= 0 && (rawId.slice(0, sep) === 'anime' || rawId.slice(0, sep) === 'manga')) {
      path = rawId.slice(0, sep) as 'anime' | 'manga';
      numericId = Number(rawId.slice(sep + 1));
    } else {
      numericId = Number(rawId);
    }
    const res = await this.http.get(`${this.apiUrl}/${path}/${numericId}/full`, {
      headers: { Accept: 'application/json' },
      signal: opts.signal,
    });
    if (res.status !== 200) throw new Error(`Jikan info failed: ${res.status}`);
    const json = (await res.json()) as any;
    const m = json?.data;
    if (!m) throw new Error(`MAL: no media for id ${rawId}`);
    return mapNode(m, path, this.id);
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
    const path = opts.kind === 'manga' ? 'manga' : 'anime';
    const page = opts.page ?? 1;
    const perPage = Math.min(opts.perPage ?? 20, 25);
    let url: string;
    if (opts.list === 'seasonal') {
      if (!opts.season || !opts.year)
        throw new Error('Jikan browse(seasonal): season and year required');
      url = `${this.apiUrl}/seasons/${opts.year}/${opts.season.toLowerCase()}?page=${page}&limit=${perPage}`;
    } else if (opts.list === 'top') {
      url = `${this.apiUrl}/top/${path}?page=${page}&limit=${perPage}`;
    } else {
      url = `${this.apiUrl}/top/${path}?filter=bypopularity&page=${page}&limit=${perPage}`;
    }
    const res = await this.http.get(url, {
      headers: { Accept: 'application/json' },
      signal: opts.signal,
    });
    if (res.status !== 200) throw new Error(`Jikan browse failed: ${res.status}`);
    const json = (await res.json()) as any;
    const items = ((json?.data as any[]) ?? []).map((m) => mapNode(m, path, this.id));
    return { items };
  }
}
