import { HttpClient } from '../transport/http.js';
import { BaseProvider } from '../providers/BaseProvider.js';
import {
  CallOptions,
  ContentLanguage,
  IContentUnit,
  IMediaMetadata,
  IMetaSearchResult,
  IStreamingEpisode,
  IUnitTracks,
  MediaCatalogType,
  MediaFormat,
  MediaSeason,
  ResolvedMediaStream,
  Urn,
} from '../types/index.js';

import { buildUrn, unwrapUrn } from '../utils/urn.js';
import { MappingClient } from './MappingClient.js';

/**
 * Named browse buckets for {@link BaseMetadataProvider.browse}.
 */
export type BrowseKind = 'trending' | 'popular' | 'seasonal' | 'top';

export interface BrowseOptions extends CallOptions {
  /** Anime / manga discriminator; defaults to ANIME. */
  catalogType?: MediaCatalogType;
  /** 1-based page number. Default 1. */
  page?: number;
  /** Page size. Default 20, capped per-catalogue. */
  perPage?: number;
  /** Required for `kind: 'seasonal'`. */
  season?: MediaSeason;
  /** Required for `kind: 'seasonal'`. */
  year?: number;
  /** Optional format filter (TV, MOVIE, …). */
  format?: MediaFormat;
}

/**
 * @deprecated Use {@link CallOptions} from `src/types/index.ts`. Kept as
 * an alias so existing callers continue to compile.
 */
export type MetaCallOptions = CallOptions;

export interface BaseMetadataProviderOptions {
  /**
   * Shared MappingClient instance. Inject your own to share its cache (and
   * MALSync rate-limit budget) across multiple meta providers in the same
   * process. A fresh instance is created if omitted.
   */
  mappingClient?: MappingClient;
}

/**
 * Common surface every metadata provider implements.
 *
 * Concrete implementations (AniList, MAL, Kitsu) supply:
 *   - `searchRaw(query)` — full-text search against the upstream catalogue.
 *   - `fetchMediaInfoRaw(nativeId)` — return full metadata by native ID.
 *
 * Everything else (resolving a content provider's `mediaId`, listing
 * episodes, getting a playable stream) is delegated to a {@link BaseProvider}
 * that the caller picks at call time. This is the swap-out point: the same
 * metadata record can drive `AllmangaProvider`, `GogoanimeProvider`, etc.,
 * and the meta layer never needs to know which one.
 *
 * The "Urn" public id space is `${this.id}:${nativeId}` (e.g. `anilist:21`).
 */
export abstract class BaseMetadataProvider {
  abstract readonly id: string;
  abstract readonly supportedTypes: MediaCatalogType[];

  protected mapping: MappingClient;

  constructor(
    protected http: HttpClient,
    options: BaseMetadataProviderOptions = {},
  ) {
    this.mapping = options.mappingClient ?? new MappingClient(http);
  }

  // ── Native catalogue surface (subclasses implement) ──────────────────────

  protected abstract searchRawNative(
    query: string,
    options?: CallOptions,
  ): Promise<IMetaSearchResult[]>;
  protected abstract fetchMediaInfoRawNative(
    nativeId: string,
    options?: CallOptions,
  ): Promise<IMediaMetadata>;

  /**
   * Optional browse endpoints. Subclasses override per-catalogue.
   *
   * `browse(kind, options)` returns a paginated list of titles in one of
   * the named buckets:
   *   - `'trending'`  — currently surfaced by the catalogue's trending shelf
   *   - `'popular'`   — all-time popular titles
   *   - `'seasonal'`  — titles airing in `options.season` + `options.year`
   *   - `'top'`       — highest-scored titles
   *
   * Default implementation throws — set `supportsBrowse[kind]` on your
   * provider when you can implement a bucket.
   */
  public supportsBrowseKind(_kind: BrowseKind): boolean {
    return false;
  }

  public async browse(kind: BrowseKind, options: BrowseOptions = {}): Promise<IMetaSearchResult[]> {
    if (!this.supportsBrowseKind(kind)) {
      throw new Error(`${this.id}: browse('${kind}') not supported by this provider`);
    }
    const items = await this.browseRawNative(kind, options);
    return items.map((r) => ({ ...r, id: buildUrn(this.id, r.id), providerId: this.id }));
  }

  /**
   * Subclasses override this to actually serve a browse request. Default
   * throws.
   */
  protected browseRawNative(
    _kind: BrowseKind,
    _options: BrowseOptions,
  ): Promise<IMetaSearchResult[]> {
    throw new Error(`${this.id}: browseRawNative is not implemented`);
  }

  // ── Public API ───────────────────────────────────────────────────────────

