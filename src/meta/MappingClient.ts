import { HttpClient } from '../transport/http.js';
import { BaseProvider, CallOptions } from '../providers/BaseProvider.js';
import {
  IMediaMappings,
  IMediaMetadata,
  IMediaSearchResult,
  IMediaTitle,
  SdkCache,
} from '../types/index.js';
import { unwrapUrn } from '../utils/urn.js';
import { bestSimilarity, normalizeTitle } from './similarity.js';

/**
 * Cross-source ID resolver.
 *
 * Given an `IMediaMetadata` record (`anilist:21`) and a `BaseProvider`
 * (`allmangaProvider`), returns the raw media ID that provider uses for
 * the same title — applying as much rigour as the data allows:
 *
 *   1. **Provider-native lookup** (`provider.lookupByMapping`) — when a
 *      site indexes its catalogue by AniList/MAL ID directly, that's
 *      authoritative and cheapest. Hook is optional per provider.
 *   2. **External mapping APIs** raced in parallel: MALSync, Anify, and
 *      arm-server. First non-empty result wins; the others get cached for
 *      later providers that need them. Provider names are taken from
 *      `Provider.malsyncSites` / fallback aliases.
 *   3. **Fuzzy title search** as a final fallback. Searches the provider
 *      with multiple title variants in parallel, then ranks every
 *      candidate by a composite similarity metric, with `year` and
 *      `catalogType` discriminators applied as hard filters. When the top
 *      candidate is borderline (similarity within `verifyBand` of the
 *      threshold), we issue one extra `fetchContentUnits` round-trip to
 *      cross-check `episodeCount` before accepting.
 *
 * Results are persisted to an `SdkCache` keyed by
 * `mapping:${metaProvider}:${metaNativeId}:${contentProvider}`. The
 * metadata object is **never** mutated — that surprised callers and made
 * `SdkCache`-cached metadata records dangerous to share across calls.
 */
export interface MappingClientOptions {
  /** Optional read/write cache for resolved mappings (and external API responses). */
  cache?: SdkCache;
  /** Disable MALSync lookups. */
  disableMalsync?: boolean;
  /** Disable Anify lookups. */
  disableAnify?: boolean;
  /** Disable arm-server lookups (only useful for anime). */
  disableArmServer?: boolean;
  /** Minimum composite similarity to accept a fuzzy match. 0–1; default 0.78. */
  minSimilarity?: number;
  /**
   * Width of the "borderline" band below the threshold within which we
   * trigger the episode-count cross-check. Default 0.07 — i.e. with
   * `minSimilarity: 0.78`, matches between 0.71 and 0.85 get verified.
   */
  verifyBand?: number;
  /** Tolerance for the year discriminator. Default 2. */
  yearTolerance?: number;
  /** Tolerance for the episode-count discriminator. Default 3. */
  episodeCountTolerance?: number;
  /** Max search candidates per provider call. Default 12. */
  fuzzyCandidateLimit?: number;
  /** Max parallel `provider.search` calls during fuzzy match. Default 4. */
  fuzzyConcurrency?: number;
}

export type MappingMethod = 'cached' | 'provider' | 'malsync' | 'anify' | 'arm' | 'fuzzy';

export interface MappingResolution {
  providerId: string;
  rawMediaId: string;
  matchedTitle: string;
  method: MappingMethod;
  similarity?: number;
}

/**
 * Provider-id aliases for external mapping services. Used when a provider
 * doesn't declare its own `malsyncSites` / `anifySites` (which it should
 * — these constants are the fallback safety net for the SDK's own
 * built-in providers).
 */
const BUILT_IN_MALSYNC_ALIASES: Record<string, string[]> = {
  mangadex: ['Mangadex', 'MangaDex'],
  mangapill: ['Mangapill'],
  weebcentral: ['Weebcentral', 'WeebCentral'],
};

