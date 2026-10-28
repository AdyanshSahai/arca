// Rich rendering for live preview: callouts, KaTeX math, code boxes and
// tables. Like the rest of live preview, everything stays plain markdown in
// the file; these are only decorations, and moving the cursor into a
// construct reveals its source for editing.
//
//   > [!WARNING] Title         → coloured callout box with a label
//   $E = mc^2$                 → inline KaTeX
//   $$ … $$  (own lines)       → display KaTeX block
//   ```rust … ```              → code box: language picker + copy button
//   | a | b | …                → rendered <table>; click a cell to edit it
//   ![alt](.assets/pic.png)    → the image itself
//
// Widgets never store document positions: typing shifts every position
// below the cursor, and position-based eq() made CodeMirror rebuild every
// widget's DOM (tables, KaTeX…) on each keystroke. They compare by content
// and look up their position at click time with view.posAtDOM().
//
// Inline things (callouts, inline math, code headers) are ViewPlugins.
// Things that replace whole lines (display math, tables) must come from a
// StateField; CodeMirror doesn't allow block replacements from plugins.

import { timeIt } from "../lib/perf";
import { syntaxTree } from "@codemirror/language";
import { EditorSelection, type EditorState, type Range, StateField } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import katex from "katex";
import { activeLines } from "./activeLines";
import { parseTable, type ParsedTable, tableAt } from "./tables";
import { linkContext, livePreviewOn } from "./wikilinks";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/** Syntax nodes whose contents are code, where `$` and `[!x]` mean nothing. */
const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "CodeInfo"]);

/** True if `pos` sits inside code. */
function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (CODE_NODES.has(n.name)) return true;
  }
  return false;
}

/** True if any selection range overlaps [from, to] (never in read-only documents). */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
  if (state.readOnly) return false;
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** KaTeX output is cached: the same formula is re-rendered on every update otherwise. */
const katexCache = new Map<string, string>();
function renderTex(tex: string, display: boolean): string {
  const key = (display ? "D:" : "I:") + tex;
  let html = katexCache.get(key);
  if (html === undefined) {
    // throwOnError: false renders bad TeX in red instead of throwing.
    html = katex.renderToString(tex, { displayMode: display, throwOnError: false, output: "html" });
    if (katexCache.size > 500) katexCache.clear(); // crude cap; formulas are tiny
    katexCache.set(key, html);
  }
  return html;
}

// ---------------------------------------------------------------------------
// Callouts: > [!TYPE] optional title
// ---------------------------------------------------------------------------

/** Callout type → colour family. Aliases follow Obsidian's names. */
const CALLOUT_KIND: Record<string, string> = {
  note: "blue", info: "blue", todo: "blue", abstract: "blue", summary: "blue",
  tip: "green", hint: "green", important: "green", success: "green", check: "green", done: "green",
  question: "amber", help: "amber", faq: "amber", warning: "amber", caution: "amber", attention: "amber",
  danger: "red", error: "red", bug: "red", failure: "red", fail: "red",
  example: "purple", quote: "muted", cite: "muted",
};

/** First line of a callout: "> [!type]" with optional +/- fold sign and title. */
const CALLOUT_RE = /^\s*>\s*\[!([A-Za-z]+)\]([+-]?)/;

/** The small label ("WARNING") shown in place of "[!warning]". */
class CalloutLabel extends WidgetType {
  constructor(readonly type: string) {
    super();
  }
  eq(o: CalloutLabel) {
    return o.type === this.type;
  }
  toDOM() {
    const el = document.createElement("span");
    el.className = "cm-callout-label";
    el.textContent = this.type;
    return el;
  }
}

function buildCallouts(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "Blockquote") return;
        const first = state.doc.lineAt(node.from);
        if (seen.has(first.from)) return false;
        seen.add(first.from);
        const m = CALLOUT_RE.exec(first.text);
        if (!m) return false;
        const type = m[1].toLowerCase();
        const kind = CALLOUT_KIND[type] ?? "blue";
        // Colour every line of the box; the first gets the title styling.
        const last = state.doc.lineAt(node.to).number;
        for (let n = first.number; n <= last; n++) {
          const cls = `cm-callout cm-callout-${kind}${n === first.number ? " cm-callout-first" : ""}${n === last ? " cm-callout-last" : ""}`;
          out.push(Decoration.line({ class: cls }).range(state.doc.line(n).from));
        }
        // Swap "[!type]+" for a label unless the first line is being edited.
        if (!active.has(first.number)) {
          const start = first.from + first.text.indexOf("[!");
          const end = first.from + m[0].length;
          out.push(Decoration.replace({ widget: new CalloutLabel(type) }).range(start, end));
        }
        return false; // nested quotes inside a callout aren't callouts
      },
    });
  }
  return Decoration.set(out, true);
}

