import { BaseProvider, CallOptions } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import { BloggerExtractor } from '../extractors/BloggerExtractor.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IVideoPayload,
} from '../types/index.js';

export interface GoyabuOptions {
  baseUrl?: string;
}

export class GoyabuProvider extends BaseProvider {
  public readonly id = 'goyabu';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];
  private baseUrl = 'https://goyabu.io';
  private bloggerExtractor: BloggerExtractor;

  constructor(http: HttpClient, options: GoyabuOptions = {}) {
    super(http);
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
    if (!this.http.getDefaultHeaders()['User-Agent']) {
      this.http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
    }
    this.bloggerExtractor = new BloggerExtractor(http);
  }

  /**
   * Search for anime on Goyabu.
   * Leverages the HTML search fallback method.
   */
  protected async searchRaw(
    query: string,
    options: CallOptions = {},
  ): Promise<IMediaSearchResult[]> {
    // Replace spaces, hyphens and underscores with plus for search query formatting
    const normalized = query.trim().replace(/[-_]/g, ' ');
    const searchUrl = `${this.baseUrl}/?s=${encodeURIComponent(normalized)}`;

    const response = await this.http.get(searchUrl, { signal: options.signal });
    if (response.status !== 200) {
      throw new Error(`Goyabu search failed with status ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const results: IMediaSearchResult[] = [];

    // Select article search cards
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
      if (!title && img) {
        title = (img.getAttribute('alt') || img.getAttribute('title') || '').trim();
      }

      if (!title) continue;

      let thumbnailUrl = undefined;
      if (img) {
        const src = img.getAttribute('src') || img.getAttribute('data-src') || '';
        if (src) {
          thumbnailUrl = src.startsWith('http')
            ? src
            : `${this.baseUrl}${src.startsWith('/') ? '' : '/'}${src}`;
        }
      }

      results.push({
        id,
        title,
        thumbnailUrl,
        catalogType: 'ANIME',
        providerId: this.id,
      });
    }

    return results;
  }

  /**
   * Fetch all content units (episodes) for a given Goyabu anime URL slug (e.g. "/anime/...").
   */
  protected async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    const fullUrl = `${this.baseUrl}${mediaId.startsWith('/') ? '' : '/'}${mediaId}`;
    const response = await this.http.get(fullUrl, { signal: options.signal });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch Goyabu details page: ${response.status}`);
    }

    const html = await response.text();
    const units: IContentUnit[] = [];

    // Regex patterns matching JavaScript array of episodes
    const patterns = [
      /(?:const|let|var)\s+allEpisodes\s*=\s*(\[[\s\S]*?\])\s*;/i,
      /episodes\s*[:=]\s*(\[[\s\S]*?\])/i,
      /"episodes"\s*:\s*(\[[\s\S]*?\])/i,
      /episodeList\s*[:=]\s*(\[[\s\S]*?\])/i,
      /episodios\s*[:=]\s*(\[[\s\S]*?\])/i,
    ];

    let foundArray = false;
    for (const pattern of patterns) {
      const match = html.match(pattern);
      if (!match) continue;

      try {
        const jsonStr = match[1];
        // Clean possible unquoted keys ({id:1} -> {"id":1}) or single quotes
        let cleaned = jsonStr.replace(/([,{\[\s]|^)(\w+)\s*:/g, '$1"$2":');
        cleaned = cleaned.replace(/'/g, '"');

        // Remove trailing commas before closing braces if any (JSON strict parsing)
        cleaned = cleaned.replace(/,\s*([\}\]])/g, '$1');

        const epData = JSON.parse(cleaned);
        if (Array.isArray(epData)) {
          for (let i = 0; i < epData.length; i++) {
            const ep = epData[i];
            const num = ep.episodio ? parseFloat(ep.episodio) : i + 1;
            // Goyabu's episode array exposes a `link` field that's a relative
            // path (e.g. "/40742"); use it directly when present.
            const link = ep.link || (ep.id ? `/${ep.id}` : ep.ID ? `/${ep.ID}` : '');
            if (!link) continue;

            units.push({
              id: link,
              title: ep.episode_name ? `Episódio ${num}: ${ep.episode_name}` : `Episódio ${num}`,
              number: num,
              availableLanguages: [mediaId.toLowerCase().includes('dublado') ? 'dub' : 'sub'],
            });
          }
          foundArray = true;
          break;
        }
      } catch (err) {
        // Fallback to next match
      }
    }

    // Fallback: parse static anchor tags from the details HTML page
    if (!foundArray || units.length === 0) {
      const doc = DomRegistry.parse(html);
      const anchors = doc.querySelectorAll('a');
      for (const a of anchors) {
        const href = a.getAttribute('href') || '';
        if (!href) continue;

        if (!href.includes('/?p=') && !href.includes('/episode/')) continue;
        if (!href.includes(this.baseUrl) && !href.startsWith('/')) continue;

        const epNumAttr = a.getAttribute('data-episode-number');
        const num = epNumAttr ? parseFloat(epNumAttr) : units.length + 1;

        const id = href.startsWith('http') ? new URL(href).pathname + new URL(href).search : href;

        units.push({
          id,
          title: `Episódio ${num}`,
          number: num,
          availableLanguages: [mediaId.toLowerCase().includes('dublado') ? 'dub' : 'sub'],
        });
      }
    }

    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Resolve playback stream for a specific Goyabu content unit path.
   *
   * Goyabu wraps all streams in a Blogger video embed (`playersData[].url`
   * points at `blogger.com/video.g?token=...`). We use BloggerExtractor to
   * call Google's batchexecute API and get back the actual googlevideo.com
   * URLs.
   */
  protected async resolveStreamRaw(
    unitId: string,
    _language?: import('../types/index.js').ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const fullUrl = `${this.baseUrl}${unitId.startsWith('/') ? '' : '/'}${unitId}`;
    const response = await this.http.get(fullUrl, { signal: options.signal });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch Goyabu episode page: ${response.status}`);
    }

    const html = await response.text();
    const videoSources: IVideoPayload[] = [];

    // Pull Blogger URLs from `playersData = [...]`
    const bloggerUrls = this.collectBloggerUrls(html);
    const errors: string[] = [];
    for (const url of bloggerUrls) {
      try {
        const extracted = await this.bloggerExtractor.extract(url);
        if (extracted.length === 0) {
          errors.push(`${url.slice(0, 80)}: Extractor returned 0 results without error`);
        } else {
          videoSources.push(...extracted);
        }
      } catch (e) {
        errors.push(`${url.slice(0, 80)}: ${(e as Error).message}`);
      }
    }

    // Fallback: also accept any direct mp4/m3u8 sitting in the page itself.
    if (videoSources.length === 0) {
      const direct = this.scrapeDirectStreams(html, fullUrl);
      videoSources.push(...direct);
    }

    if (videoSources.length === 0) {
      throw new Error(
        `Goyabu: no playable streams for ${unitId}. ` +
          (bloggerUrls.length > 0
            ? `Tried ${bloggerUrls.length} Blogger URL(s). Errors: ${errors.join('; ')}`
            : 'No Blogger URLs found on the episode page.'),
      );
    }

    return { type: 'video', streams: videoSources };
  }

  private collectBloggerUrls(html: string): string[] {
    const urls = new Set<string>();

    // The HTML embeds playersData as JS literal containing JSON-with-escaped-slashes:
    //   playersData = [{"name":"Blog","url":"https:\/\/www.blogger.com\/video.g?token=..."}]
    const playersMatch = html.match(/playersData\s*=\s*(\[[\s\S]*?\])\s*;/i);
    if (playersMatch) {
      try {
        const cleaned = playersMatch[1].replace(/\\\//g, '/');
        const players = JSON.parse(cleaned);
        if (Array.isArray(players)) {
          for (const p of players) {
            if (typeof p?.url === 'string' && p.url.includes('blogger.com/video.g')) {
              urls.add(p.url);
            }
          }
        }
      } catch {
        /* fall through to regex */
      }
    }

    // Fallback: raw scan
    const re = /https?:(?:\\\/|\/)\/www\.blogger\.com\/video\.g\?token=[A-Za-z0-9_-]+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html)) !== null) {
      urls.add(m[0].replace(/\\\//g, '/'));
    }
    return Array.from(urls);
  }

  private scrapeDirectStreams(html: string, refererUrl: string): IVideoPayload[] {
    const out: IVideoPayload[] = [];
    const seen = new Set<string>();
    const mapQuality = (label: string): IVideoPayload['quality'] => {
      const s = label.toLowerCase();
      if (s.includes('1080')) return '1080p';
      if (s.includes('720')) return '720p';
      if (s.includes('480')) return '480p';
      if (s.includes('360')) return '360p';
      return 'auto';
    };

    const patterns: Array<[RegExp, IVideoPayload['quality']]> = [
      [/"file"\s*:\s*"(https?:\/\/[^"]+?\.m3u8[^"]*)"/i, 'auto'],
      [/"file"\s*:\s*"(https?:\/\/[^"]+?\.mp4[^"]*)"/i, 'auto'],
      [/src\s*[:=]\s*["'](https?:\/\/[^"']+?\.m3u8[^"']*)["']/i, 'auto'],
      [/src\s*[:=]\s*["'](https?:\/\/[^"']+?\.mp4[^"']*)["']/i, 'auto'],
    ];
    for (const [re, q] of patterns) {
      const m = html.match(re);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        out.push({
          sourceUrl: m[1],
          isHLS: m[1].includes('.m3u8'),
          quality: mapQuality(q),
          headers: { Referer: refererUrl },
        });
      }
    }
    return out;
  }
}
