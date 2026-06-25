import { describe, it, expect } from 'vitest';
import { createSdk } from '../src/sdk.js';
import { AniError, AniErrorCode } from '../src/errors.js';

describe('createSdk()', () => {
  it('creates an Sdk instance with zero config', () => {
    const sdk = createSdk();
    expect(sdk).toBeDefined();
    expect(typeof sdk.search).toBe('function');
    expect(typeof sdk.info).toBe('function');
    expect(typeof sdk.episodes).toBe('function');
    expect(typeof sdk.stream).toBe('function');
    expect(typeof sdk.browse).toBe('function');
    expect(typeof sdk.health).toBe('function');
  });

  it('health() returns a synchronous snapshot', () => {
    const sdk = createSdk();
    const h = sdk.health();
    expect(Array.isArray(h)).toBe(true);
  });

  it('sources can be filtered via options', () => {
    const sdk = createSdk({ sources: ['anilist'] });
    const h = sdk.health();
    expect(Array.isArray(h)).toBe(true);
  });

  it('search returns a ProgressiveResult (iterable + thenable)', () => {
    const sdk = createSdk({ sources: ['anilist'] });
    const pr = sdk.search('test', { kind: 'anime' });
    expect(typeof pr[Symbol.asyncIterator]).toBe('function');
    expect(typeof pr.then).toBe('function');
    expect(typeof pr.cancel).toBe('function');
  });

  it('AniError and AniErrorCode are exported correctly', () => {
    const err = new AniError({ code: AniErrorCode.NotFound, message: 'not found' });
    expect(err instanceof AniError).toBe(true);
    expect(err.code).toBe('NotFound');
  });
});
