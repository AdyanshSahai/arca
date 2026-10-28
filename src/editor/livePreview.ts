// Live preview ("WYSIWYG-ish") mode for CodeMirror.
//
// The document stays plain markdown; this plugin only adds *decorations*
// over the syntax tree:
//   - hides markup (`#`, `**`, `` ` ``, `>`, link URLs…) on every line the
//     cursor is NOT on, so the text reads as rendered,
//   - styles headings, quotes and code blocks with line classes,
//   - swaps bullets, task boxes and horizontal rules for small widgets.
// Moving the cursor onto a line reveals its raw markdown for editing.
//
// [[WikiLinks]], tags and post-its are handled by their own extensions.

import { timeIt } from "../lib/perf";
import { syntaxTree } from "@codemirror/language";
import { type EditorState, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import type { SyntaxNodeRef } from "@lezer/common";
import { activeLines, rangeIsActive } from "./activeLines";

/** Zero-width replacement that hides a range of markup. */
const hide = Decoration.replace({});

/** Bullet shown instead of "-", "*" or "+". */
class BulletWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-bullet";
    span.textContent = "•";
    return span;
  }
  eq() {
    return true; // all bullets look the same, so the DOM can be reused
  }
}

/** Clickable checkbox replacing a task marker (`[ ]` / `[x]`). */
class TaskWidget extends WidgetType {
  // No stored position: it would change on every keystroke above the task
  // and force a redraw. The click handler asks the view where it is.
  constructor(readonly checked: boolean) {
    super();
  }
  eq(other: TaskWidget) {
    return other.checked === this.checked;
  }
  toDOM(view: EditorView) {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.className = "cm-task";
    box.checked = this.checked;
    box.addEventListener("mousedown", (e) => {
      // Stop CodeMirror from moving the cursor (which would reveal the raw marker).
      e.preventDefault();
      if (view.state.readOnly) return; // read mode: look, don't touch
      const pos = view.posAtDOM(box); // the "[ ]" marker's current offset
      view.dispatch({
        changes: { from: pos, to: pos + 3, insert: this.checked ? "[ ]" : "[x]" },
      });
    });
    return box;
  }
  ignoreEvent() {
    return false;
  }
}

/** A thin rule replacing `---`. */
class RuleWidget extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-hr";
    return span;
  }
  eq() {
    return true;
  }
}

/** Adds a line class to every line spanned by [from, to]. */
function lineClass(state: EditorState, out: Range<Decoration>[], seen: Set<string>, from: number, to: number, cls: string) {
  const first = state.doc.lineAt(from).number;
  const last = state.doc.lineAt(to).number;
  for (let n = first; n <= last; n++) {
    const line = state.doc.line(n);
    // Visible ranges can overlap a node twice; never add a line class twice.
    const key = `${line.from}:${cls}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(Decoration.line({ class: cls }).range(line.from));
  }
}

/** Builds all live-preview decorations for the visible part of the doc. */
function build(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  const seen = new Set<string>();
  /** True when the node's line(s) are being edited and should show raw. */
  const isActive = (node: SyntaxNodeRef) => rangeIsActive(state, active, node.from, node.to);

  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        const name = node.name;

        // --- Headings: size via line class, hide "## " when inactive.
        const heading = /^ATXHeading(\d)$/.exec(name);
        if (heading) {
          lineClass(state, out, seen, node.from, node.from, `cm-h${heading[1]}`);
          return;
        }
        if (name === "HeaderMark") {
          // Also swallow the single space after the hashes.
          const end = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
          // Unlike other markup, the "#"s are revealed only when the cursor
          // touches them, not whenever it's somewhere on the heading line.
          // Otherwise clicking around the note made the title's "#" pop in
          // and out, which looked like a glitch.
          const touched = !state.readOnly && state.selection.ranges.some((r) => r.from <= end && r.to >= node.from);
          if (!touched) out.push(hide.range(node.from, end));
          return;
        }

        // --- Inline emphasis / strike / code markers.
        if (name === "EmphasisMark" || name === "StrikethroughMark") {
          if (!isActive(node)) out.push(hide.range(node.from, node.to));
          return;
        }
        if (name === "CodeMark") {
          // Only inline code: fenced code keeps its ``` lines.
          if (node.node.parent?.name === "InlineCode" && !isActive(node)) out.push(hide.range(node.from, node.to));
          return;
        }

        // --- [text](url) links: show just the text.
        if (name === "Link") {
          const link = node.node;
          const url = link.getChild("URL");
          if (!url || isActive(node)) return; // not an inline link, or being edited
          // Hide every "[", "]", "(", ")" mark and the URL itself.
          const marks = link.getChildren("LinkMark");
          for (const mark of marks) out.push(hide.range(mark.from, mark.to));
          out.push(hide.range(url.from, url.to));
          // The visible text (between "[" and "]") becomes clickable; the
          // click handler in wikilinks.ts follows `data-href`.
          if (marks.length >= 2 && marks[1].from > marks[0].to) {
            out.push(
              Decoration.mark({ class: "cm-md-link", attributes: { "data-href": state.sliceDoc(url.from, url.to) } }).range(
                marks[0].to,
                marks[1].from,
              ),
            );
          }
          const title = link.getChild("LinkTitle");
          if (title) out.push(hide.range(title.from, title.to));
          return;
        }

        // --- Blockquotes: left rule on each line, ">" hidden when inactive.
        if (name === "Blockquote") {
          lineClass(state, out, seen, node.from, node.to, "cm-quote");
          return;
        }
        if (name === "QuoteMark") {
          if (!isActive(node)) {
            const end = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            out.push(hide.range(node.from, end));
          }
          return;
        }

        // --- Fenced / indented code: tinted block, contents untouched.
        if (name === "FencedCode" || name === "CodeBlock") {
          lineClass(state, out, seen, node.from, node.to, "cm-codeblock");
          return false; // don't descend: nothing inside needs decorating
        }

        // --- Bullets, tasks, rules.
        if (name === "ListMark") {
          const item = node.node.parent; // the ListItem
          const isBullet = item?.parent?.name === "BulletList";
          if (!isBullet || isActive(node)) return;
          if (item?.getChild("Task")) {
            // "- [ ] task": hide the dash (and its space); the checkbox
            // widget alone marks the item, as in most task UIs.
            const end = state.sliceDoc(node.to, node.to + 1) === " " ? node.to + 1 : node.to;
            out.push(hide.range(node.from, end));
          } else {
            out.push(Decoration.replace({ widget: new BulletWidget() }).range(node.from, node.to));
          }
          return;
        }
        if (name === "TaskMarker") {
          if (!isActive(node)) {
            const checked = /x/i.test(state.sliceDoc(node.from, node.to));
            out.push(Decoration.replace({ widget: new TaskWidget(checked) }).range(node.from, node.to));
          }
          return;
        }
        if (name === "HorizontalRule") {
          if (!isActive(node)) out.push(Decoration.replace({ widget: new RuleWidget() }).range(node.from, node.to));
          return;
        }
      },
    });
  }
  // `true` = sort the ranges for us (line decorations and marks interleave).
  return Decoration.set(out, true);
}

/** The live-preview plugin. Only included when a pane is in live mode. */
export const livePreview = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = timeIt("cm:livePreview", () => build(view));
    }
    update(u: ViewUpdate) {
      // Rebuild on edits, scrolling, cursor moves (reveal rule), and when the
      // background parser has extended the syntax tree.
      if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
        this.decorations = timeIt("cm:livePreview", () => build(u.view));
      }
    }
  },
  { decorations: (v) => v.decorations },
);
