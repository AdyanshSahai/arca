// Tabs and split panes, modelled on Konsole.
//
// Each top-bar *tab* owns a binary tree of *splits*. The leaves are *panes*,
// and every pane shows one note in its own editor:
//
//   Tab ── split(row) ─┬─ pane A  (hardware/cpu.md)
//                      └─ split(col) ─┬─ pane B  (index.md)
//                                     └─ pane C  (index.md, raw mode)
//
// Ctrl+Shift+( splits the focused pane left/right ("row"), Ctrl+Shift+)
// splits it top/bottom ("col"). As in Konsole, the new pane starts on the
// same document. The tab's title follows its focused pane.

import { create } from "zustand";
import { remapPath, isWithin } from "../lib/paths";
import { useBuffers } from "./buffers";
import { type PanelId, useUi } from "./ui";

export type EditorMode = "live" | "raw";
export type SplitDir = "row" | "col";

export interface Pane {
  id: string;
  /** Note shown in this pane, or null for an empty pane. */
  path: string | null;
  mode: EditorMode;
  /** Read mode: the note can be viewed and navigated but not changed. */
  readOnly?: boolean;
  /**
   * A sidebar view shown in this pane instead of a note (graph, search…).
   * When set, `path` is null.
   */
  view?: PanelId | null;
  /** One-shot request to scroll to a 1-based line once the note is shown. */
  reveal?: { line: number; nonce: number };
}

export type LayoutNode =
  | { kind: "pane"; paneId: string }
  | { kind: "split"; id: string; dir: SplitDir; ratio: number; a: LayoutNode; b: LayoutNode };

export interface Tab {
  id: string;
  root: LayoutNode;
  focusedPane: string;
}

interface LayoutState {
  tabs: Tab[];
  activeTab: string;
  panes: Record<string, Pane>;
  /**
   * The pane the user last worked on a note in. Views (backlinks, local
   * graph…) follow this note even while a view pane itself has focus.
   */
  contextPane: string | null;

  /**
   * Opens a note in the focused pane, or in a new tab with `newTab`.
   * `create` allows a path that doesn't exist yet (folder notes); the file
   * is written on the first keystroke. With `pick`, a tab with several
   * panes first asks which pane the note should take over.
   */
  openNote: (path: string, opts?: OpenOpts) => void;
  /** Opens a note in a specific pane (the answer to a pane prompt). */
  openNoteIn: (paneId: string, path: string, opts?: OpenOpts) => void;
  /** Shows a sidebar view in a pane, replacing its note. */
  openViewIn: (paneId: string, view: PanelId) => void;
  /** Turns a view pane back into an empty pane (the view goes back to the drawer). */
  clearView: (paneId: string) => void;
  newTab: (path?: string | null) => void;
  closeTab: (tabId: string) => void;
  /** Ctrl+Tab / Ctrl+Shift+Tab. */
  cycleTab: (delta: 1 | -1) => void;
  activateTab: (tabId: string) => void;
  /** Splits the focused pane of the active tab. */
  split: (dir: SplitDir) => void;
  /**
   * Moves a pane (with its note and mode) into another tab, docking it on
   * the right of that tab's layout, or into a brand-new tab ("new"). The
   * source tab closes if it was the pane's only home. Focus follows the pane.
   */
  movePane: (paneId: string, target: string | "new") => void;
  /** Moves the focused pane to the previous / next tab (a new tab past the end). */
  movePaneBy: (delta: 1 | -1) => void;
  /** Closes a pane; the sibling takes its place. Closing the last pane closes the tab. */
  closePane: (paneId: string) => void;
  focusPane: (paneId: string) => void;
  setRatio: (splitId: string, ratio: number) => void;
  toggleMode: (paneId: string) => void;
  /** Switches a pane between editing and read-only. */
  toggleReadOnly: (paneId: string) => void;
  /** Updates every pane after a file or folder rename. */
  remap: (from: string, to: string) => void;
  /** Empties panes showing a deleted file (or anything in a deleted folder). */
  forget: (path: string) => void;
  /** Serializable snapshot for persistence. */
  snapshot: () => LayoutSnapshot;
  restore: (snap: LayoutSnapshot) => void;
}

export interface OpenOpts {
  newTab?: boolean;
  line?: number;
  create?: boolean;
  /** Ask which pane to use when the active tab is split (sidebar, palette, pins). */
  pick?: boolean;
}

export interface LayoutSnapshot {
  tabs: Tab[];
  activeTab: string;
  panes: Record<string, Pane>;
}