// ---------------------------------------------------------------------------
// Inline math: $…$
// ---------------------------------------------------------------------------

/**
 * `$x$` with no space just inside the dollars and no digit right after the
 * closing one, so prices like "$5 and $6" aren't treated as math. `\$` is
 * an escaped dollar.
 */
const INLINE_MATH_RE = /(?<![\\$])\$(?=[^\s$])((?:\\.|[^$\n\\])+?)(?<=[^\s\\])\$(?![\d$])/g;

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-math-display" : "cm-math-inline";
    el.innerHTML = renderTex(this.tex, this.display);
    el.title = "Click to edit";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      // Where the formula's source starts *now*, then step past "$" / "$$".
      const pos = view.posAtDOM(el);
      view.dispatch({ selection: EditorSelection.cursor(pos + (this.display ? 2 : 1)) });
      view.focus();
    });
    return el;
  }
  ignoreEvent() {
    return true;
  }
}

function buildInlineMath(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      // Display math lines are handled by the block field below.
      if (!line.text.trimStart().startsWith("$$") && !active.has(line.number)) {
        for (const m of line.text.matchAll(INLINE_MATH_RE)) {
          const start = line.from + m.index!;
          if (inCode(state, start)) continue;
          out.push(
            Decoration.replace({ widget: new MathWidget(m[1], false) }).range(start, start + m[0].length),
          );
        }
      }
      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

// ---------------------------------------------------------------------------
// Images: ![alt](src)
// ---------------------------------------------------------------------------

class ImageWidget extends WidgetType {
  constructor(
    readonly url: string,
    readonly alt: string,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.url === this.url && o.alt === this.alt;
  }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.className = "cm-image";
    img.src = this.url;
    img.alt = this.alt;
    img.title = "Click to edit the link";
    img.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(view.posAtDOM(img)) });
      view.focus();
    });
    // A broken link shows its alt text instead of a broken-image icon.
    img.addEventListener("error", () => img.replaceWith(Object.assign(document.createElement("span"), {
      className: "cm-image-missing",
      textContent: `⚠ missing image: ${this.alt || this.url}`,
    })));
    return img;
  }
  ignoreEvent() {
    return true;
  }
}

function buildImages(view: EditorView): DecorationSet {
  const { state } = view;
  const ctx = state.facet(linkContext);
  if (!ctx) return Decoration.none;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "Image") return;
        const url = node.node.getChild("URL");
        if (!url || active.has(state.doc.lineAt(node.from).number)) return false;
        const marks = node.node.getChildren("LinkMark");
        // Alt text sits between "![" and "]".
        const alt = marks.length >= 2 ? state.sliceDoc(marks[0].to, marks[1].from) : "";
        const src = ctx.assetUrl(state.sliceDoc(url.from, url.to));
        out.push(Decoration.replace({ widget: new ImageWidget(src, alt) }).range(node.from, node.to));
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

// ---------------------------------------------------------------------------
// Code boxes: ```lang header with a language picker and copy button
// ---------------------------------------------------------------------------

/** Languages offered in the picker (any other info string is kept as-is). */
const LANGUAGES = [
  "", "bash", "c", "cpp", "csharp", "css", "go", "html", "java", "javascript", "json",
  "kotlin", "lua", "markdown", "python", "ruby", "rust", "sql", "swift", "toml",
  "typescript", "yaml", "asm",
];

/** Copies text, falling back to execCommand where the async API is unavailable. */
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    ta.remove();
  }
}

/** Info-string and body ranges of the fenced code block starting near `pos`. */
function fenceParts(state: EditorState, pos: number) {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>["resolveInner"]> | null = syntaxTree(state).resolveInner(pos, 1); n; n = n.parent) {
    if (n.name !== "FencedCode") continue;
    const open = state.doc.lineAt(n.from);
    const close = state.doc.lineAt(n.to);
    const info = n.getChild("CodeInfo");
    const marks = n.getChildren("CodeMark");
    const hasClose = marks.length > 1 && close.number > open.number;
    const bodyFrom = Math.min(open.to + 1, state.doc.length);
    return {
      infoFrom: info ? info.from : marks[0].to,
      infoTo: info ? info.to : marks[0].to,
      bodyFrom,
      bodyTo: hasClose ? Math.max(bodyFrom, close.from - 1) : n.to,
    };
  }
  return null;
}

