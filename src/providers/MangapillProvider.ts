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

export class MangapillProvider extends BaseProvider {
  readonly id = 'mangapill';
  readonly supportedTypes: MediaCatalogType[] = ['MANGA'];
  public static override readonly malsyncSites = ['Mangapill'] as const;

  private readonly baseUrl = 'https://mangapill.com';

  constructor(http: HttpClient) {
    super(http);
  }

  protected async searchRaw(
    query: string,
    options: CallOptions = {},
  ): Promise<IMediaSearchResult[]> {
    const url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}`;

    const res = await this.http.get(url, {
      signal: options.signal,
      headers: {
        Referer: this.baseUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept:
          'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        Connection: 'keep-alive',
      },
    });
    const html = await res.text();
    const doc = DomRegistry.parse(`<div>${html}</div>`);

    const results: IMediaSearchResult[] = [];

    const items = doc.querySelectorAll('div.grid > div');
    for (const item of items) {
      const a = item.querySelector('a.mb-2');
      const img = item.querySelector('img');
      const titleEl = a?.querySelector('div');

      if (!a || !titleEl) continue;

      const href = a.getAttribute('href');
      const title = titleEl.textContent?.trim();
      const coverUrl = img?.getAttribute('data-src') || img?.getAttribute('src');

      if (href && title) {
        results.push({
          id: href.startsWith('/') ? href.slice(1) : href,
          title: title,
          thumbnailUrl: coverUrl || undefined,
          catalogType: 'MANGA',
          providerId: this.id,
          availableLanguages: ['sub'],
        });
      }
    }

    return results;
  }

  protected async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    const url = `${this.baseUrl}/${mediaId}`;
    const res = await this.http.get(url, {
      signal: options.signal,
      headers: {
        Referer: this.baseUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=604800',
      },
    });
    const html = await res.text();
    const doc = DomRegistry.parse(`<div>${html}</div>`);

    const units: IContentUnit[] = [];
    const items = doc.querySelectorAll('a.border');

    for (const item of items) {
      const href = item.getAttribute('href');
      if (!href || !href.includes('/chapters/')) continue;

      const title = item.textContent?.trim() || '';

      let chapterNumber = 0;
      const match = title.match(/Chapter\s+(\d+(\.\d+)?)/i);
      if (match) {
        chapterNumber = parseFloat(match[1]);
      }

      units.push({
        id: href.startsWith('/') ? href.slice(1) : href,
        title: title,
        number: chapterNumber,
        availableLanguages: ['sub'],
      });
    }

    return units.reverse();
  }

  protected async resolveStreamRaw(
    unitId: string,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const url = `${this.baseUrl}/${unitId}`;
    const res = await this.http.get(url, {
      signal: options.signal,
      headers: {
        Referer: this.baseUrl,
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Connection: 'keep-alive',
        'Cache-Control': 'max-age=604800',
      },
    });
    const html = await res.text();
    const doc = DomRegistry.parse(`<div>${html}</div>`);

    const imageUrls: string[] = [];
    const images = doc.querySelectorAll('.js-page');

    for (const img of images) {
      const src = img.getAttribute('data-src') || img.getAttribute('src');
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
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Accept: 'image/avif,image/webp,image/apng,*/*;q=0.8',
          Connection: 'keep-alive',
          Host: 'mangapill.com',
        },
      },
    };
  }
}
