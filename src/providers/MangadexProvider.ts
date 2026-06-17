import { HttpClient } from '../transport/http.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
} from '../types/index.js';
import { BaseProvider, CallOptions } from './BaseProvider.js';

export class MangadexProvider extends BaseProvider {
  readonly id = 'mangadex';
  readonly supportedTypes: MediaCatalogType[] = ['MANGA'];
  public static override readonly malsyncSites = ['MangaDex', 'Mangadex'] as const;

  private readonly apiUrl = 'https://api.mangadex.org';
  private readonly coverUrlBase = 'https://uploads.mangadex.org/covers';

  constructor(http: HttpClient) {
    super(http);
  }

  protected async searchRaw(
    query: string,
    options: CallOptions = {},
  ): Promise<IMediaSearchResult[]> {
    const url = `${this.apiUrl}/manga?title=${encodeURIComponent(
      query,
    )}&includes[]=cover_art&limit=24&contentRating[]=safe&contentRating[]=suggestive&hasAvailableChapters=true`;

    const res = await this.http.get(url, { signal: options.signal });
    const data = (await res.json()) as any;

    const results: IMediaSearchResult[] = [];

    for (const manga of data.data) {
      const title = manga.attributes.title.en || Object.values(manga.attributes.title)[0];
      const coverRel = manga.relationships.find((r: any) => r.type === 'cover_art');
      const coverFileName = coverRel?.attributes?.fileName;
      const thumbnailUrl = coverFileName
        ? `${this.coverUrlBase}/${manga.id}/${coverFileName}.256.jpg`
        : undefined;
      const yearRaw = manga.attributes.year as number | null | undefined;

      results.push({
        id: manga.id,
        title,
        thumbnailUrl,
        catalogType: 'MANGA',
        providerId: this.id,
        availableLanguages: ['sub'],
        year: typeof yearRaw === 'number' ? yearRaw : undefined,
      });
    }

    return results;
  }

  protected async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    const units: IContentUnit[] = [];
    let offset = 0;
    const limit = 500;
    let total = 0;

    do {
      const url = `${this.apiUrl}/manga/${mediaId}/feed?limit=${limit}&offset=${offset}&order[chapter]=asc&contentRating[]=safe&contentRating[]=suggestive&contentRating[]=erotica&contentRating[]=pornographic&includeExternalUrl=0`;

      const res = await this.http.get(url, { signal: options.signal });
      const data = (await res.json()) as any;

      total = data.total;

      for (const chapter of data.data) {
        const num = parseFloat(chapter.attributes.chapter);
        const lang = chapter.attributes.translatedLanguage;

        units.push({
          id: chapter.id,
          title: chapter.attributes.title
            ? `Ch. ${chapter.attributes.chapter} - ${chapter.attributes.title}`
            : `Chapter ${chapter.attributes.chapter}`,
          number: isNaN(num) ? 0 : num,
          availableLanguages: [lang === 'en' ? 'sub' : lang], // Map 'en' to 'sub', others as-is or default
        });
      }

      offset += limit;
    } while (offset < total);

    return units;
  }

  protected async resolveStreamRaw(
    unitId: string,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const url = `${this.apiUrl}/at-home/server/${unitId}`;
    const res = await this.http.get(url, { signal: options.signal });
    const data = (await res.json()) as any;

    const baseUrl = data.baseUrl;
    const hash = data.chapter.hash;
    const imageUrls = data.chapter.data.map((file: string) => `${baseUrl}/data/${hash}/${file}`);

    return {
      type: 'manga',
      pages: {
        imageUrls,
        headers: {
          Referer: 'https://mangadex.org/',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      },
    };
  }
}
