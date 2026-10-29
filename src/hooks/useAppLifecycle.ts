// App-wide side effects that don't belong to any one component:
//
//   - startup: reopen the last vault and restore the saved layout,
//   - live sync: react to `vault:changed` events from the Rust watcher,
//   - persistence: save drawer + tab/split layout (debounced),
//   - shutdown: flush unsaved notes before the window closes.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { editorRegistry } from "../editor/registry";
import { attachDroppedFiles } from "../lib/attachments";
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { PROFILING } from "../lib/perf";
import { useBuffers } from "../store/buffers";
import { type LayoutSnapshot, useLayout } from "../store/layout";
import { DEFAULT_PREFS, type DrawerSize, type PanelId, type Prefs, useUi } from "../store/ui";
import { useVault } from "../store/vault";

/** What we store in the opaque `ui` blob in settings.json. */
interface SavedUi {
  /** Vault the layout belongs to; a layout is only restored for the same vault. */
  vault?: string;
  panel?: PanelId | null;
  drawerSize?: DrawerSize;
  /** User preferences (theme, where things open). Not tied to a vault. */
  prefs?: Partial<Prefs>;
  /** App-wide reading mode. */
  reading?: boolean;
  layout?: LayoutSnapshot;
}

/** Wait this long after the last layout change before writing settings. */
const SAVE_DEBOUNCE_MS = 800;

/**
 * The startup promise, shared so React StrictMode's double-run of effects in
 * development doesn't open the vault twice.
 */
let bootstrap: Promise<void> | null = null;

/** Runs startup once; returns `true` while it is still in progress. */
export function useBootstrap(): boolean {
  const [booting, setBooting] = useState(true);
  useEffect(() => {
    bootstrap ??= (async () => {
      try {
        const { vaultPath, ui } = await ipc.appState();
        const saved = (ui ?? {}) as SavedUi;
        // Preferences first, so the right theme is on before anything paints.
        useUi.getState().setPrefs({ ...DEFAULT_PREFS, ...saved.prefs });
        if (saved.reading) useUi.setState({ reading: true });
        if (saved.drawerSize) useUi.getState().setDrawerSize(saved.drawerSize);
        if (saved.panel !== undefined) {
          if (saved.panel) useUi.getState().showPanel(saved.panel);
          else useUi.getState().closeDrawer();
        }
        // A profiling run opens its own scratch vault (lib/profileRun.ts).
        if (vaultPath && !PROFILING && (await useVault.getState().open(vaultPath))) {
          const root = useVault.getState().info?.root;
          if (saved.layout && saved.vault === root) useLayout.getState().restore(saved.layout);
        }
      } catch {
        // No readable settings: start fresh on the welcome screen.
      }
    })();
    void bootstrap.finally(() => setBooting(false));
  }, []);
  return booting;
}

/** Applies outside file changes reported by the Rust watcher. */
export function useVaultEvents() {
  useEffect(() => {
    // `listen` resolves to an unsubscribe function.
    const unlisten = listen<{ paths: string[] }>("vault:changed", async ({ payload }) => {
      await useVault.getState().refresh();
      const buffers = useBuffers.getState();
      for (const p of payload.paths) {
        if (buffers.buffers[p]) await buffers.reloadFromDisk(p);
      }
    });
    // First save of a new folder note: refresh so the tree picks it up.
    const onCreated = () => void useVault.getState().refresh();
    window.addEventListener("arca:files-created", onCreated);
    return () => {
      void unlisten.then((off) => off());
      window.removeEventListener("arca:files-created", onCreated);
    };
  }, []);
}

/**
 * Files dropped from the file manager onto an editor become attachments of
 * that note, inserted where they were dropped. Tauri delivers OS drops as
 * native events with file paths (the webview never sees the files).
 */
