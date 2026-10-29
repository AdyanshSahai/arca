// Markdown formatting commands for the ribbon and Word-style shortcuts
// (Ctrl+B, Ctrl+I, Ctrl+K…). Each one edits the plain Markdown text
// around the selection, so the file stays ordinary Markdown.

import { indentLess, indentMore, redo, undo } from "@codemirror/commands";
import { EditorSelection, type EditorState } from "@codemirror/state";
import type { EditorView, KeyBinding } from "@codemirror/view";

/**
 * Wraps each selection in `mark` (e.g. "**"), or unwraps it if it's
 * already wrapped. With nothing selected, inserts a pair and puts the
 * cursor between them.
 */
export function toggleWrap(view: EditorView, mark: string): boolean {
  const { state } = view;
  view.dispatch(
    state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from);
      const after = state.sliceDoc(range.to, range.to + mark.length);
      if (before === mark && after === mark) {
        // Already wrapped: remove the markers.
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        };
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      };
    }),
  );
  view.focus();
  return true;
}

/** Every line touched by the selection, once each. */
function selectedLines(state: EditorState) {
  const seen = new Set<number>();
  const lines = [];
  for (const r of state.selection.ranges) {
    for (let n = state.doc.lineAt(r.from).number; n <= state.doc.lineAt(r.to).number; n++) {
      if (!seen.has(n)) {
        seen.add(n);
        lines.push(state.doc.line(n));
      }
    }
  }
  return lines;
}

/** Any of the list / quote / heading prefixes a line might start with. */
const BLOCK_PREFIX = /^(\s*)(#{1,6}\s+|>\s?|[-*+]\s+\[[ xX]\]\s+|[-*+]\s+|\d+[.)]\s+)?/;

/**
 * Sets the block type of every selected line: a heading level (1–6), a
 * list ("bullet" / "number" / "task"), a quote, or plain text ("p").
 * Applying the type a line already has turns it back into plain text.
 */
export function setBlock(view: EditorView, kind: "p" | "quote" | "bullet" | "number" | "task" | 1 | 2 | 3 | 4 | 5 | 6): boolean {
  const { state } = view;
  const lines = selectedLines(state);
  const prefixFor = (i: number): string => {
    if (typeof kind === "number") return "#".repeat(kind) + " ";
    return { p: "", quote: "> ", bullet: "- ", number: `${i + 1}. `, task: "- [ ] " }[kind];
  };
  // If every line already has exactly this prefix, the command toggles it off.
  const already = lines.every((l, i) => {
    const m = BLOCK_PREFIX.exec(l.text)!;
    const cur = m[2] ?? "";
    if (kind === "number") return /^\d+[.)]\s+$/.test(cur);
    return cur.replace(/\s+$/, " ") === prefixFor(i) && kind !== "p";
  });
  const changes = lines.map((l, i) => {
    const m = BLOCK_PREFIX.exec(l.text)!;
    const indent = m[1];
    const old = m[2] ?? "";
    return {
      from: l.from + indent.length,
      to: l.from + indent.length + old.length,
      insert: already ? "" : prefixFor(i),
    };
  });
  view.dispatch({ changes });
  view.focus();
  return true;
}

/** Replaces the selection with `text`, putting the cursor `cursor` chars in (or at the end). */
export function insertText(view: EditorView, text: string, cursor?: number): boolean {
  const { from, to } = view.state.selection.main;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: EditorSelection.cursor(from + (cursor ?? text.length)),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Inserts a block on its own lines (blank line before if needed). */
export function insertBlock(view: EditorView, text: string, cursor?: number): boolean {
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  const onEmpty = line.text.trim() === "";
  const at = onEmpty ? line.from : line.to;
  const prefix = onEmpty ? "" : "\n\n";
  view.dispatch({
    changes: { from: at, to: onEmpty ? line.to : at, insert: prefix + text },
    selection: EditorSelection.cursor(at + prefix.length + (cursor ?? text.length)),
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** [selected text](url) with the cursor in the url, or [](…) if empty. */
export function insertLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  const md = `[${text}](https://)`;
  // Cursor lands after "https://" so the address can be typed straight away.
  return insertText(view, md, text ? md.length - 1 : 1);
}

/** [[selected text]] or [[]] with the cursor inside (opens autocompletion). */
export function insertWikiLink(view: EditorView): boolean {
  const { from, to } = view.state.selection.main;
  const text = view.state.sliceDoc(from, to);
  return insertText(view, `[[${text}]]`, text ? text.length + 4 : 2);
}

export const insertTable = (view: EditorView) =>
  insertBlock(view, "| Column | Column |\n| ------ | ------ |\n|        |        |\n", 2);
export const insertCodeBlock = (view: EditorView) => insertBlock(view, "```\n\n```\n", 4);
export const insertMathBlock = (view: EditorView) => insertBlock(view, "$$\n\n$$\n", 3);
export const insertRule = (view: EditorView) => insertBlock(view, "---\n");
export const insertCallout = (view: EditorView, type: string) =>
  insertBlock(view, `> [!${type.toUpperCase()}] \n> \n`, type.length + 6);
export const insertInlineMath = (view: EditorView) => toggleWrap(view, "$");

/** Today's date (and time) as text, e.g. "2026-10-29 14:05". */
export function insertDate(view: EditorView, withTime: boolean): boolean {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const date = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
  return insertText(view, withTime ? `${date} ${two(d.getHours())}:${two(d.getMinutes())}` : date);
}

export const doUndo = (view: EditorView) => (undo(view), view.focus(), true);
export const doRedo = (view: EditorView) => (redo(view), view.focus(), true);
export const doIndent = (view: EditorView) => (indentMore(view), view.focus(), true);
export const doOutdent = (view: EditorView) => (indentLess(view), view.focus(), true);

/** Wraps a command so it does nothing in a read-only (reading mode) note. */
const writable =
  (cmd: (view: EditorView) => boolean) =>
  (view: EditorView): boolean =>
    view.state.readOnly ? false : cmd(view);

/** Word / Google Docs shortcuts, added to every editor's keymap. */
export const formatKeymap: KeyBinding[] = [
  { key: "Mod-b", run: writable((v) => toggleWrap(v, "**")) },
  { key: "Mod-i", run: writable((v) => toggleWrap(v, "*")) },
  // Alt+Shift+5 as in Google Docs (Ctrl+Shift+X already closes a pane).
  { key: "Alt-Shift-5", run: writable((v) => toggleWrap(v, "~~")) },
  { key: "Mod-k", run: writable(insertLink) },
  { key: "Mod-`", run: writable((v) => toggleWrap(v, "`")) },
  // Ctrl+Alt+1…6 set a heading level, Ctrl+Alt+0 plain text (as in Docs).
  ...([1, 2, 3, 4, 5, 6] as const).map((n) => ({ key: `Mod-Alt-${n}`, run: writable((v) => setBlock(v, n)) })),
  { key: "Mod-Alt-0", run: writable((v) => setBlock(v, "p")) },
  // Ctrl+Shift+7 / 8: numbered list, bullets (Docs). Docs' Ctrl+Shift+9
  // checklist would clash with the split shortcut, so it's ribbon-only.
  { key: "Mod-Shift-7", run: writable((v) => setBlock(v, "number")) },
  { key: "Mod-Shift-8", run: writable((v) => setBlock(v, "bullet")) },
];
