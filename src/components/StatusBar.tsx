// One-line status bar for the focused pane: mode, path, save state,
// cursor position and word count.

import { useRenderCount } from "../lib/perf";
import { useStatus } from "../editor/registry";
import { useBuffers } from "../store/buffers";
import { useContextPane, useLayout } from "../store/layout";
import { useUi } from "../store/ui";

export function StatusBar() {
  useRenderCount("StatusBar");
  const pane = useContextPane();
  const reading = useUi((s) => s.reading);
  const status = useStatus();
  const tabs = useLayout((s) => s.tabs.length);
  const buffer = useBuffers((s) => (pane?.path ? s.buffers[pane.path] : undefined));
  const dirty = !!buffer && buffer.content !== buffer.saved;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-5 border-t border-line bg-alt px-4 text-[12px] text-muted/80 tabular-nums">
      {pane?.path ? (
        <>
          <span className={`font-medium ${reading || pane.mode === "live" ? "text-accent" : "text-fg/70"}`}>
            {reading ? "Reading" : pane.mode === "live" ? "Live preview" : "Raw markdown"}
          </span>
          <span className="truncate text-fg/60">{pane.path}</span>
          <span className={dirty ? "text-accent" : "text-muted/60"}>{dirty ? "saving…" : "saved"}</span>
          <div className="flex-1" />
          <span>
            Ln {status.line}, Col {status.col}
          </span>
          <span>{status.words} words</span>
        </>
      ) : (
        <div className="flex-1" />
      )}
      <span className="text-muted/50">{tabs} tab{tabs === 1 ? "" : "s"}</span>
    </footer>
  );
}
