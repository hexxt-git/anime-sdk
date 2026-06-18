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
export type { AniErrorCode as AniErrorCodeType } from './errors.js';
export type { SdkOptions } from './config.js';

// ── Legacy 1.x surface (kept for backwards compat; removed in Phase 10) ──────
// Types
export * from './types/index.js';

// Transport
export * from './transport/http.js';
export * from './transport/hlsUtils.js';
export * from './transport/dom.js';
export * from './transport/rateLimiter.js';
export * from './transport/retry.js';
export * from './transport/transport.js';

// Extractors
export * from './extractors/BaseExtractor.js';
export * from './extractors/VidstreamingExtractor.js';
export * from './extractors/Mp4UploadExtractor.js';
export * from './extractors/GenericHlsExtractor.js';
export * from './extractors/BloggerExtractor.js';

// Base
export * from './providers/BaseProvider.js';

// Providers
export * from './providers/AllmangaProvider.js';
export * from './providers/GogoanimeProvider.js';
export * from './providers/GoyabuProvider.js';
export * from './providers/AnikotoProvider.js';
export * from './providers/MegaPlayProvider.js';
export * from './providers/AnimeParadiseProvider.js';
export * from './providers/MangadexProvider.js';
export * from './providers/WeebcentralProvider.js';
export * from './providers/MangapillProvider.js';

// Utilities
export * from './utils/crypto.js';
export * from './utils/subtitles.js';
export * from './utils/urn.js';

// Metadata layer
export * from './meta/index.js';

// Download
export * from './download/index.js';

// HTTP server
export * from './server/index.js';
