# anime-sdk

A small Typescript SDK for searching anime and manga, listing episodes/chapters, and resolving direct stream/page URLs (with subtitle tracks). Nine providers, a handful of reusable embed extractors, a pluggable HTTP transport, and an optional HTTP server with a stream/subtitle proxy and a bring-your-own cache hook.

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

## Architecture

```
src/
├── transport/
│   ├── http.ts              HttpClient: fetch + curl fallback, proxy routing
│   ├── dom.ts               DOMParser registry (auto-registers linkedom in Node)
│   └── hlsUtils.ts          Rewrite m3u8 chunk URLs through a proxy
├── extractors/
│   ├── Mp4UploadExtractor   Direct mp4 from www.mp4upload.com
│   ├── BloggerExtractor     Google batchexecute → googlevideo URLs
│   ├── VidstreamingExtractor  Legacy Gogo encrypt-ajax flow
│   └── GenericHlsExtractor  Best-effort m3u8/mp4 scrape from an embed page
├── providers/
│   ├── AllmangaProvider
│   ├── AnikotoProvider
│   ├── AnimeParadiseProvider
│   ├── GogoanimeProvider
│   ├── GoyabuProvider
│   ├── MangadexProvider
│   ├── MangapillProvider
│   ├── MegaPlayProvider
│   └── WeebcentralProvider
├── server/index.ts          startServer: HTTP API + /proxy + optional SdkCache
├── types/index.ts           IMediaSearchResult, IContentUnit, ISubtitleTrack,
│                            IUnitTracks, ResolvedMediaStream, SdkCache, …
└── utils/
    ├── crypto.ts            AES-CBC + AES-CTR helpers
    └── subtitles.ts         normalizeSubtitleEntries, proxifySubtitleUrl
```

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

### HTTP server with proxy + cache

```ts
import { HttpClient, startServer, AllmangaProvider, MangadexProvider } from 'anime-sdk';

const store = new Map(); // satisfies the SdkCache get/set contract
const cache = {
  get: (key) => store.get(key),
  set: (key, value) => void store.set(key, value),
};

startServer({
  providers: [new AllmangaProvider(new HttpClient()), new MangadexProvider(new HttpClient())],
  port: 3000,
  proxy: true, // /search, /content, /stream, /tracks, /proxy
  cache, // memoize provider calls by namespaced key
});
```

Routes: `GET /search`, `GET /content`, `GET /stream`, `GET /tracks`
(returns 501 when the provider has no cheap metadata path), and
`GET /proxy` for stream + subtitle fetching with header forwarding and
auto-rewritten HLS manifests. Subtitle URLs in `/stream` and `/tracks`
responses are automatically routed through `/proxy` so browsers don't hit
CORS / `Content-Type` issues with VTT files.

### Direct extractor use

Extractors work standalone — hand them an embed URL from any source and
they'll return a list of `IVideoPayload` (or an empty array if they can't
recover a direct stream).

```ts
import { HttpClient, BloggerExtractor } from 'anime-sdk';

const blogger = new BloggerExtractor(new HttpClient());
const streams = await blogger.extract('https://www.blogger.com/video.g?token=AD6v5dw…');
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

## Requirements

- Node 20+ (uses `fetch`, `globalThis.crypto.subtle`, top-level await in
  tests).
- `ffmpeg` on `PATH` for the E2E suite.

## License

MIT

## DMCA

anime-sdk does not host, store, or distribute any media content. It resolves publicly accessible URLs served by third-party sites. For copyright concerns about content on those sites, contact them directly. To report infringement in the SDK code or this repository, open an issue tagged `legal`.