interface MalsyncResponse {
  malId?: number;
  anilistId?: number;
  Sites?: Record<
    string,
    Record<string, { identifier?: string | number; url?: string; title?: string }>
  >;
}

interface AnifyMappingEntry {
  id: string;
  providerId: string;
  providerType?: 'ANIME' | 'MANGA';
}

interface AnifyResponse {
  mappings?: AnifyMappingEntry[];
  episodeCount?: number;
}

interface ArmServerResponse {
  anilist?: number;
  mal?: number;
  kitsu?: number;
  anidb?: number;
  notify?: string;
  livechart?: number;
}

export class MappingClient {
  constructor(
    private http: HttpClient,
    private options: MappingClientOptions = {},
  ) {}

  /**
   * Resolve `metadata` → raw media ID on `contentProvider`.
   *
   * Returns `null` when no resolution method finds a confident match. The
   * input `metadata` object is **never mutated**.
   */
  public async resolveProviderMediaId(
    metadata: IMediaMetadata,
    contentProvider: BaseProvider,
    options: CallOptions = {},
  ): Promise<MappingResolution | null> {
    const cacheKey = mappingCacheKey(metadata, contentProvider);
    // ── 0. SdkCache ───────────────────────────────────────────────────────
    if (this.options.cache) {
      const hit = await this.options.cache.get(cacheKey);
      if (hit !== undefined && hit !== null) {
        const stored = hit as MappingResolution;
        return { ...stored, method: 'cached' };
      }
    }

    // ── 1. Provider-native lookup ─────────────────────────────────────────
    if (contentProvider.lookupByMapping && metadata.mappings) {
      try {
        const raw = await contentProvider.lookupByMapping(metadata.mappings, options);
        if (raw)
          return this.acceptAndCache(
            cacheKey,
            contentProvider,
            raw,
            displayTitle(metadata),
            'provider',
          );
      } catch {
        // Fall through — provider-side lookup is best-effort.
      }
    }

    // ── 2. External mapping APIs (raced) ──────────────────────────────────
    const ext = await this.resolveFromExternalMappings(metadata, contentProvider, options);
    if (ext) {
      return this.acceptAndCache(
        cacheKey,
        contentProvider,
        ext.rawId,
        displayTitle(metadata),
        ext.method,
      );
    }

    // ── 3. Fuzzy search ───────────────────────────────────────────────────
    const fuzzy = await this.fuzzyMatch(metadata, contentProvider, options);
    if (fuzzy) {
      const cached = await this.acceptAndCache(
        cacheKey,
        contentProvider,
        fuzzy.rawMediaId,
        fuzzy.matchedTitle,
        'fuzzy',
      );
      return { ...cached, similarity: fuzzy.similarity };
    }

    return null;
  }

  // ── External APIs ─────────────────────────────────────────────────────────

