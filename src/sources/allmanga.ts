import { HttpClient } from '../internal/http.js';
import { encodeId, decodeId } from '../internal/id.js';
import { aesDecryptCtr } from '../utils/crypto.js';
import { Mp4UploadExtractor } from '../extractors/Mp4UploadExtractor.js';
import { GenericHlsExtractor } from '../extractors/GenericHlsExtractor.js';
import type { Media, Episode, Stream, List, Subtitle } from '../types.js';
import type { IVideoPayload, IMediaMappings } from '../types/index.js';
import type { Source, SourceCallOpts } from './base.js';

const ALLANIME_KEY_PHRASE = 'Xot36i3lK3:v1';
const ALLANIME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0';

function decodeAllAnimeSource(encoded: string): string {
  const hex = encoded.startsWith('--') ? encoded.slice(2) : encoded;
  const bytes = new Uint8Array(hex.length >>> 1);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i >>> 1] = parseInt(hex.substring(i, i + 2), 16) ^ 0x38;
  }
  return new TextDecoder('latin1').decode(bytes).replace(/\/clock(?=\?|$)/, '/clock.json');
}

function mapQuality(label: string): IVideoPayload['quality'] {
  const s = String(label).toLowerCase();
  if (s.includes('1080')) return '1080p';
  if (s.includes('720')) return '720p';
  if (s.includes('480')) return '480p';
  if (s.includes('360')) return '360p';
  return 'auto';
}

