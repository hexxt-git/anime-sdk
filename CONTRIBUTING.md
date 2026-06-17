# Contributing to anime-sdk

## Prerequisites

- Node 20+ and `ffmpeg` on `PATH` (E2E tests shell out to it)

## Setup

```sh
git clone https://github.com/hexxt-git/anime-sdk
cd anime-sdk
npm install

npm run test:run   # unit + live E2E (~60–90s, requires internet)
npm run build      # tsup → dist/ (ESM + CJS + .d.ts)
```

## What's welcome

**New providers** — the highest-value contribution. A good target is a public site (no login required) that covers a language, catalogue, or content type (Anime or Manga) the existing providers don't.

**Bug fixes for existing providers** — site layouts change. A targeted fix with a passing E2E test is always welcome. Open an issue first if the change is large.

**New extractors** — only when the embed format is genuinely novel and none of the four existing extractors (`GenericHlsExtractor`, `Mp4UploadExtractor`, `BloggerExtractor`, `VidstreamingExtractor`) can handle it.

**Metadata provider improvements** — extending `MalMeta` / `KitsuMeta` with characters/staff/recommendations parity, batch fetching for AniList, or richer Anify/arm-server integration. Any new field must be live-tested against the real upstream.

**Mapping-client improvements** — better fuzzy-match heuristics for tricky titles (multi-season shows, abbreviations, romanization variants), provider-specific `lookupByMapping` implementations for sites that index by external ID.

**Unit / pure-logic tests** — edge cases in `HlsUtils`, extractor HTML parsing, language inference, URN helpers, similarity scoring, rate limiter, retry policy. These run without a network.

**Transport / HTTP server improvements** — proxy mode extensions, better curl fallback diagnostics, new server routes, custom `HttpTransport` implementations (Undici dispatcher, Bun compatibility, etc.).

## What's out of scope

| Area                                    | Reason                                                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Browser / frontend support              | The SDK depends on `child_process`, Node-specific crypto, and shell-out for E2E tests                  |
| UI components or players                | anime-sdk is headless                                                                                  |
| Login-gated or paywall sites            | Publicly accessible streams only                                                                       |
| CLI wrappers or download scripts        | Use the HTTP server or import the SDK directly                                                         |
| Mocked E2E tests                        | All E2E tests must hit live sites — a mock that passes while the real site fails is worse than no test |
| Tests with graceful skip-on-unreachable | A skipped test is a lie. Test must pass or be deleted. See `CLAUDE.md` for the full rule.              |

## Adding a provider — complete steps

A new provider is only complete when it is integrated across the whole ecosystem. Follow this checklist:

1. **Implement**: Extend `BaseProvider` in `src/providers/MyProvider.ts`. Use `DomRegistry.parse(html)` for parsing and compose existing extractors where possible.
2. **Standardize**: Ensure imports use `.js` extensions and re-export the provider from `src/index.ts`.
3. **Test**: Add a live E2E test in `tests/e2e/myprovider.test.ts`. It must search, resolve a stream, and call `captureStreamScreenshot`.
4. **Example Server**: Add your provider to the `providers` array in `examples/server.mjs`.
5. **Example Website**: Add your provider ID to the `PROVIDERS` array in `examples/website/src/pages/Search.tsx`.
6. **Documentation**:
   - Create a new MDX file in `website/src/content/docs/docs/providers/myprovider.mdx`.
   - Update the providers list in `website/src/content/docs/docs/providers/index.mdx`.

See the [full contributing guide](https://hexxt-git.github.io/anime-sdk/docs/contributing/) for annotated code examples and the extractor guide.

## PR guidelines

- One provider or extractor per PR.
- The E2E test must pass (`npx vitest run tests/e2e/myprovider.test.ts`) before opening.
- If `npm run build` produces type errors, fix them — the CI build must be clean.
- Keep the diff focused: no unrelated refactors, no formatting sweeps.
