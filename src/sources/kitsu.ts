import { HttpClient } from '../internal/http.js';
import { encodeId } from '../internal/id.js';
import type { Media, List } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const KITSU_API = 'https://kitsu.io/api/edge';

function kitsuTitles(a: any): Media['title'] {
  const t = a?.titles ?? {};
  return {
    preferred: a?.canonicalTitle ?? t.en_jp ?? t.en ?? '',
    english: t.en ?? undefined,
    romaji: t.en_jp ?? a?.canonicalTitle ?? undefined,
    native: t.ja_jp ?? undefined,
  };
}

function mapNode(r: any, path: 'anime' | 'manga', sourceId: string, mappings = {}): Media {
  const a = r.attributes ?? {};
  const kitsuId = Number(r.id);
  return {
    id: encodeId({
      t: 'media',
      s: sourceId,
      r: `${path}:${r.id}`,
      m: { kitsu: kitsuId, ...mappings },
    }),
    kind: path === 'manga' ? 'manga' : 'anime',
    title: kitsuTitles(a),
    cover: a.posterImage?.large
      ? { url: a.posterImage.large }
      : a.posterImage?.original
        ? { url: a.posterImage.original }
        : undefined,
    banner: a.coverImage?.large ?? a.coverImage?.original ?? undefined,
    score:
      typeof a.averageRating === 'string'
        ? { value: Math.round(parseFloat(a.averageRating)), scale: 100 }
        : undefined,
    year: parseYear(a.startDate),
    status: a.status ?? undefined,
    format: a.subtype ?? undefined,
    episodeCount: a.episodeCount ?? undefined,
    chapterCount: a.chapterCount ?? undefined,
    source: sourceId,
    mappings: { kitsu: kitsuId, ...(mappings as Record<string, unknown>) } as Media['mappings'],
  };
}

function parseYear(d: unknown): number | undefined {
  if (typeof d !== 'string') return undefined;
  const m = d.match(/^(\d{4})/);
  return m ? Number(m[1]) : undefined;
}

function pickMappings(
  included: any[],
  refs: Array<{ id: string; type: string }> | undefined,
): { anilist?: number; mal?: number } {
  if (!Array.isArray(refs)) return {};
  const out: { anilist?: number; mal?: number } = {};
  for (const ref of refs) {
    const node = included.find((i: any) => i.type === 'mappings' && i.id === ref.id);
    const site: string = node?.attributes?.externalSite ?? '';
    const extId = node?.attributes?.externalId;
    const num = Number(extId);
    if (!Number.isFinite(num)) continue;
    if (site.startsWith('myanimelist')) out.mal = num;
    else if (site.startsWith('anilist')) out.anilist = num;
  }
  return out;
}

export class KitsuSource implements Source {
  readonly id = 'kitsu';
  readonly kinds = ['anime', 'manga'] as const;
  readonly caps = { search: true, info: true } as const;

  private http: HttpClient;
  private apiUrl: string;

  constructor(http: HttpClient, apiUrl = KITSU_API) {
    this.http = http;
    this.apiUrl = apiUrl;
  }

  async search(query: string, kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const path = kind === 'manga' ? 'manga' : 'anime';
    const url = `${this.apiUrl}/${path}?filter[text]=${encodeURIComponent(query)}&page[limit]=20`;
    const res = await this.http.get(url, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: opts.signal,
    });
    if (res.status !== 200) throw new Error(`Kitsu search failed: ${res.status}`);
    const json = (await res.json()) as any;
    return ((json?.data as any[]) ?? []).map((r) => mapNode(r, path, this.id));
  }

  async info(rawId: string, opts: SourceCallOpts): Promise<Media> {
    // Sdk.info passes the decoded `r` field — "<kind>:<kitsuId>" (set in
    // mapNode) or, for legacy callers, a bare numeric id.
    const sep = rawId.indexOf(':');
    let path: 'anime' | 'manga' = 'anime';
    let id = rawId;
    if (sep >= 0 && (rawId.slice(0, sep) === 'anime' || rawId.slice(0, sep) === 'manga')) {
      path = rawId.slice(0, sep) as 'anime' | 'manga';
      id = rawId.slice(sep + 1);
    }
    const url = `${this.apiUrl}/${path}/${id}?include=genres,categories,mappings`;
    const res = await this.http.get(url, {
      headers: { Accept: 'application/vnd.api+json' },
      signal: opts.signal,
    });
    if (res.status !== 200) throw new Error(`Kitsu info failed: ${res.status}`);
    const json = (await res.json()) as any;
    const r = json?.data;
    if (!r) throw new Error(`Kitsu: no media for id ${rawId}`);
    const included: any[] = json?.included ?? [];
    const extraMappings = pickMappings(included, r.relationships?.mappings?.data);
    return mapNode(r, path, this.id, extraMappings);
  }
}