  public async search(query: string, options: CallOptions = {}): Promise<IMetaSearchResult[]> {
    const results = await this.searchRawNative(query, options);
    return results.map((r) => ({ ...r, id: buildUrn(this.id, r.id), providerId: this.id }));
  }

  public async fetchMediaInfo(metaUrn: Urn, options: CallOptions = {}): Promise<IMediaMetadata> {
    const raw = unwrapUrn(this.id, metaUrn);
    const meta = await this.fetchMediaInfoRawNative(raw, options);
    return { ...meta, id: buildUrn(this.id, meta.id), providerId: this.id };
  }

  /**
   * List episodes/chapters on `contentProvider` for the title identified by
   * `metaUrn`. Resolves the cross-provider mapping under the hood, then
   * merges any per-episode enrichment the meta record carries (titles,
   * thumbnails, filler markers).
   */
  public async fetchContentUnits(
    metaUrn: Urn,
    contentProvider: BaseProvider,
    options: CallOptions = {},
  ): Promise<IContentUnit[]> {
    const metadata = await this.fetchMediaInfo(metaUrn, options);
    const resolution = await this.mapping.resolveProviderMediaId(
      metadata,
      contentProvider,
      options,
    );
    if (!resolution) {
      throw new Error(
        `No match for "${metadata.title.userPreferred ?? metadata.title.romaji ?? metaUrn}" on provider "${contentProvider.id}"`,
      );
    }
    const units = await contentProvider.fetchContentUnits(
      buildUrn(contentProvider.id, resolution.rawMediaId),
      options,
    );
    return this.enrichContentUnits(units, metadata);
  }

  /**
   * Resolve a stream by metadata + episode number on the given content
   * provider. Picks the unit whose `number` matches `episodeNumber`.
   *
   * The episode-number index keeps the caller's mental model anchored to the
   * metadata catalogue (which uses 1..episodeCount) rather than each content
   * provider's quirky internal IDs.
   */
  public async resolveStream(
    metaUrn: Urn,
    episodeNumber: number,
    contentProvider: BaseProvider,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    const unit = await this.findContentUnit(metaUrn, episodeNumber, contentProvider, options);
    return contentProvider.resolveStream(unit.id, language, options);
  }

