// Live EditorView instances by pane id, plus a tiny store for the status
// bar. Global shortcuts and sidebar panels use the registry to act on the
// focused editor (insert a post-it, jump to a line) without threading refs
// through React.

import type { EditorView } from "@codemirror/view";
import { create } from "zustand";

const views = new Map<string, EditorView>();

export const editorRegistry = {
  set: (paneId: string, view: EditorView) => void views.set(paneId, view),
  delete: (paneId: string) => void views.delete(paneId),
  get: (paneId: string) => views.get(paneId),
};

/** Cursor + size info for the status bar, reported by the focused editor. */
interface StatusState {
  line: number;
  col: number;
  words: number;
  /** Updates any subset of the fields. */
  set: (s: Partial<{ line: number; col: number; words: number }>) => void;
}

export const useStatus = create<StatusState>((set) => ({
  line: 1,
  col: 1,
  words: 0,
  set: (s) => set(s),
}));
