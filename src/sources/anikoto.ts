import { HttpClient } from '../internal/http.js';
import { DomRegistry } from '../internal/dom.js';
import { encodeId, decodeId } from '../internal/id.js';
import type { Media, Episode, Stream, List, Subtitle } from '../types.js';
import type { Source, SourceCallOpts } from './base.js';

export class AnikotoSource implements Source {
  readonly id = 'anikoto';
  readonly kinds = ['anime'] as const;
  readonly caps = { search: true, episodes: true, stream: true } as const;

  private readonly baseUrl = 'https://anikototv.to';
  private readonly apiUrl = 'https://anikotoapi.site';

  constructor(private http: HttpClient) {}

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const res = await this.http.get(`${this.baseUrl}/filter?keyword=${encodeURIComponent(query)}`, {
      signal: opts.signal,
    });
    const doc = DomRegistry.parse(await res.text());
    return doc
      .querySelectorAll('.main .item')
      .map((item): Media | null => {
        const posterEl = item.querySelector('.poster');
        const id = posterEl?.getAttribute('data-tip') || '';
        if (!id) return null;
        const title = item.querySelector('.name')?.textContent?.trim() || '';
        const imgSrc = item.querySelector('img')?.getAttribute('src') ?? undefined;
        return {
          id: encodeId({ t: 'media', s: this.id, r: id }),
          kind: 'anime',
          title: { preferred: title },
          cover: imgSrc ? { url: imgSrc } : undefined,
          catalogues: [this.id],
          playbackSources: [this.id],
          mappings: { sources: { [this.id]: id } },
        };
      })
      .filter((r): r is Media => r !== null);
  }

  async episodes(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const res = await this.http.get(`${this.apiUrl}/series/${mediaId}`, {
      signal: opts.signal,
    });
    const json = (await res.json()) as any;
    if (!json.ok || !json.data?.episodes) return { items: [] };
    return {
      items: json.data.episodes.map(
        (ep: any): Episode => ({
          id: encodeId({ t: 'episode', s: this.id, r: ep.episode_embed_id }),
          mediaId: encodeId({ t: 'media', s: this.id, r: mediaId }),
          number: ep.number,
          title: ep.title || `Episode ${ep.number}`,
          languages: [
            ...(ep.embed_url?.sub ? ['sub' as const] : []),
            ...(ep.embed_url?.dub ? ['dub' as const] : []),
          ],
          qualities: ['auto'],
          source: this.id,
        }),
      ),
    };
  }

  async stream(
    episodeId: string,
    opts: SourceCallOpts & { language?: 'sub' | 'dub' | 'raw' },
  ): Promise<Stream> {
    const { r: rawUnit } = decodeId(episodeId);
    const lang = opts.language ?? 'sub';
    const embedUrl = `https://megaplay.buzz/stream/s-2/${rawUnit}/${lang}`;
    const embedRes = await this.http.get(embedUrl, {
      signal: opts.signal,
      headers: { Referer: this.baseUrl },
    });
    const embedPage = await embedRes.text();
    const fileIdMatch = embedPage.match(/File\s+(\d+)\s+-/);
    if (!fileIdMatch) throw new Error('Anikoto: no file ID on megaplay embed page');
    const fileId = fileIdMatch[1];

    const srcRes = await this.http.get(`https://megaplay.buzz/stream/getSources?id=${fileId}`, {
      signal: opts.signal,
      headers: {
        Referer: `https://megaplay.buzz/stream/s-5/${rawUnit}/${lang}`,
        'X-Requested-With': 'XMLHttpRequest',
      },
    });
    const srcJson = (await srcRes.json()) as any;
    if (!srcJson.sources?.file) throw new Error('Anikoto: no video sources');

    const url: string = srcJson.sources.file;
    let host = '';
    try {
      host = new URL(url).hostname;
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
      origin: { host, url, proxied: false },
      isHls: url.includes('.m3u8'),
      qualities: [{ label: 'auto', url }],
      language: lang,
      subtitles,
      headers: { Referer: 'https://megaplay.buzz/' },
      adjacent: {},
    };
  }
}
