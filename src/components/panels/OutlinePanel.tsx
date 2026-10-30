// A table of contents for the note in the context pane:
//
//   Kernel Notes
//     Overview
//     Memory
//       Paging        ← the section the cursor is in is highlighted
//       TLB
//     Scheduling
//
// Click a heading to scroll the note to it. The list is built from the
// *live* buffer (not the saved text), so it follows typing; parsing is
// deferred until typing pauses briefly, since the whole note is rescanned.

import { useRenderCount } from "../../lib/perf";
import { useEffect, useMemo, useRef, useState } from "react";
import { currentHeadingIndex, parseHeadings } from "../../lib/headings";
import { stem } from "../../lib/paths";
import { useStatus } from "../../editor/registry";
import { useBuffers } from "../../store/buffers";
import { useContextPane, useLayout } from "../../store/layout";

/** How long typing must pause before the outline is rebuilt. */
const PARSE_DELAY_MS = 150;

export function OutlinePanel() {
  useRenderCount("OutlinePanel");
  const pane = useContextPane();
  const path = pane?.path ?? null;
  const content = useBuffers((s) => (path ? s.buffers[path]?.content : undefined));
  // The cursor line reported by the focused editor (the context pane's
  // editor whenever a note pane has focus).
  const cursorLine = useStatus((s) => s.line);

  // ---- Debounced copy of the note text ------------------------------------
  // Switching notes shows the new outline at once; typing waits for a pause.
  const [text, setText] = useState(content ?? "");
  const lastPath = useRef(path);
  useEffect(() => {
    if (lastPath.current !== path) {
      lastPath.current = path;
      setText(content ?? "");
      return;
    }
    const t = window.setTimeout(() => setText(content ?? ""), PARSE_DELAY_MS);
    return () => window.clearTimeout(t);
  }, [content, path]);

  const headings = useMemo(() => parseHeadings(text), [text]);
  // Indent relative to the shallowest heading, so a note that starts at
  // "##" isn't pushed one step to the right for nothing.
  const minLevel = useMemo(() => Math.min(...headings.map((h) => h.level), 6), [headings]);
  const current = currentHeadingIndex(headings, cursorLine);

  // ---- Keep the highlighted heading visible in long outlines -------------
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => {
    list.current?.querySelector<HTMLElement>("[data-current]")?.scrollIntoView({ block: "nearest" });
  }, [current]);

  if (!path || !pane) {
    return <p className="p-4 text-[12px] text-muted/60">Open a note to see its outline.</p>;
  }

  return (
    <div ref={list} className="h-full overflow-y-auto px-2.5 pb-4 pt-3">
      <h3 className="label mb-2 truncate px-2.5">{stem(path)}</h3>
      {headings.length === 0 && (
        <p className="px-2.5 text-[12px] text-muted/45">No headings yet. Start a line with # to add one.</p>
      )}
      {headings.map((h, i) => (
        <button
          key={`${h.line}:${h.text}`}
          // Read by the scroll effect above.
          data-current={i === current ? "" : undefined}
          onClick={() => useLayout.getState().revealLine(pane.id, h.line)}
          title={`Line ${h.line}`}
          className={`block w-full truncate rounded-md py-[5px] pr-2.5 text-left text-[13px] transition-colors hover:bg-hover ${
            i === current ? "bg-accent-soft text-accent" : h.level === minLevel ? "text-fg" : "text-fg/70"
          }`}
          // 10px base padding plus 14px per level below the shallowest.
          style={{ paddingLeft: 10 + (h.level - minLevel) * 14 }}
        >
          {h.text}
        </button>
      ))}
    </div>
  );
}
