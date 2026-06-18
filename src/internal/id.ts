/**
 * Unified Resource Name (URN) helpers.
 *
 * Every ID emitted by an SDK provider is prefixed with the provider's `id`
 * followed by a single colon. The first colon is the separator — the raw ID
 * that follows is treated as opaque and may itself contain colons, slashes,
 * or other characters.
 *
 * Examples:
 *   `allmanga:5jzpRTJWnubrgHm5G`             (media URN)
 *   `allmanga:5jzpRTJWnubrgHm5G/1`           (content unit URN)
 *   `animeparadise:abc:xyz`                  (raw ID itself contains a colon)
 *   `anilist:21`                             (meta provider URN)
 *
 * Unifying ID space means callers can route any URN to the right provider
 * without out-of-band knowledge of which provider it came from.
 */

import type { Urn } from '../types/index.js';

/** True when the string looks like `providerId:rawId` for the given provider. */
export function isUrn(value: string, providerId?: string): boolean {
  const sep = value.indexOf(':');
  if (sep <= 0) return false;
  if (providerId == null) return true;
  return value.slice(0, sep) === providerId;
}

/** Build a URN. The raw ID is taken as-is — no escaping is applied. */
export function buildUrn(providerId: string, rawId: string): Urn {
  if (!providerId) throw new Error('buildUrn: providerId is required');
  if (rawId == null) throw new Error('buildUrn: rawId is required');
  return `${providerId}:${rawId}`;
}

/**
 * Parse a URN into its provider and raw-ID parts. If the input has no colon,
 * `providerId` is the empty string and `rawId` is the original input — this
 * lets callers be liberal about accepting legacy bare IDs.
 */
export function parseUrn(urn: string): { providerId: string; rawId: string } {
  const sep = urn.indexOf(':');
  if (sep < 0) return { providerId: '', rawId: urn };
  return { providerId: urn.slice(0, sep), rawId: urn.slice(sep + 1) };
}

/**
 * Strip the URN prefix when it matches `providerId`. If the input has no
 * prefix or a different prefix, it is returned unchanged — this is what lets
 * providers accept both URN and legacy bare IDs.
 */
export function unwrapUrn(providerId: string, urn: string): string {
  const sep = urn.indexOf(':');
  if (sep < 0) return urn;
  const prefix = urn.slice(0, sep);
  if (prefix !== providerId) return urn;
  return urn.slice(sep + 1);
}

/**
 * Strict version of {@link unwrapUrn} — throws if the URN doesn't belong
 * to `providerId`. Use this when routing decisions depend on the prefix
 * being correct (e.g. before dispatching a `meta:anilist:21` to a content
 * provider that wouldn't know what to do with it).
 */
export function strictUnwrapUrn(providerId: string, urn: string): string {
  const sep = urn.indexOf(':');
  if (sep < 0) {
    throw new Error(`strictUnwrapUrn: bare ID "${urn}" rejected (expected "${providerId}:…")`);
  }
  const prefix = urn.slice(0, sep);
  if (prefix !== providerId) {
    throw new Error(
      `strictUnwrapUrn: prefix "${prefix}" does not match "${providerId}" for URN "${urn}"`,
    );
  }
  return urn.slice(sep + 1);
}

/**
 * Typed catalogue URN helpers.
 *
 * MAL and Kitsu IDs aren't globally unique — a single integer can belong to
 * either an anime or a manga. We encode the catalogue type as the second
 * segment so the URN is unambiguous:
 *
 *   `mal:anime:21`   `mal:manga:13`   `kitsu:anime:11013`
 *
 * This lets routing logic (and the meta-provider's `fetchMediaInfo`) pick
 * the right endpoint without falling back on a "try anime first, 404, try
 * manga" heuristic.
 *
 * The first colon still separates `providerId`; the *second* colon is
 * conventional only when the provider opts in. AniList (single ID
 * namespace) doesn't use it.
 */
export type CatalogueKind = 'anime' | 'manga';

export function buildTypedUrn(
  providerId: string,
  kind: CatalogueKind,
  rawId: string | number,
): Urn {
  return `${providerId}:${kind}:${rawId}`;
}

/**
 * Parse a typed URN. Returns `{kind, rawId}` when the second segment is
 * `"anime"` or `"manga"`, otherwise treats the whole post-prefix string as
 * a bare raw ID with `kind: undefined`. Callers can fall through to the
 * untyped path when the kind is missing.
 */
export function parseTypedUrn(
  providerId: string,
  urn: string,
): { kind?: CatalogueKind; rawId: string } {
  const sep = urn.indexOf(':');
  if (sep < 0) return { rawId: urn };
  const prefix = urn.slice(0, sep);
  const rest = urn.slice(sep + 1);
  if (prefix !== providerId) return { rawId: urn };
  const sep2 = rest.indexOf(':');
  if (sep2 < 0) return { rawId: rest };
  const candidate = rest.slice(0, sep2);
  if (candidate === 'anime' || candidate === 'manga') {
    return { kind: candidate, rawId: rest.slice(sep2 + 1) };
  }
  return { rawId: rest };
}
