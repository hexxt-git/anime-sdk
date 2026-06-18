---
'anime-sdk': major
---

# anime-sdk 2.0

## Breaking changes

The public API has been completely redesigned. Old exports (`BaseProvider`, `BaseMetadataProvider`, `AllmangaProvider`, `AnilistMeta`, `HttpClient`, URN helpers, etc.) are kept for one release cycle under the `// Backward-compat 1.x` section of `src/index.ts` and will be removed in 3.0.

### Migration table

| 1.x                                                            | 2.0                                                         |
| -------------------------------------------------------------- | ----------------------------------------------------------- |
| `new AllmangaProvider(http)` / `new AnilistMeta(http)`         | `createSdk()`                                               |
| `provider.search(q)` → `IMediaSearchResult[]`                  | `sdk.search(q)` → `ProgressiveResult<Media>`                |
| `provider.fetchContentUnits(mediaId)` → `IContentUnit[]`       | `sdk.episodes(media)` → `List<Episode>`                     |
| `provider.resolveStream(unitId, lang)` → `ResolvedMediaStream` | `sdk.stream(episode)` → `Stream`                            |
| `buildUrn` / `parseUrn` / `strictUnwrapUrn`                    | `encodeId` / `decodeId` (internal; ids are opaque)          |
| `startServer({ providers, metaProviders })`                    | `startServerV2({ port, sdk })` or `startServer(...)` (kept) |
| `IVideoPayload.sourceUrl`                                      | `Stream.url`                                                |
| `IVideoPayload.isHLS`                                          | `Stream.isHls`                                              |
| Score as `number` (0–100)                                      | `Score { value, scale }`                                    |
| `IMediaTitle.userPreferred`                                    | `MediaTitle.preferred`                                      |
| `IMediaImage.large`                                            | `MediaCover.url`                                            |

## New features

- **`createSdk()`**: zero-config factory. All 12 sources, built-in DOM parser, sane rate limits.
- **Unified `Media`/`Episode`/`Chapter` types**: plain POJOs, `JSON.stringify`-safe, opaque `id` fields.
- **`ProgressiveResult<T>`**: `AsyncIterable<T>` + `PromiseLike<T[]>` for search results.
- **`Stream.adjacent`**: prev/next episode IDs without a second fetch.
- **`Stream.origin`**: `{ host, url, proxied }` — no proxy URL parsing on the consumer side.
- **`Score { value, scale }`**: units carried; no more `(score / 10).toFixed(1)` everywhere.
- **`sdk.sources(media)`**: ranked list of playable providers — safe "Watch via" dropdown.
- **`npx anime-sdk`**: zero-install server. `PORT`, `SOURCES_DISABLED` env vars.
- **Manga has no language axis**: `sdk.pages(chapter)` — no `language` argument.
- **`AniError` + `AniErrorCode`**: structured error type for branching without string matching.
- **AbortSignal on every async call**.
