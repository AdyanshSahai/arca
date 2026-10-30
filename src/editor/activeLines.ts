// "Active lines" are the lines touched by any selection range. Live preview
// shows raw markdown syntax on these lines (so you can edit it) and renders
// everything else. This is the Obsidian/Typora-style reveal-on-cursor rule.

import { type EditorState, StateEffect, StateField } from "@codemirror/state";

/**
 * Sent with a jump (outline, backlinks, search, [[note#Heading]]) that
 * moves the cursor for the user. Until they click, move the cursor or
 * type, the cursor's line stays rendered, so the line they jumped to
 * doesn't show up as raw markdown.
 */
export const quietJump = StateEffect.define<null>();

/** True between a `quietJump` and the user's next own move or edit. */
export const quietCursor = StateField.define<boolean>({
  create: () => false,
  update(quiet, tr) {
    if (tr.effects.some((e) => e.is(quietJump))) return true;
    // Any later selection change or edit is the user's own: reveal again.
    return quiet && !tr.selection && !tr.docChanged;
  },
});

/** True when the cursor shouldn't reveal markdown: reading mode, or just after a jump. */
export function cursorHidden(state: EditorState): boolean {
  return state.readOnly || state.field(quietCursor, false) === true;
}

/**
 * Set of 1-based line numbers touched by the selection. Always empty in a
 * read-only document (reading mode): there's no editing, so markdown is
 * never revealed, wherever the user clicks. Also empty right after a jump
 * (see `quietCursor`).
 */
export function activeLines(state: EditorState): Set<number> {
  const lines = new Set<number>();
  if (cursorHidden(state)) return lines;
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
