import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import {
  createSdk,
  type Media,
  type Episode,
  type Chapter,
  type Stream,
  type Pages,
} from '../../dist/index.js';

// ─── SDK ─────────────────────────────────────────────────────────────────────

const sdk = createSdk({ http: { timeoutMs: 30_000 } });

// ─── Screen state ─────────────────────────────────────────────────────────────

type Screen =
  | { type: 'home' }
  | { type: 'browse'; loading: boolean; items: Media[]; error: string | null }
  | { type: 'search' }
  | { type: 'results'; items: Media[]; query: string }
  | { type: 'media'; media: Media }
  | { type: 'episodes'; media: Media; items: Episode[]; loading: boolean; error: string | null }
  | { type: 'chapters'; media: Media; items: Chapter[]; loading: boolean; error: string | null }
  | {
      type: 'stream';
      episode: Episode;
      streams: Stream[];
      loading: boolean;
      error: string | null;
    }
  | {
      type: 'pages';
      chapter: Chapter;
      result: Pages | null;
      loading: boolean;
      error: string | null;
    };

// ─── Helpers ─────────────────────────────────────────────────────────────────

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

function SelectList<T>({
  items,
  active,
  renderItem,
  maxVisible = 12,
}: {
  items: T[];
  active: number;
  renderItem: (item: T, isActive: boolean, index: number) => React.ReactNode;
  maxVisible?: number;
}) {
  const start = Math.max(0, active - maxVisible + 3);
  const visible = items.slice(start, start + maxVisible);
  return (
    <Box flexDirection="column">
      {visible.map((item, i) => (
        <Box key={i}>{renderItem(item, start + i === active, start + i)}</Box>
      ))}
      {items.length > maxVisible && (
        <Text color="gray">{`  +${items.length - maxVisible} more`}</Text>
      )}
    </Box>
  );
}

// ─── App ─────────────────────────────────────────────────────────────────────

