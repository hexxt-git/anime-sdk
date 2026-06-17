import { BaseProvider, CallOptions } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import {
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
  IVideoPayload,
  ISubtitleTrack,
} from '../types/index.js';

export class AnikotoProvider extends BaseProvider {
  public override readonly id = 'anikoto';
  public readonly name = 'Anikoto';
  public override readonly supportedTypes: MediaCatalogType[] = ['ANIME'];

  private readonly baseUrl = 'https://anikototv.to';
  private readonly apiUrl = 'https://anikotoapi.site';

  constructor(http: HttpClient) {
    super(http);
    if (!this.http.getDefaultHeaders()['User-Agent']) {
      this.http.setUserAgent(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      );
    }
  }

  protected override async searchRaw(
    query: string,
    options: CallOptions = {},
  ): Promise<IMediaSearchResult[]> {
    const response = await this.http.get(
      `${this.baseUrl}/filter?keyword=${encodeURIComponent(query)}`,
      { signal: options.signal },
    );
    const html = await response.text();
    const dom = DomRegistry.parse(html);

    // Target only the main content items to avoid sidebar "top rated" results
    const items = dom.querySelectorAll('.main .item');

    return items
      .map((item): IMediaSearchResult => {
        const titleEl = item.querySelector('.name');
        const posterEl = item.querySelector('.poster');
        const id = posterEl?.getAttribute('data-tip') || '';

        return {
          id,
          title: titleEl?.textContent?.trim() || '',
          thumbnailUrl: item.querySelector('img')?.getAttribute('src') || undefined,
          catalogType: 'ANIME',
          providerId: this.id,
        };
      })
      .filter((res) => res.id !== '');
  }

  protected override async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    const response = await this.http.get(`${this.apiUrl}/series/${mediaId}`, {
      signal: options.signal,
    });
    const json = (await response.json()) as any;

    if (!json.ok || !json.data || !json.data.episodes) {
      return [];
    }

    const episodes = json.data.episodes;

    return episodes.map((ep: any) => {
      const languages: ContentLanguage[] = [];
      if (ep.embed_url.sub) languages.push('sub');
      if (ep.embed_url.dub) languages.push('dub');

      return {
        id: ep.episode_embed_id,
        title: ep.title || `Episode ${ep.number}`,
        number: ep.number,
        availableLanguages: languages,
      };
    });
  }

  protected override async resolveStreamRaw(
    unitId: string,
    language: ContentLanguage = 'sub',
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const embedUrl = `https://megaplay.buzz/stream/s-2/${unitId}/${language}`;

    // Step 1: Fetch the embed page to get the file ID
    const embedResponse = await this.http.get(embedUrl, {
      signal: options.signal,
      headers: {
        Referer: this.baseUrl,
      },
    });
    const embedPage = await embedResponse.text();

    // The file ID is usually in the title: <title>File 174608 - MegaPlay</title>
    const fileIdMatch = embedPage.match(/File\s+(\d+)\s+-/);
    if (!fileIdMatch) {
      throw new Error('Could not find file ID on megaplay embed page');
    }
    const fileId = fileIdMatch[1];

    // Step 2: Fetch the sources using the file ID
    const sourcesResponse = await this.http.get(
      `https://megaplay.buzz/stream/getSources?id=${fileId}`,
      {
        signal: options.signal,
        headers: {
          Referer: `https://megaplay.buzz/stream/s-5/${unitId}/${language}`,
          'X-Requested-With': 'XMLHttpRequest',
        },
      },
    );

    const sourcesJson = (await sourcesResponse.json()) as any;
    if (!sourcesJson.sources || !sourcesJson.sources.file) {
      throw new Error('No video sources found in megaplay response');
    }

    const streams: IVideoPayload[] = [
      {
        sourceUrl: sourcesJson.sources.file,
        isHLS: sourcesJson.sources.file.includes('.m3u8'),
        quality: 'auto',
        language,
        headers: {
          Referer: 'https://megaplay.buzz/',
        },
      },
    ];

    const subtitles: ISubtitleTrack[] = (sourcesJson.tracks || [])
      .filter((t: any) => t.kind === 'captions')
      .map((t: any) => ({
        url: t.file,
        label: t.label,
        language: t.label.toLowerCase(),
        format: t.file.endsWith('.vtt') ? 'vtt' : 'srt',
      }));

    if (subtitles.length > 0) {
      streams[0].subtitles = subtitles;
    }

    return {
      type: 'video',
      streams,
    };
  }
}
