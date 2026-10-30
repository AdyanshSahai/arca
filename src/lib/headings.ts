// Finding the headings in a note's markdown.
//
// Shared by the Outline panel (a table of contents for the current note)
// and by [[note#Heading]] links (open the note scrolled to that heading),
// so both agree on what counts as a heading and what it's called.
//
// Only ATX headings (`# Title` … `###### Title`) are recognised: they are
// what the editor, the ribbon and exports produce. Lines inside fenced
// code blocks and a leading YAML front-matter block are skipped, so a
// `# comment` in a shell snippet doesn't show up in the outline.

export interface Heading {
  /** 1–6, from the number of `#`s. */
  level: number;
  /** The heading's text as shown: markers, closing `#`s and formatting stripped. */
  text: string;
  /** 1-based line number in the note. */
  line: number;
}

/** `#`–`######`, then a space (or end of line), then the text. */
const ATX_RE = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/;
/** An opening/closing code fence: 3+ backticks or tildes. */
const FENCE_RE = /^ {0,3}(`{3,}|~{3,})/;

/**
 * Turns heading markdown into the plain text a reader sees:
 * `**Paging** and [[tlb|the TLB]]` → `Paging and the TLB`.
 */
export function plainHeadingText(raw: string): string {
  return (
    raw
      // Optional closing sequence: "## Title ##" → "Title".
      .replace(/[ \t]+#+[ \t]*$/, "")
      // [[target|alias]] shows the alias, [[target]] the target.
      .replace(/\[\[([^[\]|]+)\|([^[\]]+)\]\]/g, "$2")
      .replace(/\[\[([^[\]]+)\]\]/g, "$1")
      // [text](url) shows the text.
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      // Emphasis, strikethrough, highlight and code markers.
      .replace(/(\*\*|~~|==|[*`])/g, "")
      // Underscore emphasis only at word edges, so snake_case survives.
      .replace(/(^|\W)_+|_+(?=\W|$)/g, "$1")
      .trim()
  );
}

/** Every heading in `text`, in document order. */
export function parseHeadings(text: string): Heading[] {
  const out: Heading[] = [];
  const lines = text.split("\n");
  // The fence that opened the current code block ("```" or "~~~~"), if any.
  let fence: string | null = null;
  let i = 0;
  // Skip front matter: "---" on the first line up to the next "---"/"...".
  if (lines[0]?.trim() === "---") {
    const end = lines.findIndex((l, n) => n > 0 && (l.trim() === "---" || l.trim() === "..."));
    if (end > 0) i = end + 1;
  }
  for (; i < lines.length; i++) {
    const line = lines[i];
    const f = FENCE_RE.exec(line);
    if (f) {
      if (fence === null) fence = f[1];
      // A fence closes only with the same character, at least as long.
      else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null) continue;
    const m = ATX_RE.exec(line);
    if (!m) continue;
    const heading = plainHeadingText(m[2] ?? "");
    // An empty "#" line isn't worth listing (or linking to).
    if (heading) out.push({ level: m[1].length, text: heading, line: i + 1 });
  }
  return out;
}

/** Case-, space- and formatting-insensitive form used to match link anchors. */
function anchorKey(s: string): string {
  return plainHeadingText(s).toLowerCase().replace(/[\s\-_]+/g, " ").trim();
}

/**
 * The line of the heading a link anchor points at, or null if there isn't one.
 *
 * `anchor` is everything after the first `#` in the link target. Obsidian
 * also allows a heading path (`[[note#Memory#Paging]]`): the last part is
 * the heading to find, and the earlier parts, when they match, pick the
 * right one among several headings with the same name.
 */
export function findHeadingLine(text: string, anchor: string): number | null {
  const parts = anchor.split("#").map(anchorKey).filter(Boolean);
  if (parts.length === 0) return null;
  const target = parts[parts.length - 1];
  const parents = parts.slice(0, -1);
  const headings = parseHeadings(text);

  let fallback: number | null = null;
  // The headings enclosing the current one, outermost first.
  const stack: Heading[] = [];
  for (const h of headings) {
    while (stack.length && stack[stack.length - 1].level >= h.level) stack.pop();
    if (anchorKey(h.text) === target) {
      fallback ??= h.line;
      // Every parent in the path appears, in order, among the ancestors.
      let p = 0;
      for (const s of stack) if (p < parents.length && anchorKey(s.text) === parents[p]) p++;
      if (p === parents.length) return h.line;
    }
    stack.push(h);
  }
  // The path didn't fully match: the first heading with that name will do.
  return fallback;
}

/**
 * Index of the heading the cursor's `line` falls under (the last heading
 * at or above it), or -1 when the cursor is above the first heading.
 */
export function currentHeadingIndex(headings: Heading[], line: number): number {
  let idx = -1;
  for (let i = 0; i < headings.length && headings[i].line <= line; i++) idx = i;
  return idx;
}
