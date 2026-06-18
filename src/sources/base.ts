import type { Media, Episode, Chapter, Stream, Pages, List } from '../types.js';

export interface SourceCallOpts {
  signal?: AbortSignal;
}

export interface SourceCaps {
  search?: true;
  info?: true;
  episodes?: true;
  chapters?: true;
  stream?: true;
  pages?: true;
  browse?: true;
  mapping?: true;
}

export interface Source {
  readonly id: string;
  readonly kinds: readonly ('anime' | 'manga')[];
  readonly caps: SourceCaps;

  search?(query: string, kind: 'anime' | 'manga', opts: SourceCallOpts): Promise<Media[]>;

  info?(id: string, opts: SourceCallOpts): Promise<Media>;

  episodes?(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Episode>>;

  chapters?(
    mediaId: string,
    opts: SourceCallOpts & { cursor?: string; limit?: number },
  ): Promise<List<Chapter>>;

  stream?(
    episodeId: string,
    opts: SourceCallOpts & {
      language?: 'sub' | 'dub' | 'raw';
      quality?: string;
      adjacency?: 'within-media' | 'walk-relations';
    },
  ): Promise<Stream>;

  pages?(chapterId: string, opts: SourceCallOpts): Promise<Pages>;

  browse?(
    opts: SourceCallOpts & {
      list: 'trending' | 'popular' | 'seasonal' | 'top';
      kind: 'anime' | 'manga';
      page?: number;
      perPage?: number;
      season?: string;
      year?: number;
    },
  ): Promise<List<Media>>;

  lookupByMapping?(
    mappings: Record<string, unknown>,
    opts?: SourceCallOpts,
  ): Promise<string | null>;
}