class CodeHeader extends WidgetType {
  constructor(readonly lang: string) {
    super();
  }
  eq(o: CodeHeader) {
    return o.lang === this.lang;
  }
  toDOM(view: EditorView) {
    const bar = document.createElement("span");
    bar.className = "cm-code-header";
    /** The block's current ranges (looked up when needed; positions shift). */
    const parts = () => fenceParts(view.state, view.posAtDOM(bar));

    // Language picker: rewrites the fence's info string.
    const select = document.createElement("select");
    select.className = "cm-code-lang";
    const options = LANGUAGES.includes(this.lang) ? LANGUAGES : [this.lang, ...LANGUAGES];
    for (const l of options) {
      const opt = document.createElement("option");
      opt.value = l;
      opt.textContent = l || "plain text";
      opt.selected = l === this.lang;
      select.appendChild(opt);
    }
    // In read mode the picker is shown but can't change anything.
    select.disabled = view.state.readOnly;
    select.addEventListener("change", () => {
      const p = parts();
      if (view.state.readOnly || !p) return;
      view.dispatch({ changes: { from: p.infoFrom, to: p.infoTo, insert: select.value } });
    });

    const copy = document.createElement("button");
    copy.className = "cm-code-copy";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      const p = parts();
      if (!p) return;
      await copyText(view.state.sliceDoc(p.bodyFrom, p.bodyTo));
      copy.textContent = "Copied";
      setTimeout(() => (copy.textContent = "Copy"), 1200);
    });

    bar.append(select, copy);
    return bar;
  }
  // The widget handles its own events (select, button); CodeMirror must not
  // move the cursor onto the fence line, which would remove the widget.
  ignoreEvent() {
    return true;
  }
}

function buildCodeHeaders(view: EditorView): DecorationSet {
  const { state } = view;
  const active = activeLines(state);
  const out: Range<Decoration>[] = [];
  const seen = new Set<number>();
  for (const { from, to } of view.visibleRanges) {
    syntaxTree(state).iterate({
      from,
      to,
      enter: (node) => {
        if (node.name !== "FencedCode") return;
        if (seen.has(node.from)) return false;
        seen.add(node.from);
        const open = state.doc.lineAt(node.from);
        const close = state.doc.lineAt(node.to);
        const info = node.node.getChild("CodeInfo");
        const marks = node.node.getChildren("CodeMark");
        const hasClose = marks.length > 1 && close.number > open.number;
        out.push(Decoration.line({ class: "cm-code-open" }).range(open.from));
        if (hasClose) out.push(Decoration.line({ class: "cm-code-close" }).range(close.from));
        if (!active.has(open.number)) {
          const infoFrom = info ? info.from : marks[0].to;
          const infoTo = info ? info.to : marks[0].to;
          const lang = state.sliceDoc(infoFrom, infoTo).trim();
          out.push(Decoration.replace({ widget: new CodeHeader(lang) }).range(open.from, open.to));
        }
        if (hasClose && !active.has(close.number) && close.to > close.from) {
          out.push(Decoration.replace({}).range(close.from, close.to));
        }
        return false;
      },
    });
  }
  return Decoration.set(out, true);
}

// ---------------------------------------------------------------------------
// Block replacements: display math and tables (StateField)
// ---------------------------------------------------------------------------

class TableWidget extends WidgetType {
  constructor(
    readonly table: ParsedTable,
    /**
     * The table's source text. Equal text means an identical rendering, so
     * CodeMirror keeps the existing DOM; positions deliberately aren't part
     * of it (they shift on every keystroke above the table).
     */
    readonly key: string,
  ) {
    super();
  }
  eq(o: TableWidget) {
    return o.key === this.key;
  }
  toDOM(view: EditorView) {
    const wrap = document.createElement("div");
    wrap.className = "cm-table-wrap";
    const table = document.createElement("table");
    table.className = "cm-table";
    this.table.rows.forEach((row, r) => {
      const tr = document.createElement("tr");
      const cols = Math.max(this.table.aligns.length, row.length);
      for (let c = 0; c < cols; c++) {
        const cell = row[c];
        const td = document.createElement(r === 0 ? "th" : "td");
        td.textContent = cell?.text ?? "";
        const align = this.table.aligns[c];
        if (align) td.style.textAlign = align;
        // Click a cell → cursor into that cell's markdown (reveals the
        // source). The table is re-parsed at its *current* position.
        td.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const start = view.posAtDOM(wrap);
          const line = view.state.doc.lineAt(start);
          const range = tableAt(view.state, line.from + 1) ?? { from: line.from, to: line.to };
          const now = parseTable(view.state, range.from, range.to);
          view.dispatch({ selection: EditorSelection.cursor(now.rows[r]?.[c]?.from ?? now.from) });
          view.focus();
        });
        tr.appendChild(td);
      }
      table.appendChild(tr);
    });
    wrap.appendChild(table);
    return wrap;
  }
  ignoreEvent() {
    return true;
  }
}

