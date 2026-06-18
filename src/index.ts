// ── 2.0 public surface ────────────────────────────────────────────────────────
export { createSdk, Sdk } from './sdk.js';
export type { ProgressiveResult } from './sdk.js';
export type {
  Media,
  Episode,
  Chapter,
  Stream,
  Pages,
  List,
  SourceInfo,
  Score,
  MediaTitle,
  MediaCover,
  Subtitle,
} from './types.js';
export { AniError, AniErrorCode } from './errors.js';
export type { SdkOptions } from './config.js';

// ── Server ────────────────────────────────────────────────────────────────────
export { startServerV2 } from './server/index.js';
// Legacy server (kept for existing consumers that use the old API)
export { startServer } from './server/index.js';
export type { ServerOptions } from './server/index.js';
export type { ServerV2Options } from './server/index.js';

// ── Downloads ─────────────────────────────────────────────────────────────────
export * from './download/index.js';

// ── Backward-compat 1.x exports (deprecated; removed when old tests updated) ──
// Old types
export * from './types/index.js';
// Old transport (now internal, but kept for tests that import directly)
export { HttpClient } from './internal/http.js';
export { HlsUtils } from './internal/hls.js';
export { DomRegistry, BrowserDomParser } from './internal/dom.js';
export { RateLimiter } from './internal/rateLimiter.js';
export { withRetry, HttpRetryableError, parseRetryAfter } from './internal/retry.js';
export { CurlFallbackTransport, FetchTransport } from './internal/transport.js';
// Old providers (kept for proxy tests + old server test)
export { AllmangaProvider } from './providers/AllmangaProvider.js';
export { GogoanimeProvider } from './providers/GogoanimeProvider.js';
export { GoyabuProvider } from './providers/GoyabuProvider.js';
export { AnikotoProvider } from './providers/AnikotoProvider.js';
export { MegaPlayProvider } from './providers/MegaPlayProvider.js';
export { AnimeParadiseProvider } from './providers/AnimeParadiseProvider.js';
export { MangadexProvider } from './providers/MangadexProvider.js';
export { WeebcentralProvider } from './providers/WeebcentralProvider.js';
export { MangapillProvider } from './providers/MangapillProvider.js';
export { BaseProvider } from './providers/BaseProvider.js';
// Old meta (kept for server test)
export { AnilistMeta } from './meta/AnilistMeta.js';
export { MalMeta } from './meta/MalMeta.js';
export { KitsuMeta } from './meta/KitsuMeta.js';
export { MappingClient } from './meta/MappingClient.js';
// Old utils (kept for server which uses urn helpers)
export * from './utils/crypto.js';
export * from './utils/subtitles.js';
export * from './utils/urn.js';
