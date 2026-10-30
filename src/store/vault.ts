// The open vault: its tree, note list, pins, and the file operations that
// must also update tabs and buffers (create, rename, trash).

import { openFromSidebar } from "../lib/actions";
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
      const report = await ipc.renameEntry(from, to);
      // Move open buffers, panes and pins over to the new path(s), one
      // rename at a time (a folder can be renamed along with its note).
      for (const [a, b] of report.moves) {
        for (const p of Object.keys(useBuffers.getState().buffers)) {
          const next = remapPath(p, a, b);
          if (next) useBuffers.getState().rename(p, next);
        }
        useLayout.getState().remap(a, b);
      }
      // Open notes whose [[links]] the rename just fixed take the new text
      // now, before the file watcher reports it as an outside change.
      for (const p of Object.keys(useBuffers.getState().buffers)) {
        await useBuffers.getState().reloadFromDisk(p, { ours: true });
      }
      // Pins pointing at (or into) the moved entry follow it too.
      const pins = get().pins.map((pin) => {
        let path = pin.path;
        for (const [a, b] of report.moves) path = remapPath(path, a, b) ?? path;
        return path === pin.path ? pin : { ...pin, path };
      });
      if (pins.some((p, i) => p !== get().pins[i])) {
        set({ pins });
        await ipc.setPins(pins);
      }
      await get().refresh();
      // Say what happened, with Undo (which moves it back, fixing links again).
      const fixed = report.links
        ? ` Updated ${report.links} link${report.links === 1 ? "" : "s"} in ${report.notes} note${report.notes === 1 ? "" : "s"}.`
        : "";
      // Where the entry ended up: a folder note renamed in place takes
      // its folder with it ("ch/ch.md" → "ch/part.md" → "part/part.md").
      let landed = to;
      for (const [a, b] of report.moves.slice(1)) landed = remapPath(landed, a, b) ?? landed;
      const both = report.moves.length > 1;
      useUi.getState().toast(`${both ? "Renamed" : "Moved"} to ${landed}${both ? " (folder and its note together)" : ""}.${fixed}`, "info", {
        label: "Undo",
        // With a companion rename, renaming back by name undoes both
        // (the same rule applies in reverse); otherwise move it back.
        run: () => void get().moveEntry(landed, both ? joinPath(dirName(landed), baseName(from)) : from),
      });
    } catch (err) {
      fail("Move failed")(err);
    }
  },

  confirmTrash: (path) => {
    useUi.getState().openDialog({
      kind: "confirm",
      title: "Move to trash",
      message: `Move “${path}” to the trash? You can restore it from the Trash window (trash button in the chapter tree).`,
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
        openFromSidebar(pin.path);
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
