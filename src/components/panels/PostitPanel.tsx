// Every post-it in the vault, gathered in one place so they can be read and
// edited without scrolling through their notes.
//
// Each card edits the post-it's text and colour in place. Saving (blur or
// Ctrl+Enter) rewrites just that block in the .md file through Rust, then
// pushes the new file text into any open editor. "↗" jumps to the post-it
// inside its note. A filter switches between all notes and the focused one.

import { ArrowUpRight, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { insertPostitInFocused } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import type { PostItEntry } from "../../lib/types";
import { POSTIT_COLORS, safeColor } from "../../editor/postits";
import { useBuffers } from "../../store/buffers";
import { useFocusedPane, useLayout } from "../../store/layout";
import { useUi } from "../../store/ui";
import { useVault } from "../../store/vault";
import { Segmented } from "../ui/Segmented";

export function PostitPanel() {
  const revision = useVault((s) => s.revision);
  const focusedPath = useFocusedPane()?.path ?? null;
  // Refetch when the focused buffer changes too, so post-its typed in the
  // editor appear after the autosave.
  const savedText = useBuffers((s) => (focusedPath ? s.buffers[focusedPath]?.saved : undefined));
  const [all, setAll] = useState<PostItEntry[]>([]);
  const [onlyCurrent, setOnlyCurrent] = useState(false);

  useEffect(() => {
    let cancelled = false;
    ipc
      .listPostits()
      .then((p) => !cancelled && setAll(p))
      .catch((err) => useUi.getState().toast(errorMessage(err), "error"));
    return () => {
      cancelled = true;
    };
  }, [revision, savedText]);

  const shown = onlyCurrent ? all.filter((p) => p.path === focusedPath) : all;

  // Group consecutive entries by note (Rust already sorts by path).
  const groups = useMemo(() => {
    const out: { path: string; title: string; items: PostItEntry[] }[] = [];
    for (const p of shown) {
      const last = out[out.length - 1];
      if (last && last.path === p.path) last.items.push(p);
      else out.push({ path: p.path, title: p.noteTitle, items: [p] });
    }
    return out;
  }, [shown]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-[12px]">
        <Segmented
          value={onlyCurrent ? "note" : "all"}
          options={[
            { id: "all", label: `All · ${all.length}` },
            { id: "note", label: "This note", disabled: !focusedPath },
          ]}
          onChange={(v) => setOnlyCurrent(v === "note")}
        />
        <div className="flex-1" />
        <button
          onClick={insertPostitInFocused}
          title="Insert a post-it at the cursor  (Ctrl+Alt+P)"
          className="flex items-center gap-1 rounded-md px-2 py-1 text-muted transition-colors hover:bg-hover hover:text-accent"
        >
          <Plus size={13} /> New
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {shown.length === 0 && (
          <p className="text-[12px] leading-relaxed text-muted/50">
            No post-its {onlyCurrent ? "in this note" : "yet"}. Put the cursor in a note and press Ctrl+Alt+P.
          </p>
        )}
        {groups.map((g) => (
          <section key={g.path} className="mb-4">
            <h3 className="label mb-1.5 truncate" title={g.path}>
              {g.title}
            </h3>
            <div className="flex flex-col gap-2">
              {g.items.map((p) => (
                <PostitCard key={`${p.path}#${p.id}`} entry={p} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function PostitCard({ entry }: { entry: PostItEntry }) {
  const [text, setText] = useState(entry.text);
  const color = safeColor(entry.color);

  // Take updates from disk unless the user is mid-edit on this card.
  const [editing, setEditing] = useState(false);
  useEffect(() => {
    if (!editing) setText(entry.text);
  }, [entry.text, editing]);

  /** Writes text/colour to disk and syncs any open editor on that note. */
  const save = async (nextText: string, nextColor?: string) => {
    if (nextText === entry.text && (!nextColor || nextColor === entry.color)) return;
    try {
      const buffers = useBuffers.getState();
      // Flush pending typing in that note first so nothing is lost.
      await buffers.flush(entry.path);
      const updated = await ipc.updatePostit(entry.path, entry.id, nextText, nextColor);
      buffers.replace(entry.path, updated, true);
      await useVault.getState().refresh();
    } catch (err) {
      useUi.getState().toast(`Could not save post-it: ${errorMessage(err)}`, "error");
    }
  };

  return (
    <div
      // `--pc` drives the frame colour, matching the in-editor post-it.
      style={{ ["--pc" as string]: `var(--postit-${color})` }}
      className="overflow-hidden rounded-md border border-l-[3px] border-[color-mix(in_srgb,var(--pc)_28%,transparent)] border-l-[var(--pc)] bg-[color-mix(in_srgb,var(--pc)_7%,transparent)] transition-colors focus-within:border-[color-mix(in_srgb,var(--pc)_55%,transparent)]"
    >
      <textarea
        value={text}
        onFocus={() => setEditing(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          setEditing(false);
          void save(text);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) (e.target as HTMLTextAreaElement).blur();
        }}
        rows={Math.min(8, Math.max(2, text.split("\n").length))}
        spellCheck={false}
        className="block w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-fg outline-none"
      />
      <div className="flex items-center gap-1.5 px-3 pb-2">
        {POSTIT_COLORS.map((c) => (
          <button
            key={c}
            title={c}
            onClick={() => void save(text, c)}
            style={{ background: `var(--postit-${c})` }}
            className={`h-3 w-3 rounded-full transition-opacity ${c === color ? "outline outline-1 outline-offset-2 outline-fg/70" : "opacity-50 hover:opacity-100"}`}
          />
        ))}
        <div className="flex-1" />
        <span className="text-[11px] text-muted/50 tabular-nums">line {entry.line}</span>
        <button
          onClick={() => useLayout.getState().openNote(entry.path, { line: entry.line, pick: true })}
          title="Show in note"
          className="text-muted hover:text-accent"
        >
          <ArrowUpRight size={13} />
        </button>
      </div>
    </div>
  );
}
