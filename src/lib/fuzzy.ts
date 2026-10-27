// Tiny fuzzy matcher for the command palette's action list (file paths
// are matched in Rust; see search.rs). Every query character must appear
// in order; consecutive runs and word starts score higher.

export interface FuzzyResult {
  score: number;
  /** Indices of matched characters, for highlighting. */
  indices: number[];
}

export function fuzzyMatch(query: string, text: string): FuzzyResult | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();
  const indices: number[] = [];
  let score = 0;
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] !== q[qi]) continue;
    indices.push(i);
    score += 1;
    if (indices.length > 1 && indices[indices.length - 2] === i - 1) score += 4; // consecutive
    if (i === 0 || /[\s/\-_:]/.test(t[i - 1])) score += 6; // start of a word
    qi++;
  }
  if (qi < q.length) return null; // not all characters found
  return { score: score - text.length / 20, indices };
}
