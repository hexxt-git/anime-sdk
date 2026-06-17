# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run build`: `tsup` builds dual ESM/CJS bundles to `dist/` with `.d.ts` types. `tests/`, `references/`, `dist/` are excluded.
- `npm test`: `vitest` in watch mode.
- `npm run test:run`: one-shot run of the whole suite (unit + live E2E, ~60s total).
- `npx vitest run tests/e2e`: just the live providers.
- `npx vitest run tests/e2e/allmanga.test.ts`: single E2E file.
- `npx vitest run -t "rewriteManifest"`: single test by name pattern.

Requires Node 20+ and `ffmpeg` on `PATH` (E2E suite shells out to it).

## Architecture

The SDK has four layers, all wired around a single `HttpClient`:

**1. Transport (`src/transport/`)**: site-agnostic plumbing.

- `HttpClient` wraps `fetch`, layered with a per-host rate limiter (`RateLimiter`, with built-in policies for AniList/Jikan/Kitsu/MALSync/Anify/arm-server), an exponential-backoff retry that honors `Retry-After` (`withRetry` + `HttpRetryableError`), and a curl-based fallback transport. The fallback is encapsulated behind the `HttpTransport` interface (`CurlFallbackTransport` default, `FetchTransport` for runtimes without `child_process`). `AbortSignal` is composed end-to-end: the caller's signal plus the SDK's timeout signal both abort the in-flight fetch.
- Rate limit + retry are on by default with sensible policies for the bundled catalogue APIs (`DEFAULT_RATE_LIMITS`, `DEFAULT_RETRY_STATUSES`). Disable per-instance via `disableRateLimit: true` and `retry: false`.
- `HttpClient` supports two proxy routing modes (`prepend` puts the proxy in front of `host/path`; `query` passes the URL as a query param): `requestUrl(url)` is the single chokepoint for that rewrite.
- `DomRegistry` is a global single-parser registry. `BrowserDomParser` works in browsers; in Node, consumers (and the E2E tests' `beforeAll`) must shim `globalThis.DOMParser` via `linkedom` before any provider parses HTML. Providers call `DomRegistry.parse(html)`: they never touch `DOMParser` directly.
- `HlsUtils.rewriteManifest` rewrites every URI line in an `.m3u8` (including `URI="…"` inside `#EXT-X-KEY` / `#EXT-X-MAP`) so chunk fetches go through the same proxy as the manifest fetch.

### Unified URN ID space

Every `id` flowing in or out of the SDK is a URN of shape `${providerId}:${rawId}`. The first colon is the separator; the raw portion is opaque and may itself contain colons or slashes. Helpers in `src/utils/urn.ts`:

- `buildUrn(provider, raw)` / `parseUrn(urn)` / `unwrapUrn(provider, urn)` — the standard pair.
- `strictUnwrapUrn(provider, urn)` — throws on prefix mismatch. The server uses this on `/meta/info` to catch routing bugs at the boundary.
- `buildTypedUrn(provider, kind, raw)` / `parseTypedUrn(provider, urn)` — typed catalogue URNs (`mal:anime:21`, `kitsu:manga:13`). MAL and Kitsu integer IDs aren't globally unique across anime/manga, so they're encoded with the catalogue kind as the second segment.

Providers accept legacy bare IDs as input for backwards compatibility (via the non-strict `unwrapUrn`). Public surface always emits URN form.

**2. Extractors (`src/extractors/`)**: stateless, take only an embed URL and an `HttpClient`, return `IVideoPayload[]` (empty if they can't recover a direct stream). `BaseExtractor` is the contract. They're independently usable: a consumer can hand any embed URL to `BloggerExtractor` without involving a provider.

**3. Providers (`src/providers/`)**: site-specific. `BaseProvider` defines `search` → `fetchContentUnits(mediaId)` → `resolveStream(unitId, language?)`. `fetchContentUnits` is **language-agnostic** and returns one unified list; each `IContentUnit` carries `availableLanguages: ContentLanguage[]` so the caller picks the translation at `resolveStream` time. Providers may optionally implement `fetchUnitTracks(unitId, language?): Promise<IUnitTracks>` to expose subtitle/quality metadata without paying the `resolveStream` cost. `IVideoPayload.subtitles?: ISubtitleTrack[]` carries playable VTT URLs alongside the stream. Each provider composes one or more extractors:

- `AnimeParadiseProvider`: `api.animeparadise.moe` REST. `/anime/{id}/episode` for the list (sub only). `/ep/{uid}?origin={animeId}` returns the playable HLS link **and** `subData`, which `normalizeSubtitleEntries` (in `utils/subtitles.ts`) turns into VTT-only `ISubtitleTrack[]`. Implements `fetchUnitTracks` cheaply (just `/ep`, no stream URL resolution).
- `AllmangaProvider`: AllAnime GraphQL → AES-CTR-decrypted `tobeparsed` payload → `Mp4UploadExtractor`, with a `clock.json` fallback for wixmp/sharepoint sources. Source URLs are obfuscated with a `--<hex>` scheme XOR'd with `0x38`; see `decodeAllAnimeSource`. `fetchContentUnits` merges `availableEpisodesDetail.sub` + `.dub` + `.raw` into a single language-agnostic list; unit IDs are `${mediaId}/${epStr}` (legacy `${mediaId}/${epStr}/${lang}` IDs still resolve).
- `AnikotoProvider`: HTML scrape of `anikototv.to`; uses `anikotoapi.site` for episodes, then delegates to MegaPlay embed for stream/subtitles.
- `GogoanimeProvider`: HTML scrape of `anineko.to`; vibeplayer embed → `master.m3u8` via `GenericHlsExtractor`.
- `GoyabuProvider`: pulls a Blogger token from `playersData`, calls Google `batchexecute` to recover the `googlevideo.com` URL via `BloggerExtractor`.
- `MangadexProvider`: Official JSON API at `api.mangadex.org` for high-quality manga.
- `MangapillProvider`: HTML scrape of `mangapill.com` for manga.
- `MegaPlayProvider`: AniList GraphQL for search/episodes; resolves directly against MegaPlay's mapping endpoints.
- `WeebcentralProvider`: HTML scrape of `weebcentral.com` for manga.

All public surface is re-exported from `src/index.ts`, including the shared subtitle utilities (`normalizeSubtitleEntries`, `proxifySubtitleUrl`).

**4. Metadata layer (`src/meta/`)**: provider-agnostic catalogue access.

- `BaseMetadataProvider` is the abstract surface: `search`, `fetchMediaInfo`, `fetchContentUnits(urn, contentProvider)`, `resolveStream(urn, episodeNumber, contentProvider, language?)`, `fetchUnitTracks(...)`, `browse(kind, options)`. Episode selection is by metadata-level number, with `'auto'`/`'always'`/`'never'` absolute-episode rescue (walks PREQUEL relations to compute a season offset).
- Concrete providers:
  - `AnilistMeta`: graphql.anilist.co. Surfaces full `IMediaMetadata` plus `relations`, `characters` (with voice actors), `staff`, `recommendations`, `externalLinks`, and `streamingEpisodes` (per-episode title/thumbnail). Implements `browse({trending, popular, seasonal, top})`.
  - `MalMeta`: Jikan v4 (api.jikan.moe). Typed URNs (`mal:anime:21` / `mal:manga:13`). Populates `streamingEpisodes` with Jikan's `filler`/`recap` flags. Implements `browse({top, popular, seasonal})`. Surfaces `relations` from `/anime/{id}/full`.
  - `KitsuMeta`: kitsu.io JSON:API. Typed URNs. Surfaces cross-source `mappings` (AniList/MAL/AniDB/TVDB) from Kitsu's relationship graph.
- `MappingClient` resolves a meta record onto a content provider's raw media ID via a four-step waterfall: SdkCache → `provider.lookupByMapping` → external mapping APIs (MALSync + Anify raced in parallel; arm-server enriches the cache for follow-up lookups) → fuzzy title search. The fuzzy matcher uses composite similarity (Sørensen–Dice + token Jaccard + prefix score) with year and catalogType discriminators and an optional episode-count cross-check for borderline matches. The metadata record is **never mutated**; results land in the `SdkCache` keyed by `mapping:${metaProvider}:${metaNativeId}:${contentProvider}`.
- Per-content-provider native lookup hooks: `BaseProvider.lookupByMapping?(mappings)` lets a provider short-circuit the resolver when its site indexes by AniList/MAL/Kitsu directly. `MegaPlayProvider` opts in (its `mediaId` _is_ the AniList ID). Providers can also declare `static malsyncSites: readonly string[]` (Mangadex, Mangapill, WeebCentral do).

**5. Server (`src/server/index.ts`)**: `startServer({ providers, metaProviders?, port, proxy, cache, auth, proxyBase?, proxySignSecret?, proxyAllowedHosts? })`.

Routes:

- `GET /search` / `/content` / `/stream` / `/tracks` — content-provider operations.
- `GET /meta/search` / `/meta/info` / `/meta/content` / `/meta/stream` / `/meta/tracks` / `/meta/browse` — metadata operations.
- `GET /download/video` / `/download/manga/page` / `/download/manga/chapter` (+ `/progress` SSE variants) — file downloads.
- `GET /proxy` (when `proxy: true`) — accepts `url`, `h` (base64-JSON headers), `ct` (Content-Type override), and `sig` (required when `proxySignSecret` is set — HMAC-SHA256 of `url` + optional `|h=<h>`, hex). The proxy rewriter signs URLs it emits automatically.
- `GET /health` / `/openapi.json` — discovery.

The proxy base URL is derived from each incoming request's `Host` header (and `X-Forwarded-Proto` when present) so the SDK works behind reverse proxies without configuration. Override with `proxyBase`. SSRF risk is mitigated by `proxyAllowedHosts: string[]` (suffix-matched against the target's hostname).

`cache?: SdkCache` is an optional `{get, set}` interface (sync or async) that memoizes provider calls by namespaced keys: `search:<id>:<q>`, `content:<id>:<mid>`, `stream:<id>:<uid>:<lang>`, `tracks:<id>:<uid>:<lang>`, `meta:search:<id>:<q>`, `meta:info:<id>:<urn>`, `meta:content:<metaId>:<urn>:<contentId>`, `meta:stream:<...>`, `meta:tracks:<...>`, `meta:browse:<...>`, plus mapping keys `mapping:<metaProvider>:<rawId>:<contentProvider>`.

`/tracks` returns **501** for providers without `fetchUnitTracks`. `/meta/browse` returns **501** when the meta provider doesn't implement the requested kind. The example `examples/server.mjs` wires a `new Map()` as the cache.

## ESM import convention

`tsconfig.json` uses `module: NodeNext`, so **all relative imports in `src/` must include the `.js` extension** (even though source is `.ts`). New files must follow this: `import { X } from './foo.js'`, never `'./foo'`.

## Tests

- **Unit tests** (`tests/*.test.ts`) cover pure-logic modules: `HttpClient`, `HlsUtils`, `DomRegistry`, extractor parsing, language inference, URN helpers, similarity matcher, rate limiter, retry policy.
- **E2E tests** (`tests/e2e/*.test.ts`) are intentionally **not mocked**. Each searches a popular title, picks an episode, resolves the stream, and runs it through `captureStreamScreenshot`: which probes URLs with a Range GET (`Content-Type` + MP4 `ftyp` magic) to distinguish embed pages from raw video, fetches an HLS segment ~5s in, strips PNG-wrapped segments, and runs `ffmpeg` to extract a frame. Output lands in `scratch/screenshots/screenshot_<provider>.png` (gitignored). Assertion: the PNG is >1KB. Don't try to make these tests pass by mocking: the whole point is to catch upstream site changes.
- Each E2E test sets `vitest` `timeout: 90000`: these are slow and that's expected.
- `references/` (cloned source from `ani-cli`, `animdl`, `GoAnime`, `mov-cli`) is gitignored prior art for site-scraping logic; not part of the build or tests.

### Testing rules (do not negotiate)

These rules exist because the only useful tests are the ones that catch real regressions.

- **Never mock network requests.** No `vi.spyOn(http, 'get').mockResolvedValue(...)`, no `nock`, no fake `Response`. If the test needs an HTTP server, spawn a real `http.createServer(...)` in `beforeAll` and tear it down in `afterAll`.
- **Never use fake/fixture data in place of a live call.** No frozen JSON fixtures that pretend to be AniList/MAL/Kitsu responses. If you want to test a parser, run the parser against the live API.
- **Never "gracefully skip" a test.** Patterns like `if (!reachable) return;`, `it.skipIf(...)`, or `if (!process.env.X) return;` are **forbidden** — they make a red test look green. If the upstream is unreachable from this network, the test must fail loudly. The fix is to either (a) make the upstream reachable, (b) pick a different upstream the runner can reach, or (c) delete the test. A skipped test is a lie.
- **Tests must be real and pass.** Those are the only two states a test is allowed to be in. "Skipped because environment" is not a state.
- **If a test depends on something flaky** (a slow site, a rate-limited API), make the test handle the flakiness via the SDK's own retry/timeout policy — not via skipping.
- **Stubs that replace `BaseProvider` are allowed only for testing pure SDK logic** (e.g. the meta provider's episode-picking algorithm) where the content provider's network behavior is genuinely orthogonal. Stubs of `HttpClient` or external HTTP responses are not.

## Provider/extractor additions

When adding a provider:

- Extend `BaseProvider`, set `id` and `supportedTypes`, accept `HttpClient` in the constructor.
- Compose existing extractors where possible; only add a new extractor if the embed format is genuinely novel.
- Re-export from `src/index.ts`.
- Add a live E2E test that resolves a real stream and screenshots it.
