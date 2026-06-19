import type { APIRoute } from 'astro';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createElement as h } from 'react';

const __dir = dirname(fileURLToPath(import.meta.url));
const fontsDir = join(__dir, '../../../node_modules/@fontsource/inter/files');

let fontRegular: Buffer | null = null;
let fontBold: Buffer | null = null;

async function getFonts() {
  if (!fontRegular) fontRegular = await readFile(join(fontsDir, 'inter-latin-400-normal.woff'));
  if (!fontBold) fontBold = await readFile(join(fontsDir, 'inter-latin-700-normal.woff'));
  return { regular: fontRegular!, bold: fontBold! };
}

export const pages: Record<string, { title: string; description: string; section?: string }> = {
  index: {
    title: 'anime-sdk',
    description:
      'Nine providers. A pluggable HTTP transport. An optional proxy server. Ship your anime app without touching a single stream URL.',
  },
  faq: {
    title: 'FAQ',
    description:
      'Common questions about providers, stream URLs, browser support, and when to use the HTTP server.',
    section: 'GENERAL',
  },
  'docs/index': {
    title: 'Getting Started',
    description:
      'Install anime-sdk, shim DOMParser, pick a provider, and resolve your first stream in under ten lines of TypeScript.',
    section: 'DOCS',
  },
  'docs/http-server': {
    title: 'HTTP Server',
    description:
      'Expose every provider over REST — /search, /content, /stream, /tracks — so any language or frontend can call anime-sdk over HTTP.',
    section: 'DOCS',
  },
  'docs/proxy': {
    title: 'Stream Proxy',
    description:
      'CDN streams block browsers with CORS and custom headers. Enable proxy: true and every URL becomes directly playable.',
    section: 'DOCS',
  },
  'docs/download': {
    title: 'Downloads',
    description:
      'Save anime episodes as MP4 via ffmpeg mux and manga chapters as ZIP archives with a single utility call.',
    section: 'DOCS',
  },
  'docs/api-reference': {
    title: 'API Reference',
    description:
      'Every exported type, interface, and class — Media, Episode, Stream, Pages, AniError, createSdk, startServerV2, and more.',
    section: 'DOCS',
  },
  'docs/contributing': {
    title: 'Contributing',
    description:
      'Add a new source in four steps: implement the Source interface, register it in createSdk(), compose extractors, and ship a live E2E screenshot test.',
    section: 'DOCS',
  },
  'docs/providers/index': {
    title: 'Providers',
    description:
      '12 live-tested sources across anime and manga — sub, dub, raw, and Brazilian Portuguese. All verified on every release.',
    section: 'PROVIDERS',
  },
  'docs/providers/allmanga': {
    title: 'AllManga',
    description:
      'AllAnime GraphQL with AES-CTR decryption. Sub, dub, and raw. mp4upload, wixmp, and generic HLS sources all covered.',
    section: 'PROVIDERS',
  },
  'docs/providers/animeparadise': {
    title: 'AnimeParadise',
    description:
      'Clean REST API, sub only, with first-class external VTT subtitle tracks returned alongside every stream URL.',
    section: 'PROVIDERS',
  },
  'docs/providers/gogoanime': {
    title: 'Gogoanime',
    description:
      'Scrapes anineko.to for episode pages and extracts HLS master playlists via vibeplayer embeds. Sub only.',
    section: 'PROVIDERS',
  },
  'docs/providers/anikoto': {
    title: 'Anikoto',
    description:
      'JSON API provider for anikototv.to. High-quality HLS streams with integrated VTT subtitles. Sub and dub.',
    section: 'PROVIDERS',
  },
  'docs/providers/megaplay': {
    title: 'MegaPlay',
    description:
      'AniList GraphQL for search, MegaPlay for streams. Sub and dub with VTT subtitles. Works for any AniList title.',
    section: 'PROVIDERS',
  },
  'docs/providers/goyabu': {
    title: 'Goyabu',
    description:
      'Brazilian Portuguese anime via goyabu.io. Extracts Blogger tokens and calls Google batchexecute to recover googlevideo.com URLs.',
    section: 'PROVIDERS',
  },
  'docs/providers/mangadex': {
    title: 'MangaDex',
    description:
      'Official MangaDex JSON API. High-resolution chapter pages, all languages, no scraping — the cleanest manga source available.',
    section: 'PROVIDERS',
  },
  'docs/providers/weebcentral': {
    title: 'WeebCentral',
    description:
      'HTML scrape of weebcentral.com for English manga chapters. Good fallback when MangaDex lacks a title.',
    section: 'PROVIDERS',
  },
  'docs/providers/mangapill': {
    title: 'MangaPill',
    description:
      'HTML scrape of mangapill.com. Wide catalogue coverage for manga titles not yet on MangaDex or WeebCentral.',
    section: 'PROVIDERS',
  },
  dmca: {
    title: 'DMCA',
    description:
      'anime-sdk does not host content. It resolves publicly accessible URLs from third-party sites.',
    section: 'LEGAL',
  },
  terms: {
    title: 'Terms of Use',
    description:
      'MIT-licensed open-source software. Acceptable use, no warranty, and third-party site responsibilities.',
    section: 'LEGAL',
  },
  privacy: {
    title: 'Privacy Policy',
    description:
      'No accounts, no tracking, no analytics. A static documentation site — here is what data we touch.',
    section: 'LEGAL',
  },
  contact: {
    title: 'Contact',
    description:
      'Bug reports, security disclosures, legal questions, and contributing — use the right channel.',
    section: 'CONTACT',
  },
};

