import { HttpClient } from '../transport/http.js';
import {
  CallOptions,
  IMediaSearchResult,
  IContentUnit,
  ResolvedMediaStream,
  MediaCatalogType,
  ContentLanguage,
  IMediaMappings,
  IUnitTracks,
  Urn,
} from '../types/index.js';
import { buildUrn, unwrapUrn } from '../utils/urn.js';

// Re-export so subclasses can stay close to the type they need.
export type { CallOptions } from '../types/index.js';

/**
 * @deprecated Use {@link CallOptions} from `src/types/index.ts` — the
 * single canonical options bag threaded through every public method.
 * Kept as an alias for source-compat while the SDK ages out the old name.
 */
export type ProviderCallOptions = CallOptions;

/**
 * Base contract every content provider implements.
 *
 * ## Unified IDs
 *
 * Every `id` flowing in or out of a provider is a URN of shape
 * `${providerId}:${rawId}`. The public methods (`search`,
 * `fetchContentUnits`, `resolveStream`, `fetchUnitTracks`) handle that
 * prefixing transparently — subclasses implement the `*Raw` variants and
 * deal exclusively with the raw provider-specific IDs.
 *
 * Bare (non-URN) IDs are still accepted as input for one release of
 * backwards-compatibility, but new code should always pass URNs.
 */
export abstract class BaseProvider {
  abstract readonly id: string;
  abstract readonly supportedTypes: MediaCatalogType[];

  constructor(protected http: HttpClient) {}

  /**
   * Simple FIFO semaphore. Constructed lazily so subclasses that don't
   * cap concurrency pay nothing for it.
   */
  private __semaphore?: Semaphore;
  private withConcurrency<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.maxConcurrency || this.maxConcurrency <= 0) return fn();
    if (!this.__semaphore) this.__semaphore = new Semaphore(this.maxConcurrency);
    return this.__semaphore.run(fn);
  }

  // ── Public API ────────────────────────────────────────────────────────────
  // These wrap the `Raw` methods below with URN encoding/decoding so callers
  // (and the meta layer) only ever see URN-formatted IDs. Every method also
  // accepts an optional `signal` for cancellation; subclasses are expected
  // to forward it on every outbound `http` call.

  public search(query: string, options: CallOptions = {}): Promise<IMediaSearchResult[]> {
    return this.withConcurrency(async () => {
      const results = await this.searchRaw(query, options);
      return results.map((r) => ({
        ...r,
        id: buildUrn(this.id, r.id),
        providerId: this.id,
      }));
    });
  }

  public fetchContentUnits(mediaUrn: Urn, options: CallOptions = {}): Promise<IContentUnit[]> {
    return this.withConcurrency(async () => {
      const raw = unwrapUrn(this.id, mediaUrn);
      const units = await this.fetchContentUnitsRaw(raw, options);
      return units.map((u) => ({ ...u, id: buildUrn(this.id, u.id) }));
    });
  }

  public resolveStream(
    unitUrn: Urn,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<ResolvedMediaStream> {
    return this.withConcurrency(async () => {
      const raw = unwrapUrn(this.id, unitUrn);
      return this.resolveStreamRaw(raw, language, options);
    });
  }

  /** True iff the provider implements `fetchUnitTracksRaw`. */
  public get supportsUnitTracks(): boolean {
    return typeof this.fetchUnitTracksRaw === 'function';
  }

  public fetchUnitTracks(
    unitUrn: Urn,
    language?: ContentLanguage,
    options: CallOptions = {},
  ): Promise<IUnitTracks> {
    if (!this.fetchUnitTracksRaw) {
      throw new Error(`${this.id}: fetchUnitTracks is not supported by this provider`);
    }
    return this.withConcurrency(async () => {
      const raw = unwrapUrn(this.id, unitUrn);
      return this.fetchUnitTracksRaw!(raw, language, options);
    });
  }

  /**
   * Optional: provider-native cross-source lookup. When a provider's site
   * happens to index titles by a well-known external ID (AniList, MAL, …),
   * implement this and `MappingClient` will use it before the MALSync /
   * fuzzy fallbacks. Return `null` to defer to fallbacks.
   */
  public lookupByMapping?(mappings: IMediaMappings, options?: CallOptions): Promise<string | null>;

  /**
   * Optional: comma-keyed array of MALSync `Sites` names this provider
   * corresponds to. When set, `MappingClient` will translate MALSync's
   * crowdsourced aliases into this provider's namespace automatically — so
   * new providers wire themselves in without touching the mapping client.
   */
  public static readonly malsyncSites: readonly string[] = [];

  /**
   * Optional: maximum number of in-flight calls allowed on this provider.
   * Useful for strict sites where parallel fuzzy searches risk a ban.
   * `0` / `undefined` means unbounded.
   */
  public readonly maxConcurrency: number = 0;

  // ── Subclass surface ──────────────────────────────────────────────────────
  // Subclasses implement these with raw (non-URN) IDs.

  protected abstract searchRaw(query: string, options?: CallOptions): Promise<IMediaSearchResult[]>;
  protected abstract fetchContentUnitsRaw(
    rawMediaId: string,
    options?: CallOptions,
  ): Promise<IContentUnit[]>;
  protected abstract resolveStreamRaw(
    rawUnitId: string,
    language?: ContentLanguage,
    options?: CallOptions,
  ): Promise<ResolvedMediaStream>;
  protected fetchUnitTracksRaw?(
    rawUnitId: string,
    language?: ContentLanguage,
    options?: CallOptions,
  ): Promise<IUnitTracks>;
}

/**
 * Minimal FIFO async semaphore used to cap a provider's in-flight calls.
 *
 * Kept module-local because it's small, used in one spot, and we don't want
 * to depend on a third-party limiter just to honour a per-provider cap.
 */
class Semaphore {
  private permits: number;
  private waiters: Array<() => void> = [];
  constructor(max: number) {
    this.permits = max;
  }
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
  private acquire(): Promise<void> {
    if (this.permits > 0) {
      this.permits -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  private release(): void {
    const next = this.waiters.shift();
    if (next) next();
    else this.permits += 1;
  }
}