/** Short random ids; collisions inside one session are practically impossible. */
const uid = () => Math.random().toString(36).slice(2, 10);

function makePane(path: string | null, mode: EditorMode = "live"): Pane {
  return { id: uid(), path, mode };
}

/** Every pane id in a layout tree, in visual order (left/top first). */
export function paneIds(node: LayoutNode): string[] {
  return node.kind === "pane" ? [node.paneId] : [...paneIds(node.a), ...paneIds(node.b)];
}

/** Returns a copy of `node` with the leaf `paneId` replaced by `replacement`. */
function replaceLeaf(node: LayoutNode, paneId: string, replacement: LayoutNode): LayoutNode {
  if (node.kind === "pane") return node.paneId === paneId ? replacement : node;
  return { ...node, a: replaceLeaf(node.a, paneId, replacement), b: replaceLeaf(node.b, paneId, replacement) };
}

/**
 * Removes leaf `paneId`, letting its sibling take over the parent split.
 * Returns null if the tree was just that leaf.
 */
function removeLeaf(node: LayoutNode, paneId: string): LayoutNode | null {
  if (node.kind === "pane") return node.paneId === paneId ? null : node;
  const a = removeLeaf(node.a, paneId);
  const b = removeLeaf(node.b, paneId);
  if (a === null) return b; // left side vanished: collapse to the right
  if (b === null) return a;
  return { ...node, a, b };
}

/** Copy of the tree with split `id` given a new ratio. */
function withRatio(node: LayoutNode, id: string, ratio: number): LayoutNode {
  if (node.kind === "pane") return node;
  if (node.id === id) return { ...node, ratio };
  return { ...node, a: withRatio(node.a, id, ratio), b: withRatio(node.b, id, ratio) };
}

