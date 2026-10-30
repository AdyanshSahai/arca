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
  /**
   * The file changed on disk (another program) and Arca hasn't decided
   * what to do yet: this is the disk's text. While set, nothing is saved
   * and the pane shows the "changed on disk" banner (ConflictBanner).
   */
  conflict?: string;
}

/** How a "changed on disk" conflict is settled (see ConflictBanner). */
export type ConflictChoice =
  /** Take the disk version; unsaved edits in Arca are dropped. */
  | "reload"
  /** Write Arca's version over the disk version. */
  | "mine"
  /** Save the disk version as a separate "(conflict …)" note; Arca's version stays. */
  | "both";

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
  /**
   * Re-reads a file after it changed on disk. With `ours`, Arca itself made
   * the change (link fixes after a rename, a Time Machine restore), so a
   * note without unsaved edits just takes the new text, no banner.
   */
  reloadFromDisk: (path: string, opts?: { ours?: boolean }) => Promise<void>;
  /** Moves a buffer to a new key after a rename. */
  rename: (from: string, to: string) => void;
  /** Settles a "changed on disk" conflict. */
  resolveConflict: (path: string, choice: ConflictChoice) => Promise<void>;
  /** Forgets buffers whose path isn't in `keep` (flushing them first). */
  retainOnly: (keep: Set<string>) => void;
}

/** Pending autosave timers, by path. Kept outside the store: not UI state. */
const timers = new Map<string, number>();

/** "notes/cpu.md" → "notes/cpu (conflict 2026-10-29 1405).md" */
function conflictPath(path: string): string {
  const d = new Date();
  const two = (n: number) => String(n).padStart(2, "0");
  const stamp = `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())} ${two(d.getHours())}${two(d.getMinutes())}`;
  const dot = path.lastIndexOf(".");
  return dot > path.lastIndexOf("/") ? `${path.slice(0, dot)} (conflict ${stamp})${path.slice(dot)}` : `${path} (conflict ${stamp})`;
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
      // An unsettled conflict blocks saving until the user picks a side.
      if (!buf || !buf.loaded || buf.error || buf.conflict !== undefined || buf.content === buf.saved) return;
      const content = buf.content;
      try {
        // Rust refuses the write if the file no longer holds `saved`, i.e.
        // another program changed it since we last read or wrote it. A
        // not-yet-written folder note has nothing to compare against.
        await ipc.writeNote(path, content, buf.missing ? undefined : buf.saved);
        // Only mark what we actually wrote as saved: typing may have continued.
        patch(path, { saved: content, missing: false });
        // A brand-new file (first save of a folder note) changes the tree.
        // The watcher ignores our own writes, so announce it ourselves.
        if (buf.missing) window.dispatchEvent(new Event("arca:files-created"));
      } catch (err) {
        const message = errorMessage(err);
        if (message.startsWith("changed on disk")) {
          // Show the banner with the disk's current text.
          const disk = await ipc.readNote(path).catch(() => null);
          if (disk !== null) patch(path, { conflict: disk });
          return;
        }
        useUi.getState().toast(`Save failed: ${message}`, "error");
      }
    },

    flushAll: async () => {
      await Promise.all(Object.keys(get().buffers).map((p) => get().flush(p)));
    },

    reloadFromDisk: async (path, opts) => {
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
      if (!current) return;
      if (disk === current.saved) {
        // The file is back to what we know (e.g. the other program undid
        // its change): any open banner no longer applies.
        if (current.conflict !== undefined) patch(path, { conflict: undefined });
        return;
      }
      if (disk === current.content) {
        // The disk now matches what's on screen: nothing to decide.
        patch(path, { saved: disk, conflict: undefined });
        return;
      }
      if (current.content === current.saved && (opts?.ours || useUi.getState().prefs.autoReload)) {
        // No unsaved edits, and the change was Arca's own or the user chose
        // to always reload.
        patch(path, { content: disk, saved: disk, conflict: undefined, externalRev: current.externalRev + 1 });
        return;
      }
      // Ask with the banner (see ConflictBanner); hold any pending autosave.
      window.clearTimeout(timers.get(path));
      timers.delete(path);
      patch(path, { conflict: disk });
    },

    resolveConflict: async (path, choice) => {
      const buf = get().buffers[path];
      if (!buf || buf.conflict === undefined) return;
      const disk = buf.conflict;
      if (choice === "reload") {
        patch(path, { content: disk, saved: disk, conflict: undefined, externalRev: buf.externalRev + 1 });
        return;
      }
      if (choice === "both") {
        const copy = conflictPath(path);
        try {
          await ipc.writeNote(copy, disk);
          useUi.getState().toast(`Saved the other version as ${copy}`);
          window.dispatchEvent(new Event("arca:files-created")); // refresh the tree
        } catch (err) {
          useUi.getState().toast(`Couldn't save the other version: ${errorMessage(err)}`, "error");
          return;
        }
      }
      // "mine" and "both": Arca's text wins in the original file. Treating
      // the disk text as "saved" makes the write go through, and marks the
      // buffer dirty so flush has something to write.
      patch(path, { saved: disk, conflict: undefined });
      if (get().buffers[path]?.content !== disk) await get().flush(path);
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
