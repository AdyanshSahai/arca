// Transient UI state: the sidebar drawer, modal prompts, toasts, and
// requests sent from keyboard shortcuts to the search panel.

import { create } from "zustand";
import { applyPalette, type Palette, paletteFor, type ThemeId } from "../lib/themes";

/** The five drawer panels reachable from the left action rail. */
export type PanelId = "tree" | "graph" | "search" | "backlinks" | "postits";

/** Drawer snap points: ¼ of the window, ½, or the whole work area. */
export type DrawerSize = "quarter" | "half" | "full";

export type SearchMode = "files" | "text" | "topic";

/** User preferences, edited in the Settings dialog and saved with the layout. */
export interface Prefs {
  /** A preset scheme, or "custom" (the colours in `customColors`). */
  theme: ThemeId | "custom";
  /** The user's own 8 colours (Settings → Appearance → Custom). */
  customColors: Partial<Palette> | null;
  /**
   * Autosave (default on): notes are written to disk shortly after you stop
   * typing, and whenever the window loses focus. Off: save with Ctrl+S;
   * unsaved notes stay open and Arca asks before closing.
   */
  autosave: boolean;
  /**
   * Version history (git, notes only): a snapshot of the vault every few
   * minutes for the Time Machine. Off by default; chosen in the first-run
   * walkthrough or Settings → Saving.
   */
  history: boolean;
  /** Push history to the backup remote after each snapshot. */
  historyAutoPush: boolean;
  /** The first-run walkthrough has been completed (or skipped). */
  onboarded: boolean;
  /** Where rail views (graph, search…) open: straight into the sidebar, or ask. */
  viewPlacement: "sidebar" | "ask";
  /**
   * Notes opened from the sidebar/palette/pins: ask which pane only when
   * the tab is split, always ask, or just use the focused pane.
   */
  notePlacement: "ask-split" | "ask" | "focused";
}

export const DEFAULT_PREFS: Prefs = {
  theme: "twilight",
  customColors: null,
  autosave: true,
  history: false,
  historyAutoPush: false,
  onboarded: false,
  viewPlacement: "sidebar",
  notePlacement: "ask-split",
};

/** Graph view settings, kept here so they survive the panel closing. */
export interface GraphPrefs {
  /** How many links away from the active note to show (1–3). */
  depth: number;
  /** Show links to notes that don't exist yet. */
  ghosts: boolean;
}

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
      /** A message with several buttons, e.g. Save all / Don't save / Cancel. */
      kind: "choice";
      title: string;
      message: string;
      /** Rendered left to right; the last one is the default (Enter). */
      choices: { label: string; tone?: "plain" | "primary" | "danger"; onSelect: () => void | Promise<void> }[];
      /** False = Escape / clicking outside don't close it; a button must be picked. */
      dismissable?: boolean;
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
  /** Optional button, e.g. "Undo" after a rename. */
  action?: { label: string; run: () => void };
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
  graph: GraphPrefs;

  /** Text files whose "convert to Markdown?" notice was dismissed this session. */
  dismissedTextNotices: Set<string>;

  /** Opens a panel; opening the one already shown closes the drawer. */
  togglePanel: (panel: PanelId) => void;
  showPanel: (panel: PanelId) => void;
  closeDrawer: () => void;
  setDrawerSize: (size: DrawerSize) => void;
  openDialog: (dialog: Dialog) => void;
  closeDialog: () => void;
  toast: (text: string, tone?: Toast["tone"], action?: Toast["action"]) => void;
  dismissToast: (id: number) => void;
  /** Opens the search panel in `mode`, optionally replacing the query, and focuses it. */
  requestSearch: (mode: SearchMode, query?: string) => void;
  setSearch: (patch: Partial<SearchState>) => void;
  dismissTextNotice: (path: string) => void;
  openPalette: (initial?: string) => void;
  askForPane: (choice: PaneChoice) => void;
  setPrefs: (patch: Partial<Prefs>) => void;
  /** The Trash window (restore or permanently delete trashed notes). */
  trashOpen: boolean;
  /**
   * The Time Machine window: null when closed; `path` set = history of
   * just that note.
   */
  timeMachine: { path?: string } | null;
  openTimeMachine: (path?: string) => void;
  closeTimeMachine: () => void;
  openTrash: () => void;
  closeTrash: () => void;
  toggleReading: () => void;
  setGraph: (patch: Partial<GraphPrefs>) => void;

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
  trashOpen: false,
  timeMachine: null,
  reading: false,
  graph: { depth: 1, ghosts: true },

  templatePicker: null,
  exportDialog: null,

  togglePanel: (panel) => set({ panel: get().panel === panel ? null : panel }),
  showPanel: (panel) => set({ panel }),
  closeDrawer: () => set({ panel: null }),
  setDrawerSize: (drawerSize) => set({ drawerSize }),
  openDialog: (dialog) => set({ dialog }),
  closeDialog: () => set({ dialog: null }),

  toast: (text, tone = "info", action) => {
    const id = ++toastSeq;
    set({ toasts: [...get().toasts, { id, text, tone, action }] });
    // Errors and toasts with a button linger longer, so there's time to act.
    setTimeout(() => get().dismissToast(id), tone === "error" || action ? 8000 : 2800);
  },
  openTrash: () => set({ trashOpen: true }),
  openTimeMachine: (path) => set({ timeMachine: { path } }),
  closeTimeMachine: () => set({ timeMachine: null }),
  closeTrash: () => set({ trashOpen: false }),
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
    if (patch.theme || patch.customColors) applyPalette(paletteFor(prefs.theme, prefs.customColors));
    set({ prefs });
  },
  toggleReading: () => set({ reading: !get().reading }),
  setGraph: (patch) => set({ graph: { ...get().graph, ...patch } }),
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
  openTemplatePicker: (dir) => set({ templatePicker: { dir } }),
  openExport: (scope) => set({ exportDialog: { scope } }),
  closeExport: () => set({ exportDialog: null }),
  closeTemplatePicker: () => set({ templatePicker: null }),
  closePalette: () => set({ palette: null }),
  dismissTextNotice: (path) => set({ dismissedTextNotices: new Set(get().dismissedTextNotices).add(path) }),
}));
