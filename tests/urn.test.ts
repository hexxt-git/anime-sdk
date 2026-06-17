import { describe, it, expect } from 'vitest';
import {
  buildUrn,
  buildTypedUrn,
  isUrn,
  parseTypedUrn,
  parseUrn,
  strictUnwrapUrn,
  unwrapUrn,
} from '../src/utils/urn.js';

describe('URN helpers', () => {
  it('builds a URN with provider:raw shape', () => {
    expect(buildUrn('allmanga', 'abc123')).toBe('allmanga:abc123');
  });

  it('parses a simple URN', () => {
    expect(parseUrn('allmanga:abc123')).toEqual({ providerId: 'allmanga', rawId: 'abc123' });
  });

  it('treats only the first colon as separator', () => {
    expect(parseUrn('animeparadise:abc:xyz')).toEqual({
      providerId: 'animeparadise',
      rawId: 'abc:xyz',
    });
  });

  it('falls back to bare-id behaviour when no colon present', () => {
    expect(parseUrn('legacy-id')).toEqual({ providerId: '', rawId: 'legacy-id' });
  });

  it('unwrapUrn strips matching prefix only', () => {
    expect(unwrapUrn('allmanga', 'allmanga:abc')).toBe('abc');
    expect(unwrapUrn('gogoanime', 'allmanga:abc')).toBe('allmanga:abc');
    expect(unwrapUrn('allmanga', 'no-prefix-id')).toBe('no-prefix-id');
  });

  it('preserves raw IDs containing colons after the first one', () => {
    expect(unwrapUrn('animeparadise', 'animeparadise:uid123:animeId456')).toBe('uid123:animeId456');
  });

  it('preserves raw IDs containing slashes', () => {
    expect(unwrapUrn('allmanga', 'allmanga:5jzpRTJWnubrgHm5G/1')).toBe('5jzpRTJWnubrgHm5G/1');
    expect(unwrapUrn('gogoanime', 'gogoanime:/watch/one-piece/ep-1')).toBe('/watch/one-piece/ep-1');
  });

  it('isUrn recognizes the right shape', () => {
    expect(isUrn('allmanga:abc')).toBe(true);
    expect(isUrn('allmanga:abc', 'allmanga')).toBe(true);
    expect(isUrn('allmanga:abc', 'gogoanime')).toBe(false);
    expect(isUrn('no-colon')).toBe(false);
    expect(isUrn(':leading-colon')).toBe(false);
  });

  it('round-trips build → unwrap', () => {
    const cases = ['abc', 'with/slash', 'with:colon', 'multi:slash/path:and:colon'];
    for (const raw of cases) {
      const urn = buildUrn('p', raw);
      expect(unwrapUrn('p', urn)).toBe(raw);
    }
  });

  it('rejects bad input on build', () => {
    expect(() => buildUrn('', 'x')).toThrow();
    expect(() => buildUrn('p', null as any)).toThrow();
  });
});

describe('strictUnwrapUrn', () => {
  it('returns the raw ID when the prefix matches', () => {
    expect(strictUnwrapUrn('anilist', 'anilist:21')).toBe('21');
  });

  it('throws on a wrong prefix', () => {
    expect(() => strictUnwrapUrn('anilist', 'mal:21')).toThrow(/does not match/);
  });

  it('throws on a bare (un-prefixed) ID', () => {
    expect(() => strictUnwrapUrn('anilist', '21')).toThrow(/bare/);
  });
});

describe('typed URN helpers', () => {
  it('buildTypedUrn produces provider:kind:rawId', () => {
    expect(buildTypedUrn('mal', 'anime', 21)).toBe('mal:anime:21');
    expect(buildTypedUrn('kitsu', 'manga', 'abc')).toBe('kitsu:manga:abc');
  });

  it('parseTypedUrn extracts kind + rawId when present', () => {
    expect(parseTypedUrn('mal', 'mal:anime:21')).toEqual({ kind: 'anime', rawId: '21' });
    expect(parseTypedUrn('mal', 'mal:manga:13')).toEqual({ kind: 'manga', rawId: '13' });
  });

  it('parseTypedUrn returns undefined kind for bare/untyped URNs', () => {
    expect(parseTypedUrn('mal', 'mal:21')).toEqual({ rawId: '21' });
    expect(parseTypedUrn('mal', '21')).toEqual({ rawId: '21' });
  });

  it('parseTypedUrn passes through wrong-provider URNs untouched', () => {
    expect(parseTypedUrn('mal', 'anilist:21')).toEqual({ rawId: 'anilist:21' });
  });
});
