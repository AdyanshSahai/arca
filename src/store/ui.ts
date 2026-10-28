// Transient UI state: the sidebar drawer, modal prompts, toasts, and
// requests sent from keyboard shortcuts to the search panel.

import { create } from "zustand";
import { applyTheme, type ThemeId } from "../lib/themes";

/** The five drawer panels reachable from the left action rail. */
export type PanelId = "tree" | "graph" | "search" | "backlinks" | "postits";

/** Drawer snap points: ¼ of the window, ½, or the whole work area. */
export type DrawerSize = "quarter" | "half" | "full";

export type SearchMode = "files" | "text" | "topic";

/** User preferences, edited in the Settings dialog and saved with the layout. */
export interface Prefs {
  theme: ThemeId;
  /** Where rail views (graph, search…) open: straight into the sidebar, or ask. */
  viewPlacement: "sidebar" | "ask";
  /**
   * Notes opened from the sidebar/palette/pins: ask which pane only when
   * the tab is split, always ask, or just use the focused pane.
   */
  notePlacement: "ask-split" | "ask" | "focused";
}

export const DEFAULT_PREFS: Prefs = { theme: "twilight", viewPlacement: "sidebar", notePlacement: "ask-split" };

export type PaneChoice =
  | { kind: "note"; path: string; line?: number; create?: boolean }
  | { kind: "view"; view: PanelId };

export interface SearchState {
  mode: SearchMode;
  query: string;
  /** Text mode: only search the focused note's folder. */
  folderOnly: boolean;
  /** Match capitalisation exactly (files and text modes). */
  caseSensitive: boolean;
}

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
   * The search panel's state. It lives here, not in the component, so it
   * survives the panel closing and reopening instead of resetting (and
   * jumping) every time.
   */
  search: SearchState;
  /** Bumped when a shortcut asks the search input to take focus. */
  searchFocus: number;
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
  /**
   * Something waiting for the user to pick which pane it should take over
   * (shown as numbered overlays on the panes; see PaneView): a note opened
   * from outside the panes, or a sidebar view (graph, search…).
   */
  paneChoice: PaneChoice | null;
  prefs: Prefs;
  settingsOpen: boolean;
  /**
   * Reading mode, for the whole app: every note in every pane is rendered
   * read-only, with no markdown revealed. Off = writing mode.
   */
  reading: boolean;

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
  /** Opens the search panel in `mode`, optionally replacing the query, and focuses it. */
  requestSearch: (mode: SearchMode, query?: string) => void;
  setSearch: (patch: Partial<SearchState>) => void;
  dismissTextNotice: (path: string) => void;
  openPalette: (initial?: string) => void;
  askForPane: (choice: PaneChoice) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  toggleReading: () => void;

  openSettings: () => void;
  closeSettings: () => void;
  cancelPaneChoice: () => void;
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
  search: { mode: "files", query: "", folderOnly: false, caseSensitive: false },
  searchFocus: 0,
  dismissedTextNotices: new Set(),
  palette: null,
  paneChoice: null,
  prefs: DEFAULT_PREFS,
  settingsOpen: false,
  reading: false,

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
    set({
      panel: "search",
      search: { ...get().search, mode, ...(query !== undefined ? { query } : {}) },
      searchFocus: get().searchFocus + 1,
    }),
  setSearch: (patch) => set({ search: { ...get().search, ...patch } }),
  // A new Set each time so zustand subscribers see the change.
  openPalette: (initial = "") => set({ palette: initial }),
  askForPane: (paneChoice) => {
    // Take focus out of any editor or text box, so the number/letter keys
    // that answer the prompt reach the global handler instead of being
    // typed (or swallowed by an input method).
    (document.activeElement as HTMLElement | null)?.blur();
    set({ paneChoice });
  },
  cancelPaneChoice: () => set({ paneChoice: null }),
  setPrefs: (patch) => {
    const prefs = { ...get().prefs, ...patch };
    if (patch.theme) applyTheme(patch.theme);
    set({ prefs });
  },
  toggleReading: () => set({ reading: !get().reading }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openTemplatePicker: (dir) => set({ templatePicker: { dir } }),
  openExport: (scope) => set({ exportDialog: { scope } }),
  closeExport: () => set({ exportDialog: null }),
  closeTemplatePicker: () => set({ templatePicker: null }),
  closePalette: () => set({ palette: null }),
  dismissTextNotice: (path) => set({ dismissedTextNotices: new Set(get().dismissedTextNotices).add(path) }),
}));