export function useFileDrops() {
  useEffect(() => {
    const off = getCurrentWebview().onDragDropEvent(async (event) => {
      if (event.payload.type !== "drop" || event.payload.paths.length === 0) return;
      // Native positions are physical pixels; the DOM uses CSS pixels.
      const x = event.payload.position.x / window.devicePixelRatio;
      const y = event.payload.position.y / window.devicePixelRatio;
      const paneEl = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-pane-id]");
      const paneId = paneEl?.dataset.paneId;
      const pane = paneId ? useLayout.getState().panes[paneId] : undefined;
      const view = paneId ? editorRegistry.get(paneId) : undefined;
      if (useUi.getState().reading) {
        useUi.getState().toast("Switch to writing mode (Ctrl+Shift+E) to attach files");
        return;
      }
      if (!pane?.path || !view) {
        useUi.getState().toast("Drop files onto an open note to attach them");
        return;
      }
      const pos = view.posAtCoords({ x, y }) ?? view.state.selection.main.head;
      await attachDroppedFiles(view, pane.path, event.payload.paths, pos);
    });
    return () => {
      void off.then((f) => f());
    };
  }, []);
}

/** Persists layout + drawer state and flushes notes on window close. */
export function usePersistence() {
  useEffect(() => {
    // Profiling runs must never overwrite the real settings / layout.
    if (PROFILING) return;
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const info = useVault.getState().info;
        if (!info) return; // nothing worth remembering before a vault is open
        const { panel, drawerSize, prefs, reading } = useUi.getState();
        const ui: SavedUi = { vault: info.root, panel, drawerSize, prefs, reading, layout: useLayout.getState().snapshot() };
        void ipc.saveUi(ui).catch(() => {
          /* Settings are best-effort; never interrupt the user for them. */
        });
      }, SAVE_DEBOUNCE_MS);
    };
    // Zustand's subscribe fires on every state change of that store.
    const offLayout = useLayout.subscribe(schedule);
    const offUi = useUi.subscribe((s, prev) => {
      if (s.panel !== prev.panel || s.drawerSize !== prev.drawerSize || s.prefs !== prev.prefs || s.reading !== prev.reading) schedule();
    });

    // Autosave also saves whenever the window loses focus (alt-tab, clicking
    // another app, the laptop going to sleep), not just on a typing pause.
    const onBlur = () => {
      if (useUi.getState().prefs.autosave) void useBuffers.getState().flushAll();
    };
    window.addEventListener("blur", onBlur);
    const onHidden = () => document.visibilityState === "hidden" && onBlur();
    document.addEventListener("visibilitychange", onHidden);

    // Closing: with autosave, write anything pending and go. Without it, ask
    // about unsaved notes first: Save all / Don't save / Cancel.
    const win = getCurrentWindow();
    const offClose = win.onCloseRequested(async (event) => {
      const buffers = useBuffers.getState();
      if (useUi.getState().prefs.autosave) {
        await buffers.flushAll();
        return;
      }
      const unsaved = Object.entries(buffers.buffers).filter(([, b]) => b.loaded && b.content !== b.saved);
      if (unsaved.length === 0) return;
      event.preventDefault(); // decide first, then destroy the window ourselves
      useUi.getState().openDialog({
        kind: "choice",
        title: "Unsaved changes",
        message: `${unsaved.length} note${unsaved.length === 1 ? " has" : "s have"} unsaved changes: ${unsaved
          .map(([p]) => p)
          .slice(0, 4)
          .join(", ")}${unsaved.length > 4 ? "…" : ""}`,
        choices: [
          { label: "Cancel", onSelect: () => {} },
          { label: "Don't save", tone: "danger", onSelect: () => void win.destroy() },
          {
            label: "Save all",
            tone: "primary",
            onSelect: async () => {
              await useBuffers.getState().flushAll();
              await win.destroy();
            },
          },
        ],
      });
    });

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onHidden);
      offLayout();
      offUi();
      void offClose.then((off) => off());
    };
  }, []);
}
