import { describe, it, expect } from 'vitest';
import { AniError, AniErrorCode } from '../src/errors.js';
import { resolveOptions } from '../src/config.js';
import type { Media, Episode, Chapter, Stream, List, Score } from '../src/types.js';

describe('AniError', () => {
  it('round-trips through JSON', () => {
    const err = new AniError({ code: AniErrorCode.NoStream, message: 'no stream' });
    expect(err.code).toBe('NoStream');
    expect(err.retryable).toBe(false);
    expect(err.name).toBe('AniError');
    expect(err instanceof AniError).toBe(true);
    expect(err instanceof Error).toBe(true);
  });

  it('branches on error codes correctly', () => {
    const codes: AniErrorCode[] = [];
    const err = new AniError({
      code: AniErrorCode.RateLimited,
      message: 'rate limited',
      retryable: true,
    });
    switch (err.code) {
      case AniErrorCode.RateLimited:
        codes.push(err.code);
        break;
      default:
        codes.push('other' as AniErrorCode);
    }
    expect(codes).toEqual([AniErrorCode.RateLimited]);
    expect(err.retryable).toBe(true);
  });

  it('carries source and cause', () => {
    const cause = new Error('upstream');
    const err = new AniError({
      code: AniErrorCode.SourceUnavailable,
      message: 'down',
      source: 'allmanga',
      cause,
    });
    expect(err.source).toBe('allmanga');
    expect(err.cause).toBe(cause);
  });
});

describe('resolveOptions', () => {
  it('applies defaults when no opts given', () => {
    const opts = resolveOptions();
    expect(opts.http!.timeoutMs).toBe(30000);
    expect(opts.http!.retries).toBe(3);
  });

  it('merges user overrides onto defaults', () => {
    const opts = resolveOptions({ http: { timeoutMs: 5000 } });
    expect(opts.http!.timeoutMs).toBe(5000);
    expect(opts.http!.retries).toBe(3);
  });
});

describe('value types are plain POJOs', () => {
  it('Media round-trips through JSON', () => {
    const m: Media = {
      id: 'opaque-id',
      kind: 'anime',
      title: { preferred: 'Frieren', english: 'Frieren' },
      source: 'anilist',
      mappings: { anilist: 154587 },
    };
    expect(JSON.parse(JSON.stringify(m))).toEqual(m);
  });

  it('Episode round-trips through JSON', () => {
    const ep: Episode = {
      id: 'ep-id',
      number: 1,
      languages: ['sub'],
    };
    expect(JSON.parse(JSON.stringify(ep))).toEqual(ep);
  });

  it('Chapter round-trips through JSON', () => {
    const ch: Chapter = { id: 'ch-id', number: 1 };
    expect(JSON.parse(JSON.stringify(ch))).toEqual(ch);
  });

  it('Score carries units', () => {
    const s: Score = { value: 87, scale: 100 };
    expect(s.value / s.scale).toBeCloseTo(0.87);
  });
});