const BORDER = 'rgba(255,255,255,0.08)';
const ACCENT = '#8b5cf6';
const MUTED = '#6b7280';
const BG = '#111113';

function buildImage(title: string, description: string, section?: string) {
  const dots = Array.from({ length: 198 }, () =>
    h('div', {
      style: { width: 2, height: 2, backgroundColor: 'rgba(255,255,255,0.13)', flexShrink: 0 },
    }),
  );

  return h(
    'div',
    {
      style: {
        width: 1200,
        height: 630,
        backgroundColor: BG,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Inter',
        borderLeft: `4px solid ${ACCENT}`,
      },
    },
    // Header strip
    h(
      'div',
      {
        style: {
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 52px',
          height: 68,
          borderBottom: `1px solid ${BORDER}`,
        },
      },
      h(
        'span',
        { style: { color: ACCENT, fontSize: 14, fontWeight: 700, letterSpacing: '0.1em' } },
        'anime-sdk',
      ),
      h(
        'span',
        { style: { color: MUTED, fontSize: 13, fontWeight: 400 } },
        'github.com/hexxt-git/anime-sdk',
      ),
    ),
    // Content row
    h(
      'div',
      { style: { flex: 1, display: 'flex' } },
      // Left: text
      h(
        'div',
        {
          style: {
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'center',
            padding: '0 56px',
          },
        },
        section &&
          h(
            'div',
            {
              style: {
                color: ACCENT,
                fontSize: 12,
                fontWeight: 700,
                letterSpacing: '0.12em',
                marginBottom: 20,
              },
            },
            section,
          ),
        h(
          'div',
          {
            style: {
              color: 'white',
              fontSize: 54,
              fontWeight: 700,
              letterSpacing: '-0.025em',
              lineHeight: '1.1',
            },
          },
          title,
        ),
        h(
          'div',
          {
            style: {
              marginTop: 18,
              color: MUTED,
              fontSize: 19,
              fontWeight: 400,
              lineHeight: '1.55',
              maxWidth: 560,
            },
          },
          description,
        ),
      ),
      // Right: dot grid
      h(
        'div',
        {
          style: {
            width: 296,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderLeft: `1px solid ${BORDER}`,
            overflow: 'hidden',
            padding: '24px 28px',
          },
        },
        h(
          'div',
          {
            style: {
              display: 'flex',
              flexWrap: 'wrap',
              gap: 22,
              width: 240,
              alignContent: 'center',
            },
          },
          ...dots,
        ),
      ),
    ),
    // Footer: slogan
    h(
      'div',
      {
        style: {
          height: 68,
          display: 'flex',
          alignItems: 'center',
          padding: '0 56px',
          borderTop: `1px solid ${BORDER}`,
          gap: 0,
        },
      },
      h(
        'span',
        { style: { color: 'rgba(255,255,255,0.55)', fontSize: 15, fontWeight: 400 } },
        'Build your anime app. ',
      ),
      h(
        'span',
        { style: { color: ACCENT, fontSize: 15, fontWeight: 600 } },
        "we'll handle the streams.",
      ),
    ),
  );
}

export function getStaticPaths() {
  return Object.keys(pages).map((slug) => ({ params: { slug } }));
}

export const GET: APIRoute = async ({ params }) => {
  const slug = params.slug as string;
  const page = pages[slug];

  if (!page) {
    return new Response('Not found', { status: 404 });
  }

  const { regular, bold } = await getFonts();

  const svg = await satori(buildImage(page.title, page.description, page.section), {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Inter', data: regular, weight: 400, style: 'normal' },
      { name: 'Inter', data: bold, weight: 700, style: 'normal' },
    ],
  });

  const resvg = new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } });
  const png = resvg.render().asPng();

  return new Response(png.buffer as ArrayBuffer, {
    headers: {
      'Content-Type': 'image/png',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
};
