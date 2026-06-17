import { BaseProvider, CallOptions } from './BaseProvider.js';
import { HttpClient } from '../transport/http.js';
import { DomRegistry } from '../transport/dom.js';
import {
  IMediaSearchResult,
  IContentUnit,
  IMediaMappings,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
  IVideoPayload,
  ISubtitleTrack,
} from '../types/index.js';

export interface MegaPlayOptions {
  baseUrl?: string;
}

export class MegaPlayProvider extends BaseProvider {
  public override readonly id = 'megaplay';
  public readonly name = 'MegaPlay';
  public override readonly supportedTypes: MediaCatalogType[] = ['ANIME'];

  /**
   * MegaPlay indexes its catalogue by AniList ID directly — its internal
   * `mediaId` IS the AniList ID. Surface that to `MappingClient` so it
   * can skip MALSync/Anify/fuzzy entirely when the meta record knows the
   * AniList ID.
   */
  public override async lookupByMapping(mappings: IMediaMappings): Promise<string | null> {
    return mappings.anilist != null ? String(mappings.anilist) : null;
  }

  private readonly baseUrl: string;
  private readonly anilistApi = 'https://graphql.anilist.co';

  constructor(http: HttpClient, options: MegaPlayOptions = {}) {
    super(http);
    this.baseUrl = options.baseUrl || 'https://megaplay.buzz';
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
    const graphqlQuery = `
      query ($search: String) {
        Page (page: 1, perPage: 15) {
          media (search: $search, type: ANIME) {
            id
            title {
              romaji
              english
            }
            coverImage {
              large
            }
            episodes
          }
        }
      }
    `;

    const response = await this.http.post(
      this.anilistApi,
      {
        query: graphqlQuery,
        variables: { search: query },
      },
      { signal: options.signal },
    );

    const json = (await response.json()) as any;
    if (!json.data || !json.data.Page || !json.data.Page.media) {
      return [];
    }

    return json.data.Page.media.map(
      (media: any): IMediaSearchResult => ({
        id: String(media.id),
        title: media.title.english || media.title.romaji,
        thumbnailUrl: media.coverImage.large,
        catalogType: 'ANIME',
        providerId: this.id,
      }),
    );
  }

  protected override async fetchContentUnitsRaw(
    mediaId: string,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    // Fetch episode count from AniList if not provided
    const graphqlQuery = `
      query ($id: Int) {
        Media (id: $id) {
          episodes
        }
      }
    `;

    const response = await this.http.post(
      this.anilistApi,
      {
        query: graphqlQuery,
        variables: { id: parseInt(mediaId) },
      },
      { signal: options.signal },
    );

    const json = (await response.json()) as any;
    const episodesCount = json.data?.Media?.episodes || 1; // Default to 1 if unknown

    const units: IContentUnit[] = [];
    for (let i = 1; i <= episodesCount; i++) {
      units.push({
        id: `${mediaId}:${i}`,
        title: `Episode ${i}`,
        number: i,
        availableLanguages: ['sub', 'dub'],
      });
    }

    return units;
  }

  protected override async resolveStreamRaw(
    unitId: string,
    language: ContentLanguage = 'sub',
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const [aniId, epNum] = unitId.split(':');
    const embedUrl = `${this.baseUrl}/stream/ani/${aniId}/${epNum}/${language}`;

    // Step 1: Fetch the embed page to get the file ID
    // Note: referer is important for some endpoints
    const embedResponse = await this.http.get(embedUrl, {
      signal: options.signal,
      headers: {
        Referer: this.baseUrl,
      },
    });
    const embedPage = await embedResponse.text();

    if (embedPage.includes('<title>Error - MegaPlay</title>')) {
      throw new Error(
        `MegaPlay has no mapping for AniList ID ${aniId} episode ${epNum} (${language})`,
      );
    }

    // The file ID is in the title: <title>File 174608 - MegaPlay</title>
    const fileIdMatch = embedPage.match(/File\s+(\d+)\s+-/);
    if (!fileIdMatch) {
      throw new Error('Could not find file ID on megaplay embed page');
    }
    const fileId = fileIdMatch[1];

    // Step 2: Fetch the sources using the file ID
    const sourcesResponse = await this.http.get(`${this.baseUrl}/stream/getSources?id=${fileId}`, {
      signal: options.signal,
      headers: {
        Referer: `${this.baseUrl}/stream/ani/${aniId}/${epNum}/${language}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });

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
          Referer: `${this.baseUrl}/`,
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
