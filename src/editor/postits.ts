// Post-it blocks inside the editor.
//
// A post-it on disk is:
//
//   <!-- postit:id=k3x9 color=purple -->
//   > **Post-it:** Check hardware registers before calling CPUID.
//   <!-- /postit -->
//
// This extension:
//   - frames every line of a block in its colour (both modes),
//   - in live mode, replaces the opening marker with a small clickable
//     header ("POST-IT · purple ▾") and hides the closing marker, unless
//     the cursor is on that line,
//   - makes each block foldable; clicking the header collapses/expands it,
//   - provides `insertPostit` to drop a new block at the cursor (bound to
//     Ctrl+Alt+P globally in useKeybindings).

import { timeIt } from "../lib/perf";
import { codeFolding, foldEffect, foldService, foldedRanges, unfoldEffect } from "@codemirror/language";
import { EditorSelection, type EditorState, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { ipc } from "../lib/ipc";
import { activeLines } from "./activeLines";
import { livePreviewOn } from "./wikilinks";

/** Colours the stylesheet knows; anything else falls back to purple. */
export const POSTIT_COLORS = ["purple", "magenta", "blue", "green", "amber"] as const;
export type PostitColor = (typeof POSTIT_COLORS)[number];

export function safeColor(c: string): PostitColor {
  return (POSTIT_COLORS as readonly string[]).includes(c) ? (c as PostitColor) : "purple";
}

/** Same marker rules as arca-core's postit.rs (one marker per line). */
const OPEN_RE = /^[ \t]*<!--[ \t]*postit:([^\n]*?)[ \t]*-->[ \t]*$/;
const CLOSE_RE = /^[ \t]*<!--[ \t]*\/postit[ \t]*-->[ \t]*$/;

/** A parsed block, in document offsets. */
interface Block {
  id: string;
  color: PostitColor;
  /** Opening marker line: [from, to). */
  openFrom: number;
  openTo: number;
  /** Closing marker line: [from, to). */
  closeFrom: number;
  closeTo: number;
}

/** Finds every complete post-it block (an unclosed opener is ignored). */
function parseBlocks(state: EditorState): Block[] {
  const blocks: Block[] = [];
  const doc = state.doc;
  let open: { attrs: string; from: number; to: number } | null = null;
  for (let n = 1; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (!open) {
      const m = OPEN_RE.exec(line.text);
      if (m) open = { attrs: m[1], from: line.from, to: line.to };
    } else if (CLOSE_RE.test(line.text)) {
      const id = /\bid=["']?([^\s"']+)/.exec(open.attrs)?.[1] ?? "";
      const color = /\bcolor=["']?([^\s"']+)/.exec(open.attrs)?.[1] ?? "purple";
      blocks.push({ id, color: safeColor(color), openFrom: open.from, openTo: open.to, closeFrom: line.from, closeTo: line.to });
      open = null;
    }
  }
  return blocks;
}

/** Block list, recomputed only when the document changes. */
const blockField = StateField.define<Block[]>({
  create: parseBlocks,
  update: (blocks, tr) => (tr.docChanged ? parseBlocks(tr.state) : blocks),
});

/** True if the block's body is currently folded away. */
function isFolded(state: EditorState, b: Block): boolean {
  let folded = false;
  foldedRanges(state).between(b.openTo, b.openTo, (from) => {
    if (from === b.openTo) folded = true;
  });
  return folded;
}

/** Folds or unfolds one block. */
function toggleBlock(view: EditorView, b: Block) {
  const range = { from: b.openTo, to: b.closeTo };
  view.dispatch({ effects: isFolded(view.state, b) ? unfoldEffect.of(range) : foldEffect.of(range) });
}

/** The "POST-IT · colour ▾" header shown instead of the opening marker. */
class HeaderWidget extends WidgetType {
  constructor(
    readonly block: Block,
    readonly folded: boolean,
  ) {
    super();
  }
  eq(o: HeaderWidget) {
    return o.block.openFrom === this.block.openFrom && o.block.color === this.block.color && o.folded === this.folded;
  }
  toDOM(view: EditorView) {
    const el = document.createElement("span");
    el.className = "cm-postit-header";
    el.textContent = `${this.folded ? "▸" : "▾"} post-it · ${this.block.color}`;
    el.title = "Click to collapse / expand";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault(); // keep the cursor where it is
      // Re-read the block from current state; offsets may have shifted.
      const fresh = view.state.field(blockField).find((b) => b.openFrom === this.block.openFrom);
      if (fresh) toggleBlock(view, fresh);
    });
    return el;
  }
  ignoreEvent() {
    return false;
  }
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const live = state.facet(livePreviewOn);
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];

  for (const b of state.field(blockField)) {
    const first = state.doc.lineAt(b.openFrom).number;
    const last = state.doc.lineAt(b.closeFrom).number;
    // Frame every line of the block.
    for (let n = first; n <= last; n++) {
      const classes = [`cm-postit`, `cm-postit-${b.color}`];
      if (n === first) classes.push("cm-postit-first");
      if (n === last) classes.push("cm-postit-last");
      out.push(Decoration.line({ class: classes.join(" ") }).range(state.doc.line(n).from));
    }
    if (live && !active.has(first)) {
      out.push(Decoration.replace({ widget: new HeaderWidget(b, isFolded(state, b)) }).range(b.openFrom, b.openTo));
    } else {
      out.push(Decoration.mark({ class: "cm-postit-marker" }).range(b.openFrom, b.openTo));
    }
    if (live && !active.has(last)) {
      // Hide the closing marker; its empty line still closes the frame.
      if (b.closeTo > b.closeFrom) out.push(Decoration.replace({}).range(b.closeFrom, b.closeTo));
    } else {
      out.push(Decoration.mark({ class: "cm-postit-marker" }).range(b.closeFrom, b.closeTo));
    }
  }
  return Decoration.set(out, true);
}

const postitPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = timeIt("cm:postits", () => build(view));
    }
    update(u: ViewUpdate) {
      // Fold/unfold changes the header arrow, so any transaction with
      // effects is worth a rebuild too (cheap: blocks are pre-parsed).
      const hasEffects = u.transactions.some((tr) => tr.effects.length > 0);
      const modeChanged = u.startState.facet(livePreviewOn) !== u.state.facet(livePreviewOn);
      if (u.docChanged || u.selectionSet || hasEffects || modeChanged) this.decorations = timeIt("cm:postits", () => build(u.view));
    }
  },
  { decorations: (v) => v.decorations },
);

/** Lets CodeMirror's fold commands (Ctrl+Shift+[ / ]) fold post-its too. */
const postitFolding = foldService.of((state, lineStart, lineEnd) => {
  const b = state.field(blockField).find((blk) => blk.openFrom === lineStart);
  return b ? { from: lineEnd, to: b.closeTo } : null;
});

/**
 * Inserts a new post-it below the cursor's line (or on it, if empty) and
 * places the cursor where the note text goes. The block, with its fresh id,
 * comes from Rust so ids are generated in exactly one place.
 */
export async function insertPostit(view: EditorView, color: PostitColor = "purple"): Promise<void> {
  const block = await ipc.newPostit(color);
  const { state } = view;
  const line = state.doc.lineAt(state.selection.main.head);
  // Insert on the current line if it's blank, otherwise after it with a gap.
  const at = line.text.trim() === "" ? line.from : line.to;
  const prefix = line.text.trim() === "" ? "" : "\n\n";
  const insert = `${prefix}${block}\n`;
  // Cursor goes right after "**Post-it:**" (the body line ends there).
  const bodyLineEnd = at + prefix.length + block.indexOf("\n<!-- /postit");
  view.dispatch({
    changes: { from: at, to: line.text.trim() === "" ? line.to : at, insert },
    selection: EditorSelection.cursor(bodyLineEnd),
    scrollIntoView: true,
  });
  // The body line is "> **Post-it:**" with no trailing space; add one.
  view.dispatch({ changes: { from: bodyLineEnd, insert: " " }, selection: EditorSelection.cursor(bodyLineEnd + 1) });
  view.focus();
}

/** Everything post-it related for the editor. */
export const postits = [blockField, postitPlugin, postitFolding, codeFolding()];
