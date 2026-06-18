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

## Architecture (v2.0)

The SDK has five layers:

**1. Internal plumbing (`src/internal/`)**: private, never exported.

- `http.ts`: `HttpClient` wraps `fetch` with per-host rate limiting, exponential-backoff retry (honours `Retry-After`), curl fallback transport, and end-to-end `AbortSignal` composition.
- `dom.ts`: `DomRegistry` + `BrowserDomParser`. Auto-registers `linkedom` (a direct dependency) on first parse — no consumer shim needed.
- `hls.ts`: `HlsUtils.rewriteManifest` rewrites `.m3u8` URIs to route through a proxy.
- `id.ts`: `encodeId`/`decodeId` — base64url-JSON opaque IDs. All `Media`/`Episode`/`Chapter` ids are encoded here. Also exports legacy URN helpers (`buildUrn` etc.) for backward compat.
- `mapping.ts`: `MappingClient` — cross-source ID resolver. Four-step waterfall: cache → `source.lookupByMapping` → MALSync/Anify (raced) → fuzzy title match. Not exported.

**2. Types and errors (`src/types.ts`, `src/errors.ts`, `src/config.ts`)**: all public value types.

- `Media`, `Episode`, `Chapter`, `Stream`, `Pages`, `List<T>`, `SourceInfo`, `Score` — plain POJOs, `JSON.stringify`-safe.
- `AniError extends Error` with `AniErrorCode` const enum (`SourceUnavailable`, `NoStream`, `RegionBlocked`, `RateLimited`, `NotFound`, `Cancelled`, `BadId`).
- `SdkOptions` + `resolveOptions()`.

**3. Sources (`src/sources/`)**: internal, not exported from `src/index.ts`.

Single `Source` interface (`src/sources/base.ts`) replaces the old `BaseProvider` + `BaseMetadataProvider` split. Capability flags: `search`, `info`, `episodes`, `chapters`, `stream`, `pages`, `browse`, `mapping`.

- Catalogue sources: `anilist.ts`, `mal.ts`, `kitsu.ts` — implement `search`, `info`, `browse`.
- Anime playback: `allmanga.ts`, `megaplay.ts`, `animeparadise.ts`, `anikoto.ts`, `gogoanime.ts`, `goyabu.ts` — implement `episodes`, `stream`.
- Manga: `mangadex.ts`, `mangapill.ts`, `weebcentral.ts` — implement `chapters`, `pages`.

All sources use `encodeId`/`decodeId` for IDs. `stream(episodeId)` and `pages(chapterId)` decode the opaque ID to dispatch to the right source.

**4. Registry + SDK (`src/registry.ts`, `src/sdk.ts`, `src/progressive.ts`, `src/health.ts`)**: public API.

- `Registry`: holds sources, implements `fanOutSearch` (returns `ProgressiveResult<Media>`), `mergeEpisodes`, `rankPlaybackSources`.
- `HealthTracker`: rolling 20-call success/latency window per source. Used to rank playback sources.
- `ProgressiveResult<T>`: implements `AsyncIterable<T>` (results as they arrive) and `PromiseLike<T[]>` (collect all). `cancel()` aborts via `AbortSignal.any()`.
- `Sdk` class: 9 verbs — `search`, `info`, `sources`, `episodes`, `chapters`, `stream`, `pages`, `browse`, `health`. Each accepts value objects or opaque id strings.
- `createSdk(opts?)`: zero-config factory that instantiates `HttpClient` + all enabled sources + `Registry`.

**5. Server (`src/server/`)**: thin consumer of the SDK.

- `routes.ts`: 9 routes that decode params → call SDK → JSON-serialize.
- `startServerV2({ port, sdk })`: new single-call server. `sdk` defaults to `createSdk()`.
- `cli.ts`: process entry for `npx anime-sdk`. Reads `PORT`, `SOURCES_DISABLED` env vars.
- Legacy `startServer({ providers, metaProviders, ... })`: old 1.x API, kept for backward compat.

### ID space

Every `id` field on `Media`, `Episode`, `Chapter` is a base64url-encoded JSON token:

```json
{ "v": 1, "t": "media"|"episode"|"chapter", "s": "sourceId", "r": "rawId", "m": {} }
```

Consumers treat ids as opaque strings. The SDK decodes them internally to dispatch calls to the right source.

Legacy URN helpers (`buildUrn`, `parseUrn`, `unwrapUrn`, `strictUnwrapUrn`, `buildTypedUrn`, `parseTypedUrn`) are in `src/internal/id.ts` and exported from `src/index.ts` for backward compat.

### Extractors (`src/extractors/`)

Stateless, take an embed URL + `HttpClient`, return `IVideoPayload[]`. Used internally by sources. `BloggerExtractor`, `Mp4UploadExtractor`, `GenericHlsExtractor`, `VidstreamingExtractor`.

## ESM import convention

`tsconfig.json` uses `module: NodeNext`, so **all relative imports in `src/` must include the `.js` extension** (even though source is `.ts`). New files must follow this: `import { X } from './foo.js'`, never `'./foo'`.

## Tests

- **Unit tests** (`tests/*.test.ts`): cover pure-logic modules — `HttpClient`, `HlsUtils`, `DomRegistry`, extractor parsing, language inference, URN helpers + new `encodeId`/`decodeId`, similarity matcher, rate limiter, retry policy, `ProgressiveResult`, `Registry`, `Sdk` smoke test, types/errors/config.
- **E2E tests** (`tests/e2e/*.test.ts`): live, non-mocked. Each searches a popular title, picks an episode/chapter, resolves the stream/pages, and (for anime) runs `captureStreamScreenshot` to screenshot a real video frame. Assertion: the PNG is >1KB. The new source tests use `*Source` classes; a `streamToPayload()` helper converts `Stream` to `IVideoPayload` for the screenshot helper.

### Testing rules (do not negotiate)

- **Never mock network requests.** No `vi.spyOn(http, 'get').mockResolvedValue(...)`, no `nock`, no fake `Response`.
- **Never use fake/fixture data in place of a live call.**
- **Never "gracefully skip" a test.** `if (!reachable) return;`, `it.skipIf(...)` etc. are forbidden.
- **Tests must be real and pass.** Those are the only two states a test is allowed to be in.
- **Stubs that replace `BaseProvider` are allowed only for testing pure SDK logic** (e.g. the registry's source-ranking) where the content provider's network behavior is genuinely orthogonal.

## Source/extractor additions

When adding a source:

- Implement the `Source` interface from `src/sources/base.ts`.
- Use `encodeId`/`decodeId` from `src/internal/id.ts` for all external IDs.
- Compose existing extractors where possible.
- Re-register in `buildSources()` in `src/sdk.ts` with the source's `id`.
- Add a live E2E test that resolves a real stream/pages and screenshots it.