export const useLayout = create<LayoutState>((set, get) => {
  /** The tab currently shown. */
  const active = () => get().tabs.find((t) => t.id === get().activeTab)!;

  /** Replaces one tab in the list. */
  const putTab = (tab: Tab) => set({ tabs: get().tabs.map((t) => (t.id === tab.id ? tab : t)) });

  /** Keeps only the buffers some pane still shows (unsaved text is flushed first). */
  const gcBuffers = () => {
    const used = new Set(
      Object.values(get().panes)
        .map((p) => p.path)
        .filter((p): p is string => p !== null),
    );
    useBuffers.getState().retainOnly(used);
  };

  // Start with one tab holding one empty pane.
  const first = makePane(null);
  const firstTab: Tab = { id: uid(), root: { kind: "pane", paneId: first.id }, focusedPane: first.id };

  return {
    tabs: [firstTab],
    activeTab: firstTab.id,
    panes: { [first.id]: first },
    contextPane: null,

    openNote: (path, opts) => {
      // Split tab + opened from outside the panes: let the user choose
      // which pane takes the note instead of silently replacing one.
      if (opts?.pick && !opts.newTab && paneIds(active().root).length > 1) {
        useUi.getState().askForPane({ kind: "note", path, line: opts.line, create: opts.create });
        return;
      }
      if (opts?.newTab) {
        get().newTab(path);
      } else {
        const paneId = active().focusedPane;
        const pane = get().panes[paneId];
        // A note always replaces a view shown in the pane.
        set({ panes: { ...get().panes, [paneId]: { ...pane, path, view: null } }, contextPane: paneId });
      }
      void useBuffers.getState().ensure(path, { allowMissing: opts?.create });
      if (opts?.line) {
        // The pane that just got the note is the focused one in the active tab.
        const paneId = active().focusedPane;
        const pane = get().panes[paneId];
        set({ panes: { ...get().panes, [paneId]: { ...pane, reveal: { line: opts.line, nonce: Date.now() } } } });
      }
      gcBuffers();
    },

    openViewIn: (paneId, view) => {
      useUi.getState().cancelPaneChoice();
      const pane = get().panes[paneId];
      if (!pane) return;
      set({ panes: { ...get().panes, [paneId]: { ...pane, view, path: null } } });
      get().focusPane(paneId);
      // The view now lives in a pane; the drawer doesn't need to show it too.
      if (useUi.getState().panel === view) useUi.getState().closeDrawer();
      gcBuffers();
    },

    clearView: (paneId) => {
      const pane = get().panes[paneId];
      if (!pane) return;
      set({ panes: { ...get().panes, [paneId]: { ...pane, view: null } } });
    },

    openNoteIn: (paneId, path, opts) => {
      useUi.getState().cancelPaneChoice();
      get().focusPane(paneId);
      get().openNote(path, { ...opts, pick: false });
    },

    newTab: (path = null) => {
      const pane = makePane(path);
      const tab: Tab = { id: uid(), root: { kind: "pane", paneId: pane.id }, focusedPane: pane.id };
      // Insert right after the current tab, like browsers and Konsole.
      const idx = get().tabs.findIndex((t) => t.id === get().activeTab);
      const tabs = [...get().tabs];
      tabs.splice(idx + 1, 0, tab);
      set({ tabs, activeTab: tab.id, panes: { ...get().panes, [pane.id]: pane } });
      if (path) void useBuffers.getState().ensure(path);
    },

    closeTab: (tabId) => {
      const { tabs, panes } = get();
      const idx = tabs.findIndex((t) => t.id === tabId);
      if (idx === -1) return;
      const nextPanes = { ...panes };
      for (const id of paneIds(tabs[idx].root)) delete nextPanes[id];
      const remaining = tabs.filter((t) => t.id !== tabId);
      if (remaining.length === 0) {
        // Never leave the window without a tab: replace with a fresh empty one.
        const pane = makePane(null);
        const tab: Tab = { id: uid(), root: { kind: "pane", paneId: pane.id }, focusedPane: pane.id };
        set({ tabs: [tab], activeTab: tab.id, panes: { ...nextPanes, [pane.id]: pane } });
      } else {
        // Activate the neighbour that slid into the closed tab's slot.
        const activeTab =
          get().activeTab === tabId ? remaining[Math.min(idx, remaining.length - 1)].id : get().activeTab;
        set({ tabs: remaining, activeTab, panes: nextPanes });
      }
      gcBuffers();
    },

    cycleTab: (delta) => {
      const { tabs, activeTab } = get();
      const idx = tabs.findIndex((t) => t.id === activeTab);
      // `+ tabs.length` keeps the modulo positive when going backwards.
      set({ activeTab: tabs[(idx + delta + tabs.length) % tabs.length].id });
    },

    activateTab: (activeTab) => set({ activeTab }),

    split: (dir) => {
      const tab = active();
      const current = get().panes[tab.focusedPane];
      // The new pane copies the note, live/raw mode and edit/read setting.
      const fresh = { ...makePane(current.path, current.mode), readOnly: current.readOnly };
      const node: LayoutNode = {
        kind: "split",
        id: uid(),
        dir,
        ratio: 0.5,
        a: { kind: "pane", paneId: current.id },
        b: { kind: "pane", paneId: fresh.id },
      };
      set({ panes: { ...get().panes, [fresh.id]: fresh } });
      // Focus moves to the new pane, as in Konsole.
      putTab({ ...tab, root: replaceLeaf(tab.root, current.id, node), focusedPane: fresh.id });
    },

    movePane: (paneId, target) => {
      const { tabs } = get();
      const srcIdx = tabs.findIndex((t) => paneIds(t.root).includes(paneId));
      if (srcIdx === -1) return;
      const src = tabs[srcIdx];
      if (target === src.id) return;
      const rest = removeLeaf(src.root, paneId);
      // A lone pane "moved" to a new tab would just be the same tab again.
      if (rest === null && target === "new") return;

      const leaf: LayoutNode = { kind: "pane", paneId };
      let next = [...tabs];
      let activeTab: string;
      if (target === "new") {
        const tab: Tab = { id: uid(), root: leaf, focusedPane: paneId };
        next.splice(srcIdx + 1, 0, tab);
        activeTab = tab.id;
      } else {
        // Dock on the right of the target tab's whole layout.
        next = next.map((t) =>
          t.id === target
            ? { ...t, root: { kind: "split", id: uid(), dir: "row", ratio: 0.5, a: t.root, b: leaf }, focusedPane: paneId }
            : t,
        );
        activeTab = target;
      }
      // Shrink (or drop) the source tab.
      next =
        rest === null
          ? next.filter((t) => t.id !== src.id)
          : next.map((t) =>
              t.id === src.id
                ? { ...t, root: rest, focusedPane: t.focusedPane === paneId ? paneIds(rest)[0] : t.focusedPane }
                : t,
            );
      set({ tabs: next, activeTab });
    },

    movePaneBy: (delta) => {
      const { tabs, activeTab } = get();
      const idx = tabs.findIndex((t) => t.id === activeTab);
      const paneId = tabs[idx]?.focusedPane;
      if (!paneId) return;
      const dest = tabs[idx + delta];
      // Past the last tab = a new tab; before the first does nothing.
      if (dest) get().movePane(paneId, dest.id);
      else if (delta === 1) get().movePane(paneId, "new");
    },

    closePane: (paneId) => {
      const tab = get().tabs.find((t) => paneIds(t.root).includes(paneId));
      if (!tab) return;
      const root = removeLeaf(tab.root, paneId);
      if (root === null) {
        get().closeTab(tab.id);
        return;
      }
      const panes = { ...get().panes };
      delete panes[paneId];
      set({ panes });
      const focusedPane = tab.focusedPane === paneId ? paneIds(root)[0] : tab.focusedPane;
      putTab({ ...tab, root, focusedPane });
      gcBuffers();
    },

    focusPane: (paneId) => {
      const tab = get().tabs.find((t) => paneIds(t.root).includes(paneId));
      if (tab && tab.focusedPane !== paneId) putTab({ ...tab, focusedPane: paneId });
      // Focusing a note pane makes it the context for views.
      if (get().panes[paneId]?.path && get().contextPane !== paneId) set({ contextPane: paneId });
    },

    setRatio: (splitId, ratio) => {
      // Clamp so neither side can be dragged to nothing.
      const r = Math.min(0.9, Math.max(0.1, ratio));
      set({ tabs: get().tabs.map((t) => ({ ...t, root: withRatio(t.root, splitId, r) })) });
    },

    toggleReadOnly: (paneId) => {
      const pane = get().panes[paneId];
      if (!pane) return;
      set({ panes: { ...get().panes, [paneId]: { ...pane, readOnly: !pane.readOnly } } });
    },

    toggleMode: (paneId) => {
      const pane = get().panes[paneId];
      if (!pane) return;
      set({ panes: { ...get().panes, [paneId]: { ...pane, mode: pane.mode === "live" ? "raw" : "live" } } });
    },

    remap: (from, to) => {
      const panes = { ...get().panes };
      for (const [id, pane] of Object.entries(panes)) {
        const next = pane.path && remapPath(pane.path, from, to);
        if (next) panes[id] = { ...pane, path: next };
      }
      set({ panes });
    },

    forget: (path) => {
      const panes = { ...get().panes };
      for (const [id, pane] of Object.entries(panes)) {
        if (pane.path && isWithin(pane.path, path)) panes[id] = { ...pane, path: null };
      }
      set({ panes });
      gcBuffers();
    },

    snapshot: () => {
      const { tabs, activeTab, panes } = get();
      // Drop one-shot reveal requests; they mean nothing after a restart.
      const clean = Object.fromEntries(Object.entries(panes).map(([id, p]) => [id, { ...p, reveal: undefined }]));
      return { tabs, activeTab, panes: clean };
    },

    restore: (snap) => {
      // Basic sanity check: every pane referenced by a tab must exist.
      const ok =
        snap.tabs.length > 0 &&
        snap.tabs.every((t) => paneIds(t.root).every((id) => snap.panes[id])) &&
        snap.tabs.some((t) => t.id === snap.activeTab);
      if (!ok) return;
      set({ tabs: snap.tabs, activeTab: snap.activeTab, panes: snap.panes });
      for (const pane of Object.values(snap.panes)) {
        if (pane.path) void useBuffers.getState().ensure(pane.path);
      }
    },
  };
});