function qualityScore(p: IVideoPayload): number {
  let s = 0;
  if (/\/video\.mp4(?:[?#]|$)/.test(p.sourceUrl)) s += 30;
  if (p.sourceUrl.includes('wixstatic.com')) s += 25;
  if (p.sourceUrl.includes('mp4upload.com')) s += 20;
  if (/\.m3u8(?:[?#]|$)/.test(p.sourceUrl)) s += 15;
  if (/\.mp4(?:[?#]|$)/.test(p.sourceUrl)) s += 10;
  if (p.quality === '1080p') s += 4;
  else if (p.quality === '720p') s += 3;
  else if (p.quality === '480p') s += 2;
  else if (p.quality === '360p') s += 1;
  return s;
}

function payloadsToStream(payloads: IVideoPayload[], lang: 'sub' | 'dub' | 'raw'): Stream {
  payloads.sort((a, b) => qualityScore(b) - qualityScore(a));
  const primary = payloads[0];
  const url = primary.sourceUrl;
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {}
  return {
    url,
    origin: { host, url, proxied: false },
    isHls: primary.isHLS,
    qualities: payloads.map((p) => ({ label: p.quality, url: p.sourceUrl })),
    language: lang,
    subtitles: (primary.subtitles ?? []).map(
      (s): Subtitle => ({
        url: s.url,
        language: s.language,
        label: s.label,
        format: s.format ?? 'vtt',
      }),
    ),
    headers: primary.headers,
    adjacent: {},
  };
}

export class AllmangaSource implements Source {
  readonly id = 'allmanga';
  readonly kinds = ['anime'] as const;
  readonly caps = { search: true, episodes: true, stream: true, mapping: true } as const;

  readonly malsyncSites = ['AllAnime'];

  private http: HttpClient;
  private apiBase = 'https://api.allanime.day/api';
  private apiHost = 'https://allanime.day';
  private referer = 'https://allmanga.to';
  private origin = 'https://allmanga.to';
  private mp4UploadExtractor: Mp4UploadExtractor;
  private genericExtractor: GenericHlsExtractor;

  constructor(http: HttpClient) {
    this.http = http;
    this.mp4UploadExtractor = new Mp4UploadExtractor(http);
    this.genericExtractor = new GenericHlsExtractor(http);
  }

  private apiHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      Referer: this.referer,
      Origin: this.origin,
      'User-Agent': ALLANIME_USER_AGENT,
    };
  }

  async search(query: string, _kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]> {
    const gql = `query($search:SearchInput,$limit:Int,$page:Int,$countryOrigin:VaildCountryOriginEnumType){shows(search:$search,limit:$limit,page:$page,countryOrigin:$countryOrigin){edges{_id name englishName availableEpisodes}}}`;
    const res = await this.http.post(
      this.apiBase,
      {
        variables: {
          search: { allowAdult: false, allowUnknown: false, query },
          limit: 40,
          page: 1,
          countryOrigin: 'ALL',
        },
        query: gql,
      },
      { headers: this.apiHeaders(), signal: opts.signal },
    );
    if (res.status !== 200) throw new Error(`AllManga search failed: ${res.status}`);
    const json = (await res.json()) as any;
    const edges: any[] = json?.data?.shows?.edges ?? [];
    return edges
      .filter((e) => e.englishName || e.name)
      .map((e): Media => {
        const title = e.englishName || e.name;
        const avail = e.availableEpisodes as Record<string, number> | undefined;
        const langs: ('sub' | 'dub' | 'raw')[] = [];
        if (avail?.sub) langs.push('sub');
        if (avail?.dub) langs.push('dub');
        if (avail?.raw) langs.push('raw');
        return {
          id: encodeId({ t: 'media', s: this.id, r: e._id }),
          kind: 'anime',
          title: { preferred: title },
          catalogues: [this.id],
          playbackSources: [this.id],
          mappings: { sources: { [this.id]: e._id } },
        };
      });
  }

  async episodes(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>> {
    const gql = `query($showId:String!){show(_id:$showId){_id availableEpisodesDetail}}`;
    const res = await this.http.post(
      this.apiBase,
      { variables: { showId: mediaId }, query: gql },
      { headers: this.apiHeaders(), signal: opts.signal },
    );
    if (res.status !== 200) throw new Error(`AllManga episodes failed: ${res.status}`);
    const json = (await res.json()) as any;
    const detail = json?.data?.show?.availableEpisodesDetail ?? {};

    const merged = new Map<string, { num: number; langs: ('sub' | 'dub' | 'raw')[] }>();
    for (const lang of ['sub', 'dub', 'raw'] as const) {
      const list: string[] = Array.isArray(detail[lang]) ? detail[lang] : [];
      for (const epStr of list) {
        const num = parseFloat(epStr);
        if (isNaN(num)) continue;
        const entry = merged.get(epStr) ?? { num, langs: [] };
        if (!entry.langs.includes(lang)) entry.langs.push(lang);
        merged.set(epStr, entry);
      }
    }

    const items: Episode[] = [];
    for (const [epStr, { num, langs }] of merged) {
      items.push({
        id: encodeId({ t: 'episode', s: this.id, r: `${mediaId}/${epStr}` }),
        mediaId: encodeId({ t: 'media', s: this.id, r: mediaId }),
        number: num,
        title: `Episode ${epStr}`,
        languages: langs,
        qualities: ['auto'],
        source: this.id,
      });
    }
    items.sort((a, b) => a.number - b.number);
    return { items };
  }

  async stream(
    episodeId: string,
    opts: SourceCallOpts & { language?: 'sub' | 'dub' | 'raw' },
  ): Promise<Stream> {
    const { r: rawUnit } = decodeId(episodeId);
    const [showId, episodeString] = rawUnit.split('/');
    if (!showId || !episodeString) throw new Error(`Invalid AllManga episode id: ${rawUnit}`);
    const lang = opts.language ?? 'sub';
    const sources = await this.fetchEpisodeSources(showId, episodeString, lang, opts.signal);
    if (sources.length === 0) throw new Error(`AllManga: no sources for ${rawUnit}`);
    sources.sort((a, b) => (Number(b.priority) || 0) - (Number(a.priority) || 0));

    const payloads: IVideoPayload[] = [];
    const errors: string[] = [];
    for (const src of sources) {
      try {
        payloads.push(...(await this.extractSource(src, lang)));
      } catch (e) {
        errors.push(`${src.sourceName}: ${(e as Error).message}`);
      }
    }
    if (payloads.length === 0) {
      throw new Error(`AllManga: no playable streams for ${rawUnit}. Errors: ${errors.join('; ')}`);
    }
    return payloadsToStream(payloads, lang);
  }

  async lookupByMapping(
    mappings: Record<string, unknown>,
    _opts?: SourceCallOpts,
  ): Promise<string | null> {
    const m = mappings as IMediaMappings;
    if (m.anilist) {
      const results = await this.search(String(m.anilist), 'anime', {});
      return results[0]?.mappings.sources?.['allmanga'] ?? null;
    }
    return null;
  }

  private async fetchEpisodeSources(
    showId: string,
    episodeString: string,
    lang: 'sub' | 'dub' | 'raw',
    signal?: AbortSignal,
  ): Promise<Array<{ sourceUrl: string; sourceName?: string; priority?: number }>> {
    const variables = { showId, translationType: lang, episodeString };
    const extensions = {
      persistedQuery: {
        version: 1,
        sha256Hash: 'd405d0edd690624b66baba3068e0edc3ac90f1597d898a1ec8db4e5c43c00fec',
      },
    };
    const url = `${this.apiBase}?variables=${encodeURIComponent(JSON.stringify(variables))}&extensions=${encodeURIComponent(JSON.stringify(extensions))}`;
    const res = await this.http.get(url, { headers: this.apiHeaders(), signal });
    if (res.status !== 200) throw new Error(`AllManga stream sources failed: ${res.status}`);
    const json = (await res.json()) as any;
    const tobeparsed: string | undefined = json?.data?.tobeparsed;
    if (tobeparsed) return this.decryptTobeparsed(tobeparsed);
    const fallbackQuery = `query($showId:String!,$translationType:VaildTranslationTypeEnumType!,$episodeString:String!){episode(showId:$showId translationType:$translationType episodeString:$episodeString){episodeString sourceUrls}}`;
    const fbRes = await this.http.post(
      this.apiBase,
      { variables, query: fallbackQuery },
      { headers: this.apiHeaders(), signal },
    );
    if (fbRes.status !== 200) throw new Error(`AllManga fallback failed: ${fbRes.status}`);
    const fbJson = (await fbRes.json()) as any;
    return fbJson?.data?.episode?.sourceUrls ?? [];
  }

  private async decryptTobeparsed(blob: string): Promise<any[]> {
    let binary: string;
    try {
      binary = atob(blob);
    } catch {
      const norm = blob.replace(/-/g, '+').replace(/_/g, '/');
      const pad = norm.length % 4;
      binary = atob(pad ? norm + '='.repeat(4 - pad) : norm);
    }
    const data = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) data[i] = binary.charCodeAt(i);
    if (data.length < 30) throw new Error(`tobeparsed too short (${data.length} bytes)`);
    const nonce = data.subarray(1, 13);
    const ciphertext = data.subarray(13, data.length - 16);
    const keyBytes = new TextEncoder().encode(ALLANIME_KEY_PHRASE);
    const keyHash = await globalThis.crypto.subtle.digest('SHA-256', keyBytes);
    const key = new Uint8Array(keyHash);
    const iv = new Uint8Array(16);
    iv.set(nonce, 0);
    new DataView(iv.buffer).setUint32(12, 2, false);
    const decrypted = await aesDecryptCtr(ciphertext, key, iv);
    const text = new TextDecoder().decode(decrypted);
    const parsed = JSON.parse(text);
    const sources = parsed.episode?.sourceUrls ?? parsed.data?.episode?.sourceUrls ?? null;
    if (!Array.isArray(sources)) throw new Error('No sourceUrls in decrypted tobeparsed');
    return sources;
  }

  private async extractSource(
    src: { sourceUrl: string; sourceName?: string },
    lang: 'sub' | 'dub' | 'raw',
  ): Promise<IVideoPayload[]> {
    let raw = src.sourceUrl;
    if (!raw) return [];
    if (raw.startsWith('--')) {
      raw = decodeAllAnimeSource(raw);
      if (raw.startsWith('/')) raw = this.apiHost + raw;
    }
    if (raw.startsWith('//')) raw = 'https:' + raw;
    const headers = { Referer: this.referer, 'User-Agent': ALLANIME_USER_AGENT };
    if (raw.includes('/clock.json')) return this.resolveClockJson(raw, lang);
    if (/\.m3u8(?:\?|$)/.test(raw) || /\.mp4(?:\?|$)/.test(raw)) {
      return [
        { sourceUrl: raw, isHLS: raw.includes('.m3u8'), quality: 'auto', language: lang, headers },
      ];
    }
    if (raw.includes('tools.fast4speed.rsvp')) {
      return [{ sourceUrl: raw, isHLS: false, quality: 'auto', language: lang, headers }];
    }
    if (Mp4UploadExtractor.matches(raw)) return this.mp4UploadExtractor.extract(raw);
    try {
      const extracted = await this.genericExtractor.extract(raw);
      if (extracted.length > 0) return extracted.map((p) => ({ ...p, language: lang }));
    } catch {}
    return [];
  }

  private async resolveClockJson(
    url: string,
    lang: 'sub' | 'dub' | 'raw',
  ): Promise<IVideoPayload[]> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    try {
      const res = await this.http.get(url, {
        headers: { Referer: this.referer, 'User-Agent': ALLANIME_USER_AGENT },
        signal: controller.signal as AbortSignal,
      });
      clearTimeout(timer);
      if (res.status !== 200) throw new Error(`clock.json returned ${res.status}`);
      const json = (await res.json()) as any;
      const links = json.links ?? [];
      const out: IVideoPayload[] = [];
      for (const item of links) {
        const link = item.link as string | undefined;
        if (!link) continue;
        if (link.includes('repackager.wixmp.com')) {
          const m = link.match(/\/,([^/]+),\/mp4/);
          if (m) {
            const qualities = m[1].split(',');
            const cleanBase = link
              .replace('repackager.wixmp.com/', '')
              .replace(/\.urlset\/master\.m3u8$/, '');
            for (const q of qualities) {
              const streamUrl = cleanBase.replace(`/,${m[1]},/mp4/`, `/${q}/mp4/`);
              out.push({
                sourceUrl: streamUrl,
                isHLS: false,
                quality: mapQuality(q),
                language: lang,
                headers: { Referer: this.referer },
              });
            }
            continue;
          }
          out.push({
            sourceUrl: link,
            isHLS: true,
            quality: 'auto',
            language: lang,
            headers: { Referer: this.referer },
          });
          continue;
        }
        out.push({
          sourceUrl: link,
          isHLS: !!item.hls || link.includes('.m3u8'),
          quality: mapQuality(item.resolutionStr ?? ''),
          language: lang,
          headers: { Referer: this.referer },
        });
      }
      return out;
    } finally {
      clearTimeout(timer);
    }
  }
}
