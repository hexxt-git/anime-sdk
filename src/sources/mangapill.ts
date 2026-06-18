import { HttpClient } from '../internal/http.js';
import { DomRegistry } from '../internal/dom.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Chapter, Pages, List } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const BASE = 'https://mangapill.com';
const HEADERS = {
  Referer: BASE,
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Connection: 'keep-alive',
  'Cache-Control': 'max-age=604800',
};

export class MangapillSource implements Source {
  readonly id = 'mangapill';
  readonly kinds = ['manga'] as const;
  readonly caps = { search: true, chapters: true, pages: true, mapping: true } as const;
  readonly malsyncSites = ['Mangapill'] as const;

  constructor(private http: HttpClient) {}

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const res = await this.http.get(`${BASE}/search?q=${encodeURIComponent(query)}`, {
      signal: opts.signal,
      headers: { ...HEADERS, Accept: 'text/html,application/xhtml+xml' },
    });
    const doc = DomRegistry.parse(`<div>${await res.text()}</div>`);
    const out: Media[] = [];
    for (const item of doc.querySelectorAll('div.grid > div')) {
      const a = item.querySelector('a.mb-2');
      const titleEl = a?.querySelector('div');
      if (!a || !titleEl) continue;
      const href = a.getAttribute('href');
      const title = titleEl.textContent?.trim();
      const img = item.querySelector('img');
      const coverUrl = img?.getAttribute('data-src') || img?.getAttribute('src');
      if (href && title) {
        const rawId = href.startsWith('/') ? href.slice(1) : href;
        out.push({
          id: encodeId({ t: 'media', s: this.id, r: rawId }),
          kind: 'manga',
          title: { preferred: title },
          cover: coverUrl ? { url: coverUrl } : undefined,
          catalogues: [this.id],
          playbackSources: [this.id],
          mappings: { sources: { [this.id]: rawId } },
        });
      }
    }
    return out;
  }

  async chapters(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Chapter>> {
    const res = await this.http.get(`${BASE}/${mediaId}`, {
      signal: opts.signal,
      headers: HEADERS,
    });
    const doc = DomRegistry.parse(`<div>${await res.text()}</div>`);
    const items: Chapter[] = [];
    for (const item of doc.querySelectorAll('a.border')) {
      const href = item.getAttribute('href');
      if (!href || !href.includes('/chapters/')) continue;
      const title = item.textContent?.trim() || '';
      let num = 0;
      const m = title.match(/Chapter\s+(\d+(\.\d+)?)/i);
      if (m) num = parseFloat(m[1]);
      const rawId = href.startsWith('/') ? href.slice(1) : href;
      items.push({
        id: encodeId({ t: 'chapter', s: this.id, r: rawId }),
        mediaId: encodeId({ t: 'media', s: this.id, r: mediaId }),
        number: num,
        title,
        source: this.id,
      });
    }
    items.reverse();
    return { items };
  }

  async pages(chapterId: string, opts: SourceCallOpts): Promise<Pages> {
    const { r: rawId } = decodeId(chapterId);
    const res = await this.http.get(`${BASE}/${rawId}`, {
      signal: opts.signal,
      headers: HEADERS,
    });
    const doc = DomRegistry.parse(`<div>${await res.text()}</div>`);
    const pages = doc
      .querySelectorAll('.js-page')
      .map((img) => {
        const src = img.getAttribute('data-src') || img.getAttribute('src');
        return src ? { url: src, origin: { host: 'mangapill.com' } } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    return { pages, adjacent: {} };
  }

  async lookupByMapping(
    _mappings: Record<string, unknown>,
    _opts?: SourceCallOpts,
  ): Promise<string | null> {
    return null;
  }
}
