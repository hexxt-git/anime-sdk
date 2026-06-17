import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
} from '../types/index.js';
import { BaseProvider, CallOptions } from './BaseProvider.js';

export class WeebcentralProvider extends BaseProvider {
  readonly id = 'weebcentral';
  readonly supportedTypes: MediaCatalogType[] = ['MANGA'];
  public static override readonly malsyncSites = ['Weebcentral', 'WeebCentral'] as const;

  private readonly baseUrl = 'https://weebcentral.com/';

  constructor(http: HttpClient) {
    super(http);
  }

  protected async searchRaw(
    query: string,
    options: CallOptions = {},
  ): Promise<IMediaSearchResult[]> {
    const url = `${this.baseUrl}search/data?text=${encodeURIComponent(
      query,
    )}&limit=24&offset=0&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display`;

    const res = await this.http.get(url, {
      signal: options.signal,
      headers: {
        Referer: 'https://google.com',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=604800',
      },
    });
    const html = await res.text();
    const doc = DomRegistry.parse(`<div>${html}</div>`);

    const results: IMediaSearchResult[] = [];

    const items = doc.querySelectorAll('article.bg-base-300');
    for (const item of items) {
      const a = item.querySelector('a.line-clamp-1');
      const source = item.querySelector('source');

      if (!a) continue;

      const href = a.getAttribute('href');
      const title = a.textContent?.trim();
      const coverUrl = source?.getAttribute('srcset') || undefined;

      if (href && title) {
        const idMatch = href.match(/series\/([A-Z0-9]+)/i);
        if (idMatch) {
          results.push({
            id: idMatch[1],
            title: title,
            thumbnailUrl: coverUrl,
            catalogType: 'MANGA',
            providerId: this.id,
            availableLanguages: ['sub'],
          });
        }
      }
    }

    return results;
  }

  protected async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    const url = `${this.baseUrl}series/${mediaId}/full-chapter-list`;
    const res = await this.http.get(url, {
      signal: options.signal,
      headers: {
        Referer: 'https://google.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=604800',
      },
    });
    const html = await res.text();
    const doc = DomRegistry.parse(`<div>${html}</div>`);

    const units: IContentUnit[] = [];
    const items = doc.querySelectorAll('div > a');

    for (const item of items) {
      const href = item.getAttribute('href');
      if (!href || !href.includes('/chapters/')) continue;

      const titleEl = item.querySelector('span.grow.flex.items-center.gap-2 span');
      const title = titleEl?.textContent?.trim() || '';

      let chapterNumber = 0;
      const match = title.match(/Chapter\s+(\d+(\.\d+)?)/i);
      if (match) {
        chapterNumber = parseFloat(match[1]);
      } else {
        const numMatch = title.match(/(\d+(\.\d+)?)/);
        if (numMatch) {
          chapterNumber = parseFloat(numMatch[1]);
        }
      }

      const idMatch = href.match(/chapters\/([A-Z0-9]+)/i);

      if (idMatch) {
        units.push({
          id: idMatch[1],
          title: title,
          number: chapterNumber,
          availableLanguages: ['sub'],
        });
      }
    }

    return units.reverse();
  }

  protected async resolveStreamRaw(
    unitId: string,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const url = `${this.baseUrl}chapters/${unitId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
    const res = await this.http.get(url, {
      signal: options.signal,
      headers: {
        Referer: 'https://google.com',
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=604800',
      },
    });
    const html = await res.text();
    const doc = DomRegistry.parse(`<div>${html}</div>`);

    const imageUrls: string[] = [];
    const images = doc.querySelectorAll('img');

    for (const img of images) {
      const src = img.getAttribute('src');
      if (src) {
        imageUrls.push(src);
      }
    }

    return {
      type: 'manga',
      pages: {
        imageUrls,
        headers: {
          Referer: this.baseUrl,
          Accept: 'image/avif,image/webp,image/png,image/svg+xml,image/*;q=0.8,*/*;q=0.5',
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Connection: 'keep-alive',
          'Cache-Control': 'max-age=604800',
        },
      },
    };
  }
}
