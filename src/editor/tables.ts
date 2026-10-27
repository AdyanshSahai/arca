// GFM tables: parsing, pretty-printing, and Tab / Shift+Tab cell navigation.
//
// Editing model: tables stay plain markdown. In live preview they render as
// a real <table> (see richBlocks.ts); clicking a cell puts the cursor into
// that cell's markdown. Inside a table:
//   Tab        → next cell (wrapping to the next row, adding one at the end)
//   Shift+Tab  → previous cell
// and every move re-aligns the columns, so the source stays tidy:
//
//   | Level | Size  |        | Level | Size |
//   |--|--:|           →     | ----- | ---: |
//   | L1 | 32 KB |           | L1    | 32 KB |

import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";

export type Align = "left" | "center" | "right" | null;

/** One parsed cell with its trimmed text and where that text sits in the doc. */
export interface Cell {
  text: string;
  /** Doc offset of the start of the cell's (trimmed) text. */
  from: number;
}

export interface ParsedTable {
  from: number;
  to: number;
  /** Header row first, then body rows (the delimiter row is not included). */
  rows: Cell[][];
  aligns: Align[];
}

/** Splits one table line into cells, honouring `\|` escapes. */
function splitRow(text: string, lineFrom: number): Cell[] {
  const cells: Cell[] = [];
  // Find the unescaped pipes.
  const pipes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\\") i++; // skip the escaped character
    else if (text[i] === "|") pipes.push(i);
  }
  // Leading / trailing pipes are optional in GFM; build boundaries accordingly.
  const bounds = [...pipes];
  if (text.trimStart().startsWith("|") === false) bounds.unshift(-1);
  if (text.trimEnd().endsWith("|") === false) bounds.push(text.length);
  for (let k = 0; k + 1 < bounds.length; k++) {
    const raw = text.slice(bounds[k] + 1, bounds[k + 1]);
    const lead = raw.length - raw.trimStart().length;
    cells.push({ text: raw.trim(), from: lineFrom + bounds[k] + 1 + lead });
  }
  return cells;
}

/** Reads alignment from a delimiter cell like `:--`, `--:`, `:-:`. */
function alignOf(spec: string): Align {
  const s = spec.trim();
  const l = s.startsWith(":");
  const r = s.endsWith(":");
  return l && r ? "center" : r ? "right" : l ? "left" : null;
}

/** Parses the table spanning doc range [from, to] (whole lines). */
export function parseTable(state: EditorState, from: number, to: number): ParsedTable {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  const rows: Cell[][] = [];
  let aligns: Align[] = [];
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    const cells = splitRow(line.text, line.from);
    if (n === first + 1) aligns = cells.map((c) => alignOf(c.text));
    else rows.push(cells);
  }
  return { from: state.doc.line(first).from, to: state.doc.line(last).to, rows, aligns };
}

/** Finds the GFM table node containing `pos`, if any. */
export function tableAt(state: EditorState, pos: number): { from: number; to: number } | null {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (n.name === "Table") return { from: n.from, to: n.to };
  }
  return null;
}

/**
 * Pretty-prints a table: pads every column to its widest cell and rebuilds
 * the delimiter row. Returns the new text plus a function giving the
 * offset (relative to the table start) of a cell's content.
 */
export function formatTable(t: ParsedTable): { text: string; cellOffset: (row: number, col: number) => number } {
  const cols = Math.max(t.aligns.length, ...t.rows.map((r) => r.length));
  // Widths count characters; good enough for typical (non-CJK) tables.
  const widths = Array.from({ length: cols }, (_, c) =>
    Math.max(3, ...t.rows.map((r) => (r[c]?.text ?? "").length)),
  );
  const pad = (s: string, w: number, a: Align) => {
    const gap = w - s.length;
    if (a === "right") return " ".repeat(gap) + s;
    if (a === "center") return " ".repeat(Math.floor(gap / 2)) + s + " ".repeat(Math.ceil(gap / 2));
    return s + " ".repeat(gap);
  };
  const lines: string[] = [];
  /** cellStarts[row][col] = offset of that cell's content within the text. */
  const cellStarts: number[][] = [];
  let offset = 0;
  const pushRow = (cells: string[], rowIndex: number | null) => {
    let line = "|";
    const starts: number[] = [];
    for (let c = 0; c < cols; c++) {
      line += " ";
      const a = t.aligns[c] ?? null;
      const content = pad(cells[c] ?? "", widths[c], a);
      // Where the visible text starts once padding is applied (an empty
      // cell's cursor goes to the start, not past its padding).
      const lead = content.trim() ? content.length - content.trimStart().length : 0;
      starts.push(offset + line.length + lead);
      line += content + " |";
    }
    if (rowIndex !== null) cellStarts[rowIndex] = starts;
    lines.push(line);
    offset += line.length + 1; // +1 for the newline
  };
  t.rows.forEach((r, i) => {
    pushRow(r.map((c) => c.text), i);
    if (i === 0) {
      // Delimiter row right after the header.
      const delims = Array.from({ length: cols }, (_, c) => {
        const a = t.aligns[c] ?? null;
        const dashes = "-".repeat(Math.max(3, widths[c] - (a === "center" ? 2 : a ? 1 : 0)));
        return a === "center" ? `:${dashes}:` : a === "right" ? `${dashes}:` : a === "left" ? `:${dashes}` : dashes;
      });
      pushRow(delims, null);
    }
  });
  return {
    text: lines.join("\n"),
    cellOffset: (row, col) => cellStarts[row]?.[col] ?? 0,
  };
}

/** Which (row, col) of the parsed table holds `pos` (body rows after the header). */
function cellIndex(t: ParsedTable, state: EditorState, pos: number): { row: number; col: number } {
  const lineNo = state.doc.lineAt(pos).number - state.doc.lineAt(t.from).number;
  // Line 0 = header (row 0); line 1 = delimiter (treat as header); then rows 1…
  const row = lineNo <= 1 ? 0 : lineNo - 1;
  const cells = t.rows[row] ?? [];
  let col = 0;
  for (let c = 0; c < cells.length; c++) if (cells[c].from <= pos) col = c;
  return { row, col };
}

/** Moves to the next/previous cell, re-formatting the table on the way. */
function moveCell(view: EditorView, dir: 1 | -1): boolean {
  const { state } = view;
  const pos = state.selection.main.head;
  const range = tableAt(state, pos);
  if (!range) return false; // not in a table: let Tab indent as usual
  const t = parseTable(state, range.from, range.to);
  const cols = Math.max(t.aligns.length, ...t.rows.map((r) => r.length));
  let { row, col } = cellIndex(t, state, pos);
  col += dir;
  if (col >= cols) {
    col = 0;
    row++;
  } else if (col < 0) {
    col = cols - 1;
    row--;
  }
  if (row < 0) return true; // already at the very first cell
  if (row >= t.rows.length) {
    // Tab past the last cell appends an empty row, like spreadsheets.
    t.rows.push(Array.from({ length: cols }, () => ({ text: "", from: 0 })));
  }
  const formatted = formatTable(t);
  view.dispatch({
    changes: { from: t.from, to: t.to, insert: formatted.text },
    selection: EditorSelection.cursor(t.from + formatted.cellOffset(row, col)),
    scrollIntoView: true,
  });
  return true;
}

/** Tab / Shift+Tab inside tables. Placed before indentWithTab in the keymap. */
export const tableKeymap: KeyBinding[] = [
  { key: "Tab", run: (v) => moveCell(v, 1) },
  { key: "Shift-Tab", run: (v) => moveCell(v, -1) },
];
