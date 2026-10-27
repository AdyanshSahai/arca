// Search drawer with three modes, all answered by the Rust backend:
//
//   FILES  fuzzy match on note paths (wrap in /…/ for a regex)
//   TEXT   Tantivy full-text over titles + bodies, whole vault or the
//          focused note's folder
//   TOPIC  notes carrying a #tag, or linking a [[note]]; with an empty
//          query it lists every tag in the vault
//
// ↑/↓ move the selection, Enter opens it, Ctrl+Enter opens it in a new tab.

import { useEffect, useRef, useState } from "react";
import { errorMessage, ipc } from "../../lib/ipc";
import { dirName } from "../../lib/paths";
import type { FileHit, TagCount, TextHit } from "../../lib/types";
import { useFocusedPane, useLayout } from "../../store/layout";
import { type SearchMode, useUi } from "../../store/ui";
import { useVault } from "../../store/vault";
import { Search as SearchIcon } from "lucide-react";
import { scrollWithin } from "../../lib/scroll";
import { Highlighted, indicesToRanges } from "../ui/Highlighted";
import { Segmented } from "../ui/Segmented";

/** Delay between the last keystroke and the query (results feel instant). */
const DEBOUNCE_MS = 60;

const MODES: { id: SearchMode; label: string; hint: string }[] = [
  { id: "files", label: "Files", hint: "fuzzy name…  or /regex/" },
  { id: "text", label: "Text", hint: 'words, "phrases", -exclude' },
  { id: "topic", label: "Topic", hint: "#tag  or  [[note]]" },
];

/** A result row, normalised across the three modes. */
type Row = { path: string; title: string; detail?: React.ReactNode; titleNode?: React.ReactNode };

