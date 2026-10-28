// [[WikiLinks]] and #tags inside the editor.
//
// - Raw mode, or the line being edited: the link text gets a `cm-wikilink`
//   mark; Ctrl/Cmd+click follows it.
// - Live mode, other lines: the whole `[[target|alias]]` is replaced by a
//   chip showing the alias (or target). A plain click follows it.
//   Chips for missing notes are dimmed; URLs/files get a ↗.
// - `#tags` are marked in both modes; Ctrl/Cmd+click runs a topic search.
// - Typing `[[` opens autocompletion over every note in the vault.
//
// The extension doesn't import any app stores. Everything it needs comes
// through the `linkContext` facet, which the Editor component provides.

import { timeIt } from "../lib/perf";
import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import { Facet, StateEffect, type Range } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from "@codemirror/view";
import { classifyLink, type NoteIndex } from "../lib/links";
import type { NoteInfo } from "../lib/types";
import { activeLines } from "./activeLines";

/** What the link extension needs from the outside world. */
export interface LinkContext {
  /** Existence check used to dim chips of missing notes. */
  notes: NoteIndex;
  /** Raw note list for `[[` completion. */
  noteList: NoteInfo[];
  /** Follows a link target (note, URL or file). */
  follow: (target: string) => void;
  /** Runs a topic search for a tag (without "#"). */
  searchTag: (tag: string) => void;
  /** Vault-relative path of the note being edited. */
  notePath: string;
  /** Loadable URL for an image `src` written in this note. */
  assetUrl: (src: string) => string;
}

/** Provided once per editor; the last provided value wins. */
export const linkContext = Facet.define<LinkContext, LinkContext | null>({
  combine: (values) => values[values.length - 1] ?? null,
});

/** Whether the pane is in live-preview mode (set by the mode compartment). */
export const livePreviewOn = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

/** Dispatched when the vault's note list changes, so chip states refresh. */
export const refreshLinks = StateEffect.define<null>();

/** `[[target]]` / `[[target|alias]]`, same rule as the Rust extractor. */
const WIKI_RE = /\[\[([^[\]\n]+?)\]\]/g;
/** `#tag` after whitespace / "(" / line start; must start with a letter. */
const TAG_RE = /(^|[\s(])#([A-Za-z][\w\-/]*)/g;

/** Syntax nodes whose contents are code, where links/tags don't count. */
const CODE_NODES = new Set(["InlineCode", "FencedCode", "CodeBlock", "CodeText", "CodeInfo"]);

/** The rendered chip for a link in live mode. */
class LinkChip extends WidgetType {
  constructor(
    readonly target: string,
    readonly label: string,
    readonly state: "note" | "missing" | "external",
  ) {
    super();
  }
  eq(o: LinkChip) {
    return o.target === this.target && o.label === this.label && o.state === this.state;
  }
  toDOM() {
    const span = document.createElement("span");
    span.className = "cm-wikilink-chip";
    if (this.state === "missing") span.classList.add("is-missing");
    if (this.state === "external") span.classList.add("is-external");
    span.textContent = this.label;
    span.dataset.target = this.target;
    span.title = this.state === "missing" ? `${this.target} (doesn't exist yet; click to create)` : this.target;
    return span;
  }
  ignoreEvent() {
    return false; // let our mousedown handler see clicks
  }
}

/** Splits "target|alias" and trims both halves. */
function splitLink(inner: string): { target: string; alias: string | null } {
  const bar = inner.indexOf("|");
  if (bar === -1) return { target: inner.trim(), alias: null };
  return { target: inner.slice(0, bar).trim(), alias: inner.slice(bar + 1).trim() || null };
}

function build(view: EditorView): DecorationSet {
  const { state } = view;
  const ctx = state.facet(linkContext);
  const live = state.facet(livePreviewOn);
  const active = activeLines(state);
  const tree = syntaxTree(state);
  const out: Range<Decoration>[] = [];

  /** True if `pos` sits inside code, where links are just text. */
  const inCode = (pos: number) => {
    for (let n: ReturnType<typeof tree.resolveInner> | null = tree.resolveInner(pos, 1); n; n = n.parent) {
      if (CODE_NODES.has(n.name)) return true;
    }
    return false;
  };

  for (const { from, to } of view.visibleRanges) {
    // Work line by line: links never span lines and line numbers are needed anyway.
    for (let pos = from; pos <= to; ) {
      const line = state.doc.lineAt(pos);
      const text = line.text;

      for (const m of text.matchAll(WIKI_RE)) {
        const start = line.from + m.index!;
        const end = start + m[0].length;
        if (inCode(start)) continue;
        const { target, alias } = splitLink(m[1]);
        if (!target) continue;
        if (live && !active.has(line.number)) {
          const kind = classifyLink(target);
          const chipState = kind !== "note" ? "external" : ctx?.notes.has(target) ? "note" : "missing";
          out.push(
            Decoration.replace({ widget: new LinkChip(target, alias ?? target, chipState) }).range(start, end),
          );
        } else {
          out.push(
            Decoration.mark({ class: "cm-wikilink", attributes: { "data-target": target } }).range(start, end),
          );
        }
      }

      for (const m of text.matchAll(TAG_RE)) {
        // m[1] is the preceding whitespace/"(", so the "#" starts after it.
        const start = line.from + m.index! + m[1].length;
        const end = start + 1 + m[2].length;
        if (inCode(start)) continue;
        out.push(Decoration.mark({ class: "cm-tag", attributes: { "data-tag": m[2] } }).range(start, end));
      }

      pos = line.to + 1;
    }
  }
  return Decoration.set(out, true);
}

const linkPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = timeIt("cm:wikilinks", () => build(view));
    }
    update(u: ViewUpdate) {
      const refreshed = u.transactions.some((tr) => tr.effects.some((e) => e.is(refreshLinks)));
      // Facet changes (mode switch) show up as a different facet value.
      const modeChanged = u.startState.facet(livePreviewOn) !== u.state.facet(livePreviewOn);
      if (u.docChanged || u.viewportChanged || u.selectionSet || refreshed || modeChanged) {
        this.decorations = timeIt("cm:wikilinks", () => build(u.view));
      }
    }
  },
  { decorations: (v) => v.decorations },
);