/** The field's value: the decorations plus every block's range. */
interface Blocks {
  deco: DecorationSet;
  /** [from, to] of every table / display-math block, rendered or not. */
  ranges: [number, number][];
}

function buildBlocks(state: EditorState): Blocks {
  if (!state.facet(livePreviewOn)) return { deco: Decoration.none, ranges: [] };
  const out: Range<Decoration>[] = [];
  const ranges: [number, number][] = [];

  // Tables from the syntax tree.
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      ranges.push([from, to]);
      if (!selectionTouches(state, from, to)) {
        const key = state.sliceDoc(from, to);
        out.push(Decoration.replace({ widget: new TableWidget(parseTable(state, from, to), key), block: true }).range(from, to));
      }
      return false;
    },
  });

  // Display math: a "$$" line, content, a closing "$$" line (or $$…$$ on one line).
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const t = line.text.trim();
    if (!t.startsWith("$$") || inCode(state, line.from)) continue;
    let endLine = line;
    let tex: string;
    if (t.length > 4 && t.endsWith("$$")) {
      tex = t.slice(2, -2);
    } else {
      // Find the closing line.
      let m = n + 1;
      while (m <= state.doc.lines && !state.doc.line(m).text.trim().endsWith("$$")) m++;
      if (m > state.doc.lines) break; // unclosed: leave as text
      endLine = state.doc.line(m);
      const body = state.sliceDoc(line.from, endLine.to).trim();
      tex = body.slice(2, -2);
      n = m;
    }
    ranges.push([line.from, endLine.to]);
    if (!selectionTouches(state, line.from, endLine.to)) {
      out.push(
        Decoration.replace({ widget: new MathWidget(tex.trim(), true), block: true }).range(line.from, endLine.to),
      );
    }
  }
  return { deco: Decoration.set(out, true), ranges };
}

/** True if the selection overlaps any of the block ranges. */
function selectionInBlock(state: EditorState, ranges: [number, number][]): boolean {
  return ranges.some(([from, to]) => selectionTouches(state, from, to));
}

const blockField = StateField.define<Blocks>({
  create: buildBlocks,
  update(value, tr) {
    const modeChanged = tr.startState.facet(livePreviewOn) !== tr.state.facet(livePreviewOn);
    if (modeChanged) return timeIt("cm:blockField", () => buildBlocks(tr.state));
    if (tr.docChanged) {
      // Ordinary typing outside any table/math block can't create, remove
      // or change a block, so just shift the existing decorations instead of
      // re-scanning the whole document. Edits that touch a block, or add
      // or remove "|", "$" or a line break anywhere, still rebuild.
      let affectsBlocks = false;
      tr.changes.iterChanges((fromA, toA, _fromB, _toB, inserted) => {
        const text = tr.startState.sliceDoc(fromA, toA) + inserted.toString();
        if (/[|$\n]/.test(text) || value.ranges.some(([a, b]) => fromA <= b && toA >= a)) affectsBlocks = true;
      });
      if (affectsBlocks) return timeIt("cm:blockField", () => buildBlocks(tr.state));
      return {
        deco: value.deco.map(tr.changes),
        ranges: value.ranges.map(([a, b]) => [tr.changes.mapPos(a, 1), tr.changes.mapPos(b, -1)]),
      };
    }
    // The background parser got further: tables may have been found.
    if (syntaxTree(tr.startState) !== syntaxTree(tr.state)) {
      return timeIt("cm:blockField", () => buildBlocks(tr.state));
    }
    // A cursor move only matters if it enters or leaves a block (which
    // switches that block between rendered and raw). Otherwise keep the
    // same value, so CodeMirror has nothing to diff or redraw.
    if (tr.selection && (selectionInBlock(tr.startState, value.ranges) || selectionInBlock(tr.state, value.ranges))) {
      return timeIt("cm:blockField", () => buildBlocks(tr.state));
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f, (v) => v.deco),
});

// ---------------------------------------------------------------------------
// Plugin plumbing
// ---------------------------------------------------------------------------

/** Wraps a builder in a ViewPlugin that rebuilds on the usual triggers. */
function inlinePlugin(build: (view: EditorView) => DecorationSet) {
  const label = `cm:${build.name}`;
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = timeIt(label, () => build(view));
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = timeIt(label, () => build(u.view));
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
}

/** Live-preview-only rich rendering. Include inside the live mode compartment. */
export const richLive = [
  inlinePlugin(buildCallouts),
  inlinePlugin(buildInlineMath),
  inlinePlugin(buildCodeHeaders),
  inlinePlugin(buildImages),
];

/**
 * The block field checks the live-preview facet itself (it returns nothing
 * in raw mode), so it can stay installed permanently.
 */
export const richBlocks = blockField;
