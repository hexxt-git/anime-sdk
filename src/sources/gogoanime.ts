import { HttpClient } from '../internal/http.js';
import { DomRegistry } from '../internal/dom.js';
import { GenericHlsExtractor } from '../extractors/GenericHlsExtractor.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Episode, Stream, List } from '../types.js';
import type { IVideoPayload } from '../types/index.js';
import type { Source, SourceCallOpts } from './base.js';

export class GogoanimeSource implements Source {
  readonly id = 'gogoanime';
  readonly kinds = ['anime'] as const;
  readonly caps = { search: true, episodes: true, stream: true } as const;

  private baseUrl: string;

  constructor(
    private http: HttpClient,
    baseUrl = 'https://anineko.to',
  ) {
    this.baseUrl = baseUrl;
    if (!http.getDefaultHeaders()['User-Agent']) {
      http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
    }
  }

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const res = await this.http.get(
      `${this.baseUrl}/browser?keyword=${encodeURIComponent(query)}`,
      { signal: opts.signal },
    );
    if (res.status !== 200) throw new Error(`Gogoanime search failed: ${res.status}`);
    const html = await res.text();
    const doc = DomRegistry.parse(html);
    const out: Media[] = [];
    for (const card of doc.querySelectorAll('article.nv-anime-card')) {
      const a = card.querySelector('h3.nv-anime-title a') || card.querySelector('a.nv-anime-thumb');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      const id = href.startsWith('/') ? href : `/${href}`;
      const title = a.getAttribute('title') || (a.textContent || '').trim();
      const img = card.querySelector('img');
      const src = img?.getAttribute('src') ?? '';
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
        catalogues: [this.id],
        playbackSources: [this.id],
        mappings: { sources: { [this.id]: id } },
      });
    }
    return out;
  }

  async episodes(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    let watchUrlPath = mediaId;
    if (mediaId.includes('/watch/')) {
      const parts = mediaId.split('/');
      if (parts.length > 3) watchUrlPath = `/${parts[1]}/${parts[2]}`;
    } else {
      const slug = mediaId.startsWith('/') ? mediaId.substring(1) : mediaId;
      watchUrlPath = `/watch/${slug}`;
    }
    const fullUrl = `${this.baseUrl}${watchUrlPath.startsWith('/') ? '' : '/'}${watchUrlPath}`;
    const res = await this.http.get(fullUrl, { signal: opts.signal });
    if (res.status !== 200) throw new Error(`Gogoanime episodes failed: ${res.status}`);
    const doc = DomRegistry.parse(await res.text());
    const items: Episode[] = [];
    for (const item of doc.querySelectorAll('article.nv-info-episode-item')) {
      const a = item.querySelector('a.nv-info-episode-main');
      if (!a) continue;
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      const epId = href.startsWith('/') ? href : `/${href}`;
      const strong = a.querySelector('strong');
      const span = a.querySelector('span');
      const numText = strong ? (strong.textContent || '').trim() : '';
      const titleText = span ? (span.textContent || '').trim() : '';
      const epMatch = href.match(/ep-(\d+(\.\d+)?)/);
      const number = epMatch ? parseFloat(epMatch[1]) : 0;
      const displayTitle = titleText ? `${numText} - ${titleText}` : numText || `Episode ${number}`;
      items.push({
        id: encodeId({ t: 'episode', s: this.id, r: epId }),
        mediaId: encodeId({ t: 'media', s: this.id, r: mediaId }),
        number,
        title: displayTitle,
        languages: [mediaId.toLowerCase().includes('-dub') ? 'dub' : 'sub'],
        qualities: ['auto'],
        source: this.id,
      });
    }
    items.sort((a, b) => a.number - b.number);
    return { items };
  }

  async stream(episodeId: string, opts: SourceCallOpts): Promise<Stream> {
    const { r: rawUnit } = decodeId(episodeId);
    const fullUrl = `${this.baseUrl}${rawUnit.startsWith('/') ? '' : '/'}${rawUnit}`;
    const res = await this.http.get(fullUrl, { signal: opts.signal });
    if (res.status !== 200) throw new Error(`Gogoanime stream failed: ${res.status}`);
    const doc = DomRegistry.parse(await res.text());
    const embeds: IVideoPayload[] = [];
    for (const btn of doc.querySelectorAll('button.nv-server-btn')) {
      const videoUrl = btn.getAttribute('data-video');
      if (!videoUrl) continue;
      let absoluteUrl = videoUrl;
      if (videoUrl.startsWith('//')) absoluteUrl = 'https:' + videoUrl;
      else if (videoUrl.startsWith('/')) absoluteUrl = this.baseUrl.replace(/\/$/, '') + videoUrl;
      const label = (btn.textContent || '').toLowerCase();
      let quality: IVideoPayload['quality'] = 'auto';
      if (label.includes('1080')) quality = '1080p';
      else if (label.includes('720')) quality = '720p';
      else if (label.includes('360')) quality = '360p';
      embeds.push({
        sourceUrl: absoluteUrl,
        isHLS: absoluteUrl.includes('.m3u8'),
        quality,
        headers: { Referer: fullUrl },
      });
    }
    if (embeds.length === 0) throw new Error(`Gogoanime: no server buttons on ${rawUnit}`);
    const extractor = new GenericHlsExtractor(this.http);
    let resolved: IVideoPayload[] = [];
    for (const embed of embeds) {
      try {
        const extracted = await extractor.extract(embed.sourceUrl);
        if (extracted.length > 0) {
          resolved = extracted;
          break;
        }
      } catch {}
    }
    const payloads = resolved.length > 0 ? resolved : embeds;
    const primary = payloads[0];
    let host = '';
    try {
      host = new URL(primary.sourceUrl).hostname;
    } catch {}
    return {
      url: primary.sourceUrl,
      origin: { host, url: primary.sourceUrl, proxied: false },
      isHls: primary.isHLS,
      qualities: payloads.map((p) => ({ label: p.quality, url: p.sourceUrl })),
      language: 'sub',
      subtitles: [],
      headers: primary.headers,
      adjacent: {},
    };
  }
}
