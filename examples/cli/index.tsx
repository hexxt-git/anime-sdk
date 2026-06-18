import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import {
  HttpClient,
  AllmangaProvider,
  AnikotoProvider,
  AnimeParadiseProvider,
  GogoanimeProvider,
  MegaPlayProvider,
  MangadexProvider,
  WeebcentralProvider,
  AnilistMeta,
  MalMeta,
  MappingClient,
  type IMetaSearchResult,
  type IMediaMetadata,
  type IContentUnit,
  type ResolvedMediaStream,
  type IVideoPayload,
} from '../../dist/index.js';

// ─── SDK setup ────────────────────────────────────────────────────────────────

const http = new HttpClient({ timeoutMs: 30_000 });
const mapping = new MappingClient(http);

const META_PROVIDERS = {
  anilist: new AnilistMeta(http, { mappingClient: mapping }),
  mal: new MalMeta(http, { mappingClient: mapping }),
} as const;
type MetaProviderId = keyof typeof META_PROVIDERS;

const CONTENT_PROVIDERS = {
  allmanga: new AllmangaProvider(http),
  anikoto: new AnikotoProvider(http),
  animeparadise: new AnimeParadiseProvider(http),
  gogoanime: new GogoanimeProvider(http),
  megaplay: new MegaPlayProvider(http),
  mangadex: new MangadexProvider(http),
  weebcentral: new WeebcentralProvider(http),
} as const;
type ContentProviderId = keyof typeof CONTENT_PROVIDERS;

const CONTENT_PROVIDER_IDS = Object.keys(CONTENT_PROVIDERS) as ContentProviderId[];
const META_PROVIDER_IDS = Object.keys(META_PROVIDERS) as MetaProviderId[];
const BROWSE_KINDS = ['trending', 'popular', 'seasonal', 'top'] as const;
type BrowseKind = (typeof BROWSE_KINDS)[number];

// ─── Screen state ─────────────────────────────────────────────────────────────

type Screen =
  | { type: 'home' }
  | {
      type: 'browse';
      kind: BrowseKind;
      metaProvider: MetaProviderId;
      loading: boolean;
      items: IMetaSearchResult[];
      error: string | null;
    }
  | { type: 'search'; metaProvider: MetaProviderId }
  | { type: 'results'; items: IMetaSearchResult[]; query: string; metaProvider: MetaProviderId }
  | {
      type: 'media';
      info: IMediaMetadata;
      tab: 'overview' | 'chars' | 'staff' | 'rels';
      metaProvider: MetaProviderId;
    }
  | { type: 'provider-select'; info: IMediaMetadata; metaProvider: MetaProviderId }
  | {
      type: 'episodes';
      info: IMediaMetadata;
      contentProvider: ContentProviderId;
      units: IContentUnit[];
      loading: boolean;
      error: string | null;
    }
  | {
      type: 'stream';
      info: IMediaMetadata;
      unit: IContentUnit;
      contentProvider: ContentProviderId;
      result: ResolvedMediaStream | null;
      loading: boolean;
      error: string | null;
    };

// ─── Shared helpers ───────────────────────────────────────────────────────────

function preferredTitle(t: IMediaMetadata['title'] | IMetaSearchResult['title']): string {
  return t.english ?? t.romaji ?? t.userPreferred ?? t.native ?? '(untitled)';
}

function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .trim();
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

// ─── Scrollable select list ───────────────────────────────────────────────────

interface SelectListProps<T> {
  items: T[];
  active: number;
  renderItem: (item: T, isActive: boolean, index: number) => React.ReactNode;
  maxVisible?: number;
}

function SelectList<T>({ items, active, renderItem, maxVisible = 10 }: SelectListProps<T>) {
  const start = Math.max(0, active - maxVisible + 3);
  const visible = items.slice(start, start + maxVisible);
  return (
    <Box flexDirection="column">
      {visible.map((item, i) => (
        <Box key={start + i}>{renderItem(item, start + i === active, start + i)}</Box>
      ))}
    </Box>
  );
}