  /** Same selection logic as `resolveStream`, but for the cheap-tracks path. */
  public async fetchUnitTracks(
    metaUrn: Urn,
    episodeNumber: number,
    contentProvider: BaseProvider,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<IUnitTracks> {
    if (!contentProvider.supportsUnitTracks) {
      throw new Error(`Provider "${contentProvider.id}" does not support fetchUnitTracks`);
    }
    const unit = await this.findContentUnit(metaUrn, episodeNumber, contentProvider, options);
    return contentProvider.fetchUnitTracks(unit.id, language, options);
  }

  /**
   * Surface the underlying mapping result. Useful when callers want to log
   * which content-provider title was picked, or stash the raw ID for
   * out-of-band use.
   */
  public async resolveContentProviderMediaId(
    metaUrn: Urn,
    contentProvider: BaseProvider,
    options: CallOptions = {},
  ): Promise<{ rawMediaId: string; mediaUrn: Urn; matchedTitle: string }> {
    const metadata = await this.fetchMediaInfo(metaUrn, options);
    const resolution = await this.mapping.resolveProviderMediaId(
      metadata,
      contentProvider,
      options,
    );
    if (!resolution) {
      throw new Error(
        `No match for "${metadata.title.userPreferred ?? metadata.title.romaji ?? metaUrn}" on provider "${contentProvider.id}"`,
      );
    }
    return {
      rawMediaId: resolution.rawMediaId,
      mediaUrn: buildUrn(contentProvider.id, resolution.rawMediaId),
      matchedTitle: resolution.matchedTitle,
    };
  }

  // ── Hooks for subclasses ─────────────────────────────────────────────────

  /**
   * Merge per-episode metadata onto the content provider's unit list.
   *
   * The default implementation looks for `metadata.streamingEpisodes`
   * (AniList carries this — title, thumbnail, source URL per episode) and
   * keys by episode number. Subclasses can override to fold in catalogue-
   * specific fields (e.g. filler markers, recap flags).
   */
  protected enrichContentUnits(units: IContentUnit[], metadata: IMediaMetadata): IContentUnit[] {
    const byNumber = new Map<number, IStreamingEpisode>();
    for (const ep of metadata.streamingEpisodes ?? []) {
      if (typeof ep.number === 'number') byNumber.set(ep.number, ep);
    }
    if (byNumber.size === 0) return units;
    return units.map((u) => {
      const ext = byNumber.get(u.number);
      if (!ext) return u;
      return {
        ...u,
        // Prefer extended title only when meaningfully different (content
        // provider's "Episode 5" is barren; meta's "The Plan to Defeat …" is
        // what we actually want to surface).
        title: ext.title ?? u.title,
        ...(ext.thumbnail ? { thumbnailUrl: ext.thumbnail } : {}),
        ...(ext.description ? { description: ext.description } : {}),
        ...(typeof ext.isFiller === 'boolean' ? { isFiller: ext.isFiller } : {}),
        ...(typeof ext.isRecap === 'boolean' ? { isRecap: ext.isRecap } : {}),
        ...(ext.airDate ? { airDate: ext.airDate } : {}),
      };
    });
  }

  /**
   * Compute the absolute-episode offset for `metaUrn`.
   *
   * Many anime catalogues (notably AniList) split multi-season shows into
   * separate entries (e.g. *Attack on Titan* S1, S2, S3, Final S). Many
   * content providers, by contrast, list episodes as one continuous run
   * (1..N). When that mismatch shows up, we walk the PREQUEL relation
   * chain back, summing each prequel's `episodeCount`, and the resulting
   * sum is the offset we add to a per-season episode number to get the
   * absolute one.
   *
   * Public so callers building custom episode pickers can opt in directly.
   * Cap of 8 hops prevents pathological cycles.
   */
  public async computeAbsoluteEpisodeOffset(
    metaUrn: Urn,
    options: CallOptions = {},
  ): Promise<number> {
    let offset = 0;
    let current: IMediaMetadata | undefined = await this.fetchMediaInfo(metaUrn, options);
    const visited = new Set<string>();
    for (let i = 0; i < 8 && current; i += 1) {
      if (visited.has(current.id)) break;
      visited.add(current.id);
      const prequel = current.relations?.find((r) => r.relationType === 'PREQUEL');
      if (!prequel) break;
      try {
        const prevMeta = await this.fetchMediaInfo(prequel.id, options);
        if (typeof prevMeta.episodeCount === 'number') offset += prevMeta.episodeCount;
        current = prevMeta;
      } catch {
        break;
      }
    }
    return offset;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async findContentUnit(
    metaUrn: Urn,
    episodeNumber: number,
    contentProvider: BaseProvider,
    options: CallOptions,
  ): Promise<IContentUnit> {
    const units = await this.fetchContentUnits(metaUrn, contentProvider, options);
    const target = units.find((u) => u.number === episodeNumber);
    if (target) return target;

    if (options.strictEpisodeMatching) {
      throw new Error(
        `Episode ${episodeNumber} not found on provider "${contentProvider.id}" (have: ${units.map((u) => u.number).join(', ')})`,
      );
    }

    // ── Absolute-episode rescue ───────────────────────────────────────────
    // When the meta record describes only this season but the content
    // provider's list runs across the whole series, look up the offset by
    // summing previous seasons' episode counts and retry. We only trigger
    // when (a) `episodeAbsoluteMatching` is opted in or set to 'auto', AND
    // (b) the heuristic conditions for a multi-season concatenation are met.
    const mode = options.episodeAbsoluteMatching ?? 'auto';
    if (mode !== 'never' && shouldTryAbsolute(units, episodeNumber, mode)) {
      try {
        const offset = await this.computeAbsoluteEpisodeOffset(metaUrn, options);
        if (offset > 0) {
          const absolute = episodeNumber + offset;
          const absHit = units.find((u) => u.number === absolute);
          if (absHit) return absHit;
        }
      } catch {
        /* fall through to closest-below */
      }
    }

    // Non-strict mode: fall back to closest-by-number for catalogues whose
    // numbering is off-by-one (specials/prologues). Prefer ≤ over ≥ to
    // avoid silently leaking *future* episodes when a number is missing
    // in the middle.
    const sorted = [...units].sort((a, b) => a.number - b.number);
    const lower = [...sorted].reverse().find((u) => u.number <= episodeNumber);
    if (lower) return lower;

    throw new Error(
      `Episode ${episodeNumber} not found on provider "${contentProvider.id}" (have: ${units.map((u) => u.number).join(', ')})`,
    );
  }
}

/**
 * Heuristic gate for the absolute-episode lookup. Cheap enough to run on
 * every miss in 'auto' mode without measurable cost.
 */
function shouldTryAbsolute(
  units: IContentUnit[],
  requestedNumber: number,
  mode: NonNullable<CallOptions['episodeAbsoluteMatching']>,
): boolean {
  if (mode === 'always') return true;
  if (units.length === 0) return false;
  const max = Math.max(...units.map((u) => u.number));
  // The requested ep is well within the content provider's range — looks
  // like a real miss (specials, gaps), not a season-numbering mismatch.
  if (requestedNumber <= max) return false;
  // The miss is *above* the provider's max episode — only worth re-trying
  // with an offset if the provider has > 1.5× the requested number of
  // episodes, indicating a multi-season concatenation.
  return max >= requestedNumber * 1.5;
}
