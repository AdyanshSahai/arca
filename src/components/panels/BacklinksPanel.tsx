// Backlinks and topics for the note in the focused pane:
//
//   BACKLINKS  every note whose [[link]] resolves here, with the linking
//              line as context. Click to jump to that line.
//   OUTGOING   [[links]] this note makes (click to follow).
//   TAGS       #tags in this note (click for a vault-wide topic search).
//
// Outgoing links and tags are read from the live buffer, so they update as
// you type; backlinks come from the Rust index and refresh on save.

import { useEffect, useMemo, useState } from "react";
import { followLink } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import { classifyLink } from "../../lib/links";
import { stem } from "../../lib/paths";
import type { Backlink } from "../../lib/types";
import { useBuffers } from "../../store/buffers";
import { useFocusedPane, useLayout } from "../../store/layout";
import { useUi } from "../../store/ui";
import { useVault } from "../../store/vault";
import { Highlighted } from "../ui/Highlighted";

/** Same patterns as the editor / Rust extractor; code isn't excluded here (cheap preview). */
const WIKI_RE = /\[\[([^[\]\n]+?)\]\]/g;
const TAG_RE = /(?:^|[\s(])#([A-Za-z][\w\-/]*)/g;

/** Ranges of every [[…]] in a line, for highlighting backlink context. */
function linkRanges(text: string): [number, number][] {
  return [...text.matchAll(WIKI_RE)].map((m) => [m.index!, m.index! + m[0].length]);
}

export function BacklinksPanel() {
  const path = useFocusedPane()?.path ?? null;
  const revision = useVault((s) => s.revision);
  const content = useBuffers((s) => (path ? s.buffers[path]?.content : undefined));
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
    return <p className="p-4 font-mono text-[11px] text-muted/60">Open a note to see what links to it.</p>;
  }

  return (
    <div className="h-full overflow-y-auto pb-4">
      <Section title={`Backlinks · ${backlinks.length}`}>
        {backlinks.length === 0 && <Empty>nothing links to {stem(path)} yet</Empty>}
        {backlinks.map((b, i) => (
          <button
            key={`${b.source}:${b.line}:${i}`}
            onClick={(e) => useLayout.getState().openNote(b.source, { line: b.line, newTab: e.ctrlKey || e.metaKey })}
            className="block w-full px-3 py-1.5 text-left hover:bg-hover"
          >
            <div className="flex items-baseline gap-2 font-mono text-[12px]">
              <span className="truncate text-fg">{b.title}</span>
              <span className="shrink-0 text-[10px] text-muted/50">:{b.line}</span>
            </div>
            <div className="mt-0.5 line-clamp-2 text-[12px] leading-snug text-fg/55">
              <Highlighted text={b.context} ranges={linkRanges(b.context)} />
            </div>
          </button>
        ))}
      </Section>

      <Section title={`Outgoing · ${outgoing.length}`}>
        {outgoing.length === 0 && <Empty>no [[links]] in this note</Empty>}
        <div className="flex flex-wrap gap-1 px-3">
          {outgoing.map((t) => (
            <button
              key={t}
              onClick={() => void followLink(t, path)}
              className="max-w-full truncate border border-line px-1.5 py-[1px] font-mono text-[11px] text-accent hover:border-accent"
            >
              {t}
              {classifyLink(t) !== "note" && " ↗"}
            </button>
          ))}
        </div>
      </Section>

      <Section title={`Tags · ${tags.length}`}>
        {tags.length === 0 && <Empty>no #tags in this note</Empty>}
        <div className="flex flex-wrap gap-1 px-3">
          {tags.map((t) => (
            <button
              key={t}
              onClick={() => useUi.getState().requestSearch("topic", `#${t}`)}
              className="bg-accent-soft px-1.5 py-[1px] font-mono text-[11px] text-muted hover:text-accent"
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
    <section className="pt-3">
      <h3 className="label mb-1.5 px-3">{title}</h3>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-3 font-mono text-[11px] text-muted/45">{children}</p>;
}
