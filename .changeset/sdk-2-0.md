---
'anime-sdk': major
---

# anime-sdk 2.0

A complete redesign around a single `createSdk()` factory and nine verbs.

## Highlights

- **`createSdk()`**: zero-config factory. All 12 sources, built-in DOM parser, sane rate limits.
- **Unified `Media`/`Episode`/`Chapter` types**: plain POJOs, `JSON.stringify`-safe, opaque `id` fields.
- **`ProgressiveResult<T>`**: `AsyncIterable<T>` + `PromiseLike<T[]>` for search results.
- **`Stream.adjacent`**: prev/next episode IDs without a second fetch.
- **`Stream.origin`**: `{ host, url, proxied }` — no URL parsing on the consumer side.
- **`Score { value, scale }`**: units carried.
- **`sdk.sources(media)`**: ranked list of playable providers — safe "Watch via" dropdown.
- **`npx anime-sdk`**: zero-install server. `PORT`, `SOURCES_DISABLED`, `PROXY_*` env vars.
- **`startServer({ proxy })`**: optional `/proxy` endpoint with SSRF allowlist + HMAC signing. Every `Stream`/`Pages` URL the server emits gets rewritten to be browser-playable.
- **`downloadVideo` / `downloadMangaChapter` / `downloadMangaPage`**: built-in MP4 (via ffmpeg mux) and ZIP downloaders that work on `Stream`/`Pages` directly.
- **Manga has no language axis**: `sdk.pages(chapter)` — no `language` argument.
- **`AniError` + `AniErrorCode`**: structured error type for branching without string matching.
- **AbortSignal on every async call**.
