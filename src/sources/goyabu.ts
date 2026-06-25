import { HttpClient } from '../internal/http.js';
import { DomRegistry } from '../internal/dom.js';
import { BloggerExtractor } from '../extractors/BloggerExtractor.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Episode, Stream, List } from '../types.js';
import type { IVideoPayload } from '../types/index.js';
import type { Source, SourceCallOpts } from './base.js';

export class GoyabuSource implements Source {
  readonly id = 'goyabu';
  readonly kinds = ['anime'] as const;
  readonly caps = { search: true, episodes: true, stream: true } as const;

  private baseUrl: string;
  private bloggerExtractor: BloggerExtractor;

  constructor(
    private http: HttpClient,
    baseUrl = 'https://goyabu.io',
  ) {
    this.baseUrl = baseUrl;
    this.bloggerExtractor = new BloggerExtractor(http);
  }

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const normalized = query.trim().replace(/[-_]/g, ' ');
    const res = await this.http.get(`${this.baseUrl}/?s=${encodeURIComponent(normalized)}`, {
      signal: opts.signal,
    });
    if (res.status !== 200) throw new Error(`Goyabu search failed: ${res.status}`);
    const doc = DomRegistry.parse(await res.text());
    const out: Media[] = [];
    const cards = doc.querySelectorAll('article.boxAN') || doc.querySelectorAll('article');
    for (const card of cards) {
      const a = card.querySelector('a');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      if (!href || !href.includes('/anime/')) continue;
      const id = href.startsWith('http') ? new URL(href).pathname : href;
      const titleElem =
        card.querySelector('.title') || card.querySelector('h3') || card.querySelector('h2');
      let title = titleElem ? (titleElem.textContent || '').trim() : '';
      const img = card.querySelector('img');
      if (!title && img)
        title = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
      if (!title) continue;
      const src = img?.getAttribute('src') || img?.getAttribute('data-src') || '';
      const coverUrl = src
        ? src.startsWith('http')
          ? src
          : `${this.baseUrl}${src.startsWith('/') ? '' : '/'}${src}`
        : undefined;
      out.push({
        id: encodeId({ t: 'media', s: this.id, r: id }),
        kind: 'anime',
        title: { preferred: title },
        cover: coverUrl ? { url: coverUrl } : undefined,
        source: this.id,
        mappings: {},
      });
    }
    return out;
  }

  async episodes(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const fullUrl = `${this.baseUrl}${mediaId.startsWith('/') ? '' : '/'}${mediaId}`;
    const res = await this.http.get(fullUrl, { signal: opts.signal });
    if (res.status !== 200) throw new Error(`Goyabu episodes failed: ${res.status}`);
    const html = await res.text();
    const items: Episode[] = [];
    const patterns = [
      /(?:const|let|var)\s+allEpisodes\s*=\s*(\[[\s\S]*?\])\s*;/i,
      /episodes\s*[:=]\s*(\[[\s\S]*?\])/i,
      /"episodes"\s*:\s*(\[[\s\S]*?\])/i,
    ];
    let parsed = false;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;
      try {
        let cleaned = match[1].replace(/([,{\[\s]|^)(\w+)\s*:/g, '$1"$2":');
        cleaned = cleaned.replace(/'/g, '"').replace(/,\s*([\}\]])/g, '$1');
        const epData = JSON.parse(cleaned);
        if (Array.isArray(epData)) {
          for (let i = 0; i < epData.length; i++) {
            const ep = epData[i];
            const num = ep.episodio ? parseFloat(ep.episodio) : i + 1;
            const link = ep.link || (ep.id ? `/${ep.id}` : ep.ID ? `/${ep.ID}` : '');
            if (!link) continue;
            items.push({
              id: encodeId({ t: 'episode', s: this.id, r: link }),
              number: num,
              title: ep.episode_name ? `Episódio ${num}: ${ep.episode_name}` : `Episódio ${num}`,
              languages: [mediaId.toLowerCase().includes('dublado') ? 'dub' : 'sub'],
            });
          }
          parsed = true;
          break;
        }
      } catch {}
    }
    if (!parsed) {
      const doc = DomRegistry.parse(html);
      for (const a of doc.querySelectorAll('a')) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;
        if (!href.includes('/?p=') && !href.includes('/episode/')) continue;
        if (!href.includes(this.baseUrl) && !href.startsWith('/')) continue;
        const num = items.length + 1;
        const id = href.startsWith('http') ? new URL(href).pathname + new URL(href).search : href;
        items.push({
          id: encodeId({ t: 'episode', s: this.id, r: id }),
          number: num,
          title: `Episódio ${num}`,
          languages: ['sub'],
        });
      }
    }
    items.sort((a, b) => a.number - b.number);
    return { items };
  }

  async stream(episodeId: string, opts: SourceCallOpts): Promise<Stream[]> {
    const { r: rawUnit } = decodeId(episodeId);
    const fullUrl = `${this.baseUrl}${rawUnit.startsWith('/') ? '' : '/'}${rawUnit}`;
    const res = await this.http.get(fullUrl, { signal: opts.signal });
    if (res.status !== 200) throw new Error(`Goyabu stream page failed: ${res.status}`);
    const html = await res.text();

    const bloggerUrls = this.collectBloggerUrls(html);
    const payloads: IVideoPayload[] = [];
    for (const url of bloggerUrls) {
      try {
        const extracted = await this.bloggerExtractor.extract(url);
        payloads.push(...extracted);
      } catch {}
    }
    if (payloads.length === 0) {
      payloads.push(...this.scrapeDirectStreams(html, fullUrl));
    }
    if (payloads.length === 0) throw new Error(`Goyabu: no playable streams for ${rawUnit}`);
    const lang = rawUnit.toLowerCase().includes('dublado') ? 'dub' : 'sub';
    return payloads.map((p): Stream => {
      let server = 'goyabu';
      try {
        server = new URL(p.sourceUrl).hostname;
      } catch {}
      return {
        url: p.sourceUrl,
        source: this.id,
        server,
        quality: p.quality,
        language: lang,
        isHls: p.isHLS,
        headers: p.headers,
        subtitles: [],
      };
    });
  }

  private collectBloggerUrls(html: string): string[] {
    const urls = new Set<string>();
    const m = html.match(/playersData\s*=\s*(\[[\s\S]*?\])\s*;/i);
    if (m) {
      try {
        const cleaned = m[1].replace(/\\\//g, '/');
        const players = JSON.parse(cleaned);
        if (Array.isArray(players)) {
          for (const p of players) {
            if (typeof p?.url === 'string' && p.url.includes('blogger.com/video.g'))
              urls.add(p.url);
          }
        }
      } catch {}
    }
    const re = /https?:(?:\\\/|\/)\/www\.blogger\.com\/video\.g\?token=[A-Za-z0-9_-]+/g;
    let match: RegExpExecArray | null;
    while ((match = re.exec(html)) !== null) urls.add(match[0].replace(/\\\//g, '/'));
    return Array.from(urls);
  }

  private scrapeDirectStreams(html: string, refererUrl: string): IVideoPayload[] {
    const out: IVideoPayload[] = [];
    const seen = new Set<string>();
    const patterns: Array<[RegExp, IVideoPayload['quality']]> = [
      [/"file"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i, 'auto'],
      [/"file"\s*:\s*"(https?:\/\/[^"]+?\.mp4[^"]*)"/i, 'auto'],
      [/src\s*[:=]\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i, 'auto'],
    ];
    for (const [re, q] of patterns) {
      const m = html.match(re);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({
          sourceUrl: m[1],
          isHLS: m[1].includes('.m3u8'),
          quality: q,
          headers: { Referer: refererUrl },
        });
      }
    }
    return out;
  }
}
