// App-wide side effects that don't belong to any one component:
//
//   - startup: reopen the last vault and restore the saved layout,
//   - live sync: react to `vault:changed` events from the Rust watcher,
//   - persistence: save drawer + tab/split layout (debounced),
//   - shutdown: flush unsaved notes before the window closes.

import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useState } from "react";
import { ipc } from "../lib/ipc";
import { useBuffers } from "../store/buffers";
import { type LayoutSnapshot, useLayout } from "../store/layout";
import { type DrawerSize, type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";

/** What we store in the opaque `ui` blob in settings.json. */
interface SavedUi {
  /** Vault the layout belongs to; a layout is only restored for the same vault. */
  vault?: string;
  panel?: PanelId | null;
  drawerSize?: DrawerSize;
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
        if (saved.drawerSize) useUi.getState().setDrawerSize(saved.drawerSize);
        if (saved.panel !== undefined) {
          if (saved.panel) useUi.getState().showPanel(saved.panel);
          else useUi.getState().closeDrawer();
        }
        if (vaultPath && (await useVault.getState().open(vaultPath))) {
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

/** Persists layout + drawer state and flushes notes on window close. */
export function usePersistence() {
  useEffect(() => {
    let timer = 0;
    const schedule = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const info = useVault.getState().info;
        if (!info) return; // nothing worth remembering before a vault is open
        const { panel, drawerSize } = useUi.getState();
        const ui: SavedUi = { vault: info.root, panel, drawerSize, layout: useLayout.getState().snapshot() };
        void ipc.saveUi(ui).catch(() => {
          /* Settings are best-effort; never interrupt the user for them. */
        });
      }, SAVE_DEBOUNCE_MS);
    };
    // Zustand's subscribe fires on every state change of that store.
    const offLayout = useLayout.subscribe(schedule);
    const offUi = useUi.subscribe((s, prev) => {
      if (s.panel !== prev.panel || s.drawerSize !== prev.drawerSize) schedule();
    });

    // Make sure typing from the last 600ms reaches disk before exiting.
    const offClose = getCurrentWindow().onCloseRequested(async () => {
      await useBuffers.getState().flushAll();
    });

    return () => {
      window.clearTimeout(timer);
      offLayout();
      offUi();
      void offClose.then((off) => off());
    };
  }, []);
}
