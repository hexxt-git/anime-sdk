import { HttpClient } from '../internal/http.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Episode, Stream, List, Subtitle } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

const ANILIST_API = 'https://graphql.anilist.co';

export class MegaPlaySource implements Source {
  readonly id = 'megaplay';
  readonly kinds = ['anime'] as const;
  readonly caps = { search: true, episodes: true, stream: true, mapping: true } as const;

  private baseUrl: string;

  constructor(
    private http: HttpClient,
    baseUrl = 'https://megaplay.buzz',
  ) {
    this.baseUrl = baseUrl;
  }

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const gql = `query($search:String){Page(page:1,perPage:15){media(search:$search,type:ANIME){id title{romaji english}coverImage{large}episodes}}}`;
    const res = await this.http.post(
      ANILIST_API,
      { query: gql, variables: { search: query } },
      { signal: opts.signal },
    );
    const json = (await res.json()) as any;
    return ((json.data?.Page?.media as any[]) ?? []).map(
      (m): Media => ({
        id: encodeId({ t: 'media', s: this.id, r: String(m.id), m: { al: m.id } }),
        kind: 'anime',
        title: { preferred: m.title.english ?? m.title.romaji ?? '' },
        cover: m.coverImage?.large ? { url: m.coverImage.large } : undefined,
        source: this.id,
        mappings: { anilist: m.id },
      }),
    );
  }

  async episodes(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const gql = `query($id:Int){Media(id:$id){episodes}}`;
    const res = await this.http.post(
      ANILIST_API,
      { query: gql, variables: { id: parseInt(mediaId) } },
      { signal: opts.signal },
    );
    const json = (await res.json()) as any;
    const count: number = json.data?.Media?.episodes ?? 1;
    const items: Episode[] = [];
    for (let i = 1; i <= count; i++) {
      items.push({
        id: encodeId({ t: 'episode', s: this.id, r: `${mediaId}:${i}` }),
        number: i,
        title: `Episode ${i}`,
        languages: ['sub', 'dub'],
      });
    }
    return { items };
  }

  async stream(episodeId: string, opts: SourceCallOpts): Promise<Stream[]> {
    const { r: rawUnit } = decodeId(episodeId);
    const [aniId, epNum] = rawUnit.split(':');

    const results = await Promise.allSettled(
      (['sub', 'dub'] as const).map(async (lang) => {
        const embedUrl = `${this.baseUrl}/stream/ani/${aniId}/${epNum}/${lang}`;
        const embedRes = await this.http.get(embedUrl, {
          signal: opts.signal,
          headers: { Referer: this.baseUrl },
        });
        const embedPage = await embedRes.text();
        if (embedPage.includes('<title>Error - MegaPlay</title>')) {
          throw new Error(`no mapping for AniList ID ${aniId} episode ${epNum} (${lang})`);
        }
        const fileIdMatch = embedPage.match(/File\s+(\d+)\s+-/);
        if (!fileIdMatch) throw new Error('no file ID on embed page');
        const fileId = fileIdMatch[1];

        const srcRes = await this.http.get(`${this.baseUrl}/stream/getSources?id=${fileId}`, {
          signal: opts.signal,
          headers: {
            Referer: `${this.baseUrl}/stream/ani/${aniId}/${epNum}/${lang}`,
            'X-Requested-With': 'XMLHttpRequest',
          },
        });
        const srcJson = (await srcRes.json()) as any;
        if (!srcJson.sources?.file) throw new Error('no video sources in response');

        const url: string = srcJson.sources.file;
        let server = 'megaplay';
        try {
          server = new URL(url).hostname;
        } catch {}

        const subtitles: Subtitle[] = ((srcJson.tracks ?? []) as any[])
          .filter((t) => t.kind === 'captions')
          .map(
            (t): Subtitle => ({
              url: t.file,
              label: t.label,
              language: String(t.label).toLowerCase(),
              format: String(t.file).endsWith('.vtt') ? 'vtt' : 'srt',
            }),
          );

        return {
          url,
          source: this.id,
          server,
          quality: 'auto' as const,
          language: lang,
          isHls: url.includes('.m3u8'),
          headers: { Referer: `${this.baseUrl}/` },
          subtitles,
        };
      }),
    );

    const streams = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    if (streams.length === 0)
      throw new Error(`MegaPlay: no playable streams for AniList ${aniId} ep ${epNum}`);
    return streams;
  }

  async lookupByMapping(
    mappings: Record<string, unknown>,
    _opts?: SourceCallOpts,
  ): Promise<string | null> {
    const al = mappings.anilist ?? (mappings as any).al;
    return al != null ? String(al) : null;
  }
}
