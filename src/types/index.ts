export type MediaCatalogType = 'ANIME' | 'MOVIE' | 'TV' | 'MANGA';

/**
 * Unified Resource Name — every ID emitted by an SDK provider has shape
 * `${providerId}:${rawId}`. The first colon is the separator; the raw part
 * is opaque and may contain further colons or slashes. See `utils/urn.ts`
 * for build/parse helpers.
 */
export type Urn = string;

/**
 * Language/translation type for anime content.
 * - 'sub': Subtitled (original Japanese audio with subtitles)
 * - 'dub': Dubbed (localized audio track, typically English)
 * - 'raw': No subtitles, original audio only
 */
export type ContentLanguage = 'sub' | 'dub' | 'raw';

export interface IMediaSearchResult {
  id: string;
  title: string;
  thumbnailUrl?: string;
  catalogType: MediaCatalogType;
  providerId: string;
  /** Languages available for this title (sub/dub/raw). Omitted if unknown. */
  availableLanguages?: ContentLanguage[];
  /**
   * Year of release/publication, if the provider exposes it. The
   * metadata-layer fuzzy matcher uses this as a discriminator: when two
   * candidate titles are similar but their years differ by more than
   * `MappingClientOptions.yearTolerance`, the lower-year match is
   * rejected. Pre-existing providers that don't surface a year just
   * disable the year filter for that candidate.
   */
  year?: number;
}

export interface IContentUnit {
  id: string; // Provider-specific internal ID (language-agnostic when possible)
  title: string;
  number: number;
  /**
   * Translation types this unit can be played in. Providers return a single
   * unified episode list — callers pick which translation to resolve at
   * `resolveStream` time. Omitted if the provider cannot guarantee availability
   * ahead of time.
   */
  availableLanguages?: ContentLanguage[];
  /**
   * Subtitle tracks known to be available for this unit, when the provider
   * exposes that at episode-list time. Each entry carries the same shape as
   * {@link ISubtitleTrack} *minus* the URL (URLs are only resolved during
   * `resolveStream` / `fetchUnitTracks`). Omitted when the provider can't
   * surface this without per-unit resolution.
   */
  availableSubtitles?: ISubtitleAvailability[];
  /**
   * Video qualities known to be available for this unit, when the provider
   * exposes that at episode-list time. Omitted when not available.
   */
  availableQualities?: IVideoPayload['quality'][];
  /**
   * Per-episode metadata folded in by `BaseMetadataProvider.fetchContentUnits`
   * from the metadata layer (AniList `streamingEpisodes`, Jikan filler flags,
   * …). Optional — content providers themselves never populate these.
   */
  thumbnailUrl?: string;
  description?: string;
  airDate?: string;
  isFiller?: boolean;
  isRecap?: boolean;
}

export interface ISubtitleAvailability {
  language: string;
  label: string;
  format?: 'vtt' | 'srt' | 'ass';
}

export interface ISubtitleTrack extends ISubtitleAvailability {
  url: string;
}

/**
 * Per-unit track metadata returned from `fetchUnitTracks`. Lets a consumer
 * introspect which subtitle/video tracks exist for an episode *without*
 * triggering a full stream resolution (which is often the slowest step).
 */
export interface IUnitTracks {
  subtitles: ISubtitleTrack[];
  qualities: IVideoPayload['quality'][];
  headers?: Record<string, string>;
}

export interface IVideoPayload {
  sourceUrl: string;
  isHLS: boolean;
  quality: '1080p' | '720p' | '480p' | '360p' | 'auto';
  /** The translation type of this stream (sub/dub/raw) */
  language?: ContentLanguage;
  headers?: Record<string, string>;
  subtitles?: ISubtitleTrack[];
}

export interface IMangaPayload {
  imageUrls: string[];
  headers?: Record<string, string>;
}

export type ResolvedMediaStream =
  | { type: 'video'; streams: IVideoPayload[] }
  | { type: 'manga'; pages: IMangaPayload };

export interface IDomElement {
  querySelector(selector: string): IDomElement | null;
  querySelectorAll(selector: string): IDomElement[];
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly outerHTML: string;
  readonly innerHTML: string;
}

export interface IDomParser {
  parse(html: string): IDomElement;
}

