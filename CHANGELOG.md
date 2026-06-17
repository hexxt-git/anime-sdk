# anime-sdk

## 1.1.0

### Minor Changes

- 9d92372: Add metadata layer (AniList, MAL/Jikan, Kitsu) and unify IDs as URNs

  - **Metadata providers**: `AnilistMeta` (full enrichments: relations, characters with voice actors, staff, recommendations, externalLinks, streamingEpisodes), `MalMeta` (Jikan filler/recap + relations + browse), `KitsuMeta` (cross-source mappings).
  - **`MappingClient`**: resolves a metadata record onto a content provider's raw media ID via a four-step waterfall — cache → `provider.lookupByMapping` → MALSync + Anify (raced) + arm-server enrichment → fuzzy title search with composite similarity (Sørensen–Dice + token Jaccard + prefix), year + catalogType discriminators, and an episode-count cross-check.
  - **Unified URN ID space**: every `id` flowing through the SDK has shape `${providerId}:${rawId}` (e.g. `allmanga:5jzpRTJW`, `anilist:21`, `mal:anime:21`). Helpers: `buildUrn`, `parseUrn`, `unwrapUrn`, `strictUnwrapUrn`, `buildTypedUrn`, `parseTypedUrn`.
  - **`BaseProvider` upgrades**: optional `lookupByMapping(mappings)` for provider-native cross-source lookups (MegaPlay opts in — its media ID _is_ the AniList ID), `static malsyncSites` declaration, per-provider concurrency cap.
  - **Transport hardening**: per-host token-bucket rate limiter with built-in policies for the catalogue APIs, exponential-backoff retry honouring `Retry-After`, real `AbortSignal` propagation, curl fallback extracted into a pluggable `HttpTransport` interface.
  - **Server**: new `/meta/search`, `/meta/info`, `/meta/content`, `/meta/stream`, `/meta/tracks`, `/meta/browse`, `/health`, `/openapi.json` routes. Dynamic `proxyBase` derived from the request `Host` header. Optional HMAC-signed `/proxy` URLs (`proxySignSecret`) and suffix-matched SSRF allowlist (`proxyAllowedHosts`).
  - **`IContentUnit` enrichment**: when used through the metadata layer, content units carry per-episode metadata (title, thumbnail, filler/recap flags) folded in from the catalogue.
  - **Absolute-episode rescue**: walks PREQUEL relations to compute a season offset for multi-season titles where the meta record's per-season numbering misaligns with the content provider's continuous list.
  - **Tests**: 118 tests, all real (no mocks, no fixtures, no graceful skipping). `CLAUDE.md` carries the testing rule explicitly.

## 1.0.1

### Patch Changes

- 867dc8c: copy updates

## 1.0.0

### Major Changes

- a266c7f: anime-sdk first version with 9 providers and http server