/** The focused pane of the active tab (what the status bar, backlinks etc. follow). */
export function useFocusedPane(): Pane | undefined {
  return useLayout((s) => {
    const tab = s.tabs.find((t) => t.id === s.activeTab);
    return tab ? s.panes[tab.focusedPane] : undefined;
  });
}

/**
 * The pane holding the note the user is working on: the focused pane if it
 * shows a note, otherwise the last note pane they used. Views (backlinks,
 * local graph, "this folder" search…) follow this, so clicking into a view
 * pane doesn't make them lose track of the note.
 */
function pickContext(s: LayoutState): Pane | undefined {
  const tab = s.tabs.find((t) => t.id === s.activeTab);
  const focused = tab ? s.panes[tab.focusedPane] : undefined;
  if (focused?.path) return focused;
  const ctx = s.contextPane ? s.panes[s.contextPane] : undefined;
  return ctx?.path ? ctx : focused;
}

export function useContextPane(): Pane | undefined {
  return useLayout(pickContext);
}

/** Non-hook variant of useContextPane. */
export function contextPane(): Pane | undefined {
  return pickContext(useLayout.getState());
}

/** Non-hook variant for event handlers. */
export function focusedPane(): Pane | undefined {
  const s = useLayout.getState();
  const tab = s.tabs.find((t) => t.id === s.activeTab);
  return tab ? s.panes[tab.focusedPane] : undefined;
}
