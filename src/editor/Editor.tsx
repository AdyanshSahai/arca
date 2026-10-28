// One CodeMirror 6 editor bound to one note buffer.
//
// Lifecycle:
//   - A new EditorView is created when the pane's note changes (the parent
//     keys this component by path), once the buffer has loaded.
//   - Local typing → `buffers.edit()` (debounced autosave).
//   - Outside changes (disk reload, sidebar post-it edit, another pane on the
//     same note) arrive via the buffer; the doc is swapped in place, tagged
//     with `External` so it isn't echoed back as an edit.
//   - Live/raw mode is a Compartment, so toggling keeps undo history and
//     scroll position.

import { autocompletion, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { syntaxHighlighting, foldKeymap } from "@codemirror/language";
import { languages } from "@codemirror/language-data";
import { highlightSelectionMatches, search, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorSelection, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, placeholder } from "@codemirror/view";
import { useEffect, useMemo, useRef } from "react";
import { followLink } from "../lib/actions";
import { assetUrl, handlePaste } from "../lib/attachments";
import { NoteIndex } from "../lib/links";
import { useBuffers } from "../store/buffers";
import type { EditorMode, Pane } from "../store/layout";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { livePreview } from "./livePreview";
import { postits } from "./postits";
import { richBlocks, richLive } from "./richBlocks";
import { tableKeymap } from "./tables";
import { editorRegistry, useStatus } from "./registry";
import { editorTheme, highlightStyle } from "./theme";
import { linkContext, livePreviewOn, refreshLinks, wikiCompletion, wikiLinks } from "./wikilinks";

/** Marks transactions that came from outside the editor (not user typing). */
const External = Annotation.define<boolean>();

/** Extensions that differ between live preview and raw markdown. */
function modeExtensions(mode: EditorMode) {
  return mode === "live"
    ? [livePreview, richLive, livePreviewOn.of(true), EditorView.editorAttributes.of({ class: "arca-live" })]
    : [highlightActiveLine(), EditorView.editorAttributes.of({ class: "arca-raw" })];
}

/**
 * Reader mode: no typing (readOnly) and no caret or IME (editable false).
 * Widgets that write to the doc check `state.readOnly` themselves, and
 * live preview never reveals markdown in a read-only document.
 */
function readOnlyExtensions(readOnly: boolean) {
  return [EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly)];
}

/** Counts words for the status bar (whitespace-separated runs). */
function countWords(text: string): number {
  const m = text.match(/\S+/g);
  return m ? m.length : 0;
}

interface Props {
  pane: Pane;
  path: string;
  focused: boolean;
  /** Reader mode: rendered, not editable, markdown never revealed. */
  readOnly?: boolean;
  /** Overrides what clicking a [[link]] does (the Reader navigates in place). */
  onFollow?: (target: string) => void;
}

