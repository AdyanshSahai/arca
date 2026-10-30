// Time Machine: browse version history and bring old versions back.
//
// Left: a timeline of snapshots, every one from the last day, then thinned
// like Apple's Time Machine (at most one per hour for a week, one per day
// after that; each entry covers everything that changed in its period).
// Right: what changed at that point. Pick a note to compare that version
// with now, then restore the note, its chapter, or the whole vault.
//
// Opened from the clock button on the left rail, the command palette
// ("Time Machine…" / "History of this note…"), the clock button in a pane
// header, or Settings → Saving. With a
// note given, the timeline only shows that note's versions.

import { Clock, History as HistoryIcon, RotateCcw, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { diffLines } from "../lib/diff";
import { errorMessage, ipc } from "../lib/ipc";
import { dirName } from "../lib/paths";
import type { Snapshot } from "../lib/types";
import { useBuffers } from "../store/buffers";
import { useUi } from "../store/ui";
import { useVault } from "../store/vault";

/** A timeline entry: one or more snapshots merged by the thinning rules. */
interface Entry {
  /** The newest snapshot in the period (what restoring/browsing uses). */
  id: string;
  time: number;
  /** Union of the period's changes (latest kind wins per note). */
  changes: Map<string, string>;
}

/** Thins the timeline: all of the last day, hourly for a week, daily after. */
function thin(snaps: Snapshot[]): Entry[] {
  const now = Date.now() / 1000;
  const entries: Entry[] = [];
  const byKey = new Map<string, Entry>();
  for (const s of snaps) {
    const age = now - s.time;
    const d = new Date(s.time * 1000);
    // Snapshots sharing a key are shown as one entry.
    const key =
      age < 86400 ? s.id : age < 7 * 86400 ? `h:${d.toDateString()}:${d.getHours()}` : `d:${d.toDateString()}`;
    let e = byKey.get(key);
    if (!e) {
      // Snapshots arrive newest first, so the first of a key is the newest.
      e = { id: s.id, time: s.time, changes: new Map() };
      byKey.set(key, e);
      entries.push(e);
    }
    for (const c of s.changes) if (!e.changes.has(c.path)) e.changes.set(c.path, c.kind);
  }
  return entries;
}

/** "Today", "Yesterday", "Tuesday", or a date: the timeline's group headings. */
function dayLabel(t: number): string {
  const d = new Date(t * 1000);
  const today = new Date();
  const days = Math.floor((new Date(today.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 7) return d.toLocaleDateString(undefined, { weekday: "long" });
  return d.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" });
}

const timeOf = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

const KIND_STYLE: Record<string, string> = {
  added: "text-[#9fdcb4]",
  modified: "text-[#9db8ff]",
  deleted: "text-[#ff9ab8]",
};

export function TimeMachine() {
  const tm = useUi((s) => s.timeMachine);
  if (!tm) return null;
  return <Machine only={tm.path} />;
}

function Machine({ only }: { only?: string }) {
  const close = useUi((s) => s.closeTimeMachine);
  const [snaps, setSnaps] = useState<Snapshot[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(only ?? null);
  const [showAll, setShowAll] = useState(false);
  const [allFiles, setAllFiles] = useState<string[]>([]);

  const load = () =>
    ipc
      .historyTimeline(1000, only)
      .then((s) => {
        setSnaps(s);
        setSelected((cur) => cur ?? s[0]?.id ?? null);
      })
      .catch((err) => setError(errorMessage(err)));
  useEffect(() => {
    void load();
  }, []);

  const entries = useMemo(() => (snaps ? thin(snaps) : []), [snaps]);
  const entry = entries.find((e) => e.id === selected) ?? null;

  // "Show all notes at this moment" lists the full snapshot.
  useEffect(() => {
    if (showAll && selected) void ipc.historyFiles(selected).then(setAllFiles);
  }, [showAll, selected]);

  /** Runs a restore after confirming, then reloads open notes and the vault. */
  const restore = (prefix: string, what: string) => {
    if (!entry) return;
    useUi.getState().openDialog({
      kind: "confirm",
      title: "Restore from history?",
      message: `Bring back ${what} as it was on ${dayLabel(entry.time).toLowerCase()} at ${timeOf(entry.time)}? The current state is saved in history first, so you can undo this here.${
        prefix === "" || !prefix.endsWith(".md") ? " Notes that didn't exist then are moved to the trash." : ""
      }`,
      confirmText: "Restore",
      onConfirm: async () => {
        try {
          await useBuffers.getState().flushAll();
          const r = await ipc.historyRestore(entry.id, prefix);
          // Open editors pick up the restored text.
          for (const p of Object.keys(useBuffers.getState().buffers)) await useBuffers.getState().reloadFromDisk(p, { ours: true });
          await useVault.getState().refresh();
          useUi.getState().toast(
            `Restored ${r.written} note${r.written === 1 ? "" : "s"}${r.trashed ? `, moved ${r.trashed} newer note${r.trashed === 1 ? "" : "s"} to the trash` : ""}.`,
          );
          setSelected(null);
          void load();
        } catch (err) {
          useUi.getState().toast(`Restore failed: ${errorMessage(err)}`, "error");
        }
      },
    });
  };

  const notesHere = entry ? (showAll ? allFiles.map((p) => [p, ""] as [string, string]) : [...entry.changes]) : [];

  return (
    <div
      className="fixed inset-0 z-40 flex bg-black/60 p-6 backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
      onKeyDown={(e) => e.key === "Escape" && close()}
      tabIndex={-1}
    >
      <div className="flex min-h-0 w-full overflow-hidden rounded-xl border border-line-strong bg-alt shadow-[0_24px_64px_rgb(0_0_0/0.6)]">
        {/* Timeline */}
        <aside className="flex w-80 shrink-0 flex-col border-r border-line">
          <div className="flex items-center gap-2.5 border-b border-line px-5 py-3.5">
            <HistoryIcon size={17} className="text-accent" />
            <span className="truncate text-[14px] font-semibold text-fg">
              {only ? `History of ${only.split("/").pop()?.replace(/\.md$/, "")}` : "Time Machine"}
            </span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {error && <p className="p-3 text-[13px] text-[#ff9ab8]">{error}</p>}
            {snaps && entries.length === 0 && (
              <p className="p-3 text-[13px] text-muted/60">No snapshots yet. History takes one every few minutes while you work.</p>
            )}
            {entries.map((e, i) => (
              <div key={e.id}>
                {(i === 0 || dayLabel(entries[i - 1].time) !== dayLabel(e.time)) && (
                  <div className="label px-2.5 pt-3 pb-1.5">{dayLabel(e.time)}</div>
                )}
                <button
                  onClick={() => {
                    setSelected(e.id);
                    if (!only) setNote(null);
                  }}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors ${
                    e.id === selected ? "bg-accent-soft text-accent" : "text-fg/85 hover:bg-hover"
                  }`}
                >
                  <Clock size={13} className="shrink-0 opacity-70" />
                  <span className="text-[13px] tabular-nums">{timeOf(e.time)}</span>
                  <span className="ml-auto text-[11px] text-muted/70">
                    {e.changes.size} note{e.changes.size === 1 ? "" : "s"}
                  </span>
                </button>
              </div>
            ))}
          </div>
        </aside>

        {/* Selected moment */}
        <section className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-center gap-3 border-b border-line px-5 py-3">
            <span className="flex-1 truncate text-[13px] text-fg/85">
              {entry ? `As of ${dayLabel(entry.time).toLowerCase()} at ${timeOf(entry.time)}` : "Pick a moment on the left"}
            </span>
            {entry && !only && (
              <button
                onClick={() => restore("", "the whole vault")}
                className="btn-soft flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px]"
              >
                <RotateCcw size={13} /> Restore everything
              </button>
            )}
            <button
              onClick={close}
              title="Close (Esc)"
              className="flex h-7 w-7 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
            >
              <X size={16} />
            </button>
          </div>

          <div className="flex min-h-0 flex-1">
            {/* Notes at that moment */}
            {!only && entry && (
              <div className="flex w-72 shrink-0 flex-col border-r border-line">
                <label className="flex items-center gap-2 border-b border-line px-4 py-2 text-[12px] text-muted">
                  <input type="checkbox" checked={showAll} onChange={() => setShowAll(!showAll)} className="cm-task !m-0" />
                  Show every note at this moment
                </label>
                <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
                  {notesHere.map(([path, kind]) => (
                    <button
                      key={path}
                      onClick={() => setNote(path)}
                      className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] ${
                        note === path ? "bg-hover text-fg" : "text-fg/80 hover:bg-hover/70"
                      }`}
                    >
                      <span className="min-w-0 flex-1 truncate">{path}</span>
                      {kind && <span className={`shrink-0 text-[10px] uppercase ${KIND_STYLE[kind]}`}>{kind}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Compare a note's version with now */}
            <div className="min-w-0 flex-1">
              {entry && note ? (
                <Compare
                  id={entry.id}
                  path={note}
                  onRestoreNote={() => restore(note, `“${note}”`)}
                  onRestoreChapter={dirName(note) ? () => restore(dirName(note), `the chapter “${dirName(note)}”`) : undefined}
                />
              ) : (
                <p className="p-6 text-[13px] text-muted/60">Pick a note to compare that version with now.</p>
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** That version of a note vs the current file, as a line diff. */
function Compare({
  id,
  path,
  onRestoreNote,
  onRestoreChapter,
}: {
  id: string;
  path: string;
  onRestoreNote: () => void;
  onRestoreChapter?: () => void;
}) {
  const [then, setThen] = useState<string | null | undefined>(undefined);
  const [now, setNow] = useState<string | null>(null);
  useEffect(() => {
    setThen(undefined);
    void ipc.historyRead(id, path).then(setThen);
    ipc
      .readNote(path)
      .then(setNow)
      .catch(() => setNow(null)); // the note doesn't exist any more
  }, [id, path]);

  const diff = useMemo(() => (then === undefined ? [] : diffLines(now ?? "", then ?? "")), [then, now]);
  const changed = diff.some((d) => d.kind !== "same");

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-line px-5 py-2.5">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg">{path}</span>
        <span className="text-[11px] text-muted/70">
          <span className="text-[#ff9ab8]">− now</span> · <span className="text-[#9fdcb4]">+ then</span>
        </span>
        {onRestoreChapter && (
          <button onClick={onRestoreChapter} className="btn-soft rounded-md px-2.5 py-1 text-[12px]">
            Restore chapter
          </button>
        )}
        <button
          onClick={onRestoreNote}
          disabled={then === null || (!changed && now !== null)}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1 text-[12px] font-medium text-void transition-colors hover:bg-[#ffd6ff] disabled:opacity-40"
        >
          <RotateCcw size={12} /> Restore this note
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-4 font-mono text-[12px] leading-relaxed">
        {then === undefined && <p className="text-muted/60">Loading…</p>}
        {then === null && <p className="text-muted/60">This note didn't exist at that moment.</p>}
        {then !== undefined && then !== null && !changed && now !== null && (
          <p className="mb-3 text-muted/60">Identical to the current note.</p>
        )}
        {then !== undefined &&
          then !== null &&
          diff.map((d, i) => (
            <div
              key={i}
              className={`whitespace-pre-wrap px-2 ${
                d.kind === "added" ? "bg-[#9fdcb4]/10 text-[#c8f0d6]" : d.kind === "removed" ? "bg-[#ff9ab8]/10 text-[#ffc4d6] line-through decoration-[#ff9ab8]/50" : "text-fg/60"
              }`}
            >
              {d.kind === "added" ? "+ " : d.kind === "removed" ? "− " : "  "}
              {d.text || " "}
            </div>
          ))}
      </div>
    </div>
  );
}
