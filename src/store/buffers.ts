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
   * Bumped whenever content changes from *outside* the editor (disk reload,
   * post-it edited from the sidebar). Editors watch this to know they must
   * replace their document instead of treating it as their own keystroke.
   */
  externalRev: number;
}

interface BufferState {
  buffers: Record<string, Buffer>;
  /** Reads a note from disk unless it is already loaded. */
  ensure: (path: string) => Promise<void>;
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

export const useBuffers = create<BufferState>((set, get) => {
  /** Shallow-merges fields into one buffer. */
  const patch = (path: string, fields: Partial<Buffer>) => {
    const prev = get().buffers[path];
    if (!prev) return;
    set({ buffers: { ...get().buffers, [path]: { ...prev, ...fields } } });
  };

  return {
    buffers: {},

    ensure: async (path) => {
      if (get().buffers[path]) return;
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
        patch(path, { loaded: true, error: errorMessage(err) });
      }
    },

    edit: (path, content) => {
      const buf = get().buffers[path];
      if (!buf || buf.content === content) return;
      patch(path, { content });
      // Restart this note's autosave countdown.
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
        patch(path, { saved: content });
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
        // Dirty buffer and the file changed underneath. Keep the user's edits
        // (they win on the next save) but say so.
        patch(path, { saved: disk });
        useUi.getState().toast(`${path} changed on disk; keeping your unsaved edits`);
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
      const drop = Object.keys(get().buffers).filter((p) => !keep.has(p));
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
