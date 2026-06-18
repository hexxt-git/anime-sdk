# ani-sdk — Restructure Proposal

A clean-slate redesign aimed at one thing: **a junior dev should be able to build a working anime/manga app in 10 minutes without reading source code.**

The current SDK has a correct mental model — _catalogue → episodes → stream_ — buried under five layers of abstractions (transport, extractors, providers, meta, server), a URN string format, dual provider hierarchies (content vs meta), a manual `DOMParser` shim, a custom `CallOptions` bag threaded through everything, and ~40 named public exports. This document throws that away and proposes alternatives.

The result we must preserve: **find a title → list episodes/chapters → get a playable stream URL or manga page URLs**, with optional metadata enrichment (AniList/MAL/Kitsu), optional HTTP server, optional proxy, optional cache. Nothing else is sacred.

---

## Table of contents

1. [Diagnosis: why the current SDK is hard](#1-diagnosis)
2. [Design principles](#2-design-principles)
3. [Option A — The fluent client (recommended)](#3-option-a--the-fluent-client)
4. [Option B — The query-spec client](#4-option-b--the-query-spec-client)
5. [Option C — Server-first / "headless backend"](#5-option-c--server-first)
6. [Option D — Pipelines and middleware](#6-option-d--pipelines-and-middleware)
7. [Cross-cutting ideas worth stealing](#7-cross-cutting-ideas)
8. [Concrete file layout (for Option A)](#8-file-layout)
9. [Migration & rollout sketch](#9-migration)

---

## 1. Diagnosis

What makes the current SDK feel like a PhD project:

| Pain                               | What's happening                                                                                                                                | What it costs the user                                                       |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| **Two parallel "provider" worlds** | `BaseProvider` (sites) and `BaseMetadataProvider` (catalogues) are separate hierarchies that the user has to wire together via `MappingClient`. | "Do I want `AnilistMeta` or `AllmangaProvider`? Both? In what order?"        |
| **Manual ID format**               | URN strings `"anilist:21"`, `"mal:anime:21"`. Some helpers throw, others don't. Some accept legacy bare IDs.                                    | Users have to learn a string format that is not enforced by the type system. |
| **DOMParser shim requirement**     | Node consumers have to install `linkedom` and assign `globalThis.DOMParser` before any HTML provider runs.                                      | Cryptic runtime errors on first use.                                         |
| **CallOptions bag**                | A single options shape carrying fields meaningful at different layers ("ignored where not meaningful").                                         | Users don't know which knob applies where; autocomplete shows everything.    |
| **Three-step resolution**          | `search → fetchContentUnits → resolveStream`, with `fetchUnitTracks` as a side path, and language-as-an-orthogonal axis on the third call.      | Lots of ceremony for "give me episode 5 of Naruto."                          |
| **Transport layer is public**      | `HttpClient`, `RateLimiter`, `HttpRetryableError`, `CurlFallbackTransport`, `FetchTransport`, `HlsUtils`, `DomRegistry` are all exported.       | The "public surface" of the SDK is dominated by plumbing nobody needs.       |
| **Server is bolted on**            | `startServer` re-implements the SDK's surface as HTTP routes that mostly mirror the JS API one-to-one.                                          | Two sources of truth (TS surface + REST routes) that drift.                  |

Note what is **not** broken: the extractor pattern, the rate-limit-per-host policy, HLS manifest proxy rewriting, the mapping waterfall idea, the URN concept itself (just not as a hand-written string). These are _good ideas_ — they just don't need to be in the user's face.

---

## 2. Design principles

The redesign should obey these, even when it costs flexibility:

1. **One API surface.** A user imports one thing and gets autocomplete to everything they'll ever do. Plumbing is not exported.
2. **Result is reachable in ≤2 calls.** Search and play should be one or two `await`s, not three plus a mapping client.
3. **IDs are objects, not strings.** No hand-formatted URNs at the user boundary. The library round-trips IDs as opaque tokens.
4. **Catalogue and source are one concept.** A "Source" is anything that can answer "do you have X, and can you give me Y about it?" — whether that's AniList (metadata only), MegaPlay (stream only), or AllManga (both).
5. **Sensible defaults that just work.** `createClient()` with zero arguments should be enough to build a working app in Node. No `DOMParser` shim, no rate-limit config, no proxy config.
6. **Server is generated, not hand-written.** If we expose 6 verbs, the server has 6 routes — derived from the API, not duplicated.
7. **Optional features stay optional and tree-shake.** Manga, metadata, server, proxy, downloads should each be optional sub-imports.
8. **Testability without mocking.** Keep the "no-mocks" E2E discipline. The shape of the API shouldn't make that harder.

---

## 3. Option A — The fluent client

**Recommended.** Highest UX gain for least implementation complexity.

### The whole API in one screen

```ts
import { createClient } from 'ani-sdk';

const client = createClient(); // ← that's it. Defaults for everything.

// Find something
const results = await client.anime.search('frieren');
// results: { id: MediaId, title: string, cover?: string, year?: number }[]

// Get rich info
const info = await results[0].info();
// info: { title, description, episodes, cover, banner, genres, ... }

// List episodes (auto-merges metadata + source data)
const episodes = await results[0].episodes();
// episodes: Episode[] — each has number, title, thumbnail, languages, isFiller

// Play one
const stream = await episodes[4].stream({ language: 'sub', quality: '1080p' });
// stream: { url, isHls, headers, subtitles }

// Manga is symmetric
const manga = await client.manga.search('chainsaw man');
const chapters = await manga[0].chapters();
const pages = await chapters[0].pages();
```

That is the **entire** primary surface. No `BaseProvider`, no `MappingClient`, no URNs visible, no `HttpClient`, no `CallOptions`. The user never picks a provider unless they want to.

### Key moves that make this work

#### 3.1 `MediaId` is an opaque object, not a URN string

```ts
// Returned by search; never constructed by hand.
class MediaId {
  // Internally carries { sources: Map<SourceId, rawId>, kind: 'anime'|'manga' }
  // — but the user only sees opaque methods.
  toJSON(): string; // serialize for storage / URL params
  static fromJSON(s: string): MediaId;
}
```

A `MediaId` knows _all_ the IDs that map to the same title (AniList #21, MAL #21, AllManga `Vw9bN…`) the moment any one of them is resolved. This kills the mapping waterfall from the API surface — the client resolves lazily and caches on the ID itself.

Compare to today: the user holds `"anilist:21"` and has to separately ask `MappingClient` to figure out the AllManga ID. The new design _attaches_ mappings to the ID.

#### 3.2 Search returns "live" objects, not records

The objects returned from `search` are not POJOs — they are thin handles with methods (`info()`, `episodes()`, `chapters()`). Each method memoizes. The user never says "okay, now pass the id to `fetchContentUnits`."

If a user wants pure data (for serialization, Redux store, etc.) they call `.toJSON()` which returns the POJO shape. The class is just a UX wrapper.

#### 3.3 Sources, not providers

Replace the dual `BaseProvider` / `BaseMetadataProvider` hierarchy with **one** interface:

```ts
interface Source {
  id: string; // 'anilist', 'allmanga', 'megaplay'
  kinds: ('anime' | 'manga')[];
  capabilities: {
    search?: true;
    info?: true; // describe a title
    units?: true; // list episodes/chapters
    stream?: true; // resolve to a playable URL
    browse?: true; // top/trending/seasonal
  };
  // Implementation methods are internal; the registry composes them.
}
```

The client maintains two ordered lists per kind: `metadataSources` (preferred for info & search ranking) and `playbackSources` (preferred for streams). On `episodes()` the client _fuses_ the best metadata source's per-episode data with the best playback source's actual list, keyed by episode number. No `MappingClient` in the user's face — it's an implementation detail of the registry.

#### 3.4 Configuration is layered, all optional

```ts
const client = createClient({
  // 1. zero config: pick the bundled defaults
  // 2. small config: pick which sources to enable
  sources: ['anilist', 'mal', 'allmanga', 'mangadex'],
  // 3. medium config: knobs
  http: { proxy: 'https://proxy.example.com', timeoutMs: 15_000 },
  cache: new Map(),
  // 4. power-user: inject custom sources
  extend: [myCustomSource],
});
```

No `HttpClient` constructor exposed to the user. No `DOMParser` shim — the SDK bundles a minimal HTML parser (or auto-detects `linkedom` if present, or ships a `parse5`-based fallback).

#### 3.5 `Stream` is a smart object, not a payload

```ts
const stream = await episode.stream();

stream.url; // direct URL (proxied if proxy is on)
stream.subtitles; // ISubtitleTrack[]
stream.qualities; // [{ quality, url }] for HLS variants
stream.headers; // playback headers (Referer, etc.)

await stream.download('out.mp4'); // built-in download
const blob = await stream.toBlob(); // for browser MediaSource
const hls = stream.hlsManifest({ proxy }); // rewritten m3u8 text
```

Today's `IVideoPayload[]` + `HlsUtils` + `download/index.ts` collapse into one object. The user does _not_ learn three modules.

#### 3.6 Streaming progressive results

`search` returns `AsyncIterable<MediaResult>` _and_ implements `.then` (i.e. it's both a `PromiseLike<MediaResult[]>` and an iterable). Apps that want a Spotify-style "results as they arrive" UX iterate; apps that just want the array `await` it.

```ts
for await (const hit of client.anime.search('one piece')) {
  showInUI(hit); // appears as each source responds
}
// or:
const all = await client.anime.search('one piece'); // waits for everyone
```

#### 3.7 Errors are typed, not strings

```ts
import { AniError, AniErrorCode } from 'ani-sdk';

try {
  await episode.stream();
} catch (e) {
  if (e instanceof AniError) {
    switch (e.code) {
      case AniErrorCode.SourceUnavailable: ...
      case AniErrorCode.RegionBlocked:    ...
      case AniErrorCode.NoStream:         ...
      case AniErrorCode.RateLimited:      ...
    }
  }
}
```

No more "did this throw because of network or because the upstream changed its DOM?"

---

## 4. Option B — The query-spec client

For users who think in _what they want_ rather than _which methods to call_. Trades fluency for declarativeness; works well for server-side / batch use.

```ts
import { ani } from 'ani-sdk';

const result = await ani({
  query: 'frieren',
  kind: 'anime',
  episode: 5,
  language: 'sub',
  quality: '1080p',
  include: ['info', 'subtitles', 'related'],
});

// result: { info, episode: { stream, subtitles }, related: [...] }
```

One function. The SDK figures out which sources to hit. Good for cron jobs ("download the latest episode of every anime in my list every Tuesday at 3am") and for LLM tool-calling (one schema, every operation).

**Composes well with Option A:** ship Option A as the primary API, ship `ani(spec)` as a sugar wrapper for the 80% case.

---

## 5. Option C — Server-first

The observation: a real chunk of users are building _streaming sites_, where the SDK runs on the server and the browser talks JSON. Today that's done via `startServer(...)` bolted on top of the JS API.

Flip it. Make the **HTTP API the primary contract**, and ship two clients on top:

```
ani-server/        ← node service, single binary, configurable via env vars
ani-sdk-node/      ← thin wrapper around fetch() to ani-server
ani-sdk-browser/   ← same, for browsers
```

```ts
// Browser
import { createClient } from 'ani-sdk-browser';
const client = createClient({ baseUrl: 'https://my-ani-server.example' });
await client.anime.search('frieren');
```

Pros:

- The hard parts (DOM parsing, ffmpeg, rate-limit state, cookies) live in **one** place.
- One OpenAPI spec drives both clients; no drift.
- A user with a Vercel/Cloudflare account can `deploy → done` and have a working backend in minutes.
- Tighter security: scraping credentials/cookies never reach the browser.

Cons:

- Users who _want_ a pure library (Electron apps, CLIs) now run an embedded server. Workable (start it in-process) but heavier.

**Hybrid:** ship Option A's classes as the in-process API, and have `createClient({ baseUrl })` _also_ exist as a drop-in remote variant. Same surface, two transports.

---

## 6. Option D — Pipelines and middleware

For library-builders rather than app-builders. Every operation is a pipeline of pure functions; the user composes their own client out of stages.

```ts
import { pipeline, sources, transforms, sinks } from 'ani-sdk';

const myClient = pipeline()
  .search(sources.anilist())
  .info(sources.anilist())
  .episodes(sources.allmanga())
  .stream(sources.allmanga())
  .use(transforms.rateLimit({ perHost: '1rps' }))
  .use(transforms.cache(new Map()))
  .use(transforms.proxy({ base: 'https://p.example' }))
  .use(transforms.observability(myLogger))
  .build();
```

Pros: extremely testable, every stage is pure, easy to slot in a new source as a one-liner.
Cons: more concepts up front; verges back into "PhD territory" if not careful.

Best treated as a **power-user escape hatch under Option A**, not the primary surface.

---

## 7. Cross-cutting ideas worth stealing

These can layer onto any of the options above. Some are speculative.

### 7.1 Source health & auto-failover

The client tracks per-source rolling success rate. If `allmanga` 5xxs three times in a row, the next `episodes()` call silently tries `gogoanime` first. Today the user picks a provider and lives with its failures.

```ts
client.health(); // { allmanga: 'ok', gogoanime: 'degraded', goyabu: 'down' }
```

### 7.2 Watch-state as a first-class concept

Many apps need progress tracking. Today the SDK punts entirely.

```ts
client.progress.set(episode, { positionSec: 1432, completed: false });
const next = client.progress.continueWatching(); // sorted by recency
```

Storage is pluggable (`progressStore?: ProgressStore`), defaulting to in-memory. This is a 100-line module and would save every consumer from writing it.

### 7.3 Subscriptions: "tell me when episode 8 is out"

```ts
const sub = client.subscribe(media, { onNewEpisode: (ep) => ... });
// internally: cheap polling against the cheapest source's episode-count endpoint
sub.cancel();
```

Pairs well with Option C (server-first) where one node polls and broadcasts.

### 7.4 LLM/agent-ready tool schema

Ship `client.tools` as a Zod / JSON-Schema description of every method, so any agent framework can drop the SDK in without a wrapper.

```ts
import { tools } from 'ani-sdk/tools';
agent.useTools(tools); // ready for Anthropic / OpenAI tool-use
```

### 7.5 Offline-first manga reader

Manga is the easier case (pages are static images). Ship a `downloadChapter()` that returns a CBZ blob, and a `client.library` for managing downloaded volumes. Most readers want this and write it themselves badly.

### 7.6 First-class request-tracing

A debug mode that emits one event per upstream call (URL, source, duration, cache-hit) so consumers can wire it into Sentry/Datadog without reverse-engineering the SDK.

```ts
createClient({ trace: (e) => console.log(e.source, e.url, e.durationMs) });
```

### 7.7 Schema-first source manifests

A source is a JSON file describing its endpoints + a small parser script (TS plugin). This makes it possible for non-maintainers to PR new sources without touching the core, and to ship sources over-the-air (a `client.refreshSources()` that pulls a signed manifest).

Trade-off: increases attack surface; would need code signing.

### 7.8 Smart cache, not dumb cache

Today's `SdkCache` is `{get, set}` and the caller picks TTL. Better: the SDK declares per-method semantics (search results: 1h; episode lists: 6h; stream URLs: _do not cache, they're signed_; metadata: 24h) and exposes those defaults — caller can override per-namespace.

### 7.9 Versioned source contracts

Bake the source's expected response shape into the source itself, and have CI run live snapshots nightly. When a source's parser silently starts returning empty arrays, a CI bot opens an issue. The "screenshot-the-frame" E2E discipline is good — formalize it.

---

## 8. File layout

For **Option A** (recommended), the source tree shrinks dramatically:

```
src/
  index.ts                  # public surface: createClient, types, errors
  client.ts                 # the Client class and its facets (anime/manga)
  media.ts                  # MediaId, MediaResult, Episode, Stream classes
  errors.ts                 # AniError + codes
  http.ts                   # internal fetch wrapper (NOT exported)
  registry.ts               # source registry + fusion logic
  sources/
    base.ts                 # the single Source interface
    anilist.ts
    mal.ts
    kitsu.ts
    allmanga.ts
    megaplay.ts
    mangadex.ts
    ...
  extractors/               # still useful internally, NOT exported
    base.ts
    mp4upload.ts
    blogger.ts
    hls.ts
  internal/
    rate-limit.ts
    retry.ts
    dom.ts                  # bundles a default parser; no shim required
    proxy.ts                # URL rewriting + HLS manifest rewriting
    cache.ts
  server/                   # optional sub-import: 'ani-sdk/server'
    index.ts                # auto-generated from client surface
  tools/                    # optional sub-import: 'ani-sdk/tools' (LLM schema)
```

**~10 files vs. today's 40+.** Public surface goes from ~40 exports to ~6 (`createClient`, `AniError`, `AniErrorCode`, a couple of types like `MediaResult`, `Episode`, `Stream`).

`package.json` exports:

```jsonc
{
  "exports": {
    ".": "./dist/index.js",
    "./server": "./dist/server/index.js",
    "./tools": "./dist/tools/index.js",
    "./sources": "./dist/sources/index.js", // for power users
  },
}
```

---

## 9. Migration

Not part of the brief, but for reference if Option A is picked:

1. **Adapter month.** Ship `createClient()` alongside the existing exports; new code uses the new API, old code keeps working.
2. **Deprecate.** Mark every existing export `@deprecated` with a migration hint pointing to the new equivalent.
3. **Major bump.** Remove deprecated exports in `2.0`. Provide a one-page migration guide ("`new AllmangaProvider(http)` → `createClient({ sources: ['allmanga'] }).anime`").
4. **Source contributions don't change much.** Today a contributor writes a `BaseProvider` subclass; tomorrow they write a `Source` object. The HTML/JSON parsing logic ports almost verbatim — what changes is the wrapper.

---

## TL;DR — pick one

| If you want…                                         | Pick                                     |
| ---------------------------------------------------- | ---------------------------------------- |
| Best DX for app builders, smallest surface           | **Option A**                             |
| Tiny LLM-tool/cron-job ergonomics                    | Option B (as sugar on top of A)          |
| Multi-tenant SaaS, browser apps, "one binary deploy" | Option C (with A as in-process fallback) |
| Building your own framework on top                   | Option D (as escape hatch under A)       |

**Recommendation:** Build **Option A**, expose **Option B** as a one-function sugar wrapper, and structure the internals so **Option C** is a 200-line additional package later. Skip **Option D** until a real power user asks for it.

The whole redesign is one idea repeated everywhere: **the user should be able to forget that the SDK has layers.**
