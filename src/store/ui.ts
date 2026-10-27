// Transient UI state: the sidebar drawer, modal prompts, toasts, and
// requests sent from keyboard shortcuts to the search panel.

import { create } from "zustand";

/** The five drawer panels reachable from the left action rail. */
export type PanelId = "tree" | "graph" | "search" | "backlinks" | "postits";

/** Drawer snap points: ¼ of the window, ½, or the whole work area. */
export type DrawerSize = "quarter" | "half" | "full";

export type SearchMode = "files" | "text" | "topic";

/** A modal text prompt (new note, rename…) or a yes/no confirmation. */
export type Dialog =
  | {
      kind: "prompt";
      title: string;
      label?: string;
      initial: string;
      /** Characters to pre-select in the input, e.g. the name without ".md". */
      selectRange?: [number, number];
      confirmText: string;
      onSubmit: (value: string) => void | Promise<void>;
    }
  | {
      kind: "confirm";
      title: string;
      message: string;
      confirmText: string;
      danger?: boolean;
      onConfirm: () => void | Promise<void>;
    };

export interface Toast {
  id: number;
  text: string;
  tone: "info" | "error";
}

interface UiState {
  panel: PanelId | null;
  drawerSize: DrawerSize;
  dialog: Dialog | null;
  toasts: Toast[];
  /**
   * A request for the search panel to switch mode / prefill / focus. The
   * `nonce` changes on every request so the panel reacts even when the same
   * mode is asked for twice in a row.
   */
  searchRequest: { mode: SearchMode; query?: string; nonce: number } | null;
  /**
   * Command palette: null when closed, otherwise the text it opened with
   * (">" = actions only).
   */
  palette: string | null;
  /**
   * Export dialog: null when closed, else the scope to preselect
   * ("" = vault, a folder, or a note path; undefined = decide from focus).
   */
  exportDialog: { scope?: string } | null;
  /** Template picker: null when closed, else the folder to create the note in. */
  templatePicker: { dir: string } | null;
  /** Text files whose "convert to Markdown?" notice was dismissed this session. */
  dismissedTextNotices: Set<string>;

  /** Opens a panel; opening the one already shown closes the drawer. */
  togglePanel: (panel: PanelId) => void;
  showPanel: (panel: PanelId) => void;
  closeDrawer: () => void;
  setDrawerSize: (size: DrawerSize) => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (text: string, tone?: Toast["tone"]) => void;
  dismissToast: (id: number) => void;
  requestSearch: (mode: SearchMode, query?: string) => void;
  dismissTextNotice: (path: string) => void;
  openPalette: (initial?: string) => void;
  openTemplatePicker: (dir: string) => void;
  openExport: (scope?: string) => void;
  closeExport: () => void;
  closeTemplatePicker: () => void;
  closePalette: () => void;
}

/** Monotonic id source for toasts. */
let toastSeq = 0;

export const useUi = create<UiState>((set, get) => ({
  panel: "tree",
  drawerSize: "quarter",
  dialog: null,
  toasts: [],
  searchRequest: null,
  dismissedTextNotices: new Set(),
  palette: null,
  templatePicker: null,
  exportDialog: null,

  togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
  showPanel: (panel) => set({ panel }),
  closeDrawer: () => set({ panel: null }),
  setDrawerSize: (drawerSize) => set({ drawerSize }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast: (text, tone = "info") => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone }] });
    // Errors linger longer so there is time to read them.
    setTimeout(() => get().dismissToast(id), tone === "error" ? 6000 : 2800);
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  requestSearch: (mode, query) =>
    set({ panel: "search", searchRequest: { mode, query, nonce: Date.now() } }),
  // A new Set each time so zustand subscribers see the change.
  openPalette: (initial = "") => set({ palette: initial }),
  openTemplatePicker: (dir) => set({ templatePicker: { dir } }),
  openExport: (scope) => set({ exportDialog: { scope } }),
  closeExport: () => set({ exportDialog: null }),
  closeTemplatePicker: () => set({ templatePicker: null }),
  closePalette: () => set({ palette: null }),
  dismissTextNotice: (path) => set({ dismissedTextNotices: new Set(get().dismissedTextNotices).add(path) }),
}));