  /**
   * Race MALSync, Anify, and arm-server. The first one to return a
   * matching alias for `contentProvider` wins; the others continue in the
   * background and their answers are cached on the SdkCache so a *future*
   * lookup for a different content provider can pick them up cheaply.
   */
  private async resolveFromExternalMappings(
    metadata: IMediaMetadata,
    contentProvider: BaseProvider,
    options: CallOptions,
  ): Promise<{ rawId: string; method: MappingMethod } | null> {
    const type: 'anime' | 'manga' = metadata.catalogType === 'MANGA' ? 'manga' : 'anime';
    const malsyncAliases = providerMalsyncAliases(contentProvider);

    const tasks: Array<{ method: MappingMethod; promise: Promise<string | null> }> = [];

    if (!this.options.disableMalsync && (metadata.mappings?.anilist || metadata.mappings?.mal)) {
      tasks.push({
        method: 'malsync',
        promise: this.lookupMalsync(metadata, type, malsyncAliases, contentProvider.id, options),
      });
    }
    if (!this.options.disableAnify && (metadata.mappings?.anilist || metadata.mappings?.mal)) {
      tasks.push({
        method: 'anify',
        promise: this.lookupAnify(metadata, contentProvider.id, options),
      });
    }
    if (!this.options.disableArmServer && type === 'anime' && metadata.mappings?.anilist) {
      tasks.push({
        method: 'arm',
        promise: this.enrichMappingsViaArm(metadata, options).then(() => null),
        // arm doesn't return provider-specific IDs — it gives us cross-source
        // catalogue IDs (kitsu, anidb, notify, …) that we cache for later
        // mapping-API calls. We never accept its result directly here.
      });
    }

    if (tasks.length === 0) return null;

    // Race: resolve as soon as any task returns a non-null value.
    // We can't use Promise.any (rejects ≠ no-match), so do it manually.
    return new Promise<{ rawId: string; method: MappingMethod } | null>((resolve) => {
      let remaining = tasks.length;
      for (const { method, promise } of tasks) {
        promise
          .then((rawId) => {
            if (rawId) resolve({ rawId, method });
          })
          .catch(() => {})
          .finally(() => {
            remaining -= 1;
            if (remaining === 0) resolve(null);
          });
      }
    });
  }

  private async lookupMalsync(
    metadata: IMediaMetadata,
    type: 'anime' | 'manga',
    aliases: string[],
    contentProviderId: string,
    options: CallOptions,
  ): Promise<string | null> {
    const anilistId = metadata.mappings?.anilist;
    const malId = metadata.mappings?.mal;
    const namespace = anilistId ? 'anilist' : 'mal';
    const id = anilistId ?? malId;
    if (!id) return null;
    const url = `https://api.malsync.moe/${namespace}/${type}/${id}`;
    try {
      const res = await this.http.get(url, {
        headers: { Accept: 'application/json' },
        signal: options.signal,
      });
      if (res.status !== 200) return null;
      const data = (await res.json()) as MalsyncResponse;
      const sites = data?.Sites;
      if (!sites) return null;
      for (const alias of aliases) {
        const bucket = sites[alias];
        if (!bucket) continue;
        const first = Object.values(bucket)[0];
        const raw = String(first?.identifier ?? '').trim();
        if (raw) return raw;
      }
      // Also stash any other provider hits we found in the cache so
      // future lookups for those providers can short-circuit.
      await this.stashSiblingHits(metadata, sites);
      return null;
    } catch {
      return null;
    }
  }

  private async lookupAnify(
    metadata: IMediaMetadata,
    contentProviderId: string,
    options: CallOptions,
  ): Promise<string | null> {
    const anilistId = metadata.mappings?.anilist;
    if (!anilistId) return null;
    const url = `https://api.anify.tv/info/${anilistId}`;
    try {
      const res = await this.http.get(url, {
        headers: { Accept: 'application/json' },
        signal: options.signal,
      });
      if (res.status !== 200) return null;
      const data = (await res.json()) as AnifyResponse;
      const m = data?.mappings ?? [];
      const hit = m.find((x) => x.providerId === contentProviderId);
      return hit?.id ?? null;
    } catch {
      return null;
    }
  }

  /**
   * arm-server doesn't speak content-provider IDs — it speaks catalogue
   * IDs (kitsu, anidb, notify, livechart). We call it not to *resolve*
   * but to *enrich* the in-memory mappings so subsequent MALSync/Anify
   * lookups have more keys to try. Cached on the SdkCache.
   */
  private async enrichMappingsViaArm(
    metadata: IMediaMetadata,
    options: CallOptions,
  ): Promise<IMediaMappings | null> {
    const anilistId = metadata.mappings?.anilist;
    if (!anilistId) return null;
    const cacheKey = `arm:anilist:${anilistId}`;
    if (this.options.cache) {
      const hit = await this.options.cache.get(cacheKey);
      if (hit !== undefined && hit !== null) return hit as IMediaMappings;
    }
    try {
      const res = await this.http.get(
        `https://arm.haglund.dev/api/v2/ids?source=anilist&id=${anilistId}`,
        { headers: { Accept: 'application/json' }, signal: options.signal },
      );
      if (res.status !== 200) return null;
      const data = (await res.json()) as ArmServerResponse;
      const enriched: IMediaMappings = {
        anilist: data.anilist,
        mal: data.mal,
        kitsu: data.kitsu,
        anidb: data.anidb,
      };
      if (this.options.cache) await this.options.cache.set(cacheKey, enriched);
      return enriched;
    } catch {
      return null;
    }
  }

