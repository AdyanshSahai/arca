// Line diff for the Time Machine's "compare with now" view. A classic
// longest-common-subsequence table: simple and exact. Notes are small, and
// very long ones fall back to a coarse whole-block diff to stay fast.

export interface DiffLine {
  kind: "same" | "added" | "removed";
  text: string;
}

/** Above this many lines × lines, skip the LCS table (memory/time). */
const MAX_CELLS = 4_000_000;

export function diffLines(before: string, after: string): DiffLine[] {
  const a = before.split("\n");
  const b = after.split("\n");
  if (a.length * b.length > MAX_CELLS) {
    // Coarse fallback: shared prefix/suffix kept, the middle swapped.
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start++;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
      endA--;
      endB--;
    }
    return [
      ...a.slice(0, start).map((text) => ({ kind: "same" as const, text })),
      ...a.slice(start, endA).map((text) => ({ kind: "removed" as const, text })),
      ...b.slice(start, endB).map((text) => ({ kind: "added" as const, text })),
      ...a.slice(endA).map((text) => ({ kind: "same" as const, text })),
    ];
  }
  // lcs[i][j] = length of the LCS of a[i..] and b[j..], filled backwards.
  const lcs = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  // Walk the table forwards to emit the diff.
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      out.push({ kind: "same", text: a[i] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      out.push({ kind: "removed", text: a[i++] });
    } else {
      out.push({ kind: "added", text: b[j++] });
    }
  }
  while (i < a.length) out.push({ kind: "removed", text: a[i++] });
  while (j < b.length) out.push({ kind: "added", text: b[j++] });
  return out;
}
