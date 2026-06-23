/**
 * Internal value types shared by sources and extractors. Not exported from
 * the public package surface — consumers use the value types in `src/types.ts`.
 */

export type ContentLanguage = 'sub' | 'dub' | 'raw';

export interface ISubtitleAvailability {
  language: string;
  label: string;
  format?: 'vtt' | 'srt' | 'ass';
}

export interface ISubtitleTrack extends ISubtitleAvailability {
  url: string;
}

export interface IVideoPayload {
  sourceUrl: string;
  isHLS: boolean;
  quality: '1080p' | '720p' | '480p' | '360p' | 'auto';
  language?: ContentLanguage;
  headers?: Record<string, string>;
  subtitles?: ISubtitleTrack[];
}

export interface IMangaPayload {
  imageUrls: string[];
  headers?: Record<string, string>;
}

export interface IDomElement {
  querySelector(selector: string): IDomElement | null;
  querySelectorAll(selector: string): IDomElement[];
  getAttribute(name: string): string | null;
  readonly textContent: string | null;
  readonly outerHTML: string;
  readonly innerHTML: string;
}

export interface IDomParser {
  parse(html: string): IDomElement;
}
