/// <reference types="vite/client" />
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

const get = (path: string, params: Record<string, string>) =>
  fetch(`${API}${path}?${new URLSearchParams(params)}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });

// ─── Content provider routes ─────────────────────────────────────────────────

export const search = (provider: string, q: string) => get('/search', { provider, q });

export const content = (provider: string, mediaId: string) =>
  get('/content', { provider, mediaId });

export const stream = (provider: string, unitId: string, language: string) =>
  get('/stream', { provider, unitId, language });

export const tracks = (provider: string, unitId: string, language: string) =>
  get('/tracks', { provider, unitId, language });

// ─── Metadata routes ─────────────────────────────────────────────────────────

export const metaSearch = (provider: string, q: string) => get('/meta/search', { provider, q });

export const metaInfo = (provider: string, id: string) => get('/meta/info', { provider, id });

export const metaContent = (provider: string, id: string, contentProvider: string) =>
  get('/meta/content', { provider, id, contentProvider });

export const metaStream = (
  provider: string,
  id: string,
  episode: number,
  contentProvider: string,
  language: string,
) => get('/meta/stream', { provider, id, episode: String(episode), contentProvider, language });

export const metaBrowse = (
  provider: string,
  kind: string,
  opts: { catalogType?: string; perPage?: number; season?: string; year?: number } = {},
) =>
  get('/meta/browse', {
    provider,
    kind,
    ...(opts.catalogType ? { catalogType: opts.catalogType } : {}),
    ...(opts.perPage ? { perPage: String(opts.perPage) } : {}),
    ...(opts.season ? { season: opts.season } : {}),
    ...(opts.year ? { year: String(opts.year) } : {}),
  });

// ─── Provider lists ───────────────────────────────────────────────────────────

export const CONTENT_PROVIDERS = [
  'megaplay',
  'allmanga',
  'animeparadise',
  'anikoto',
  'gogoanime',
  'goyabu',
  'mangadex',
  'weebcentral',
  'mangapill',
] as const;

export const META_PROVIDERS = ['anilist', 'mal', 'kitsu'] as const;

export type MetaProvider = (typeof META_PROVIDERS)[number];

// ─── Content types ────────────────────────────────────────────────────────────

export type Lang = 'sub' | 'dub' | 'raw';

export interface SearchResult {
  id: string;
  title: string;
  thumbnailUrl?: string;
  catalogType: string;
  providerId: string;
  availableLanguages?: Lang[];
  year?: number;
}

export interface Episode {
  id: string;
  title: string;
  number: number;
  availableLanguages?: Lang[];
  thumbnailUrl?: string;
  description?: string;
  airDate?: string;
  isFiller?: boolean;
  isRecap?: boolean;
}

export interface SubtitleTrack {
  url: string;
  language: string;
  label: string;
  format?: 'vtt' | 'srt' | 'ass';
}

export interface VideoStream {
  sourceUrl: string;
  isHLS: boolean;
  quality: string;
  language?: Lang;
  headers?: Record<string, string>;
  subtitles?: SubtitleTrack[];
}

export interface MangaStream {
  imageUrls: string[];
  headers?: Record<string, string>;
}

export interface ResolvedStream {
  type: 'video' | 'manga' | 'live';
  streams?: VideoStream[];
  pages?: MangaStream;
}

// ─── Metadata types ───────────────────────────────────────────────────────────

export interface MetaTitle {
  romaji?: string;
  english?: string;
  native?: string;
  userPreferred?: string;
}

export interface MetaCover {
  large?: string;
  medium?: string;
  color?: string;
}

export interface MetaSearchResult {
  id: string;
  providerId: string;
  catalogType: string;
  title: MetaTitle;
  cover?: MetaCover;
  year?: number;
  format?: string;
  score?: number;
  isAdult?: boolean;
}

export interface MediaRelation {
  id: string;
  relationType: string;
  catalogType: string;
  format?: string;
  status?: string;
  title: MetaTitle;
  cover?: MetaCover;
}

export interface VoiceActor {
  id: string;
  name: string;
  language?: string;
  image?: MetaCover;
}

export interface MediaCharacter {
  id: string;
  name: string;
  role?: string;
  image?: MetaCover;
  voiceActors?: VoiceActor[];
}

export interface MediaStaff {
  id: string;
  name: string;
  role?: string;
  image?: MetaCover;
}

export interface MediaRecommendation {
  id: string;
  catalogType: string;
  format?: string;
  title: MetaTitle;
  cover?: MetaCover;
  rating?: number;
}

export interface ExternalLink {
  site: string;
  url: string;
  language?: string;
  type?: 'STREAMING' | 'INFO' | 'SOCIAL';
}

export interface StreamingEpisode {
  number: number;
  title?: string;
  description?: string;
  thumbnail?: string;
  airDate?: string;
  isFiller?: boolean;
  isRecap?: boolean;
}

export interface MediaMetadata {
  id: string;
  providerId: string;
  catalogType: string;
  title: MetaTitle;
  description?: string;
  cover?: MetaCover;
  banner?: string;
  status?: string;
  format?: string;
  episodeCount?: number;
  chapterCount?: number;
  durationMinutes?: number;
  genres?: string[];
  tags?: string[];
  studios?: string[];
  year?: number;
  season?: string;
  startDate?: string;
  endDate?: string;
  score?: number;
  trailer?: string;
  isAdult?: boolean;
  synonyms?: string[];
  relations?: MediaRelation[];
  characters?: MediaCharacter[];
  staff?: MediaStaff[];
  recommendations?: MediaRecommendation[];
  externalLinks?: ExternalLink[];
  streamingEpisodes?: StreamingEpisode[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function preferredTitle(t: MetaTitle): string {
  return t.english ?? t.romaji ?? t.userPreferred ?? t.native ?? '(untitled)';
}

export function stripHtml(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}