/** Click handling: chips on plain click, marks/tags on Ctrl/Cmd+click. */
const clickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    const ctx = view.state.facet(linkContext);
    const el = event.target as HTMLElement | null;
    if (!ctx || !el || event.button !== 0) return false;

    const chip = el.closest<HTMLElement>(".cm-wikilink-chip");
    if (chip?.dataset.target) {
      event.preventDefault(); // don't put the cursor inside (would reveal raw text)
      ctx.follow(chip.dataset.target);
      return true;
    }
    // Rendered [text](url) links follow on a plain click, like chips.
    const rendered = el.closest<HTMLElement>(".cm-md-link[data-href]");
    if (rendered?.dataset.href) {
      event.preventDefault();
      ctx.follow(decodeURI(rendered.dataset.href));
      return true;
    }
    // Editing needs Ctrl+click so plain clicks place the cursor; in the
    // read-only reading mode there's no cursor, so plain clicks follow.
    if (!(event.ctrlKey || event.metaKey || view.state.readOnly)) return false;
    const mark = el.closest<HTMLElement>("[data-target]");
    if (mark?.dataset.target) {
      event.preventDefault();
      ctx.follow(mark.dataset.target);
      return true;
    }
    // [text](url) links rendered by live preview (see livePreview.ts):
    // web links, local files (attachments) and relative note links.
    const href = el.closest<HTMLElement>("[data-href]");
    if (href?.dataset.href) {
      event.preventDefault();
      ctx.follow(decodeURI(href.dataset.href));
      return true;
    }
    const tag = el.closest<HTMLElement>("[data-tag]");
    if (tag?.dataset.tag) {
      event.preventDefault();
      ctx.searchTag(tag.dataset.tag);
      return true;
    }
    return false;
  },
});

/**
 * Autocompletion source for `[[`. Offers every note by title, inserting the
 * file stem (or the vault path when two notes share a stem) plus `]]`.
 */
export function wikiCompletion(context: CompletionContext): CompletionResult | null {
  const ctx = context.state.facet(linkContext);
  // Text between the last "[[" and the cursor, if we're inside one.
  const match = context.matchBefore(/\[\[[^[\]|\n]*/);
  if (!ctx || !match) return null;

  // Count stems so ambiguous names get their full path inserted.
  const stemCount = new Map<string, number>();
  const stemOf = (p: string) => p.slice(p.lastIndexOf("/") + 1).replace(/\.(md|markdown)$/i, "");
  for (const n of ctx.noteList) stemCount.set(stemOf(n.path), (stemCount.get(stemOf(n.path)) ?? 0) + 1);

  // Skip auto-inserting "]]" if they're already right after the cursor.
  const closes = context.state.sliceDoc(context.pos, context.pos + 2) === "]]";
  const options: Completion[] = ctx.noteList.map((n) => {
    const stem = stemOf(n.path);
    const insert = (stemCount.get(stem) ?? 0) > 1 ? n.path.replace(/\.(md|markdown)$/i, "") : stem;
    return {
      label: insert,
      detail: n.title !== stem ? n.title : undefined,
      apply: closes ? insert : `${insert}]]`,
      type: "text",
    };
  });
  return {
    from: match.from + 2, // after the "[["
    options,
    // Keep filtering client-side while typing word characters.
    validFor: /^[^[\]|\n]*$/,
  };
}

/** Everything link-related, ready to drop into an editor's extensions. */
export const wikiLinks = [linkPlugin, clickHandler];
