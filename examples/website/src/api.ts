/// <reference types="vite/client" />
export const API = (import.meta.env.VITE_API_URL as string | undefined) ?? '/api';

const get = (path: string, params: Record<string, string> = {}) =>
  fetch(`${API}${path}?${new URLSearchParams(params)}`).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });

// ─── SDK types (mirrors src/types.ts) ────────────────────────────────────────

export type Quality = '1080p' | '720p' | '480p' | '360p' | 'auto';
export type Language = 'sub' | 'dub' | 'raw';

export interface MediaTitle {
  preferred: string;
  english?: string;
  romaji?: string;
  native?: string;
}

export interface MediaCover {
  url: string;
  color?: string;
}

export interface Score {
  value: number;
  scale: number;
}

export interface Media {
  id: string;
  kind: 'anime' | 'manga';
  title: MediaTitle;
  cover?: MediaCover;
  banner?: string;
  score?: Score;
  year?: number;
  season?: string;
  status?: string;
  format?: string;
  episodeCount?: number;
  chapterCount?: number;
  description?: string;
  catalogues: string[];
  playbackSources: string[];
  mappings: { anilist?: number; mal?: number; kitsu?: number; sources?: Record<string, string> };
}

export interface Episode {
  id: string;
  mediaId: string;
  number: number;
  title?: string;
  thumbnail?: string;
  airDate?: string;
  filler?: boolean;
  recap?: boolean;
  languages: Language[];
  qualities: Quality[];
  source: string;
}

export interface Chapter {
  id: string;
  mediaId: string;
  number: number;
  title?: string;
  source: string;
}

export interface Subtitle {
  url: string;
  language: string;
  label: string;
  format: 'vtt' | 'srt' | 'ass';
}

export interface Stream {
  url: string;
  origin: { host: string; url: string; proxied: boolean };
  isHls: boolean;
  qualities: { label: Quality; url: string }[];
  language: Language;
  subtitles: Subtitle[];
  headers?: Record<string, string>;
  adjacent: {
    prev?: { id: string; number: number };
    next?: { id: string; number: number };
  };
}

export interface Pages {
  pages: { url: string; origin: { host: string }; width?: number; height?: number }[];
  adjacent: {
    prev?: { id: string; number: number };
    next?: { id: string; number: number };
  };
}

export interface List<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}

export interface SourceInfo {
  id: string;
  status: 'available' | 'incompatible' | 'error';
  episodeCount?: number;
  successRate?: number;
}

export interface SourceHealth {
  id: string;
  successRate: number;
  avgLatencyMs: number;
  calls: number;
}

// ─── API calls ───────────────────────────────────────────────────────────────

export const search = (q: string, kind: 'anime' | 'manga' = 'anime'): Promise<Media[]> =>
  get('/search', { q, kind });

export const mediaInfo = (id: string): Promise<Media> => get(`/media/${encodeURIComponent(id)}`);

export const mediaEpisodes = (id: string, cursor?: string): Promise<List<Episode>> =>
  get(`/media/${encodeURIComponent(id)}/episodes`, cursor ? { cursor } : {});

export const mediaChapters = (id: string, cursor?: string): Promise<List<Chapter>> =>
  get(`/media/${encodeURIComponent(id)}/chapters`, cursor ? { cursor } : {});

export const mediaSources = (id: string): Promise<SourceInfo[]> =>
  get(`/media/${encodeURIComponent(id)}/sources`);

export const episodeStream = (
  id: string,
  language: Language = 'sub',
  adjacency?: string,
): Promise<Stream> =>
  get(`/episode/${encodeURIComponent(id)}/stream`, {
    language,
    ...(adjacency ? { adjacency } : {}),
  });

export const chapterPages = (id: string): Promise<Pages> =>
  get(`/chapter/${encodeURIComponent(id)}/pages`);

export const browse = (
  list: 'trending' | 'popular' | 'seasonal' | 'top',
  kind: 'anime' | 'manga' = 'anime',
  opts: { page?: number; season?: string; year?: number } = {},
): Promise<List<Media>> =>
  get('/browse', {
    list,
    kind,
    ...(opts.page ? { page: String(opts.page) } : {}),
    ...(opts.season ? { season: opts.season } : {}),
    ...(opts.year ? { year: String(opts.year) } : {}),
  });

export const health = (): Promise<SourceHealth[]> => get('/health');

// ─── Downloads ───────────────────────────────────────────────────────────────
//
// The server runs the download in the background and streams progress over
// SSE. When complete it returns a single-use `token` that names a temp file
// on disk; the client GETs /download/.../file?token=… to pull the bytes.

export interface VideoDownloadCallbacks {
  onProgress: (info: { phase: string; detail?: string }) => void;
  onComplete: (token: string) => void;
  onError: (msg: string) => void;
}

export interface ChapterDownloadCallbacks {
  onProgress: (info: { downloaded: number; total: number }) => void;
  onComplete: (token: string) => void;
  onError: (msg: string) => void;
}

export interface DownloadHandle {
  close: () => void;
}

export function watchVideoDownload(
  episodeId: string,
  language: Language,
  cb: VideoDownloadCallbacks,
): DownloadHandle {
  const url = `${API}/download/video/progress?episodeId=${encodeURIComponent(episodeId)}&language=${language}`;
  const es = new EventSource(url);
  let done = false;
  const close = () => {
    if (!done) {
      done = true;
      es.close();
    }
  };
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'progress') cb.onProgress({ phase: data.phase, detail: data.detail });
      else if (data.type === 'complete') {
        cb.onComplete(data.token);
        close();
      } else if (data.type === 'error') {
        cb.onError(data.message);
        close();
      }
    } catch (err) {
      cb.onError(err instanceof Error ? err.message : String(err));
      close();
    }
  };
  es.onerror = () => {
    if (!done) {
      cb.onError('SSE connection error');
      close();
    }
  };
  return { close };
}

export function watchChapterDownload(
  chapterId: string,
  cb: ChapterDownloadCallbacks,
): DownloadHandle {
  const url = `${API}/download/manga/chapter/progress?chapterId=${encodeURIComponent(chapterId)}`;
  const es = new EventSource(url);
  let done = false;
  const close = () => {
    if (!done) {
      done = true;
      es.close();
    }
  };
  es.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      if (data.type === 'progress')
        cb.onProgress({ downloaded: data.downloaded, total: data.total });
      else if (data.type === 'complete') {
        cb.onComplete(data.token);
        close();
      } else if (data.type === 'error') {
        cb.onError(data.message);
        close();
      }
    } catch (err) {
      cb.onError(err instanceof Error ? err.message : String(err));
      close();
    }
  };
  es.onerror = () => {
    if (!done) {
      cb.onError('SSE connection error');
      close();
    }
  };
  return { close };
}

export function downloadFileUrl(kind: 'video' | 'manga-chapter', token: string): string {
  const path = kind === 'video' ? '/download/video/file' : '/download/manga/chapter/file';
  return `${API}${path}?token=${encodeURIComponent(token)}`;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatScore(s?: Score): string {
  if (!s) return 'N/A';
  return ((s.value / s.scale) * 10).toFixed(1);
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
