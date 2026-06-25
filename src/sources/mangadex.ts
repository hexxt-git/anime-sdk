import { HttpClient } from '../internal/http.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Chapter, Pages, List } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const MANGADEX_API = 'https://api.mangadex.org';
const COVER_BASE = 'https://uploads.mangadex.org/covers';

export class MangadexSource implements Source {
  readonly id = 'mangadex';
  readonly kinds = ['manga'] as const;
  readonly caps = { search: true, chapters: true, pages: true, mapping: true } as const;
  readonly malsyncSites = ['MangaDex', 'Mangadex'] as const;

  constructor(private http: HttpClient) {}

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const url = `${MANGADEX_API}/manga?title=${encodeURIComponent(query)}&includes[]=cover_art&limit=24&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true`;
    const res = await this.http.get(url, { signal: opts.signal });
    const data = (await res.json()) as any;
    return ((data.data as any[]) ?? []).map((manga): Media => {
      const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
      const coverRel = manga.relationships.find((r: any) => r.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      return {
        id: encodeId({ t: 'media', s: this.id, r: manga.id }),
        kind: 'manga',
        title: { preferred: String(title) },
        cover: coverFileName
          ? { url: `${COVER_BASE}/${manga.id}/${coverFileName}.256.jpg` }
          : undefined,
        year: typeof manga.attributes.year === 'number' ? manga.attributes.year : undefined,
        source: this.id,
        mappings: {},
      };
    });
  }

  async chapters(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Chapter>> {
    const items: Chapter[] = [];
    let offset = 0;
    const limit = 500;
    let total = 0;
    do {
      const url = `${MANGADEX_API}/manga/${mediaId}/feed?limit=${limit}&offset=${offset}&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic&includeExternalUrl=0`;
      const res = await this.http.get(url, { signal: opts.signal });
      const data = (await res.json()) as any;
      total = data.total;
      for (const ch of data.data as any[]) {
        const num = parseFloat(ch.attributes.chapter);
        items.push({
          id: encodeId({ t: 'chapter', s: this.id, r: ch.id }),
          number: isNaN(num) ? 0 : num,
          title: ch.attributes.title
            ? `Ch. ${ch.attributes.chapter} - ${ch.attributes.title}`
            : `Chapter ${ch.attributes.chapter}`,
        });
      }
      offset += limit;
    } while (offset < total);
    return { items };
  }

  async pages(chapterId: string, opts: SourceCallOpts): Promise<Pages> {
    const { r: rawId } = decodeId(chapterId);
    const url = `${MANGADEX_API}/at-home/server/${rawId}`;
    const res = await this.http.get(url, { signal: opts.signal });
    const data = (await res.json()) as any;
    const base = data.baseUrl;
    const hash = data.chapter.hash;
    const pages = (data.chapter.data as string[]).map((file) => ({
      url: `${base}/data/${hash}/${file}`,
    }));
    return { pages };
  }

  async lookupByMapping(
    _mappings: Record<string, unknown>,
    _opts?: SourceCallOpts,
  ): Promise<string | null> {
    // MangaDex doesn't have a native MAL/AniList ID lookup endpoint.
    // Cross-source resolution requires a title search via the search() method.
    return null;
  }
}
