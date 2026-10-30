// Backlinks and topics for the note in the focused pane:
//
//   BACKLINKS  every note whose [[link]] resolves here, with the linking
//              line as context. Click to jump to that line.
//   OUTGOING   [[links]] this note makes (click to follow).
//   TAGS       #tags in this note (click for a vault-wide topic search).
//
// Outgoing links and tags are read from the note's saved text (they update
// right after the autosave); backlinks come from the Rust index.

import { useRenderCount } from "../../lib/perf";
import { useEffect, useMemo, useState } from "react";
import { followLink, openFromSidebar } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import { classifyLink } from "../../lib/links";
import { stem } from "../../lib/paths";
import type { Backlink } from "../../lib/types";
import { useBuffers } from "../../store/buffers";
import { useContextPane } from "../../store/layout";
import { useUi } from "../../store/ui";
import { useVault } from "../../store/vault";
import { Highlighted } from "../ui/Highlighted";

/** Same patterns as the editor / Rust extractor; code isn't excluded here (cheap preview). */
const WIKI_RE = /\[\[([^[\]\n]+?)\]\]/g;
const TAG_RE = /(?:^|[\s(])#([A-Za-z][\w\-/]*)/g;

/**
 * A backlink's context line as live preview would show it: `[[target|alias]]`
 * becomes "alias" (or "target"), and emphasis, code and list/quote/heading
 * markers are dropped. Returns the text plus the ranges of the links in
 * it, which get highlighted.
 */
function renderContext(raw: string): { text: string; ranges: [number, number][] } {
  // Leading block markers: "- ", "1. ", "> ", "## ", "- [ ] ".
  const line = raw.replace(/^\s*(?:>\s*)*(?:#{1,6}\s+|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)?/, "");
  /** Drops emphasis/code markers from a plain stretch of text. */
  const plain = (t: string) => t.replace(/(\*\*|~~|==|[*`])/g, "");
  let text = "";
  const ranges: [number, number][] = [];
  let pos = 0;
  for (const m of line.matchAll(WIKI_RE)) {
    text += plain(line.slice(pos, m.index));
    const [target, alias] = m[1].split("|");
    const shown = (alias ?? target).trim();
    ranges.push([text.length, text.length + shown.length]);
    text += shown;
    pos = m.index! + m[0].length;
  }
  text += plain(line.slice(pos));
  return { text, ranges };
}

export function BacklinksPanel() {
  useRenderCount("BacklinksPanel");
  const path = useContextPane()?.path ?? null;
  const revision = useVault((s) => s.revision);
  // The *saved* text, not the live buffer: re-scanning a whole note for
  // links and tags on every keystroke was wasted work, and saved text
  // catches up within a second of typing pausing.
  const content = useBuffers((s) => (path ? s.buffers[path]?.saved : undefined));
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  useEffect(() => {
    if (!path) return setBacklinks([]);
    let cancelled = false;
    ipc
      .backlinks(path)
      .then((b) => !cancelled && setBacklinks(b))
      .catch((err) => useUi.getState().toast(errorMessage(err), "error"));
    return () => {
      cancelled = true;
    };
  }, [path, revision]);

  // Outgoing links (unique targets, in order of appearance) and tags.
  const { outgoing, tags } = useMemo(() => {
    const text = content ?? "";
    const targets = [...text.matchAll(WIKI_RE)].map((m) => m[1].split("|")[0].trim()).filter(Boolean);
    const tagList = [...text.matchAll(TAG_RE)].map((m) => m[1].toLowerCase());
    return { outgoing: [...new Set(targets)], tags: [...new Set(tagList)] };
  }, [content]);

  if (!path) {
    return <p className="p-4 text-[12px] text-muted/60">Open a note to see what links to it.</p>;
  }

  return (
    <div className="h-full overflow-y-auto px-2.5 pb-4">
      <Section title={`Backlinks · ${backlinks.length}`}>
        {backlinks.length === 0 && <Empty>Nothing links to {stem(path)} yet.</Empty>}
        {backlinks.map((b, i) => (
          <button
            key={`${b.source}:${b.line}:${i}`}
            onClick={(e) => openFromSidebar(b.source, { line: b.line, newTab: e.ctrlKey || e.metaKey })}
            className="block w-full rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover"
          >
            <div className="flex items-baseline gap-2 text-[13px]">
              <span className="truncate font-medium text-fg">{b.title}</span>
              <span className="shrink-0 text-[11px] text-muted/50 tabular-nums">line {b.line}</span>
            </div>
            <div className="mt-1 line-clamp-2 text-[12px] leading-snug text-fg/55">
              <Highlighted {...renderContext(b.context)} />
            </div>
          </button>
        ))}
      </Section>

      <Section title={`Outgoing · ${outgoing.length}`}>
        {outgoing.length === 0 && <Empty>No [[links]] in this note.</Empty>}
        <div className="flex flex-wrap gap-1.5 px-2.5">
          {outgoing.map((t) => (
            <button
              key={t}
              onClick={() => void followLink(t, path)}
              className="max-w-full truncate rounded-md border border-line px-2 py-[3px] text-[12px] text-accent transition-colors hover:border-accent/60"
            >
              {t}
              {classifyLink(t) !== "note" && " ↗"}
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Tags · ${tags.length}`}>
        {tags.length === 0 && <Empty>No #tags in this note.</Empty>}
        <div className="flex flex-wrap gap-1.5 px-2.5">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => useUi.getState().requestSearch("topic", `#${t}`)}
              className="rounded-full bg-accent-soft px-2.5 py-[3px] text-[12px] text-muted transition-colors hover:text-accent"
            >
              #{t}
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="pt-4">
      <h3 className="label mb-2 px-2.5">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-2.5 text-[12px] text-muted/45">{children}</p>;
}