// ─── Divider ─────────────────────────────────────────────────────────────────

function Divider({ label }: { label?: string }) {
  const line = '─'.repeat(label ? 2 : 50);
  return (
    <Box>
      <Text color="gray">
        {label ? `─── ${label} ${'─'.repeat(Math.max(0, 46 - label.length))}` : '─'.repeat(50)}
      </Text>
    </Box>
  );
}

// ─── Status bar ──────────────────────────────────────────────────────────────

function StatusBar({ hints }: { hints: string }) {
  return (
    <Box borderStyle="single" borderColor="gray" paddingX={1} marginTop={1}>
      <Text color="gray" dimColor>
        {hints}
      </Text>
    </Box>
  );
}

// ─── Home screen ─────────────────────────────────────────────────────────────

const HOME_ITEMS = [
  { label: 'Browse Trending', action: 'browse-trending' },
  { label: 'Browse Popular', action: 'browse-popular' },
  { label: 'Browse Seasonal', action: 'browse-seasonal' },
  { label: 'Search (meta)', action: 'search' },
  { label: 'Quit', action: 'quit' },
] as const;

function HomeScreen({ onSelect }: { onSelect: (action: string) => void }) {
  const [active, setActive] = useState(0);
  const { exit } = useApp();

  useInput((input, key) => {
    if (key.upArrow) setActive((i) => Math.max(0, i - 1));
    if (key.downArrow) setActive((i) => Math.min(HOME_ITEMS.length - 1, i + 1));
    if (key.return) {
      const item = HOME_ITEMS[active];
      if (item.action === 'quit') exit();
      else onSelect(item.action);
    }
    if (input === 'q') exit();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="white">
          anime-sdk
        </Text>
        <Text color="gray"> — React Ink TUI</Text>
      </Box>
      <Divider />
      <Box flexDirection="column" marginY={1}>
        {HOME_ITEMS.map((item, i) => (
          <Box key={item.action}>
            <Text color={i === active ? 'white' : 'gray'}>
              {i === active ? '► ' : '  '}
              {item.label}
            </Text>
          </Box>
        ))}
      </Box>
      <Divider />
      <StatusBar hints="↑↓ navigate  Enter select  q quit" />
    </Box>
  );
}

// ─── Browse screen ────────────────────────────────────────────────────────────

function BrowseScreen({
  kind,
  metaProvider,
  onSelect,
  onBack,
}: {
  kind: BrowseKind;
  metaProvider: MetaProviderId;
  onSelect: (item: IMetaSearchResult) => void;
  onBack: () => void;
}) {
  const [active, setActive] = useState(0);
  const [items, setItems] = useState<IMetaSearchResult[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    const provider = META_PROVIDERS[metaProvider];
    provider
      .browse(kind, { catalogType: 'ANIME', perPage: 20 })
      .then(setItems)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [kind, metaProvider]);

  useInput((input, key) => {
    if (loading) return;
    if (key.upArrow) setActive((i) => Math.max(0, i - 1));
    if (key.downArrow) setActive((i) => Math.min(items.length - 1, i + 1));
    if (key.return && items[active]) onSelect(items[active]);
    if (key.escape || input === 'q') onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="gray">Browse / </Text>
        <Text bold color="white">
          {kind}
        </Text>
        <Text color="gray"> [{metaProvider}]</Text>
      </Box>
      <Divider />
      {loading && (
        <Box marginY={1}>
          <Text color="gray">loading...</Text>
        </Box>
      )}
      {error && (
        <Box marginY={1}>
          <Text color="red">{error}</Text>
        </Box>
      )}
      {!loading && !error && (
        <Box flexDirection="column" marginY={1}>
          <SelectList
            items={items}
            active={active}
            maxVisible={14}
            renderItem={(item, isActive) => {
              const title = preferredTitle(item.title);
              const score = item.score != null ? ` ★${(item.score / 10).toFixed(1)}` : '';
              const meta = [item.format, item.year].filter(Boolean).join(' ');
              return (
                <Box>
                  <Text color={isActive ? 'white' : 'gray'}>
                    {isActive ? '► ' : '  '}
                    {truncate(title, 38)}
                  </Text>
                  {score && <Text color={isActive ? 'yellow' : 'gray'}>{score}</Text>}
                  {meta && (
                    <Text color="gray" dimColor>
                      {' '}
                      {meta}
                    </Text>
                  )}
                </Box>
              );
            }}
          />
        </Box>
      )}
      <Divider />
      <StatusBar hints="↑↓ navigate  Enter details  Esc/q back" />
    </Box>
  );
}

// ─── Search screen ────────────────────────────────────────────────────────────

function SearchScreen({
  metaProvider,
  onResults,
  onBack,
}: {
  metaProvider: MetaProviderId;
  onResults: (items: IMetaSearchResult[], query: string) => void;
  onBack: () => void;
}) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doSearch = useCallback(async () => {
    if (!query.trim()) return;
    setSearching(true);
    setError(null);
    try {
      const results = await META_PROVIDERS[metaProvider].search(query.trim());
      onResults(results, query.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }, [query, metaProvider, onResults]);

  useInput((input, key) => {
    if (key.escape) onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="gray">Search [</Text>
        <Text bold color="white">
          {metaProvider}
        </Text>
        <Text color="gray">]</Text>
      </Box>
      <Divider />
      <Box marginY={1} gap={1}>
        <Text color="gray">› </Text>
        <TextInput
          value={query}
          onChange={setQuery}
          onSubmit={doSearch}
          placeholder="type a title and press Enter..."
        />
      </Box>
      {searching && <Text color="gray">searching...</Text>}
      {error && <Text color="red">{error}</Text>}
      <Divider />
      <StatusBar hints="Enter search  Esc back" />
    </Box>
  );
}

// ─── Results screen ───────────────────────────────────────────────────────────

function ResultsScreen({
  items,
  query,
  metaProvider,
  onSelect,
  onBack,
}: {
  items: IMetaSearchResult[];
  query: string;
  metaProvider: MetaProviderId;
  onSelect: (item: IMetaSearchResult) => void;
  onBack: () => void;
}) {
  const [active, setActive] = useState(0);

  useInput((input, key) => {
    if (key.upArrow) setActive((i) => Math.max(0, i - 1));
    if (key.downArrow) setActive((i) => Math.min(items.length - 1, i + 1));
    if (key.return && items[active]) onSelect(items[active]);
    if (key.escape || input === 'q') onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="gray">Results for </Text>
        <Text bold color="white">
          "{query}"
        </Text>
        <Text color="gray"> ({items.length})</Text>
      </Box>
      <Divider />
      <Box flexDirection="column" marginY={1}>
        <SelectList
          items={items}
          active={active}
          maxVisible={14}
          renderItem={(item, isActive) => {
            const title = preferredTitle(item.title);
            const score = item.score != null ? ` ★${(item.score / 10).toFixed(1)}` : '';
            return (
              <Box>
                <Text color={isActive ? 'white' : 'gray'}>
                  {isActive ? '► ' : '  '}
                  {truncate(title, 42)}
                </Text>
                {score && <Text color={isActive ? 'yellow' : 'gray'}>{score}</Text>}
                <Text color="gray" dimColor>
                  {' '}
                  {item.format ?? item.catalogType}
                </Text>
              </Box>
            );
          }}
        />
      </Box>
      <Divider />
      <StatusBar hints="↑↓ navigate  Enter details  Esc back" />
    </Box>
  );
}

// ─── Media info screen ────────────────────────────────────────────────────────

function MediaInfoScreen({
  info,
  metaProvider,
  onWatch,
  onBack,
}: {
  info: IMediaMetadata;
  metaProvider: MetaProviderId;
  onWatch: () => void;
  onBack: () => void;
}) {
  const [tab, setTab] = useState<'overview' | 'chars' | 'staff' | 'rels'>('overview');
  const [scroll, setScroll] = useState(0);

  const title = preferredTitle(info.title);
  const desc = info.description ? stripHtml(info.description) : null;

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    ...(info.characters?.length
      ? [{ key: 'chars' as const, label: `Chars(${info.characters.length})` }]
      : []),
    ...(info.staff?.length
      ? [{ key: 'staff' as const, label: `Staff(${info.staff.length})` }]
      : []),
    ...(info.relations?.length
      ? [{ key: 'rels' as const, label: `Relations(${info.relations.length})` }]
      : []),
  ];

  useInput((input, key) => {
    if (key.escape || input === 'q') onBack();
    if (input === 'w' || key.return) onWatch();
    if (input === 'c' && info.characters?.length) setTab('chars');
    if (input === 's' && info.staff?.length) setTab('staff');
    if (input === 'r' && info.relations?.length) setTab('rels');
    if (input === 'o') setTab('overview');
    if (key.downArrow) setScroll((s) => s + 1);
    if (key.upArrow) setScroll((s) => Math.max(0, s - 1));
    if (input === '\t') {
      const idx = tabs.findIndex((t) => t.key === tab);
      setTab(tabs[(idx + 1) % tabs.length].key);
      setScroll(0);
    }
  });

  const meta = [
    info.format,
    info.year,
    info.season,
    info.status,
    info.score != null ? `★${(info.score / 10).toFixed(1)}` : null,
    info.episodeCount != null ? `${info.episodeCount} eps` : null,
    info.chapterCount != null ? `${info.chapterCount} chapters` : null,
    info.durationMinutes != null ? `${info.durationMinutes}min` : null,
  ]
    .filter(Boolean)
    .join('  ');

  return (
    <Box flexDirection="column" padding={1}>
      {/* Header */}
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="white">
          {truncate(title, 60)}
        </Text>
        {info.title.romaji && info.title.romaji !== title && (
          <Text color="gray" dimColor>
            {truncate(info.title.romaji, 60)}
          </Text>
        )}
      </Box>
      <Divider />

      {/* Meta row */}
      <Box marginY={1} flexDirection="column" gap={0}>
        <Text color="gray">{meta}</Text>
        {info.studios && info.studios.length > 0 && (
          <Text color="gray" dimColor>
            Studio: {info.studios.slice(0, 2).join(', ')}
          </Text>
        )}
        {info.genres && info.genres.length > 0 && (
          <Text color="gray" dimColor>
            Genres: {info.genres.slice(0, 5).join(', ')}
          </Text>
        )}
      </Box>

      <Divider />

      {/* Tab bar */}
      <Box marginY={1} gap={2}>
        {tabs.map((t) => (
          <Text key={t.key} color={tab === t.key ? 'white' : 'gray'} bold={tab === t.key}>
            {tab === t.key ? `[${t.label}]` : t.label}
          </Text>
        ))}
      </Box>

      {/* Tab content */}
      {tab === 'overview' && (
        <Box flexDirection="column">
          {desc && (
            <Box marginBottom={1}>
              <Text color="gray" wrap="wrap">
                {desc
                  .split('\n')
                  .slice(scroll, scroll + 6)
                  .join('\n')}
              </Text>
            </Box>
          )}
          {info.externalLinks && info.externalLinks.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" dimColor>
                Links:{' '}
                {info.externalLinks
                  .slice(0, 5)
                  .map((l) => l.site)
                  .join(' · ')}
              </Text>
            </Box>
          )}
          {info.streamingEpisodes && info.streamingEpisodes.length > 0 && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" dimColor>
                Episodes metadata: {info.streamingEpisodes.length} entries available
              </Text>
            </Box>
          )}
          {info.mappings && (
            <Box flexDirection="column" marginTop={1}>
              <Text color="gray" dimColor>
                Mappings:{' '}
                {[
                  info.mappings.anilist != null && `AniList:${info.mappings.anilist}`,
                  info.mappings.mal != null && `MAL:${info.mappings.mal}`,
                  info.mappings.kitsu != null && `Kitsu:${info.mappings.kitsu}`,
                ]
                  .filter(Boolean)
                  .join('  ')}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {tab === 'chars' && info.characters && (
        <Box flexDirection="column">
          {info.characters.slice(scroll * 3, scroll * 3 + 9).map((c) => {
            const va = c.voiceActors?.find((v) => v.language === 'Japanese') ?? c.voiceActors?.[0];
            return (
              <Box key={c.id} gap={2}>
                <Text color="white">{truncate(c.name, 22)}</Text>
                <Text color="gray" dimColor>
                  {c.role ?? ''}
                </Text>
                {va && (
                  <Text color="gray" dimColor>
                    — {truncate(va.name, 18)}
                  </Text>
                )}
              </Box>
            );
          })}
          <Text color="gray" dimColor>
            {scroll * 3 + 1}–{Math.min((scroll + 3) * 3, info.characters.length)} of{' '}
            {info.characters.length}
          </Text>
        </Box>
      )}

      {tab === 'staff' && info.staff && (
        <Box flexDirection="column">
          {info.staff.slice(scroll, scroll + 10).map((s) => (
            <Box key={s.id} gap={2}>
              <Text color="white">{truncate(s.name, 24)}</Text>
              {s.role && (
                <Text color="gray" dimColor>
                  {s.role}
                </Text>
              )}
            </Box>
          ))}
        </Box>
      )}

      {tab === 'rels' && info.relations && (
        <Box flexDirection="column">
          {info.relations.slice(scroll, scroll + 8).map((r) => (
            <Box key={r.id} gap={2}>
              <Text color="gray">[{r.relationType}]</Text>
              <Text color="white">{truncate(preferredTitle(r.title), 32)}</Text>
              <Text color="gray" dimColor>
                {r.format ?? r.catalogType}
              </Text>
            </Box>
          ))}
        </Box>
      )}

      <Divider />
      <StatusBar hints="w/Enter watch  o overview  c chars  s staff  r rels  Tab cycle  ↑↓ scroll  Esc back" />
    </Box>
  );
}

// ─── Provider select screen ───────────────────────────────────────────────────

function ProviderSelectScreen({
  info,
  onSelect,
  onBack,
}: {
  info: IMediaMetadata;
  onSelect: (id: ContentProviderId) => void;
  onBack: () => void;
}) {
  const [active, setActive] = useState(0);
  const title = preferredTitle(info.title);

  // Filter to anime or manga providers based on catalogType
  const relevant = CONTENT_PROVIDER_IDS.filter((id) => {
    const isManga = info.catalogType === 'MANGA';
    const mangaProviders = ['mangadex', 'weebcentral'];
    return isManga ? mangaProviders.includes(id) : !mangaProviders.includes(id);
  });

  useInput((input, key) => {
    if (key.upArrow) setActive((i) => Math.max(0, i - 1));
    if (key.downArrow) setActive((i) => Math.min(relevant.length - 1, i + 1));
    if (key.return) onSelect(relevant[active]);
    if (key.escape || input === 'q') onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text color="gray">Select provider for </Text>
        <Text bold color="white">
          {truncate(title, 30)}
        </Text>
      </Box>
      <Divider />
      <Box flexDirection="column" marginY={1}>
        {relevant.map((id, i) => (
          <Box key={id}>
            <Text color={i === active ? 'white' : 'gray'}>
              {i === active ? '► ' : '  '}
              {id}
            </Text>
          </Box>
        ))}
      </Box>
      <Divider />
      <StatusBar hints="↑↓ navigate  Enter select  Esc back" />
    </Box>
  );
}

// ─── Episodes screen ──────────────────────────────────────────────────────────

function EpisodesScreen({
  info,
  contentProvider,
  units,
  onSelect,
  onBack,
}: {
  info: IMediaMetadata;
  contentProvider: ContentProviderId;
  units: IContentUnit[];
  onSelect: (unit: IContentUnit) => void;
  onBack: () => void;
}) {
  const [active, setActive] = useState(0);
  const title = preferredTitle(info.title);
  const isManga = info.catalogType === 'MANGA';

  useInput((input, key) => {
    if (key.upArrow) setActive((i) => Math.max(0, i - 1));
    if (key.downArrow) setActive((i) => Math.min(units.length - 1, i + 1));
    if (key.return && units[active]) onSelect(units[active]);
    if (key.escape || input === 'q') onBack();
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="white">
          {truncate(title, 40)}
        </Text>
        <Text color="gray">
          {' '}
          — {units.length} {isManga ? 'chapters' : 'episodes'} [{contentProvider}]
        </Text>
      </Box>
      <Divider />
      <Box flexDirection="column" marginY={1}>
        <SelectList
          items={units}
          active={active}
          maxVisible={14}
          renderItem={(unit, isActive) => {
            const prefix = isManga ? 'Ch' : 'EP';
            const num = String(unit.number).padStart(3, '0');
            const flags = [unit.isFiller ? 'FILLER' : null, unit.isRecap ? 'RECAP' : null]
              .filter(Boolean)
              .join(' ');
            return (
              <Box gap={2}>
                <Text color={isActive ? 'white' : 'gray'}>
                  {isActive ? '► ' : '  '}
                  {prefix}.{num}
                </Text>
                {flags && (
                  <Text color="yellow" dimColor>
                    [{flags}]
                  </Text>
                )}
                <Text color={isActive ? 'white' : 'gray'} dimColor={!isActive}>
                  {truncate(unit.title, 34)}
                </Text>
                {unit.availableLanguages && (
                  <Text color="gray" dimColor>
                    {unit.availableLanguages.join('/')}
                  </Text>
                )}
              </Box>
            );
          }}
        />
      </Box>
      <Divider />
      <StatusBar hints="↑↓ navigate  Enter stream  Esc back" />
    </Box>
  );
}

// ─── Stream result screen ─────────────────────────────────────────────────────

function StreamResultScreen({
  info,
  unit,
  contentProvider,
  result,
  onBack,
}: {
  info: IMediaMetadata;
  unit: IContentUnit;
  contentProvider: ContentProviderId;
  result: ResolvedMediaStream;
  onBack: () => void;
}) {
  const [active, setActive] = useState(0);
  const title = preferredTitle(info.title);
  const isManga = result.type === 'manga';

  const streams: IVideoPayload[] = result.type === 'video' ? result.streams : [];

  useInput((input, key) => {
    if (key.escape || input === 'q') onBack();
    if (!isManga) {
      if (key.upArrow) setActive((i) => Math.max(0, i - 1));
      if (key.downArrow) setActive((i) => Math.min(streams.length - 1, i + 1));
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1} flexDirection="column">
        <Box gap={1}>
          <Text bold color="white">
            {truncate(title, 38)}
          </Text>
          <Text color="gray">EP.{String(unit.number).padStart(3, '0')}</Text>
        </Box>
        <Text color="gray" dimColor>
          via {contentProvider}
        </Text>
      </Box>
      <Divider />

      {isManga && result.type === 'manga' && (
        <Box flexDirection="column" marginY={1}>
          <Text color="green">✓ {result.pages.imageUrls.length} pages resolved</Text>
          <Box marginTop={1} flexDirection="column">
            {result.pages.imageUrls.slice(0, 5).map((url, i) => (
              <Text key={i} color="gray" dimColor>
                {i + 1}. {truncate(url, 60)}
              </Text>
            ))}
            {result.pages.imageUrls.length > 5 && (
              <Text color="gray" dimColor>
                ... and {result.pages.imageUrls.length - 5} more
              </Text>
            )}
          </Box>
          {result.pages.headers && Object.keys(result.pages.headers).length > 0 && (
            <Box marginTop={1}>
              <Text color="gray" dimColor>
                Headers:{' '}
                {Object.entries(result.pages.headers)
                  .map(([k, v]) => `${k}: ${v}`)
                  .join(', ')}
              </Text>
            </Box>
          )}
        </Box>
      )}

      {!isManga && streams.length > 0 && (
        <Box flexDirection="column" marginY={1}>
          <Text color="green">
            ✓ {streams.length} stream{streams.length > 1 ? 's' : ''} resolved
          </Text>
          <Box flexDirection="column" marginTop={1}>
            {streams.map((s, i) => (
              <Box key={i} flexDirection="column" marginBottom={1}>
                <Box gap={2}>
                  <Text color={i === active ? 'white' : 'gray'}>
                    {i === active ? '●' : '○'} [{s.isHLS ? 'HLS' : 'MP4'}] {s.quality}
                    {s.language ? `  ${s.language}` : ''}
                  </Text>
                  {s.subtitles && s.subtitles.length > 0 && (
                    <Text color="cyan" dimColor>
                      {s.subtitles.length} sub{s.subtitles.length > 1 ? 's' : ''}
                    </Text>
                  )}
                </Box>
                <Text color={i === active ? 'cyan' : 'gray'} dimColor={i !== active}>
                  {'   '}
                  {truncate(s.sourceUrl, 58)}
                </Text>
                {i === active && s.headers && Object.keys(s.headers).length > 0 && (
                  <Text color="gray" dimColor>
                    {'   '}headers: {Object.keys(s.headers).join(', ')}
                  </Text>
                )}
                {i === active && s.subtitles && s.subtitles.length > 0 && (
                  <Box flexDirection="column">
                    {s.subtitles.slice(0, 3).map((sub, j) => (
                      <Text key={j} color="gray" dimColor>
                        {'   '}sub [{sub.label}]: {truncate(sub.url, 48)}
                      </Text>
                    ))}
                  </Box>
                )}
              </Box>
            ))}
          </Box>
        </Box>
      )}

      <Divider />
      <StatusBar hints={isManga ? 'Esc/q back' : '↑↓ switch stream  Esc/q back'} />
    </Box>
  );
}

// ─── Root app ─────────────────────────────────────────────────────────────────

function App() {
  const [screen, setScreen] = useState<Screen>({ type: 'home' });
  const [metaProvider, setMetaProvider] = useState<MetaProviderId>('anilist');
  const [history, setHistory] = useState<Screen[]>([]);

  const push = useCallback(
    (next: Screen) => {
      setHistory((h) => [...h, screen]);
      setScreen(next);
    },
    [screen],
  );

  const back = useCallback(() => {
    const prev = history[history.length - 1];
    if (prev) {
      setHistory((h) => h.slice(0, -1));
      setScreen(prev);
    }
  }, [history]);

  const loadMedia = useCallback(
    async (item: IMetaSearchResult) => {
      const loading: Screen = {
        type: 'media',
        info: null as unknown as IMediaMetadata,
        tab: 'overview',
        metaProvider,
      };
      push(loading);
      try {
        const info = await META_PROVIDERS[metaProvider].fetchMediaInfo(item.id);
        setScreen({ type: 'media', info, tab: 'overview', metaProvider });
      } catch (e) {
        back();
      }
    },
    [metaProvider, push, back],
  );

  const loadEpisodes = useCallback(
    async (info: IMediaMetadata, contentProviderId: ContentProviderId) => {
      const provider = CONTENT_PROVIDERS[contentProviderId];
      const loadingScreen: Screen = {
        type: 'episodes',
        info,
        contentProvider: contentProviderId,
        units: [],
        loading: true,
        error: null,
      };
      push(loadingScreen);
      try {
        const units = await META_PROVIDERS[metaProvider].fetchContentUnits(info.id, provider);
        setScreen({ ...loadingScreen, units, loading: false });
      } catch (e) {
        setScreen({
          ...loadingScreen,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [metaProvider, push],
  );

  const resolveStream = useCallback(
    async (info: IMediaMetadata, unit: IContentUnit, contentProviderId: ContentProviderId) => {
      const loadingScreen: Screen = {
        type: 'stream',
        info,
        unit,
        contentProvider: contentProviderId,
        result: null,
        loading: true,
        error: null,
      };
      push(loadingScreen);
      try {
        const provider = CONTENT_PROVIDERS[contentProviderId];
        const lang = unit.availableLanguages?.[0] ?? 'sub';
        const result = await provider.resolveStream(unit.id, lang as 'sub' | 'dub' | 'raw');
        setScreen({ ...loadingScreen, result, loading: false });
      } catch (e) {
        setScreen({
          ...loadingScreen,
          loading: false,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    },
    [push],
  );

  if (screen.type === 'home') {
    return (
      <HomeScreen
        onSelect={(action) => {
          if (action === 'browse-trending')
            push({
              type: 'browse',
              kind: 'trending',
              metaProvider,
              loading: true,
              items: [],
              error: null,
            });
          if (action === 'browse-popular')
            push({
              type: 'browse',
              kind: 'popular',
              metaProvider,
              loading: true,
              items: [],
              error: null,
            });
          if (action === 'browse-seasonal')
            push({
              type: 'browse',
              kind: 'seasonal',
              metaProvider,
              loading: true,
              items: [],
              error: null,
            });
          if (action === 'search') push({ type: 'search', metaProvider });
        }}
      />
    );
  }

  if (screen.type === 'browse') {
    return (
      <BrowseScreen
        kind={screen.kind}
        metaProvider={screen.metaProvider}
        onSelect={loadMedia}
        onBack={back}
      />
    );
  }

  if (screen.type === 'search') {
    return (
      <SearchScreen
        metaProvider={screen.metaProvider}
        onResults={(items, query) =>
          push({ type: 'results', items, query, metaProvider: screen.metaProvider })
        }
        onBack={back}
      />
    );
  }

  if (screen.type === 'results') {
    return (
      <ResultsScreen
        items={screen.items}
        query={screen.query}
        metaProvider={screen.metaProvider}
        onSelect={loadMedia}
        onBack={back}
      />
    );
  }

  if (screen.type === 'media') {
    if (!screen.info) {
      return (
        <Box padding={1}>
          <Text color="gray">Loading media info...</Text>
        </Box>
      );
    }
    return (
      <MediaInfoScreen
        info={screen.info}
        metaProvider={screen.metaProvider}
        onWatch={() =>
          push({ type: 'provider-select', info: screen.info, metaProvider: screen.metaProvider })
        }
        onBack={back}
      />
    );
  }

  if (screen.type === 'provider-select') {
    return (
      <ProviderSelectScreen
        info={screen.info}
        onSelect={(id) => loadEpisodes(screen.info, id)}
        onBack={back}
      />
    );
  }

  if (screen.type === 'episodes') {
    if (screen.loading) {
      return (
        <Box padding={1} flexDirection="column">
          <Text color="gray">Resolving episodes via {screen.contentProvider}...</Text>
          <Text color="gray" dimColor>
            (cross-source mapping may take a few seconds)
          </Text>
        </Box>
      );
    }
    if (screen.error) {
      return (
        <Box padding={1} flexDirection="column">
          <Text color="red">{screen.error}</Text>
          <Text color="gray">Press Esc to go back</Text>
        </Box>
      );
    }
    return (
      <EpisodesScreen
        info={screen.info}
        contentProvider={screen.contentProvider}
        units={screen.units}
        onSelect={(unit) => resolveStream(screen.info, unit, screen.contentProvider)}
        onBack={back}
      />
    );
  }

  if (screen.type === 'stream') {
    if (screen.loading) {
      return (
        <Box padding={1}>
          <Text color="gray">Resolving stream...</Text>
        </Box>
      );
    }
    if (screen.error || !screen.result) {
      return (
        <Box padding={1} flexDirection="column">
          <Text color="red">{screen.error ?? 'No result'}</Text>
          <Text color="gray">Press Esc to go back</Text>
        </Box>
      );
    }
    return (
      <StreamResultScreen
        info={screen.info}
        unit={screen.unit}
        contentProvider={screen.contentProvider}
        result={screen.result}
        onBack={back}
      />
    );
  }

  return null;
}

// Boot the app — need stdin in raw mode for key capture
const { stdin } = process;
if (stdin.isTTY) stdin.setRawMode(true);

render(<App />);