  /** Best-effort cache-warming: stash MALSync's other site hits in SdkCache. */
  private async stashSiblingHits(
    metadata: IMediaMetadata,
    sites: NonNullable<MalsyncResponse['Sites']>,
  ): Promise<void> {
    if (!this.options.cache) return;
    // We can't know which BaseProvider.id a site corresponds to without
    // querying the registered providers — but the matched site name is a
    // stable key, so cache by `malsync:${siteName}:${anilistOrMal}:${id}`
    // and let future MappingClient instances pick up.
    const anilistId = metadata.mappings?.anilist;
    const malId = metadata.mappings?.mal;
    for (const [siteName, bucket] of Object.entries(sites)) {
      const first = Object.values(bucket)[0];
      const raw = String(first?.identifier ?? '').trim();
      if (!raw) continue;
      if (anilistId) await this.options.cache.set(`malsync:${siteName}:anilist:${anilistId}`, raw);
      if (malId) await this.options.cache.set(`malsync:${siteName}:mal:${malId}`, raw);
    }
  }

  // ── Fuzzy matching ────────────────────────────────────────────────────────

  private async fuzzyMatch(
    metadata: IMediaMetadata,
    contentProvider: BaseProvider,
    options: CallOptions,
  ): Promise<MappingResolution | null> {
    const threshold = this.options.minSimilarity ?? 0.78;
    const verifyBand = this.options.verifyBand ?? 0.07;
    const limit = this.options.fuzzyCandidateLimit ?? 12;
    const concurrency = this.options.fuzzyConcurrency ?? 4;
    const yearTol = this.options.yearTolerance ?? 2;

    const queries = uniqueQueries([
      metadata.title.userPreferred,
      metadata.title.english,
      metadata.title.romaji,
      metadata.title.native,
      ...(metadata.synonyms ?? []),
    ]);
    if (queries.length === 0) return null;

    const candidates = await runParallelSearches(
      contentProvider,
      queries.slice(0, concurrency),
      limit,
      options,
    );
    if (candidates.length === 0) return null;

    const altTitles = [
      metadata.title.userPreferred,
      metadata.title.english,
      metadata.title.romaji,
      metadata.title.native,
      ...(metadata.synonyms ?? []),
    ];

    // Score every candidate with all known discriminators applied.
    type Scored = {
      result: IMediaSearchResult;
      score: number;
      catalogMatch: boolean;
      yearMatch: boolean;
    };
    const scored: Scored[] = candidates.map((c) => ({
      result: c,
      score: bestSimilarity(c.title, altTitles),
      catalogMatch: c.catalogType === metadata.catalogType,
      yearMatch: yearIsCompatible(metadata.year, getCandidateYear(c), yearTol),
    }));

    // Hard filters first.
    const filtered = scored.filter((s) => s.catalogMatch && s.yearMatch);
    const pool = filtered.length > 0 ? filtered : scored;

    pool.sort((a, b) => b.score - a.score);
    const top = pool[0];
    if (!top || top.score < threshold - verifyBand) return null;

    const raw = unwrapUrn(contentProvider.id, top.result.id);

    // High-confidence: above threshold and catalogType matches → accept directly.
    if (top.score >= threshold && top.catalogMatch && top.yearMatch) {
      return makeRes(contentProvider, raw, top);
    }

    // Borderline → cross-check episode count.
    if (typeof metadata.episodeCount === 'number') {
      try {
        const units = await contentProvider.fetchContentUnits(top.result.id, options);
        const actualCount = units.length;
        const expected = metadata.episodeCount;
        const tol = this.options.episodeCountTolerance ?? 3;
        if (Math.abs(actualCount - expected) <= tol) {
          return makeRes(contentProvider, raw, top);
        }
      } catch {
        // Provider blew up — fall back to similarity threshold alone.
      }
    }

    // No cross-check possible; accept only if clearly above threshold.
    if (top.score >= threshold) return makeRes(contentProvider, raw, top);
    return null;
  }

