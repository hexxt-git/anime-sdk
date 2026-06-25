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
  source: string;
  mappings: {
    anilist?: number;
    mal?: number;
    kitsu?: number;
  };
}

export interface Episode {
  id: string;
  number: number;
  title?: string;
  thumbnail?: string;
  airDate?: string;
  filler?: boolean;
  recap?: boolean;
  languages?: ('sub' | 'dub' | 'raw')[];
}

export interface Chapter {
  id: string;
  number: number;
  title?: string;
}

export interface Subtitle {
  url: string;
  language: string;
  label: string;
  format: 'vtt' | 'srt' | 'ass';
}

export interface Stream {
  url: string;
  source: string;
  server: string;
  quality: '1080p' | '720p' | '480p' | '360p' | 'auto';
  language: 'sub' | 'dub' | 'raw';
  isHls: boolean;
  headers?: Record<string, string>;
  subtitles: Subtitle[];
}

export interface Pages {
  pages: { url: string; width?: number; height?: number }[];
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
