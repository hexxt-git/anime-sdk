# anime-sdk 2.0

A TypeScript SDK for searching anime and manga, resolving playable streams and manga pages. Library-first — the SDK is the product, the bundled HTTP server is a convenience.

[anime-sdk.hexxt.dev](https://animesdk.hexxt.dev/)

## Install

```bash
npm install anime-sdk
```

## Usage

### Search → stream (3 calls)

```ts
import { createSdk } from 'anime-sdk';

const sdk = createSdk(); // zero config — all 12 sources enabled

// 1. Search
const results = await sdk.search('frieren', { kind: 'anime' });
// or iterate as results arrive:
for await (const hit of sdk.search('frieren', { kind: 'anime' })) {
  console.log(hit.title.preferred);
}

// 2. List episodes
const { items: episodes } = await sdk.episodes(results[0]);
// items is Episode[] — each has an opaque .id

// 3. Resolve stream
const stream = await sdk.stream(episodes[0], { language: 'sub' });
console.log(stream.url); // playable HLS or MP4 URL
console.log(stream.origin.host); // origin hostname (no proxy URL parsing needed)
console.log(stream.adjacent.next); // prev/next episode for navigation
```

### Manga

```ts
const { items: chapters } = await sdk.chapters(mangaResult);
const pages = await sdk.pages(chapters[0]); // no language argument
console.log(pages.pages.map((p) => p.url));
```

### Browse

```ts
const trending = await sdk.browse({ list: 'trending', kind: 'anime' });
```

### HTTP server (one line)

```ts
import { startServerV2 } from 'anime-sdk/server';
await startServerV2({ port: 3030 }); // SDK auto-constructed from env
```

Or via CLI:

```sh
npx anime-sdk          # → listening on http://localhost:3030
PORT=8080 npx anime-sdk
SOURCES_DISABLED=goyabu npx anime-sdk
```

### Custom config

```ts
createSdk({
  sources: ['anilist', 'allmanga'], // whitelist
  disabled: ['goyabu'], // or blacklist
  http: { timeoutMs: 10000, retries: 2 },
  proxy: { signSecret: process.env.PROXY_SECRET },
  cache: {
    get: (k) => store.get(k),
    set: (k, v) => store.set(k, v),
  },
});
```

### Error handling

```ts
import { AniError, AniErrorCode } from 'anime-sdk';

try {
  const stream = await sdk.stream(episode);
} catch (e) {
  if (e instanceof AniError) {
    switch (e.code) {
      case AniErrorCode.NoStream: // no playable URL found
      case AniErrorCode.SourceUnavailable: // upstream unreachable
      case AniErrorCode.RateLimited: // rate limit hit
      case AniErrorCode.Cancelled: // AbortSignal fired
      case AniErrorCode.NotFound: // title/episode not found
    }
  }
}
```

### Cancellation

```ts
const ac = new AbortController();
setTimeout(() => ac.abort(), 5000);
const results = await sdk.search('frieren', { kind: 'anime', signal: ac.signal });
```

## Sources

| ID              | Site               | Type        | Capabilities         |
| --------------- | ------------------ | ----------- | -------------------- |
| `anilist`       | graphql.anilist.co | anime+manga | search, info, browse |
| `mal`           | api.jikan.moe      | anime+manga | search, info, browse |
| `kitsu`         | kitsu.io           | anime+manga | search, info         |
| `allmanga`      | allmanga.to        | anime       | episodes, stream     |
| `megaplay`      | megaplay.buzz      | anime       | episodes, stream     |
| `animeparadise` | animeparadise.moe  | anime       | episodes, stream     |
| `anikoto`       | anikototv.to       | anime       | episodes, stream     |
| `gogoanime`     | anineko.to         | anime       | episodes, stream     |
| `goyabu`        | goyabu.io          | anime       | episodes, stream     |
| `mangadex`      | mangadex.org       | manga       | chapters, pages      |
| `mangapill`     | mangapill.com      | manga       | chapters, pages      |
| `weebcentral`   | weebcentral.com    | manga       | chapters, pages      |

## Server routes (v2)

```
GET /search?q=…&kind=anime           → Media[]
GET /media/:id                       → Media
GET /media/:id/episodes              → List<Episode>
GET /media/:id/chapters              → List<Chapter>
GET /media/:id/sources               → SourceInfo[]
GET /episode/:id/stream?language=sub → Stream
GET /chapter/:id/pages               → Pages
GET /browse?list=trending&kind=anime → List<Media>
GET /health                          → SourceHealth[]
```

## API reference

Public exports: `createSdk`, `Sdk`, `AniError`, `AniErrorCode`, `Media`, `Episode`, `Chapter`, `Stream`, `Pages`, `List`, `SourceInfo`, `SdkOptions`, `Score`.

Server: `startServerV2`, `ServerV2Options` (from `anime-sdk/server`).

All types are plain POJOs — `JSON.stringify` round-trips, safe for React state, Zustand, Redux.

## Requirements

Node 20+. `ffmpeg` on `PATH` (E2E test suite only).
