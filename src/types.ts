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
  season?: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
  status?: 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';
  format?: 'TV' | 'MOVIE' | 'OVA' | 'ONA' | 'SPECIAL' | 'MANGA' | 'NOVEL';
  episodeCount?: number;
  chapterCount?: number;
  description?: string;
  catalogues: string[];
  playbackSources: string[];
  mappings: {
    anilist?: number;
    mal?: number;
    kitsu?: number;
    sources?: Record<string, string>;
  };
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
  languages: ('sub' | 'dub' | 'raw')[];
  qualities: ('1080p' | '720p' | '480p' | '360p' | 'auto')[];
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
  qualities: { label: '1080p' | '720p' | '480p' | '360p' | 'auto'; url: string }[];
  language: 'sub' | 'dub' | 'raw';
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
