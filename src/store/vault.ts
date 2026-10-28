// The open vault: its tree, note list, pins, and the file operations that
// must also update tabs and buffers (create, rename, trash).

import { create } from "zustand";
import { errorMessage, ipc } from "../lib/ipc";
import { baseName, dirName, isNotePath, joinPath, remapPath, stem } from "../lib/paths";
import type { NoteInfo, Pin, PinKind, TreeNode, VaultInfo } from "../lib/types";
import { useBuffers } from "./buffers";
import { useLayout } from "./layout";
import { useUi } from "./ui";

interface VaultState {
  info: VaultInfo | null;
  tree: TreeNode | null;
  notes: NoteInfo[];
  pins: Pin[];
  /**
   * Bumped after anything in the vault changes (our edits or outside
   * ones). Panels that show derived data (graph, backlinks, post-its,
   * search results) refetch when it changes.
   */
  revision: number;

  open: (path: string) => Promise<boolean>;
  /** Refetches tree and note list and bumps `revision`. */
  refresh: () => Promise<void>;

  /** Prompts for a name, creates the note in `dir`, and opens it. */
  promptNewNote: (dir?: string) => void;
  promptNewFolder: (dir?: string) => void;
  promptRename: (path: string) => void;
  /** Renames/moves a file or folder and updates buffers, panes and pins. */
  moveEntry: (from: string, to: string) => Promise<void>;
  confirmTrash: (path: string) => void;
  /** Creates a note at an exact path (used by "create missing [[link]]"). */
  createAndOpen: (path: string) => Promise<void>;

  addPin: (path: string, kind: PinKind) => Promise<void>;
  removePin: (id: string) => Promise<void>;
  /** Opens whatever a pin points at. */
  activatePin: (pin: Pin) => void;
}

/** Shows an error toast; used by every failing vault action. */
const fail = (prefix: string) => (err: unknown) => useUi.getState().toast(`${prefix}: ${errorMessage(err)}`, "error");

export const useVault = create<VaultState>((set, get) => ({
  info: null,
  tree: null,
  notes: [],
  pins: [],
  revision: 0,

  open: async (path) => {
    try {
      const info = await ipc.openVault(path);
      const pins = await ipc.getPins().catch(() => [] as Pin[]);
      set({ info, pins });
      await get().refresh();
      return true;
    } catch (err) {
      fail("Could not open vault")(err);
      return false;
    }
  },

  refresh: async () => {
    try {
      const [tree, notes] = await Promise.all([ipc.vaultTree(), ipc.listNotes()]);
      set({ tree, notes, revision: get().revision + 1 });
    } catch (err) {
      fail("Could not read vault")(err);
    }
  },

  promptNewNote: (dir = "") => {
    useUi.getState().openDialog({
      kind: "prompt",
      title: "New note",
      label: dir ? `in ${dir}/` : "in vault root",
      initial: "",
      confirmText: "Create",
      onSubmit: async (name) => {
        // "folder/name" in the box creates sub-chapters on the fly.
        await get().createAndOpen(joinPath(dir, name.trim()));
      },
    });
  },

  createAndOpen: async (path) => {
    try {
      const created = await ipc.createNote(path);
      await get().refresh();
      useLayout.getState().openNote(created);
    } catch (err) {
      fail("Could not create note")(err);
    }
  },

  promptNewFolder: (dir = "") => {
    useUi.getState().openDialog({
      kind: "prompt",
      title: "New chapter folder",
      label: dir ? `in ${dir}/` : "in vault root",
      initial: "",
      confirmText: "Create",
      onSubmit: async (name) => {
        try {
          await ipc.createFolder(joinPath(dir, name.trim()));
          await get().refresh();
        } catch (err) {
          fail("Could not create folder")(err);
        }
      },
    });
  },

  promptRename: (path) => {
    const name = baseName(path);
    useUi.getState().openDialog({
      kind: "prompt",
      title: "Rename",
      label: path,
      initial: name,
      // Pre-select the name without its extension, like file managers do.
      selectRange: [0, isNotePath(name) ? stem(name).length : name.length],
      confirmText: "Rename",
      onSubmit: (value) => get().moveEntry(path, joinPath(dirName(path), value.trim())),
    });
  },

  moveEntry: async (from, to) => {
    if (to === from) return;
    try {
      // Save first so a pending autosave doesn't recreate the old file.
      await useBuffers.getState().flushAll();
      await ipc.renameEntry(from, to);
      // Move open buffers and panes over to the new path(s).
      for (const p of Object.keys(useBuffers.getState().buffers)) {
        const next = remapPath(p, from, to);
        if (next) useBuffers.getState().rename(p, next);
      }
      useLayout.getState().remap(from, to);
      // Pins pointing at (or into) the moved entry follow it too.
      const pins = get().pins.map((pin) => {
        const next = remapPath(pin.path, from, to);
        return next ? { ...pin, path: next } : pin;
      });
      if (pins.some((p, i) => p !== get().pins[i])) {
        set({ pins });
        await ipc.setPins(pins);
      }
      await get().refresh();
    } catch (err) {
      fail("Move failed")(err);
    }
  },

  confirmTrash: (path) => {
    useUi.getState().openDialog({
      kind: "confirm",
      title: "Move to trash",
      message: `Move “${path}” to the vault's .trash folder? You can restore it from there.`,
      confirmText: "Move to trash",
      danger: true,
      onConfirm: async () => {
        try {
          await ipc.trashEntry(path);
          useLayout.getState().forget(path);
          await get().refresh();
        } catch (err) {
          fail("Could not move to trash")(err);
        }
      },
    });
  },

  addPin: async (path, kind) => {
    if (get().pins.some((p) => p.path === path)) return; // already pinned
    const pin: Pin = {
      id: Math.random().toString(36).slice(2, 10),
      label: kind === "note" ? stem(path) : baseName(path) || get().info?.name || "vault",
      path,
      kind,
    };
    const pins = [...get().pins, pin];
    set({ pins });
    await ipc.setPins(pins).catch(fail("Could not save pins"));
  },

  removePin: async (id) => {
    const pins = get().pins.filter((p) => p.id !== id);
    set({ pins });
    await ipc.setPins(pins).catch(fail("Could not save pins"));
  },

  activatePin: (pin) => {
    switch (pin.kind) {
      case "note":
        useLayout.getState().openNote(pin.path, { pick: true });
        break;
      case "folder":
        // Show the tree drawer and ask it to reveal + expand the folder.
        useUi.getState().showPanel("tree");
        window.dispatchEvent(new CustomEvent("arca:reveal-folder", { detail: pin.path }));
        break;
      case "file":
        ipc.openInDefaultApp(pin.path).catch(fail("Could not open file"));
        break;
    }
  },
}));
