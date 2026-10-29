// In-memory copies of open notes, with debounced autosave.
//
// Every pane showing a note edits the *same* buffer, so two panes on one
// file stay in sync. Each buffer remembers the last content known to be on
// disk (`saved`) so we can tell local edits apart from outside changes.

import { create } from "zustand";
import { errorMessage, ipc } from "../lib/ipc";
import { useUi } from "./ui";

/** Idle time after the last keystroke before a note is written to disk. */
const AUTOSAVE_MS = 600;

export interface Buffer {
  /** Current editor text. */
  content: string;
  /** What we last read from / wrote to disk. `content !== saved` = dirty. */
  saved: string;
  /** False until the first read finishes. */
  loaded: boolean;
  error?: string;
  /**
   * The file doesn't exist yet: an unwritten folder note. It is created on
   * the first save, so merely opening a folder never leaves an empty file.
   */
  missing?: boolean;
  /**
   * Bumped whenever content changes from *outside* the editor (disk reload,
   * post-it edited from the sidebar). Editors watch this to know they must
   * replace their document instead of treating it as their own keystroke.
   */
  externalRev: number;
}

interface BufferState {
  buffers: Record<string, Buffer>;
  /**
   * Reads a note from disk unless it is already loaded. With
   * `allowMissing`, a file that doesn't exist yet opens as an empty
   * `missing` buffer instead of an error.
   */
  ensure: (path: string, opts?: { allowMissing?: boolean }) => Promise<void>;
  /** Called by editors on every change; schedules an autosave. */
  edit: (path: string, content: string) => void;
  /** Replaces content from outside the editor (e.g. a sidebar post-it edit). */
  replace: (path: string, content: string, alreadySaved: boolean) => void;
  /** Writes one buffer now if it is dirty. */
  flush: (path: string) => Promise<void>;
  flushAll: () => Promise<void>;
  /** Re-reads a file after the watcher reported an outside change. */
  reloadFromDisk: (path: string) => Promise<void>;
  /** Moves a buffer to a new key after a rename. */
  rename: (from: string, to: string) => void;
  /** Forgets buffers whose path isn't in `keep` (flushing them first). */
  retainOnly: (keep: Set<string>) => void;
}

/** Pending autosave timers, by path. Kept outside the store: not UI state. */
const timers = new Map<string, number>();

/** Notes with a conflict prompt already open (so one change = one prompt). */
const conflicts = new Set<string>();

/** "notes/cpu.md" → "notes/cpu (conflict 2026-10-29 1405).md" */
function conflictPath(path: string): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? `${path.slice(0, dot)} (conflict ${stamp})${path.slice(dot)}` : `${path} (conflict ${stamp})`;
}

/**
 * A note changed on disk (another app, a sync tool…) while it had unsaved
 * edits in Arca. Instead of silently keeping one side, ask:
 *  - Keep both: the disk version is saved as a separate "(conflict …)" note
 *    next to it, and your version stays in the original.
 *  - Use the disk version: your unsaved edits are dropped.
 *  - Keep mine: your version overwrites the disk copy now.
 */
function askAboutConflict(path: string, disk: string) {
  if (conflicts.has(path)) return;
  conflicts.add(path);
  // Stop any pending autosave until the user decides.
  window.clearTimeout(timers.get(path));
  timers.delete(path);
  const store = useBuffers.getState();
  const done = () => conflicts.delete(path);
  useUi.getState().openDialog({
    kind: "choice",
    title: "Note changed on disk",
    message: `“${path}” was changed outside Arca while you had unsaved edits in it. Which version do you want?`,
    dismissable: false, // an unanswered conflict would silently pick a side
    choices: [
      {
        label: "Use the disk version",
        onSelect: () => {
          done();
          store.replace(path, disk, true);
        },
      },
      {
        label: "Keep both",
        onSelect: async () => {
          done();
          const copy = conflictPath(path);
          try {
            await ipc.writeNote(copy, disk);
            useUi.getState().toast(`Saved the disk version as ${copy}`);
          } catch (err) {
            useUi.getState().toast(`Couldn't save the other version: ${errorMessage(err)}`, "error");
            return;
          }
          // Yours wins in the original file.
          const b = useBuffers.getState().buffers[path];
          if (b) useBuffers.setState({ buffers: { ...useBuffers.getState().buffers, [path]: { ...b, saved: disk } } });
          await useBuffers.getState().flush(path);
          window.dispatchEvent(new Event("arca:files-created")); // refresh the tree
        },
      },
      {
        label: "Keep mine",
        tone: "primary",
        onSelect: async () => {
          done();
          const b = useBuffers.getState().buffers[path];
          if (b) useBuffers.setState({ buffers: { ...useBuffers.getState().buffers, [path]: { ...b, saved: disk } } });
          await useBuffers.getState().flush(path);
        },
      },
    ],
  });
}