export function Editor({ pane, path, focused, readOnly = false, onFollow }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  // One compartment per editor instance, created once.
  const modeComp = useMemo(() => new Compartment(), []);
  const ctxComp = useMemo(() => new Compartment(), []);
  const roComp = useMemo(() => new Compartment(), []);

  const buffer = useBuffers((s) => s.buffers[path]);
  const notes = useVault((s) => s.notes);
  const vaultRoot = useVault((s) => s.info?.root ?? "");

  // The link context changes whenever the vault's note list does.
  const linkCtx = useMemo(
    () => ({
      notes: new NoteIndex(notes),
      noteList: notes,
      follow: (target: string) => (onFollow ? onFollow(target) : void followLink(target, path)),
      searchTag: (tag: string) => useUi.getState().requestSearch("topic", `#${tag}`),
      notePath: path,
      assetUrl: (src: string) => assetUrl(vaultRoot, path, src),
    }),
    [notes, path, vaultRoot, onFollow],
  );

  // Keep the latest `focused` flag in a ref for the update listener below,
  // which is created once and would otherwise see a stale value.
  const focusedRef = useRef(focused);
  focusedRef.current = focused;

  // ---- Create the view once the buffer has loaded ----------------------
  const loaded = buffer?.loaded ?? false;
  useEffect(() => {
    if (!loaded || !host.current) return;
    const initial = useBuffers.getState().buffers[path]?.content ?? "";
    // An unwritten folder note gets an inviting hint instead of a blank page.
    const isNewFolderNote = useBuffers.getState().buffers[path]?.missing ?? false;

    // Start with the cursor at the end of the first line (normally the title)
    // instead of before its "# ", so the heading opens fully rendered.
    const firstLineEnd = initial.indexOf("\n") === -1 ? initial.length : initial.indexOf("\n");
    const state = EditorState.create({
      doc: initial,
      selection: EditorSelection.cursor(firstLineEnd),
      extensions: [
        history(),
        drawSelection(),
        search({ top: false }),
        highlightSelectionMatches(),
        EditorView.lineWrapping,
        markdown({ base: markdownLanguage, codeLanguages: languages }),
        placeholder(
          isNewFolderNote
            ? "Write an overview for this chapter… (the file is created when you start typing)"
            : "Start writing…",
        ),
        syntaxHighlighting(highlightStyle),
        editorTheme,
        autocompletion({ override: [wikiCompletion], icons: false }),
        // Ctrl+Alt+P (post-it) and other app shortcuts are global; see useKeybindings.
        keymap.of([
          ...completionKeymap,
          ...searchKeymap,
          ...historyKeymap,
          ...foldKeymap,
          ...defaultKeymap,
          // Tab moves between table cells; elsewhere it indents.
          ...tableKeymap,
          indentWithTab,
        ]),
        postits,
        wikiLinks,
        // Tables and display math (does nothing outside live preview).
        richBlocks,
        ctxComp.of(linkContext.of(linkCtx)),
        modeComp.of(modeExtensions(pane.mode)),
        roComp.of(readOnlyExtensions(readOnly)),
        // Pasting images saves them as attachments (lib/attachments.ts).
        EditorView.domEventHandlers({
          paste: (event, view) => !view.state.readOnly && handlePaste(view, path, event),
        }),
        // Push edits into the shared buffer and report cursor info.
        EditorView.updateListener.of((u) => {
          if (u.docChanged && !u.transactions.some((tr) => tr.annotation(External))) {
            useBuffers.getState().edit(path, u.state.doc.toString());
          }
          if (focusedRef.current && (u.docChanged || u.selectionSet)) {
            const head = u.state.selection.main.head;
            const line = u.state.doc.lineAt(head);
            useStatus.getState().set({
              line: line.number,
              col: head - line.from + 1,
              words: countWords(u.state.doc.toString()),
            });
          }
        }),
      ],
    });

    const view = new EditorView({ state, parent: host.current });
    viewRef.current = view;
    editorRegistry.set(pane.id, view);
    if (focusedRef.current) {
      view.focus();
      useStatus.getState().set({ line: 1, col: 1, words: countWords(initial) });
    }
    return () => {
      editorRegistry.delete(pane.id);
      view.destroy();
      viewRef.current = null;
    };
    // The view is (re)created only when the note or pane identity changes;
    // mode and link context are updated through compartments below.
  }, [loaded, path, pane.id]);

  // ---- Apply outside content changes ------------------------------------
  // Two triggers: `externalRev` (disk / sidebar) and plain `content` changes
  // made by *another pane* showing the same note.
  const content = buffer?.content;
  const externalRev = buffer?.externalRev;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || content === undefined) return;
    const current = view.state.doc.toString();
    if (current === content) return; // our own keystroke, already in the doc
    // Keep the cursor roughly where it was, clamped to the new length.
    const head = Math.min(view.state.selection.main.head, content.length);
    view.dispatch({
      changes: { from: 0, to: current.length, insert: content },
      selection: EditorSelection.cursor(head),
      annotations: External.of(true),
    });
  }, [content, externalRev]);

  // ---- Mode toggle (live ↔ raw) -----------------------------------------
  useEffect(() => {
    viewRef.current?.dispatch({ effects: modeComp.reconfigure(modeExtensions(pane.mode)) });
  }, [pane.mode, modeComp]);

  // ---- Edit / read toggle -------------------------------------------------
  useEffect(() => {
    viewRef.current?.dispatch({ effects: roComp.reconfigure(readOnlyExtensions(readOnly)) });
  }, [readOnly, roComp]);

  // ---- Note list changed: refresh chip states and completion ------------
  useEffect(() => {
    viewRef.current?.dispatch({ effects: [ctxComp.reconfigure(linkContext.of(linkCtx)), refreshLinks.of(null)] });
  }, [linkCtx, ctxComp]);

  // ---- Jump-to-line requests (from backlinks, post-its, search) --------
  const reveal = pane.reveal;
  useEffect(() => {
    const view = viewRef.current;
    if (!view || !reveal) return;
    const n = Math.min(Math.max(reveal.line, 1), view.state.doc.lines);
    const line = view.state.doc.line(n);
    view.dispatch({
      selection: EditorSelection.cursor(line.from),
      effects: EditorView.scrollIntoView(line.from, { y: "center" }),
    });
    view.focus();
  }, [reveal, loaded]);

  // ---- Focus the editor when its pane becomes the focused one -----------
  useEffect(() => {
    // Only take focus if it's sitting on <body> (e.g. after switching tabs),
    // never away from an input the user is typing in.
    if (focused && viewRef.current && document.activeElement === document.body) viewRef.current.focus();
  }, [focused]);

  if (buffer?.error) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-xs text-muted">
        Could not open {path}: {buffer.error}
      </div>
    );
  }
  return <div ref={host} className="h-full overflow-hidden" />;
}