  // ── Acceptance / persistence helpers ──────────────────────────────────────

  private async acceptAndCache(
    cacheKey: string,
    contentProvider: BaseProvider,
    rawMediaId: string,
    matchedTitle: string,
    method: MappingMethod,
  ): Promise<MappingResolution> {
    const resolution: MappingResolution = {
      providerId: contentProvider.id,
      rawMediaId,
      matchedTitle,
      method,
    };
    if (this.options.cache) await this.options.cache.set(cacheKey, resolution);
    return resolution;
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function mappingCacheKey(metadata: IMediaMetadata, contentProvider: BaseProvider): string {
  return `mapping:${metadata.providerId}:${unwrapUrn(metadata.providerId, metadata.id)}:${contentProvider.id}`;
}

function displayTitle(m: IMediaMetadata): string {
  return m.title.userPreferred ?? m.title.english ?? m.title.romaji ?? '';
}

function uniqueQueries(raw: Array<string | undefined>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const q of raw) {
    if (!q) continue;
    const norm = normalizeTitle(q);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(q);
  }
  return out;
}

/**
 * Read the provider's MALSync aliases — first from a `malsyncSites` static
 * property on the constructor, then from `BUILT_IN_MALSYNC_ALIASES`.
 * Returns at least one entry (the provider's own id, lowercased and
 * capitalized) so single-word provider IDs work without configuration.
 */
function providerMalsyncAliases(provider: BaseProvider): string[] {
  const ctor = provider.constructor as unknown as { malsyncSites?: readonly string[] };
  if (ctor.malsyncSites && ctor.malsyncSites.length > 0) return [...ctor.malsyncSites];
  const builtIn = BUILT_IN_MALSYNC_ALIASES[provider.id];
  if (builtIn) return builtIn;
  return [capitalize(provider.id)];
}

function capitalize(s: string): string {
  if (!s) return s;
  return s[0].toUpperCase() + s.slice(1);
}

function yearIsCompatible(
  expected: number | undefined,
  actual: number | undefined,
  tolerance: number,
): boolean {
  if (expected == null || actual == null) return true; // unknown → not a hard filter
  return Math.abs(expected - actual) <= tolerance;
}

function getCandidateYear(c: IMediaSearchResult): number | undefined {
  return c.year;
}

function makeRes(
  contentProvider: BaseProvider,
  raw: string,
  s: { result: IMediaSearchResult; score: number },
): MappingResolution {
  return {
    providerId: contentProvider.id,
    rawMediaId: raw,
    matchedTitle: s.result.title,
    method: 'fuzzy',
    similarity: s.score,
  };
}

async function runParallelSearches(
  contentProvider: BaseProvider,
  queries: string[],
  perQueryLimit: number,
  options: CallOptions,
): Promise<IMediaSearchResult[]> {
  const results = await Promise.allSettled(queries.map((q) => contentProvider.search(q, options)));
  const seen = new Set<string>();
  const out: IMediaSearchResult[] = [];
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    for (const hit of r.value.slice(0, perQueryLimit)) {
      if (seen.has(hit.id)) continue;
      seen.add(hit.id);
      out.push(hit);
    }
  }
  return out;
}
