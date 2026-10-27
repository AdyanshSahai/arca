// Renders text with some ranges wrapped in <mark>. Ranges are UTF-16 offsets
// (what Rust sends), which is exactly how JS strings index, so `slice`
// works directly.

export function Highlighted({ text, ranges }: { text: string; ranges: [number, number][] }) {
  const parts: React.ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) parts.push(text.slice(pos, a));
    parts.push(<mark key={i}>{text.slice(a, b)}</mark>);
    pos = b;
  });
  if (pos < text.length) parts.push(text.slice(pos));
  return <>{parts}</>;
}

/** Converts a list of matched character indices into contiguous ranges. */
export function indicesToRanges(indices: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const i of indices) {
    const last = out[out.length - 1];
    // Extend the current run if this index directly follows it.
    if (last && last[1] === i) last[1] = i + 1;
    else out.push([i, i + 1]);
  }
  return out;
}
