// Command palette (Ctrl+P), in the spirit of KDE's KRunner (Alt+Space)
// and VS Code's quick open. One box for everything, no mouse needed:
//
//   text      → notes (fuzzy, matched in Rust) followed by matching actions
//   >text     → actions only (Ctrl+Shift+P opens straight into this mode)
//   #tag      → notes carrying that tag
//
// ↑/↓ choose, Enter runs (Ctrl+Enter opens a note in a new tab), Esc closes.

import { ArrowRight, FileText, Hash, Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { allCommands, type Command } from "../lib/commands";
import { fuzzyMatch } from "../lib/fuzzy";
import { ipc } from "../lib/ipc";
import { scrollWithin } from "../lib/scroll";
import { stem } from "../lib/paths";
import type { FileHit, TextHit } from "../lib/types";
import { useLayout } from "../store/layout";
import { useUi } from "../store/ui";
import { Highlighted, indicesToRanges } from "./ui/Highlighted";

/** One row in the palette, whatever its source. */
type Item =
  | { kind: "note"; path: string; label: string; ranges: [number, number][] }
  | { kind: "tag"; path: string; label: string; detail: string }
  | { kind: "command"; command: Command; ranges: [number, number][] };

const MAX_NOTES = 30;

export function CommandPalette() {
  const initial = useUi((s) => s.palette);
  if (initial === null) return null;
  return <Palette initial={initial} />;
}

function Palette({ initial }: { initial: string }) {
  const close = useUi((s) => s.closePalette);
  const [query, setQuery] = useState(initial);
  const [notes, setNotes] = useState<Item[]>([]);
  const [selected, setSelected] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  // Same keyboard-only scrolling rule as the search panel (see lib/scroll.ts).
  const keyboardMove = useRef(false);

  const commandsOnly = query.startsWith(">");
  const tagMode = query.startsWith("#");
  const text = commandsOnly ? query.slice(1).trim() : query.trim();

  useEffect(() => input.current?.focus(), []);

  // Notes (or tag matches) come from Rust; actions are matched locally.
  useEffect(() => {
    if (commandsOnly) {
      setNotes([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      if (tagMode) {
        if (text.length < 2) return setNotes([]);
        const hits: TextHit[] = await ipc.searchTopic("tag", text, MAX_NOTES);
        if (!cancelled) setNotes(hits.map((h) => ({ kind: "tag", path: h.path, label: h.title, detail: h.path })));
      } else {
        const hits: FileHit[] = await ipc.searchFiles(text, MAX_NOTES);
        if (!cancelled)
          setNotes(hits.map((h) => ({ kind: "note", path: h.path, label: h.path, ranges: indicesToRanges(h.indices) })));
      }
    };
    void load().catch(() => !cancelled && setNotes([]));
    return () => {
      cancelled = true;
    };
  }, [text, commandsOnly, tagMode]);

  const commands = useMemo<Item[]>(() => {
    if (tagMode) return [];
    const scored = allCommands()
      .map((c) => ({ c, m: fuzzyMatch(text, c.label) }))
      .filter((x): x is { c: Command; m: NonNullable<typeof x.m> } => x.m !== null);
    // Best matches first (when there's a query); otherwise keep list order.
    if (text) scored.sort((a, b) => b.m.score - a.m.score);
    return scored.map(({ c, m }) => ({ kind: "command", command: c, ranges: indicesToRanges(m.indices) }));
  }, [text, tagMode]);

  // With no query in mixed mode, lead with actions; otherwise notes first.
  const items = useMemo(() => {
    if (commandsOnly) return commands;
    if (!text) return [...commands.slice(0, 8), ...notes];
    return [...notes, ...commands.slice(0, 12)];
  }, [commandsOnly, text, notes, commands]);

  useEffect(() => setSelected(0), [query]);

  useEffect(() => {
    if (!keyboardMove.current || !list.current) return;
    keyboardMove.current = false;
    const el = list.current.querySelector<HTMLElement>(`[data-palette-row="${selected}"]`);
    if (el) scrollWithin(list.current, el);
  }, [selected]);

  const run = (item: Item, newTab: boolean) => {
    close();
    if (item.kind === "command") item.command.run();
    else useLayout.getState().openNote(item.path, { newTab });
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardMove.current = true;
      setSelected((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardMove.current = true;
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && items[selected]) {
      e.preventDefault();
      run(items[selected], e.ctrlKey || e.metaKey);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-start justify-center bg-black/45 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && close()}
    >
      <div className="flex max-h-[64vh] w-[620px] max-w-[92vw] flex-col overflow-hidden rounded-xl border border-line-strong bg-btn shadow-[0_24px_64px_rgb(0_0_0/0.6)]">
        <div className="flex items-center gap-3 border-b border-line px-4">
          <Search size={17} className="shrink-0 text-muted" />
          <input
            ref={input}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            spellCheck={false}
            placeholder="Jump to a note…   > for actions   # for tags"
            className="h-13 flex-1 bg-transparent text-[15px] text-fg outline-none placeholder:text-muted/45"
          />
        </div>
        <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {items.length === 0 && (
            <p className="px-3 py-4 text-[13px] text-muted/55">{text ? "No matches." : "Type to search."}</p>
          )}
          {items.map((item, i) => (
            <button
              key={item.kind === "command" ? `c:${item.command.id}` : `n:${item.path}`}
              data-palette-row={i}
              onMouseMove={() => selected !== i && setSelected(i)}
              onClick={(e) => run(item, e.ctrlKey || e.metaKey)}
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-[13px] ${
                i === selected ? "bg-hover text-fg" : "text-fg/80"
              }`}
            >
              {item.kind === "command" ? (
                <>
                  <ArrowRight size={15} className="shrink-0 text-accent/80" />
                  <span className="min-w-0 flex-1 truncate">
                    <Highlighted text={item.command.label} ranges={item.ranges} />
                  </span>
                  <span className="shrink-0 text-[11px] text-muted/55">{item.command.group}</span>
                  {item.command.shortcut && (
                    <span className="shrink-0 text-[11px] text-muted/80">{item.command.shortcut}</span>
                  )}
                </>
              ) : item.kind === "tag" ? (
                <>
                  <Hash size={15} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate font-medium">{item.label}</span>
                  <span className="shrink-0 truncate text-[11px] text-muted/55">{item.detail}</span>
                </>
              ) : (
                <>
                  <FileText size={15} className="shrink-0 text-muted" />
                  <span className="shrink-0 font-medium">{stem(item.path)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12px] text-muted/60">
                    <Highlighted text={item.label} ranges={item.ranges} />
                  </span>
                </>
              )}
            </button>
          ))}
        </div>
        <div className="flex gap-4 border-t border-line px-4 py-2 text-[11px] text-muted/60">
          <span>↑↓ choose</span>
          <span>Enter open / run</span>
          <span>Ctrl+Enter new tab</span>
          <span>Esc close</span>
        </div>
      </div>
    </div>
  );
}
