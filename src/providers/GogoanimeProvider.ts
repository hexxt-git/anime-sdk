import { BaseProvider, CallOptions } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import { GenericHlsExtractor } from '../extractors/GenericHlsExtractor.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  IVideoPayload,
} from '../types/index.js';

export interface GogoanimeOptions {
  baseUrl?: string;
}

export class GogoanimeProvider extends BaseProvider {
  public readonly id = 'gogoanime';
  public readonly supportedTypes: MediaCatalogType[] = ['ANIME'];
  private baseUrl = 'https://anineko.to';

  constructor(http: HttpClient, options: GogoanimeOptions = {}) {
    super(http);
    if (options.baseUrl) {
      this.baseUrl = options.baseUrl;
    }
    if (!this.http.getDefaultHeaders()['User-Agent']) {
      this.http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
    }
  }

  /**
   * Search for anime on AniNeko.
   */
  protected async searchRaw(
    query: string,
    options: CallOptions = {},
  ): Promise<IMediaSearchResult[]> {
    const searchUrl = `${this.baseUrl}/browser?keyword=${encodeURIComponent(query)}`;
    const response = await this.http.get(searchUrl, { signal: options.signal });
    if (response.status !== 200) {
      throw new Error(`GogoAnime search failed with status ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const results: IMediaSearchResult[] = [];

    const cards = doc.querySelectorAll('article.nv-anime-card');
    for (const card of cards) {
      const a = card.querySelector('h3.nv-anime-title a') || card.querySelector('a.nv-anime-thumb');
      if (!a) continue;

      const href = a.getAttribute('href') || '';
      if (!href) continue;

      const id = href.startsWith('/') ? href : `/${href}`;
      const title = a.getAttribute('title') || (a.textContent || '').trim();

      let thumbnailUrl = undefined;
      const img = card.querySelector('img');
      if (img) {
        const src = img.getAttribute('src') || '';
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
   * Fetch all content units (episodes) for a given AniNeko anime ID (e.g., "/watch/slug").
   */
  protected async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    let watchUrlPath = mediaId;
    // Normalize path to watch page if it is an episode URL
    if (mediaId.includes('/watch/')) {
      const parts = mediaId.split('/');
      // If path looks like /watch/slug/ep-1, we strip the ep part to get /watch/slug
      if (parts.length > 3) {
        watchUrlPath = `/${parts[1]}/${parts[2]}`;
      }
    } else {
      // Normalize to watch path format
      const slug = mediaId.startsWith('/') ? mediaId.substring(1) : mediaId;
      watchUrlPath = `/watch/${slug}`;
    }

    const fullUrl = `${this.baseUrl}${watchUrlPath.startsWith('/') ? '' : '/'}${watchUrlPath}`;
    const response = await this.http.get(fullUrl, { signal: options.signal });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch AniNeko watch page: ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);
    const episodeItems = doc.querySelectorAll('article.nv-info-episode-item');

    const units: IContentUnit[] = [];
    for (const item of episodeItems) {
      const a = item.querySelector('a.nv-info-episode-main');
      if (!a) continue;

      const href = a.getAttribute('href') || '';
      if (!href) continue;

      const strong = a.querySelector('strong');
      const span = a.querySelector('span');

      const numText = strong ? (strong.textContent || '').trim() : '';
      const titleText = span ? (span.textContent || '').trim() : '';

      const epMatch = href.match(/ep-(\d+(\.\d+)?)/);
      const number = epMatch ? parseFloat(epMatch[1]) : 0;

      const displayTitle = titleText ? `${numText} - ${titleText}` : numText || `Episode ${number}`;
      const id = href.startsWith('/') ? href : `/${href}`;

      units.push({
        id,
        title: displayTitle,
        number,
        availableLanguages: [mediaId.toLowerCase().includes('-dub') ? 'dub' : 'sub'],
      });
    }

    return units.sort((a, b) => a.number - b.number);
  }

  /**
   * Resolve playback stream for a specific content unit (episode) URL path.
   */
  protected async resolveStreamRaw(
    unitId: string,
    _language?: import('../types/index.js').ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const fullUrl = `${this.baseUrl}${unitId.startsWith('/') ? '' : '/'}${unitId}`;
    const response = await this.http.get(fullUrl, { signal: options.signal });
    if (response.status !== 200) {
      throw new Error(`Failed to fetch AniNeko episode page: ${response.status}`);
    }

    const html = await response.text();
    const doc = DomRegistry.parse(html);

    // Find all server buttons containing video URLs
    const serverButtons = doc.querySelectorAll('button.nv-server-btn');
    const streams: IVideoPayload[] = [];

    for (const btn of serverButtons) {
      const videoUrl = btn.getAttribute('data-video');
      if (!videoUrl) continue;

      // Extract server label and tab context
      const labelText = (btn.textContent || '').replace(/\s+/g, ' ').trim();
      const tabId = btn.getAttribute('data-tab') || '';

      // Determine quality or translation status (SUB vs DUB)
      let qualityLabel: '1080p' | '720p' | '360p' | 'auto' = 'auto';
      if (labelText.toLowerCase().includes('1080')) qualityLabel = '1080p';
      else if (labelText.toLowerCase().includes('720')) qualityLabel = '720p';
      else if (labelText.toLowerCase().includes('360')) qualityLabel = '360p';

      let absoluteVideoUrl = videoUrl;
      if (videoUrl.startsWith('//')) {
        absoluteVideoUrl = 'https:' + videoUrl;
      } else if (videoUrl.startsWith('/')) {
        absoluteVideoUrl = this.baseUrl.replace(/\/$/, '') + videoUrl;
      }

      streams.push({
        sourceUrl: absoluteVideoUrl,
        isHLS: absoluteVideoUrl.includes('.m3u8'),
        quality: qualityLabel,
        headers: {
          Referer: fullUrl,
          'User-Agent': this.http.getDefaultHeaders()['User-Agent'] || '',
        },
      });
    }

    if (streams.length === 0) {
      throw new Error(`No server video streams found on AniNeko episode page: ${unitId}`);
    }

    // Resolve embed URLs to direct streams — try sequentially, stop on first success
    const extractor = new GenericHlsExtractor(this.http);
    let resolved: IVideoPayload[] = [];
    for (const embed of streams) {
      try {
        const extracted = await extractor.extract(embed.sourceUrl);
        if (extracted.length > 0) {
          resolved = extracted;
          break;
        }
      } catch {
        /* try next */
      }
    }

    return {
      type: 'video',
      streams: resolved.length > 0 ? resolved : streams,
    };
  }
}
