import { HttpClient } from '../internal/http.js';
import { encodeId, decodeId } from '../internal/id.js';
import { normalizeSubtitleEntries } from '../utils/subtitles.js';
import type { Media, Episode, Stream, List, Subtitle } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const API_BASE = 'https://api.animeparadise.moe';
const STREAM_BASE = 'https://stream.animeparadise.moe';

export class AnimeParadiseSource implements Source {
  readonly id = 'animeparadise';
  readonly kinds = ['anime'] as const;
  readonly caps = { search: true, episodes: true, stream: true } as const;

  constructor(private http: HttpClient) {}

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const res = await this.http.get(`${API_BASE}/search?q=${encodeURIComponent(query)}&limit=20`, {
      signal: opts.signal,
    });
    const json = (await res.json()) as any;
    return ((json?.data as any[]) ?? []).map(
      (item): Media => ({
        id: encodeId({ t: 'media', s: this.id, r: item._id }),
        kind: 'anime',
        title: { preferred: item.alternativeTitle?.english ?? item.title ?? '' },
        cover: item.posterImage?.medium
          ? { url: item.posterImage.medium }
          : item.posterImage?.large
            ? { url: item.posterImage.large }
            : undefined,
        year:
          typeof item.year === 'number'
            ? item.year
            : item.released
              ? new Date(item.released).getUTCFullYear()
              : undefined,
        source: this.id,
        mappings: {},
      }),
    );
  }

  async episodes(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const res = await this.http.get(`${API_BASE}/anime/${mediaId}/episode`, {
      signal: opts.signal,
    });
    const json = (await res.json()) as any;
    const episodes: any[] = json?.data ?? [];
    return {
      items: episodes.map(
        (ep): Episode => ({
          id: encodeId({ t: 'episode', s: this.id, r: `${ep.uid}:${mediaId}` }),
          number: parseFloat(ep.number),
          title: ep.title ?? `Episode ${ep.number}`,
          languages: ['sub'],
        }),
      ),
    };
  }

  async stream(episodeId: string, opts: SourceCallOpts): Promise<Stream[]> {
    const { r: rawUnit } = decodeId(episodeId);
    const sep = rawUnit.lastIndexOf(':');
    if (sep < 0) throw new Error(`AnimeParadise: invalid episode id: ${rawUnit}`);
    const uid = rawUnit.slice(0, sep);
    const animeId = rawUnit.slice(sep + 1);

    const res = await this.http.get(`${API_BASE}/ep/${uid}?origin=${animeId}`, {
      signal: opts.signal,
    });
    const json = (await res.json()) as any;
    const episode = json?.data?.episode;
    if (!episode?.streamLink) throw new Error('AnimeParadise: no streamLink in response');

    const url = `${STREAM_BASE}/m3u8?url=${encodeURIComponent(episode.streamLink)}`;
    const rawSubs = normalizeSubtitleEntries(episode.subData);
    const subtitles: Subtitle[] = rawSubs.map((s) => ({
      url: s.url,
      language: s.language,
      label: s.label,
      format: (s.format ?? 'vtt') as 'vtt' | 'srt' | 'ass',
    }));

    return [
      {
        url,
        source: this.id,
        server: 'animeparadise',
        quality: 'auto' as const,
        language: 'sub' as const,
        isHls: true,
        headers: { Referer: 'https://animeparadise.moe/' },
        subtitles,
      },
    ];
  }
}
