import { describe, it, expect } from 'vitest';
import { normalizeTitle, diceSimilarity, bestSimilarity } from '../src/meta/similarity.js';

describe('normalizeTitle', () => {
  it('lowercases and strips punctuation', () => {
    expect(normalizeTitle('Re:ZERO -Starting Life in Another World-')).toBe(
      're zero starting life in another world',
    );
  });

  it('keeps digits and removes year tags', () => {
    expect(normalizeTitle('Frieren (2023)')).toBe('frieren');
  });

  it('strips combining diacritics', () => {
    expect(normalizeTitle('Pokémon')).toBe('pokemon');
  });

  it('translates trailing Roman numerals to arabic', () => {
    expect(normalizeTitle('Attack on Titan Season II')).toBe('attack on titan season 2');
  });

  it('handles empty input', () => {
    expect(normalizeTitle('')).toBe('');
  });
});

describe('diceSimilarity', () => {
  it('returns 1 for identical titles', () => {
    expect(diceSimilarity('Naruto', 'Naruto')).toBe(1);
  });

  it('is high for known same-show variations', () => {
    // "Shingeki no Kyojin" vs "Shingeki no Kyojin Season 2" — base title is a
    // substring, but the extra "Season 2" suffix drags Dice down. 0.75 is the
    // empirical floor for "same show, different season".
    expect(diceSimilarity('Shingeki no Kyojin', 'Shingeki no Kyojin Season 2')).toBeGreaterThan(
      0.75,
    );
  });

  it('is low for unrelated titles', () => {
    expect(diceSimilarity('Bleach', 'Frieren')).toBeLessThan(0.3);
  });

  it('treats normalized punctuation/case as identical', () => {
    expect(diceSimilarity('Re:Zero', 're zero')).toBeGreaterThan(0.95);
  });
});

describe('bestSimilarity', () => {
  it('picks the highest-scoring alternative', () => {
    const score = bestSimilarity('Attack on Titan', [
      'Shingeki no Kyojin',
      'Attack on Titan',
      'AoT',
    ]);
    expect(score).toBe(1);
  });

  it('ignores undefined entries', () => {
    expect(bestSimilarity('Bleach', [undefined, 'Bleach'])).toBe(1);
  });
});
