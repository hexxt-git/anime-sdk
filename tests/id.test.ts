import { describe, it, expect } from 'vitest';
import { encodeId, decodeId } from '../src/internal/id.js';
import { AniError, AniErrorCode } from '../src/errors.js';

describe('encodeId / decodeId', () => {
  it('round-trips a media id', () => {
    const id = encodeId({ t: 'media', s: 'allmanga', r: 'abc123' });
    const decoded = decodeId(id);
    expect(decoded.v).toBe(1);
    expect(decoded.t).toBe('media');
    expect(decoded.s).toBe('allmanga');
    expect(decoded.r).toBe('abc123');
  });

  it('round-trips an episode id with mappings', () => {
    const id = encodeId({ t: 'episode', s: 'megaplay', r: '21/5', m: { al: 21 } });
    const decoded = decodeId(id);
    expect(decoded.t).toBe('episode');
    expect(decoded.r).toBe('21/5');
    expect(decoded.m).toEqual({ al: 21 });
  });

  it('round-trips a chapter id', () => {
    const id = encodeId({ t: 'chapter', s: 'mangadex', r: 'uuid-here' });
    const decoded = decodeId(id);
    expect(decoded.t).toBe('chapter');
    expect(decoded.s).toBe('mangadex');
  });

  it('version field is always 1', () => {
    const id = encodeId({ t: 'media', s: 'x', r: 'y' });
    expect(decodeId(id).v).toBe(1);
  });

  it('malformed base64 throws BadId', () => {
    expect(() => decodeId('!!!not-base64!!!')).toThrow(AniError);
    try {
      decodeId('!!!not-base64!!!');
    } catch (e) {
      expect(e instanceof AniError).toBe(true);
      expect((e as AniError).code).toBe(AniErrorCode.BadId);
    }
  });

  it('missing required fields throws BadId', () => {
    const bad = Buffer.from(JSON.stringify({ v: 1, s: 'x' }), 'utf8').toString('base64url');
    expect(() => decodeId(bad)).toThrow(AniError);
    try {
      decodeId(bad);
    } catch (e) {
      expect((e as AniError).code).toBe(AniErrorCode.BadId);
    }
  });

  it('wrong version throws BadId', () => {
    const bad = Buffer.from(JSON.stringify({ v: 99, t: 'media', s: 'x', r: 'y' }), 'utf8').toString(
      'base64url',
    );
    expect(() => decodeId(bad)).toThrow(AniError);
  });
});