/**
 * Canonical per-call options bag.
 *
 * Every public method in the SDK (content providers, meta providers,
 * mapping client) accepts an instance of this bag. Fields that aren't
 * meaningful at a particular layer are simply ignored there — e.g. a
 * content provider doesn't honour `strictEpisodeMatching`, but it's
 * harmless when present.
 *
 * Threading a single shape through every layer means a caller can build
 * one `CallOptions` (with an `AbortSignal` + their preferred meta-layer
 * knobs) and pass it through unchanged.
 */
export interface CallOptions {
  /** Cancels the in-flight call. Propagated to `fetch`, the rate limiter,
   * and the retry loop. */
  signal?: AbortSignal;
  /**
   * Meta-layer only: when true, a missing episode number throws instead
   * of falling back to closest-below. Content providers ignore this.
   */
  strictEpisodeMatching?: boolean;
  /**
   * Meta-layer only: behaviour of the absolute-episode rescue when an
   * exact episode-number match misses.
   * - `'auto'` (default): triggers when the requested number is above the
   *   provider's max AND the provider has noticeably more episodes than
   *   the meta record says.
   * - `'always'`: every miss tries the absolute lookup.
   * - `'never'`: disables; falls through to closest-below.
   */
  episodeAbsoluteMatching?: 'auto' | 'always' | 'never';
}

/**
 * Minimal cache contract the SDK consumes — bring whatever store you want
 * (in-memory Map, Redis, SQLite, edge KV). Both methods may be async; the
 * SDK awaits them either way.
 *
 * Keys are stable, namespaced strings produced by the server layer
 * (`search:<providerId>:<query>`, `content:<providerId>:<mediaId>`,
 * `stream:<providerId>:<unitId>:<lang>`, `tracks:<providerId>:<unitId>:<lang>`).
 * Consumers can inspect the prefix to pick a TTL or refuse to cache
 * particular endpoints (e.g. `/stream` when upstream URLs carry signed
 * expiries).
 *
 * `get` returns `undefined` for a miss; any other value (including `null`)
 * counts as a hit and is served as-is.
 */
export interface SdkCache {
  get(key: string): unknown | Promise<unknown>;
  set(key: string, value: unknown): void | Promise<void>;
}

// ─── Metadata layer ─────────────────────────────────────────────────────────
//
// The metadata layer is a thin abstraction over external title catalogues
// (AniList, MAL/Jikan, Kitsu) that lets callers operate on a normalized
// `IMediaMetadata` record instead of a provider-specific shape, and then
// resolve playback through any content provider they choose.

export type MediaStatus =
  | 'FINISHED'
  | 'RELEASING'
  | 'NOT_YET_RELEASED'
  | 'CANCELLED'
  | 'HIATUS'
  | 'UNKNOWN';

export type MediaFormat =
  | 'TV'
  | 'TV_SHORT'
  | 'MOVIE'
  | 'SPECIAL'
  | 'OVA'
  | 'ONA'
  | 'MUSIC'
  | 'MANGA'
  | 'NOVEL'
  | 'ONE_SHOT'
  | 'UNKNOWN';

export type MediaSeason = 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';

export interface IMediaTitle {
  romaji?: string;
  english?: string;
  native?: string;
  userPreferred?: string;
}

export interface IMediaImage {
  large?: string;
  medium?: string;
  small?: string;
  /** Dominant colour in hex, when surfaced (e.g. AniList `coverImage.color`). */
  color?: string;
}

/**
 * Cross-source ID mappings. Lets a meta record carry the equivalent IDs in
 * neighbouring catalogues (AniList ↔ MAL ↔ Kitsu) plus per-content-provider
 * raw IDs once resolved — so two callers wanting the same title via two
 * different content providers don't each re-pay the matching cost.
 */
export interface IMediaMappings {
  anilist?: number;
  mal?: number;
  kitsu?: number;
  thetvdb?: number;
  tmdb?: number;
  anidb?: number;
  /** content provider id → raw media ID for this title on that provider */
  providers?: Record<string, string>;
}

export type MediaRelationType =
  | 'SEQUEL'
  | 'PREQUEL'
  | 'PARENT'
  | 'CHILD'
  | 'SIDE_STORY'
  | 'SPIN_OFF'
  | 'ADAPTATION'
  | 'ALTERNATIVE'
  | 'CHARACTER'
  | 'SUMMARY'
  | 'COMPILATION'
  | 'CONTAINS'
  | 'OTHER';

