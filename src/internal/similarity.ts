/**
 * String-similarity utilities used by the metadata layer to match a title
 * fetched from a catalogue (e.g. AniList) against the slightly different
 * names content providers use.
 *
 * We layer three complementary scorers and take the maximum:
 *   - **Sørensen–Dice on character bigrams** — robust to word order and
 *     light variation.
 *   - **Prefix score** — boosts cases like "Re:Zero" matching against
 *     "Re:Zero kara Hajimeru Isekai Seikatsu" by giving credit for one
 *     title being a clean prefix of the other.
 *   - **Token Jaccard** — handles "AoT" abbreviations and word-level
 *     reorderings by comparing tokens as sets.
 *
 * All scoring runs after the same normalization pass: lowercase, strip
 * diacritics, collapse punctuation, remove season/year tags, translate
 * roman numerals to arabic.
 */

/**
 * Normalize a title for fuzzy comparison: lowercase, strip punctuation,
 * collapse whitespace, remove common season/part suffixes. Keeps numerals.
 */
export function normalizeTitle(title: string): string {
  if (!title) return '';
  let s = title.toLowerCase();
  // Curly quotes / fancy dashes
  s = s.replace(/[‘’“”]/g, '');
  s = s.replace(/[–—]/g, '-');
  // Strip diacritics
  s = s.normalize('NFD').replace(/[̀-ͯ]/g, '');
  // Roman numerals at the end → arabic ("season ii" ↔ "season 2")
  s = s.replace(/\b(i{1,3}|iv|v|vi{1,3}|ix|x)\b$/i, (m) => {
    const map: Record<string, string> = {
      i: '1',
      ii: '2',
      iii: '3',
      iv: '4',
      v: '5',
      vi: '6',
      vii: '7',
      viii: '8',
      ix: '9',
      x: '10',
    };
    return map[m.toLowerCase()] ?? m;
  });
  // Remove "(TV)", "(Movie)", "(2023)"
  s = s.replace(/\((?:tv|ova|ona|movie|special|\d{4})\)/g, ' ');
  // Strip non-alphanumerics (keep digits)
  s = s.replace(/[^a-z0-9\s]/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();
  return s;
}

/** Generate character bigrams from a normalized string. */
function bigrams(s: string): Map<string, number> {
  const out = new Map<string, number>();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    out.set(g, (out.get(g) ?? 0) + 1);
  }
  return out;
}

/** Sørensen–Dice on character bigrams. */
export function diceSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.length < 2 || nb.length < 2) return na === nb ? 1 : 0;

  const ba = bigrams(na);
  const bb = bigrams(nb);
  let intersection = 0;
  for (const [g, ca] of ba) {
    const cb = bb.get(g);
    if (cb) intersection += Math.min(ca, cb);
  }
  const sa = na.length - 1;
  const sb = nb.length - 1;
  return (2 * intersection) / (sa + sb);
}

/**
 * Token Jaccard on whitespace-separated tokens. Robust to "AoT" / "Attack
 * on Titan" style abbreviations only when one of the candidates already
 * includes the long form — Jaccard between {"a", "o", "t"} and the long
 * title is low, which is correct.
 */
export function tokenJaccard(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  const ta = new Set(na.split(' ').filter(Boolean));
  const tb = new Set(nb.split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter += 1;
  const union = ta.size + tb.size - inter;
  return inter / union;
}

/**
 * Score how well one title is a prefix of the other. Returns
 * `shorterLen / longerLen` if a prefix match holds (after normalization),
 * else 0. So "Re:Zero" vs "Re:Zero kara Hajimeru …" gets ~0.21 — modest
 * but additive to dice.
 */
export function prefixScore(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  const [shorter, longer] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (!longer.startsWith(shorter)) return 0;
  // Require the prefix to end on a token boundary so "naruto" doesn't
  // prefix "naruto: shippuden" trivially but "naruto" + "naruto" does.
  if (longer.length > shorter.length && longer[shorter.length] !== ' ') return 0;
  return shorter.length / longer.length;
}

/**
 * Composite similarity score: max(dice, tokenJaccard, prefixScore * 1.1).
 *
 * The 1.1 prefix bonus means a 100% clean prefix at half-length scores
 * 0.55, which is competitive with a strong dice match — that nudges the
 * matcher to prefer clean-prefix candidates ("Re:Zero") over noisy
 * dice-only ones.
 */
export function compositeSimilarity(a: string, b: string): number {
  const d = diceSimilarity(a, b);
  const t = tokenJaccard(a, b);
  const p = prefixScore(a, b) * 1.1;
  return Math.min(1, Math.max(d, t, p));
}

/**
 * Score a single candidate title against a target set of candidate titles
 * (romaji/english/native/synonyms). Returns the maximum composite score.
 */
export function bestSimilarity(candidate: string, targets: Array<string | undefined>): number {
  let best = 0;
  for (const t of targets) {
    if (!t) continue;
    const s = compositeSimilarity(candidate, t);
    if (s > best) best = s;
  }
  return best;
}