function App() {
  const { exit } = useApp();
  const [screen, setScreen] = useState<Screen>({ type: 'home' });
  const [kind, setKind] = useState<'anime' | 'manga'>('anime');
  const [activeIdx, setActiveIdx] = useState(0);
  const [searchInput, setSearchInput] = useState('');

  const push = useCallback((s: Screen) => {
    setScreen(s);
    setActiveIdx(0);
  }, []);

  // ─── Browse loader ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== 'browse' || !screen.loading) return;
    sdk
      .browse({ list: 'trending', kind })
      .then((list) => push({ type: 'browse', loading: false, items: list.items, error: null }))
      .catch((e) =>
        push({ type: 'browse', loading: false, items: [], error: (e as Error).message }),
      );
  }, [screen.type === 'browse' && screen.loading, kind]);

  // ─── Episodes loader ────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== 'episodes' || !screen.loading) return;
    const m = screen.media;
    sdk
      .episodes(m)
      .then((list) =>
        setScreen({ type: 'episodes', media: m, items: list.items, loading: false, error: null }),
      )
      .catch((e) =>
        setScreen({
          type: 'episodes',
          media: m,
          items: [],
          loading: false,
          error: (e as Error).message,
        }),
      );
  }, [screen.type === 'episodes' && screen.loading]);

  // ─── Chapters loader ────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== 'chapters' || !screen.loading) return;
    const m = screen.media;
    sdk
      .chapters(m)
      .then((list) =>
        setScreen({ type: 'chapters', media: m, items: list.items, loading: false, error: null }),
      )
      .catch((e) =>
        setScreen({
          type: 'chapters',
          media: m,
          items: [],
          loading: false,
          error: (e as Error).message,
        }),
      );
  }, [screen.type === 'chapters' && screen.loading]);

  // ─── Stream loader ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== 'stream' || !screen.loading) return;
    const ep = screen.episode;
    sdk
      .stream(ep)
      .then((streams) =>
        setScreen({ type: 'stream', episode: ep, streams, loading: false, error: null }),
      )
      .catch((e) =>
        setScreen({
          type: 'stream',
          episode: ep,
          streams: [],
          loading: false,
          error: (e as Error).message,
        }),
      );
  }, [screen.type === 'stream' && screen.loading]);

  // ─── Pages loader ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen.type !== 'pages' || !screen.loading) return;
    const ch = screen.chapter;
    sdk
      .pages(ch)
      .then((result) =>
        setScreen({ type: 'pages', chapter: ch, result, loading: false, error: null }),
      )
      .catch((e) =>
        setScreen({
          type: 'pages',
          chapter: ch,
          result: null,
          loading: false,
          error: (e as Error).message,
        }),
      );
  }, [screen.type === 'pages' && screen.loading]);

  // ─── Input handling ────────────────────────────────────────────────────────
  useInput((input, key) => {
    if (key.ctrl && input === 'c') exit();

    if (screen.type === 'home') {
      if (input === 's') push({ type: 'search' });
      if (input === 'b') push({ type: 'browse', loading: true, items: [], error: null });
      if (input === 'a') setKind('anime');
      if (input === 'm') setKind('manga');
    }

    if (screen.type === 'browse' || screen.type === 'results') {
      const items = screen.type === 'browse' ? screen.items : screen.items;
      if (key.upArrow) setActiveIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setActiveIdx((i) => Math.min(items.length - 1, i + 1));
      if (key.return && items[activeIdx]) push({ type: 'media', media: items[activeIdx] });
      if (key.escape) push({ type: 'home' });
    }

    if (screen.type === 'media') {
      const m = screen.media;
      if (input === 'e' || input === 'r') {
        if (m.kind === 'manga')
          push({ type: 'chapters', media: m, items: [], loading: true, error: null });
        else push({ type: 'episodes', media: m, items: [], loading: true, error: null });
      }
      if (key.escape) push({ type: 'home' });
    }

    if (screen.type === 'episodes') {
      if (key.upArrow) setActiveIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setActiveIdx((i) => Math.min(screen.items.length - 1, i + 1));
      if (key.return && screen.items[activeIdx]) {
        push({
          type: 'stream',
          episode: screen.items[activeIdx],
          streams: [],
          loading: true,
          error: null,
        });
      }
      if (key.escape) push({ type: 'media', media: screen.media });
    }

    if (screen.type === 'chapters') {
      if (key.upArrow) setActiveIdx((i) => Math.max(0, i - 1));
      if (key.downArrow) setActiveIdx((i) => Math.min(screen.items.length - 1, i + 1));
      if (key.return && screen.items[activeIdx]) {
        push({
          type: 'pages',
          chapter: screen.items[activeIdx],
          result: null,
          loading: true,
          error: null,
        });
      }
      if (key.escape) push({ type: 'media', media: screen.media });
    }

    if (screen.type === 'stream') {
      if (key.escape)
        push({
          type: 'episodes',
          media: { kind: 'anime' } as Media,
          items: [],
          loading: false,
          error: null,
        });
    }

    if (screen.type === 'pages') {
      if (key.escape) push({ type: 'media', media: { kind: 'manga' } as Media });
    }
  });

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <Box flexDirection="column" padding={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">
          anime-sdk{' '}
        </Text>
        <Text color="gray">2.0 </Text>
        <Text color={kind === 'anime' ? 'white' : 'gray'}>[a]nime</Text>
        <Text color="gray"> </Text>
        <Text color={kind === 'manga' ? 'white' : 'gray'}>[m]anga</Text>
      </Box>

      {screen.type === 'home' && (
        <Box flexDirection="column" gap={0}>
          <Text>[s] search</Text>
          <Text>[b] browse trending</Text>
          <Text color="gray">ctrl+c quit</Text>
        </Box>
      )}

      {screen.type === 'search' && (
        <Box flexDirection="column">
          <Text>Search: </Text>
          <TextInput
            value={searchInput}
            onChange={setSearchInput}
            onSubmit={async (q) => {
              if (!q.trim()) return;
              const results = await sdk.search(q.trim(), { kind });
              push({ type: 'results', items: results, query: q });
              setSearchInput('');
            }}
          />
        </Box>
      )}

      {(screen.type === 'results' || screen.type === 'browse') && (
        <Box flexDirection="column">
          <Text color="gray" dimColor>
            {screen.type === 'results'
              ? `results for "${screen.query}" (${screen.items.length})`
              : `trending ${kind}`}
          </Text>
          {screen.type === 'browse' && screen.loading && <Text color="gray">loading…</Text>}
          {screen.type === 'browse' && screen.error && <Text color="red">{screen.error}</Text>}
          <SelectList
            items={screen.items}
            active={activeIdx}
            renderItem={(m, isActive) => (
              <Text color={isActive ? 'cyan' : undefined}>
                {isActive ? '› ' : '  '}
                {truncate(m.title.preferred, 50)}
                {'  '}
                <Text color="gray">
                  {m.year ? String(m.year) : ''}
                  {m.score ? `  ★${((m.score.value / m.score.scale) * 10).toFixed(1)}` : ''}
                </Text>
              </Text>
            )}
          />
          <Text color="gray">↑↓ navigate enter select esc home</Text>
        </Box>
      )}

      {screen.type === 'media' && (
        <Box flexDirection="column" gap={0}>
          <Text bold>{screen.media.title.preferred}</Text>
          {screen.media.title.native && <Text color="gray">{screen.media.title.native}</Text>}
          <Box marginTop={1} gap={2}>
            {screen.media.status && <Text color="gray">{screen.media.status}</Text>}
            {screen.media.format && <Text color="gray">{screen.media.format}</Text>}
            {screen.media.year && <Text color="gray">{String(screen.media.year)}</Text>}
            {screen.media.score && (
              <Text color="yellow">
                ★ {((screen.media.score.value / screen.media.score.scale) * 10).toFixed(1)}
              </Text>
            )}
          </Box>
          {screen.media.episodeCount && (
            <Text color="gray">{screen.media.episodeCount} episodes</Text>
          )}
          {screen.media.chapterCount && (
            <Text color="gray">{screen.media.chapterCount} chapters</Text>
          )}
          {screen.media.description && (
            <Box marginTop={1}>
              <Text wrap="wrap" color="gray">
                {truncate(stripHtml(screen.media.description), 300)}
              </Text>
            </Box>
          )}
          <Box marginTop={1}>
            <Text>[e/r] {screen.media.kind === 'manga' ? 'read chapters' : 'watch episodes'} </Text>
            <Text color="gray">esc home</Text>
          </Box>
        </Box>
      )}

      {screen.type === 'episodes' && (
        <Box flexDirection="column">
          {screen.loading && <Text color="gray">loading episodes…</Text>}
          {screen.error && <Text color="red">{screen.error}</Text>}
          {!screen.loading && !screen.error && (
            <>
              <Text color="gray" dimColor>
                {screen.items.length} episodes
              </Text>
              <SelectList
                items={screen.items}
                active={activeIdx}
                renderItem={(ep, isActive) => (
                  <Text color={isActive ? 'cyan' : undefined}>
                    {isActive ? '› ' : '  '}
                    {`EP.${String(ep.number).padStart(3, '0')}  `}
                    <Text>{truncate(ep.title ?? '', 40)}</Text>
                    <Text color="gray"> {ep.languages.join('/')}</Text>
                  </Text>
                )}
              />
              <Text color="gray">↑↓ navigate enter stream esc back</Text>
            </>
          )}
        </Box>
      )}

      {screen.type === 'chapters' && (
        <Box flexDirection="column">
          {screen.loading && <Text color="gray">loading chapters…</Text>}
          {screen.error && <Text color="red">{screen.error}</Text>}
          {!screen.loading && !screen.error && (
            <>
              <Text color="gray" dimColor>
                {screen.items.length} chapters
              </Text>
              <SelectList
                items={screen.items}
                active={activeIdx}
                renderItem={(ch, isActive) => (
                  <Text color={isActive ? 'cyan' : undefined}>
                    {isActive ? '› ' : '  '}
                    {`Ch.${String(ch.number).padStart(3, '0')}  `}
                    <Text>{truncate(ch.title ?? '', 40)}</Text>
                  </Text>
                )}
              />
              <Text color="gray">↑↓ navigate enter pages esc back</Text>
            </>
          )}
        </Box>
      )}

      {screen.type === 'stream' && (
        <Box flexDirection="column">
          {screen.loading && <Text color="gray">resolving streams…</Text>}
          {screen.error && <Text color="red">{screen.error}</Text>}
          {screen.streams.length > 0 && (
            <>
              <Text bold>
                EP.{screen.episode.number} {screen.episode.title ?? ''}
              </Text>
              <Box marginTop={1} flexDirection="column">
                {screen.streams.map((s, i) => (
                  <Box key={i} flexDirection="column" marginBottom={1}>
                    <Text color="gray">
                      [{s.isHls ? 'HLS' : 'MP4'}] {s.source} · {s.language} {s.quality} {s.server}
                    </Text>
                    <Text color="cyan" wrap="wrap">
                      {s.url}
                    </Text>
                    {s.subtitles.length > 0 && (
                      <Text color="gray">
                        subtitles: {s.subtitles.map((sub) => sub.label).join(', ')}
                      </Text>
                    )}
                  </Box>
                ))}
              </Box>
            </>
          )}
          <Text color="gray">esc back</Text>
        </Box>
      )}

      {screen.type === 'pages' && (
        <Box flexDirection="column">
          {screen.loading && <Text color="gray">loading pages…</Text>}
          {screen.error && <Text color="red">{screen.error}</Text>}
          {screen.result && (
            <>
              <Text bold>
                Ch.{screen.chapter.number} {screen.chapter.title ?? ''}
              </Text>
              <Text color="gray">{screen.result.pages.length} pages</Text>
              {screen.result.pages.slice(0, 3).map((p, i) => (
                <Text key={i} color="cyan" wrap="wrap">
                  {p.url}
                </Text>
              ))}
              {screen.result.pages.length > 3 && (
                <Text color="gray">… +{screen.result.pages.length - 3} more</Text>
              )}
            </>
          )}
          <Text color="gray">esc back</Text>
        </Box>
      )}
    </Box>
  );
}

render(<App />);