export const useBuffers = create<BufferState>((set, get) => {
  /** Shallow-merges fields into one buffer. */
  const patch = (path: string, fields: Partial<Buffer>) => {
    const prev = get().buffers[path];
    if (!prev) return;
    set({ buffers: { ...get().buffers, [path]: { ...prev, ...fields } } });
  };

  return {
    buffers: {},

    ensure: async (path, opts) => {
      const existing = get().buffers[path];
      // Retry a previous "not found" if this caller is allowed to create it.
      if (existing && !(opts?.allowMissing && existing.error)) return;
      // Placeholder first, so concurrent callers don't read the file twice.
      set({
        buffers: {
          ...get().buffers,
          [path]: { content: "", saved: "", loaded: false, externalRev: 0 },
        },
      });
      try {
        const text = await ipc.readNote(path);
        patch(path, { content: text, saved: text, loaded: true, externalRev: 1 });
      } catch (err) {
        const message = errorMessage(err);
        // arca-core reports absent files as "not found: <path>".
        if (opts?.allowMissing && message.startsWith("not found")) {
          patch(path, { content: "", saved: "", loaded: true, missing: true, error: undefined, externalRev: 1 });
        } else {
          patch(path, { loaded: true, error: message });
        }
      }
    },

    edit: (path, content) => {
      const buf = get().buffers[path];
      if (!buf || buf.content === content) return;
      patch(path, { content });
      // Autosave: (re)start this note's countdown, so the file is written
      // once typing pauses. With autosave off, saving waits for Ctrl+S.
      if (!useUi.getState().prefs.autosave) return;
      window.clearTimeout(timers.get(path));
      timers.set(path, window.setTimeout(() => void get().flush(path), AUTOSAVE_MS));
    },

    replace: (path, content, alreadySaved) => {
      const buf = get().buffers[path];
      if (!buf) return;
      patch(path, {
        content,
        saved: alreadySaved ? content : buf.saved,
        externalRev: buf.externalRev + 1,
      });
    },

    flush: async (path) => {
      window.clearTimeout(timers.get(path));
      timers.delete(path);
      const buf = get().buffers[path];
      if (!buf || !buf.loaded || buf.error || buf.content === buf.saved) return;
      const content = buf.content;
      try {
        await ipc.writeNote(path, content);
        // Only mark what we actually wrote as saved: typing may have continued.
        patch(path, { saved: content, missing: false });
        // A brand-new file (first save of a folder note) changes the tree.
        // The watcher ignores our own writes, so announce it ourselves.
        if (buf.missing) window.dispatchEvent(new Event("arca:files-created"));
      } catch (err) {
        useUi.getState().toast(`Save failed: ${errorMessage(err)}`, "error");
      }
    },

    flushAll: async () => {
      await Promise.all(Object.keys(get().buffers).map((p) => get().flush(p)));
    },

    reloadFromDisk: async (path) => {
      const buf = get().buffers[path];
      if (!buf || !buf.loaded) return;
      let disk: string;
      try {
        disk = await ipc.readNote(path);
      } catch {
        // The file was deleted or moved; leave the buffer for the user to see.
        return;
      }
      const current = get().buffers[path];
      if (!current || disk === current.saved) return; // nothing new on disk
      if (current.content === current.saved) {
        // Clean buffer: just take the disk version.
        patch(path, { content: disk, saved: disk, externalRev: current.externalRev + 1 });
      } else {
        // Dirty buffer and the file changed underneath: a real conflict.
        // Hold off saving and let the user decide.
        askAboutConflict(path, disk);
      }
    },

    rename: (from, to) => {
      const { [from]: buf, ...rest } = get().buffers;
      if (!buf) return;
      // A pending autosave would otherwise write to the old path.
      window.clearTimeout(timers.get(from));
      timers.delete(from);
      set({ buffers: { ...rest, [to]: buf } });
    },

    retainOnly: (keep) => {
      const autosave = useUi.getState().prefs.autosave;
      const drop = Object.keys(get().buffers).filter((p) => {
        if (keep.has(p)) return false;
        // Without autosave, a closed note's unsaved edits are kept in memory
        // (never silently saved or lost): reopening it brings them back, and
        // Arca asks about them before quitting.
        const b = get().buffers[p];
        return autosave || !b || b.content === b.saved;
      });
      if (drop.length === 0) return;
      // Save before forgetting; the drop happens once the write finishes.
      void Promise.all(drop.map((p) => get().flush(p))).then(() => {
        const next = { ...get().buffers };
        for (const p of drop) delete next[p];
        set({ buffers: next });
      });
    },
  };
});