export function SearchPanel() {
  const request = useUi((s) => s.searchRequest);
  const revision = useVault((s) => s.revision);
  const pane = useFocusedPane();
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  /** Text mode: restrict to the focused note's folder. */
  const [folderOnly, setFolderOnly] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [tags, setTags] = useState<TagCount[]>([]);
  const [selected, setSelected] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  /** The scrollable results list. */
  const list = useRef<HTMLDivElement>(null);
  /**
   * True when the selection last moved by keyboard. Only then do we scroll:
   * scrolling on mouse hover would move a new row under the pointer and
   * start an endless hover → scroll → hover loop.
   */
  const keyboardMove = useRef(false);

  const scopeDir = pane?.path ? dirName(pane.path) : "";

  // Shortcut requests (Ctrl+P, Ctrl+Shift+F, tag clicks) switch mode/query.
  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    if (request.query !== undefined) setQuery(request.query);
    input.current?.focus();
    input.current?.select();
  }, [request]);

  // The query text of the previous search run, to tell typing apart from
  // clicks on the mode / scope switches.
  const lastQuery = useRef(query);

  // Run the search whenever its inputs or the vault change. Only typing is
  // debounced. Mode and scope switches are deliberate clicks, so they
  // search immediately instead of feeling sluggish.
  useEffect(() => {
    let cancelled = false;
    const typed = query !== lastQuery.current;
    lastQuery.current = query;
    const handle = window.setTimeout(async () => {
      try {
        const q = query.trim();
        let next: Row[] = [];
        if (mode === "files") {
          const hits: FileHit[] = await ipc.searchFiles(q);
          next = hits.map((h) => ({
            path: h.path,
            title: h.path,
            titleNode: <Highlighted text={h.path} ranges={indicesToRanges(h.indices)} />,
          }));
        } else if (q) {
          const hits: TextHit[] =
            mode === "text"
              ? await ipc.searchText(q, folderOnly && scopeDir ? scopeDir : undefined)
              : // "[[cpu" / "[[cpu]]" searches links; anything else is a tag.
                await ipc.searchTopic(q.startsWith("[[") ? "link" : "tag", q);
          next = hits.map((h) => ({
            path: h.path,
            title: h.title,
            detail: <Highlighted text={h.snippet.text} ranges={h.snippet.highlights} />,
          }));
        } else if (mode === "topic") {
          setTags(await ipc.listTags());
        }
        if (!cancelled) {
          setRows(next);
          setSelected(0);
          setError(null);
        }
      } catch (err) {
        // e.g. an invalid /regex/; show it inline rather than as a toast.
        if (!cancelled) setError(errorMessage(err));
      }
    }, typed ? DEBOUNCE_MS : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mode, query, folderOnly, scopeDir, revision]);

  const openRow = (row: Row, newTab: boolean) => useLayout.getState().openNote(row.path, { newTab });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      keyboardMove.current = true;
      setSelected((s) => Math.min(s + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      keyboardMove.current = true;
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && rows[selected]) {
      e.preventDefault();
      openRow(rows[selected], e.ctrlKey || e.metaKey);
    }
  };

  // Keep the selected row visible while arrowing through results (keyboard
  // only; see `keyboardMove`). Scrolls just the list, never the window.
  useEffect(() => {
    if (!keyboardMove.current || !list.current) return;
    keyboardMove.current = false;
    const row = list.current.querySelector<HTMLElement>(`[data-search-row="${selected}"]`);
    if (row) scrollWithin(list.current, row);
  }, [selected]);

  const showTagCloud = mode === "topic" && !query.trim();

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center border-b border-line px-4">
        <Segmented
          value={mode}
          options={MODES.map((m) => ({ id: m.id, label: m.label }))}
          onChange={(m) => {
            setMode(m);
            input.current?.focus();
          }}
        />
      </div>

      <div className="shrink-0 border-b border-line px-4 py-3">
        <div className="relative">
          <SearchIcon size={14} className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-muted/60" />
          <input
          ref={input}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder={MODES.find((m) => m.id === mode)!.hint}
          className="h-9 w-full rounded-md border border-line-strong bg-void pr-3 pl-8 text-[13px] text-fg transition-colors placeholder:text-muted/40 focus:border-accent focus:outline-none"
          />
        </div>
        {mode === "text" && (
          <div className="mt-2.5 flex items-center gap-3 text-[12px]">
            <span className="text-muted/60">Search in</span>
            <ScopeOption checked={!folderOnly} onClick={() => setFolderOnly(false)} label="vault" />
            <ScopeOption
              checked={folderOnly}
              onClick={() => setFolderOnly(true)}
              label={scopeDir ? `${scopeDir}/` : "current folder"}
              disabled={!scopeDir}
            />
          </div>
        )}
      </div>

      <div ref={list} className="min-h-0 flex-1 overflow-y-auto p-2">
        {error && <p className="px-4 py-3 text-[12px] text-[#ff9ab8]">{error}</p>}

        {showTagCloud && (
          <div className="flex flex-wrap gap-1.5 p-3">
            {tags.length === 0 && <span className="text-[12px] text-muted/50">No #tags in this vault yet.</span>}
            {tags.map((t) => (
              <button
                key={t.tag}
                onClick={() => setQuery(`#${t.tag}`)}
                className="rounded-full bg-accent-soft px-2.5 py-[3px] text-[12px] text-muted transition-colors hover:text-accent"
              >
                #{t.tag} <span className="ml-0.5 text-muted/50">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {!showTagCloud && rows.length === 0 && query.trim() && !error && (
          <p className="px-4 py-3 text-[12px] text-muted/50">No matches.</p>
        )}

        {rows.map((row, i) => (
          <button
            key={row.path}
            data-search-row={i}
            // onMouseMove, not onMouseEnter: rows sliding under a still
            // pointer (results updating) must not steal the selection.
            onMouseMove={() => selected !== i && setSelected(i)}
            onClick={(e) => openRow(row, e.ctrlKey || e.metaKey)}
            className={`block w-full rounded-md px-3 py-2 text-left transition-colors ${
              i === selected ? "bg-hover shadow-[inset_2px_0_0_var(--accent-magenta)]" : ""
            }`}
          >
            <div className="truncate text-[13px] font-medium text-fg">{row.titleNode ?? row.title}</div>
            {row.detail && (
              <>
                <div className="truncate text-[11px] text-muted/60">{row.path}</div>
                <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg/60">{row.detail}</div>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

function ScopeOption({
  checked,
  onClick,
  label,
  disabled,
}: {
  checked: boolean;
  onClick: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      className={`flex items-center gap-1 disabled:opacity-30 ${checked ? "text-accent" : "text-muted hover:text-fg"}`}
    >
      {/* Round radio mark. */}
      <span
        className={`inline-block h-2.5 w-2.5 rounded-full border ${checked ? "border-accent bg-accent shadow-[inset_0_0_0_2px_var(--bg-alternate)]" : "border-muted/60"}`}
      />
      <span className="max-w-40 truncate">{label}</span>
    </button>
  );
}