export interface IMediaRelation {
  /** URN of the related media in the meta provider's namespace. */
  id: Urn;
  relationType: MediaRelationType;
  catalogType: MediaCatalogType;
  format?: MediaFormat;
  status?: MediaStatus;
  title: IMediaTitle;
  cover?: IMediaImage;
}

export interface IMediaCharacter {
  id: Urn;
  name: string;
  /** "MAIN" / "SUPPORTING" / "BACKGROUND" (provider-defined). */
  role?: string;
  image?: IMediaImage;
  voiceActors?: Array<{
    id: Urn;
    name: string;
    language?: string;
    image?: IMediaImage;
  }>;
}

export interface IMediaStaff {
  id: Urn;
  name: string;
  role?: string;
  image?: IMediaImage;
}

export interface IMediaRecommendation {
  id: Urn;
  catalogType: MediaCatalogType;
  format?: MediaFormat;
  title: IMediaTitle;
  cover?: IMediaImage;
  /** Strength of the recommendation (provider-specific; AniList: vote count). */
  rating?: number;
}

export interface IMediaExternalLink {
  /** Site name, e.g. "Crunchyroll", "Netflix", "Official Site". */
  site: string;
  url: string;
  language?: string;
  /** When site is a streaming service, that fact. */
  type?: 'STREAMING' | 'INFO' | 'SOCIAL';
}

/**
 * Per-episode metadata sourced from the metadata layer (AniList's
 * `streamingEpisodes`, Jikan's filler/recap flags). Folded onto
 * `IContentUnit` records by `BaseMetadataProvider.fetchContentUnits`.
 */
export interface IStreamingEpisode {
  number: number;
  title?: string;
  description?: string;
  thumbnail?: string;
  /** Where the catalogue saw this episode (e.g. Crunchyroll URL). */
  externalUrl?: string;
  airDate?: string;
  isFiller?: boolean;
  isRecap?: boolean;
}

export interface IMediaMetadata {
  /** Unified URN — `${metaProviderId}:${nativeId}` (e.g. `anilist:21`). */
  id: Urn;
  /** Meta-provider id that produced this record (e.g. `anilist`, `mal`). */
  providerId: string;
  catalogType: MediaCatalogType;
  title: IMediaTitle;
  /** Synopsis. May contain HTML when the upstream catalogue ships it that way. */
  description?: string;
  cover?: IMediaImage;
  /** Landscape banner URL, when the catalogue ships one. */
  banner?: string;
  status?: MediaStatus;
  format?: MediaFormat;
  /** Total episodes (for anime/TV) if known. */
  episodeCount?: number;
  /** Total chapters (for manga) if known. */
  chapterCount?: number;
  /** Per-episode duration in minutes, if known. */
  durationMinutes?: number;
  genres?: string[];
  tags?: string[];
  studios?: string[];
  year?: number;
  season?: MediaSeason;
  /** ISO 8601 yyyy-mm-dd if known, otherwise omitted. */
  startDate?: string;
  endDate?: string;
  /** Normalized 0–100 score across all sources for easy comparison. */
  score?: number;
  /** Trailer URL (typically YouTube embed) when known. */
  trailer?: string;
  /** Adult-content flag (AniList `isAdult` and equivalents). */
  isAdult?: boolean;
  synonyms?: string[];
  mappings?: IMediaMappings;
  // ── Enrichments (optional; only set when the catalogue exposes them) ──
  relations?: IMediaRelation[];
  characters?: IMediaCharacter[];
  staff?: IMediaStaff[];
  recommendations?: IMediaRecommendation[];
  externalLinks?: IMediaExternalLink[];
  streamingEpisodes?: IStreamingEpisode[];
}

/**
 * A meta-provider-level search hit. The `id` is a URN in the meta provider's
 * namespace (e.g. `anilist:21`); a full {@link IMediaMetadata} is one call
 * to `fetchMediaInfo` away.
 */
export interface IMetaSearchResult {
  id: Urn;
  providerId: string;
  catalogType: MediaCatalogType;
  title: IMediaTitle;
  cover?: IMediaImage;
  year?: number;
  format?: MediaFormat;
  /** Light score so callers can rank without a second round-trip. */
  score?: number;
  isAdult?: boolean;
  mappings?: IMediaMappings;
}
