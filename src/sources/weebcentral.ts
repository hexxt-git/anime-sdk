import { HttpClient } from '../internal/http.js';
import { DomRegistry } from '../internal/dom.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Chapter, Pages, List } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const BASE = 'https://weebcentral.com/';
const HEADERS = {
  Referer: 'https://google.com',
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Connection: 'keep-alive',
  'Cache-Control': 'max-age=604800',
};

export class WeebcentralSource implements Source {
  readonly id = 'weebcentral';
  readonly kinds = ['manga'] as const;
  readonly caps = { search: true, chapters: true, pages: true, mapping: true } as const;
  readonly malsyncSites = ['Weebcentral', 'WeebCentral'] as const;

  constructor(private http: HttpClient) {}

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const url = `${BASE}search/data?text=${encodeURIComponent(query)}&limit=24&offset=0&sort=Best+Match&order=Descending&official=Any&anime=Any&adult=Any&display_mode=Full+Display`;
    const res = await this.http.get(url, { signal: opts.signal, headers: HEADERS });
    const doc = DomRegistry.parse(`<div>${await res.text()}</div>`);
    const out: Media[] = [];
    for (const item of doc.querySelectorAll('article.bg-base-300')) {
      const a = item.querySelector('a.line-clamp-1');
      if (!a) continue;
      const href = a.getAttribute('href');
      const title = a.textContent?.trim();
      const coverUrl = item.querySelector('source')?.getAttribute('srcset') ?? undefined;
      if (href && title) {
        const idMatch = href.match(/series\/([A-Z0-9]+)/i);
        if (idMatch) {
          out.push({
            id: encodeId({ t: 'media', s: this.id, r: idMatch[1] }),
            kind: 'manga',
            title: { preferred: title },
            cover: coverUrl ? { url: coverUrl } : undefined,
            source: this.id,
            mappings: {},
          });
        }
      }
    }
    return out;
  }

  async chapters(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Chapter>> {
    const url = `${BASE}series/${mediaId}/full-chapter-list`;
    const res = await this.http.get(url, { signal: opts.signal, headers: HEADERS });
    const doc = DomRegistry.parse(`<div>${await res.text()}</div>`);
    const items: Chapter[] = [];
    for (const item of doc.querySelectorAll('div > a')) {
      const href = item.getAttribute('href');
      if (!href || !href.includes('/chapters/')) continue;
      const titleEl = item.querySelector('span.grow.flex.items-center.gap-2 span');
      const title = titleEl?.textContent?.trim() || '';
      let num = 0;
      const m = title.match(/Chapter\s+(\d+(\.\d+)?)/i) || title.match(/(\d+(\.\d+)?)/);
      if (m) num = parseFloat(m[1]);
      const idMatch = href.match(/chapters\/([A-Z0-9]+)/i);
      if (idMatch) {
        items.push({
          id: encodeId({ t: 'chapter', s: this.id, r: idMatch[1] }),
          number: num,
          title,
        });
      }
    }
    items.reverse();
    return { items };
  }

  async pages(chapterId: string, opts: SourceCallOpts): Promise<Pages> {
    const { r: rawId } = decodeId(chapterId);
    const url = `${BASE}chapters/${rawId}/images?is_prev=False&current_page=1&reading_style=long_strip`;
    const res = await this.http.get(url, { signal: opts.signal, headers: HEADERS });
    const doc = DomRegistry.parse(`<div>${await res.text()}</div>`);
    const pages = doc
      .querySelectorAll('img')
      .map((img) => {
        const src = img.getAttribute('src') ?? '';
        return src ? { url: src } : null;
      })
      .filter((p): p is NonNullable<typeof p> => p !== null);
    return { pages };
  }

  async lookupByMapping(
    _mappings: Record<string, unknown>,
    _opts?: SourceCallOpts,
  ): Promise<string | null> {
    return null;
  }
}
