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
// Inline things (callouts, inline math, code headers) are ViewPlugins.
// Things that replace whole lines (display math, tables) must come from a
// StateField; CodeMirror doesn't allow block replacements from plugins.

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
import { parseTable, type ParsedTable } from "./tables";
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

/** True if any selection range overlaps [from, to]. */
function selectionTouches(state: EditorState, from: number, to: number): boolean {
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
    /** Where clicking should put the cursor (start of the source). */
    readonly pos: number,
  ) {
    super();
  }
  eq(o: MathWidget) {
    return o.tex === this.tex && o.display === this.display && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const el = document.createElement(this.display ? "div" : "span");
    el.className = this.display ? "cm-math-display" : "cm-math-inline";
    el.innerHTML = renderTex(this.tex, this.display);
    el.title = "Click to edit";
    el.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.pos + (this.display ? 2 : 1)) });
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
            Decoration.replace({ widget: new MathWidget(m[1], false, start) }).range(start, start + m[0].length),
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
    readonly pos: number,
  ) {
    super();
  }
  eq(o: ImageWidget) {
    return o.url === this.url && o.alt === this.alt && o.pos === this.pos;
  }
  toDOM(view: EditorView) {
    const img = document.createElement("img");
    img.className = "cm-image";
    img.src = this.url;
    img.alt = this.alt;
    img.title = "Click to edit the link";
    img.addEventListener("mousedown", (e) => {
      e.preventDefault();
      view.dispatch({ selection: EditorSelection.cursor(this.pos) });
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
        out.push(Decoration.replace({ widget: new ImageWidget(src, alt, node.from) }).range(node.from, node.to));
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

class CodeHeader extends WidgetType {
  constructor(
    readonly lang: string,
    /** Doc range of the info string (empty range right after ``` if none). */
    readonly infoFrom: number,
    readonly infoTo: number,
    /** Doc range of the code body, for the copy button. */
    readonly bodyFrom: number,
    readonly bodyTo: number,
  ) {
    super();
  }
  eq(o: CodeHeader) {
    return (
      o.lang === this.lang &&
      o.infoFrom === this.infoFrom &&
      o.infoTo === this.infoTo &&
      o.bodyFrom === this.bodyFrom &&
      o.bodyTo === this.bodyTo
    );
  }
  toDOM(view: EditorView) {
    const bar = document.createElement("span");
    bar.className = "cm-code-header";

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
      if (view.state.readOnly) return;
      view.dispatch({ changes: { from: this.infoFrom, to: this.infoTo, insert: select.value } });
    });

    const copy = document.createElement("button");
    copy.className = "cm-code-copy";
    copy.textContent = "Copy";
    copy.addEventListener("click", async () => {
      await copyText(view.state.sliceDoc(this.bodyFrom, this.bodyTo));
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
        const bodyFrom = Math.min(open.to + 1, state.doc.length);
        const bodyTo = hasClose ? Math.max(bodyFrom, close.from - 1) : node.to;
        out.push(Decoration.line({ class: "cm-code-open" }).range(open.from));
        if (hasClose) out.push(Decoration.line({ class: "cm-code-close" }).range(close.from));
        if (!active.has(open.number)) {
          const infoFrom = info ? info.from : marks[0].to;
          const infoTo = info ? info.to : marks[0].to;
          const lang = state.sliceDoc(infoFrom, infoTo).trim();
          out.push(
            Decoration.replace({ widget: new CodeHeader(lang, infoFrom, infoTo, bodyFrom, bodyTo) }).range(
              open.from,
              open.to,
            ),
          );
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
  constructor(readonly table: ParsedTable) {
    super();
  }
  eq(o: TableWidget) {
    // Same source text = same rendering; comparing JSON is cheap for tables.
    return JSON.stringify(o.table) === JSON.stringify(this.table);
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
        // Click a cell → cursor into that cell's markdown (reveals the source).
        td.addEventListener("mousedown", (e) => {
          e.preventDefault();
          const pos = cell ? cell.from : this.table.from;
          view.dispatch({ selection: EditorSelection.cursor(pos) });
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

function buildBlocks(state: EditorState): DecorationSet {
  if (!state.facet(livePreviewOn)) return Decoration.none;
  const out: Range<Decoration>[] = [];

  // Tables from the syntax tree.
  syntaxTree(state).iterate({
    enter: (node) => {
      if (node.name !== "Table") return;
      const from = state.doc.lineAt(node.from).from;
      const to = state.doc.lineAt(node.to).to;
      if (!selectionTouches(state, from, to)) {
        out.push(Decoration.replace({ widget: new TableWidget(parseTable(state, from, to)), block: true }).range(from, to));
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
    if (!selectionTouches(state, line.from, endLine.to)) {
      out.push(
        Decoration.replace({ widget: new MathWidget(tex.trim(), true, line.from), block: true }).range(line.from, endLine.to),
      );
    }
  }
  return Decoration.set(out, true);
}

const blockField = StateField.define<DecorationSet>({
  create: buildBlocks,
  update(deco, tr) {
    // Rebuild on edits, cursor moves (reveal), mode switches, and when the
    // background parser extends the syntax tree.
    if (
      tr.docChanged ||
      tr.selection ||
      tr.startState.facet(livePreviewOn) !== tr.state.facet(livePreviewOn) ||
      syntaxTree(tr.startState) !== syntaxTree(tr.state)
    ) {
      return buildBlocks(tr.state);
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ---------------------------------------------------------------------------
// Plugin plumbing
// ---------------------------------------------------------------------------

/** Wraps a builder in a ViewPlugin that rebuilds on the usual triggers. */
function inlinePlugin(build: (view: EditorView) => DecorationSet) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view);
      }
      update(u: ViewUpdate) {
        if (u.docChanged || u.viewportChanged || u.selectionSet || syntaxTree(u.startState) !== syntaxTree(u.state)) {
          this.decorations = build(u.view);
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
