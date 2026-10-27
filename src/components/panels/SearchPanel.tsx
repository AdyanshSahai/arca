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
import { Highlighted, indicesToRanges } from "../ui/Highlighted";

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

  const scopeDir = pane?.path ? dirName(pane.path) : "";

  // Shortcut requests (Ctrl+P, Ctrl+Shift+F, tag clicks) switch mode/query.
  useEffect(() => {
    if (!request) return;
    setMode(request.mode);
    if (request.query !== undefined) setQuery(request.query);
    input.current?.focus();
    input.current?.select();
  }, [request]);

  // Run the search (debounced) whenever its inputs or the vault change.
  useEffect(() => {
    let cancelled = false;
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
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(handle);
    };
  }, [mode, query, folderOnly, scopeDir, revision]);

  const openRow = (row: Row, newTab: boolean) => useLayout.getState().openNote(row.path, { newTab });

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter" && rows[selected]) {
      e.preventDefault();
      openRow(rows[selected], e.ctrlKey || e.metaKey);
    }
  };

  // Keep the selected row visible while arrowing through results.
  useEffect(() => {
    document.querySelector(`[data-search-row="${selected}"]`)?.scrollIntoView({ block: "nearest" });
  }, [selected]);

  const showTagCloud = mode === "topic" && !query.trim();

  return (
    <div className="flex h-full flex-col">
      {/* Mode switcher: a segmented control drawn as plain text tabs. */}
      <div className="flex h-8 shrink-0 items-stretch border-b border-line px-2 text-[11px]">
        {MODES.map((m) => (
          <button
            key={m.id}
            onClick={() => {
              setMode(m.id);
              input.current?.focus();
            }}
            className={`relative px-2 uppercase tracking-wider ${mode === m.id ? "text-accent" : "text-muted hover:text-fg"}`}
          >
            {m.label}
            {mode === m.id && <div className="absolute inset-x-2 bottom-0 h-px bg-accent" />}
          </button>
        ))}
      </div>

      <div className="shrink-0 border-b border-line p-2">
        <input
          ref={input}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          spellCheck={false}
          placeholder={MODES.find((m) => m.id === mode)!.hint}
          className="h-7 w-full border border-line-strong bg-void px-2 text-[12px] text-fg placeholder:text-muted/40 focus:border-accent focus:outline-none"
        />
        {mode === "text" && (
          <div className="mt-2 flex items-center gap-3 text-[11px]">
            <span className="text-muted/60">scope</span>
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

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error && <p className="px-3 py-2 text-[11px] text-[#ff9ab8]">{error}</p>}

        {showTagCloud && (
          <div className="flex flex-wrap gap-1 p-3">
            {tags.length === 0 && <span className=" text-[11px] text-muted/50">no #tags in this vault yet</span>}
            {tags.map((t) => (
              <button
                key={t.tag}
                onClick={() => setQuery(`#${t.tag}`)}
                className="bg-accent-soft px-1.5 py-[1px] text-[11px] text-muted hover:text-accent"
              >
                #{t.tag} <span className="text-muted/50">{t.count}</span>
              </button>
            ))}
          </div>
        )}

        {!showTagCloud && rows.length === 0 && query.trim() && !error && (
          <p className="px-3 py-2 text-[11px] text-muted/50">no matches</p>
        )}

        {rows.map((row, i) => (
          <button
            key={row.path}
            data-search-row={i}
            onMouseEnter={() => setSelected(i)}
            onClick={(e) => openRow(row, e.ctrlKey || e.metaKey)}
            className={`block w-full border-l-2 px-3 py-1.5 text-left ${
              i === selected ? "border-accent bg-hover" : "border-transparent"
            }`}
          >
            <div className="truncate text-[12px] text-fg">{row.titleNode ?? row.title}</div>
            {row.detail && (
              <>
                <div className="truncate text-[10px] text-muted/60">{row.path}</div>
                <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-fg/60">{row.detail}</div>
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
      {/* Square "radio" mark in keeping with the pixel theme. */}
      <span className={`inline-block h-2 w-2 border ${checked ? "border-accent bg-accent" : "border-muted"}`} />
      <span className="max-w-40 truncate">{label}</span>
    </button>
  );
}
