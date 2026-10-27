// "Active lines" are the lines touched by any selection range. Live preview
// shows raw markdown syntax on these lines (so you can edit it) and renders
// everything else. This is the Obsidian/Typora-style reveal-on-cursor rule.

import type { EditorState } from "@codemirror/state";

/** Set of 1-based line numbers touched by the selection. */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  for (const r of state.selection.ranges) {
    const first = state.doc.lineAt(r.from).number;
    const last = state.doc.lineAt(r.to).number;
    for (let n = first; n <= last; n++) lines.add(n);
  }
  return lines;
}

/** True if any line of the range [from, to] is active. */
export function rangeIsActive(state: EditorState, active: Set<number>, from: number, to: number): boolean {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) if (active.has(n)) return true;
  return false;
}
