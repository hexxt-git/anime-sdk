# anime-sdk

A Typescript SDK for searching anime and manga across multiple catalogue sources and content providers, normalizing them behind a single API, and resolving direct playable streams or page URLs (with subtitle tracks).

[anime-sdk.hexxt.dev](https://animesdk.hexxt.dev/)

What's in the box:

- **Nine content providers** (anime + manga) with live, non-mocked E2E tests.
- **Three metadata providers** — AniList, MAL (Jikan), Kitsu — with full
  enrichments (relations, characters, staff, recommendations, external
  links, per-episode `streamingEpisodes` with Jikan filler/recap flags).
- **Unified URN ID space** (`provider:rawId`) so you can swap a content
  provider without rewriting your call sites.
- **Cross-source mapping** via a four-step waterfall (cache → provider
  native lookup → MALSync/Anify/arm-server → fuzzy title match with year +
  catalogType discriminators and episode-count cross-check).
- **A pluggable HTTP transport** (curl fallback included), with built-in
  per-host rate limiting, exponential-backoff retry honouring `Retry-After`,
  and end-to-end `AbortSignal` propagation.
- **Built-in downloads** for anime (HLS → MP4) and manga (chapters → ZIP).
- **An optional HTTP server** with content + metadata + download routes,
  a header-forwarding `/proxy` (HMAC-signable + suffix-matched SSRF
  allowlist) and a `GET /openapi.json` spec for client codegen.

## Providers

| ID              | Site                | Type  | Languages   | Subtitles | What it scrapes                                                                                                                                 |
| --------------- | ------------------- | ----- | ----------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `animeparadise` | `animeparadise.moe` | Anime | sub         | yes       | REST API at `api.animeparadise.moe`; episode carries a signed `streamLink` token; streamed as multi-quality HLS via `stream.animeparadise.moe`. |
| `allmanga`      | `allmanga.to`       | Anime | sub, dub    | no        | AllAnime GraphQL → AES-CTR `tobeparsed` payload → Mp4Upload extractor (with `clock.json` fallback for the wixmp/sharepoint sources).            |
| `gogoanime`     | `anineko.to`        | Anime | sub         | no        | Page scraping; vibeplayer embed → `master.m3u8` via `GenericHlsExtractor` (sequential, stops on first success).                                 |
| `goyabu`        | `goyabu.io`         | Anime | pt-br (dub) | no        | Pulls the Blogger token from `playersData`, then calls Google's `batchexecute` endpoint to recover the `googlevideo.com` URL.                   |
| `mangadex`      | `mangadex.org`      | Manga | sub         | no        | Official JSON API at `api.mangadex.org` with cover art and high-quality page resolution.                                                        |
| `weebcentral`   | `weebcentral.com`   | Manga | sub         | no        | Page scraping; extracts high-quality images with referer protection.                                                                            |
| `mangapill`     | `mangapill.com`     | Manga | sub         | no        | Page scraping; efficient extraction of chapter page lists and direct image sources.                                                             |
| `anikoto`       | `anikototv.to`      | Anime | sub, dub    | yes       | Page scraping; uses `anikotoapi.site` for episodes, and `megaplay.buzz` for stream and subtitle extraction.                                     |
| `megaplay`      | `megaplay.buzz`     | Anime | sub, dub    | yes       | Uses AniList GraphQL for search and episodes, and resolves streams directly against MegaPlay's AniList mapping endpoints.                       |

Every provider has a live E2E test that searches, picks an episode/chapter, resolves
the stream/pages, and captures a real video frame or verifies page links.

## Metadata providers

| ID        | Catalogue       | Native ID shape | Enrichments                                                                                                                       |
| --------- | --------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `anilist` | AniList GraphQL | `anilist:21`    | full metadata + relations + characters (with voice actors) + staff + recommendations + externalLinks + streamingEpisodes + browse |
| `mal`     | MyAnimeList     | `mal:anime:21`  | filler/recap flags via Jikan episodes + relations + browse(top/popular/seasonal)                                                  |
| `kitsu`   | Kitsu JSON:API  | `kitsu:anime:1` | core metadata + cross-source mappings (AniList/MAL/AniDB/TVDB)                                                                    |

## Architecture

```
src/
├── transport/
│   ├── http.ts              HttpClient: rate-limit + retry + AbortSignal + pluggable transport
│   ├── transport.ts         HttpTransport interface; CurlFallbackTransport (default), FetchTransport
│   ├── rateLimiter.ts       Per-host token bucket with secondary burst window
│   ├── retry.ts             withRetry + Retry-After parser
│   ├── dom.ts               DOMParser registry (auto-registers linkedom in Node)
│   └── hlsUtils.ts          Rewrite m3u8 chunk URLs through a proxy
├── extractors/
│   ├── Mp4UploadExtractor   Direct mp4 from www.mp4upload.com
│   ├── BloggerExtractor     Google batchexecute → googlevideo URLs
│   ├── VidstreamingExtractor  Legacy Gogo encrypt-ajax flow
│   └── GenericHlsExtractor  Best-effort m3u8/mp4 scrape from an embed page
├── providers/
│   ├── BaseProvider         URN wrap/unwrap, concurrency cap, lookupByMapping hook, malsyncSites
│   ├── AllmangaProvider, AnikotoProvider, AnimeParadiseProvider, GogoanimeProvider,
│   ├── GoyabuProvider, MangadexProvider, MangapillProvider, MegaPlayProvider, WeebcentralProvider
├── meta/
│   ├── BaseMetadataProvider Episode picking + IContentUnit enrichment + absolute-episode rescue
│   ├── AnilistMeta, MalMeta, KitsuMeta
│   ├── MappingClient        cache → provider → MALSync/Anify/arm-server → fuzzy waterfall
│   └── similarity.ts        normalizeTitle, dice + token Jaccard + prefix composite
├── download/                Built-in HLS → MP4 and chapter → ZIP download helpers
├── server/index.ts          startServer: /search, /content, /stream, /tracks, /meta/*, /download/*, /proxy, /openapi.json, /health
├── types/index.ts           CallOptions, IMediaSearchResult, IMediaMetadata, IContentUnit, …
└── utils/
    ├── crypto.ts            AES-CBC + AES-CTR helpers
    ├── subtitles.ts         normalizeSubtitleEntries, proxifySubtitleUrl (with signSecret)
    └── urn.ts               buildUrn, unwrapUrn, strictUnwrapUrn, buildTypedUrn, parseTypedUrn
```

### Unified URN IDs

Every `id` flowing in or out of the SDK has shape `${providerId}:${rawId}`:

```
allmanga:5jzpRTJWnubrgHm5G          # media URN
allmanga:5jzpRTJWnubrgHm5G/1        # content-unit URN
anilist:21                          # meta URN (single ID namespace)
mal:anime:21                        # typed catalogue URN (anime/manga distinction)
kitsu:manga:13                      # typed catalogue URN
```

The first colon is the separator; raw IDs may themselves contain colons or
slashes. Use `strictUnwrapUrn` when a URN must belong to a specific
provider (the server enforces this on `/meta/info`).

A provider is just a class with `search`, `fetchContentUnits`, and
`resolveStream`. `fetchContentUnits` is language-agnostic — it returns one
unified list and each `IContentUnit` carries `availableLanguages` so the
caller can pick at `resolveStream` time. Providers may optionally implement
`fetchUnitTracks(unitId, language?)` to expose subtitle/quality metadata
cheaply (no full stream resolution). Extractors are stateless and take a
`HttpClient`, so you can mix and match (or use the extractors on their own).

## Usage

```ts
import { HttpClient, AllmangaProvider, MangadexProvider } from 'anime-sdk';

const http = new HttpClient({ timeoutMs: 25_000 });

// Anime
const anime = new AllmangaProvider(http);
const shows = await anime.search('Frieren');
const eps = await anime.fetchContentUnits(shows[0].id);
const stream = await anime.resolveStream(eps[0].id, 'sub');

// Manga
const manga = new MangadexProvider(http);
const books = await manga.search('Frieren');
const chapters = await manga.fetchContentUnits(books[0].id);
const pages = await manga.resolveStream(chapters[0].id);

if (pages.type === 'manga') {
  console.log(pages.pages.imageUrls); // Array of high-res page URLs
}
```

### Cross-source: metadata + content provider

The metadata layer lets you swap content providers without changing
anything else. Mapping (AniList ID → AllManga raw ID) happens
automatically:

```ts
import {
  HttpClient,
  AnilistMeta,
  MappingClient,
  AllmangaProvider,
  GogoanimeProvider,
} from 'anime-sdk';

const http = new HttpClient();
const mapping = new MappingClient(http);
const meta = new AnilistMeta(http, { mappingClient: mapping });

// Pull rich metadata from AniList (relations, characters, streamingEpisodes…)
const info = await meta.fetchMediaInfo('anilist:1');
console.log(info.title.english, info.streamingEpisodes?.[0].title);

// Resolve a stream on any content provider using the same AniList URN.
const allmanga = new AllmangaProvider(http);
const stream = await meta.resolveStream('anilist:1', 1, allmanga, 'sub');

// Or swap to a different content provider — no other changes.
const gogo = new GogoanimeProvider(http);
const stream2 = await meta.resolveStream('anilist:1', 1, gogo, 'sub');
```

### Browse the catalogue

```ts
const trending = await meta.browse('trending', { catalogType: 'ANIME', perPage: 10 });
const seasonal = await meta.browse('seasonal', { season: 'FALL', year: 2024 });
const top = await meta.browse('top');
```

### HTTP server with proxy + cache + metadata routes

```ts
import {
  HttpClient,
  startServer,
  AllmangaProvider,
  MangadexProvider,
  AnilistMeta,
  MalMeta,
} from 'anime-sdk';

const http = new HttpClient();
const store = new Map();
const cache = {
  get: (key) => store.get(key),
  set: (key, value) => void store.set(key, value),
};

startServer({
  providers: [new AllmangaProvider(http), new MangadexProvider(http)],
  metaProviders: [new AnilistMeta(http), new MalMeta(http)],
  port: 3000,
  proxy: true,
  proxySignSecret: process.env.PROXY_SECRET, // optional: signs /proxy URLs
  proxyAllowedHosts: ['wixstatic.com', 'allanime.day'], // optional SSRF allowlist
  cache,
});
```

Routes the server exposes:

| Route                         | Purpose                                                                                |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| `GET /search`                 | Search a content provider                                                              |
| `GET /content`                | Episode/chapter list for a media URN                                                   |
| `GET /stream`                 | Resolve a playable stream for a unit URN                                               |
| `GET /tracks`                 | Cheap subtitle/quality list (501 if provider doesn't support it)                       |
| `GET /meta/search`            | Search a metadata catalogue                                                            |
| `GET /meta/info`              | Full `IMediaMetadata` for a meta URN                                                   |
| `GET /meta/content`           | Episode list for a meta URN, resolved via a content provider                           |
| `GET /meta/stream`            | Resolve a stream by metadata + episode number                                          |
| `GET /meta/tracks`            | Cheap tracks for an episode (501 if provider doesn't support it)                       |
| `GET /meta/browse`            | Trending / popular / seasonal / top                                                    |
| `GET /download/video`         | Download an anime episode as MP4                                                       |
| `GET /download/manga/page`    | Download a single manga page                                                           |
| `GET /download/manga/chapter` | Download a manga chapter as a ZIP                                                      |
| `GET /proxy`                  | CORS-friendly upstream proxy (header forwarding, HLS rewrite, optional HMAC signature) |
| `GET /openapi.json`           | OpenAPI 3.1 spec describing every route                                                |
| `GET /health`                 | Health + capability check                                                              |

### Direct extractor use

Extractors work standalone — hand them an embed URL from any source and
they'll return a list of `IVideoPayload` (or an empty array if they can't
recover a direct stream).

```ts
import { HttpClient, BloggerExtractor } from 'anime-sdk';

const blogger = new BloggerExtractor(new HttpClient());
const streams = await blogger.extract('https://www.blogger.com/video.g?token=AD6v5dw…');
```

### Cancellation

Every public method takes a `CallOptions` bag with an optional
`AbortSignal`. It's threaded all the way down to `fetch`, the rate
limiter (so a long queue can be drained on abort), and the retry loop.

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 1500);
const results = await meta.search('frieren', { signal: ac.signal });
```

## Tests

```bash
# Everything (unit + live e2e, ~60s total)
npx vitest run

# Just the live providers
npx vitest run tests/e2e
```

The E2E suite is intentionally not mocked. Each test:

1. Searches a popular title (`Frieren` for AllManga/Gogoanime, `Naruto`
   Clássico for Goyabu).
2. Picks a mainline entry, fetches episodes, resolves a stream.
3. Walks the candidate list via `captureStreamScreenshot`, which:

- probes a URL with a Range GET (Content-Type + MP4 `ftyp` magic) to tell
  embed pages from direct video bytes,
- scrapes embed HTML for an `.m3u8`/`.mp4` URL when needed,
- downloads an HLS segment ~5s in and runs ffmpeg locally on it
  (PNG-wrapped segments are stripped before decoding), or
- hands plain MP4 URLs straight to ffmpeg with `-user_agent`/`-referer`,

4. Asserts the resulting PNG is >1KB before passing.

Screenshots land in `scratch/screenshots/screenshot_<provider>.png`.
`scratch/` is gitignored.

The tests are **all real**. See `CLAUDE.md` for the non-negotiable testing
rules — short version: no mocked network requests, no fake/fixture data,
no graceful skipping. A test must pass for real or be deleted.

## Requirements

- Node 20+ (uses `fetch`, `globalThis.crypto.subtle`, top-level await in
  tests).
- `ffmpeg` on `PATH` for the E2E suite.

## License

MIT

## DMCA

anime-sdk does not host, store, or distribute any media content. It resolves publicly accessible URLs served by third-party sites. For copyright concerns about content on those sites, contact them directly. To report infringement in the SDK code or this repository, open an issue tagged `legal`.
