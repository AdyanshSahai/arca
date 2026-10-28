// One-line status bar for the focused pane: mode, path, save state,
// cursor position and word count.

import { useStatus } from "../editor/registry";
import { useBuffers } from "../store/buffers";
import { useFocusedPane, useLayout } from "../store/layout";

export function StatusBar() {
  const pane = useFocusedPane();
  const status = useStatus();
  const tabs = useLayout((s) => s.tabs.length);
  const buffer = useBuffers((s) => (pane?.path ? s.buffers[pane.path] : undefined));
  const dirty = !!buffer && buffer.content !== buffer.saved;

  return (
    <footer className="flex h-7 shrink-0 items-center gap-5 border-t border-line bg-alt px-4 text-[12px] text-muted/80 tabular-nums">
      {pane?.path ? (
        <>
          <span className={`font-medium ${pane.mode === "live" ? "text-accent" : "text-fg/70"}`}>
            {pane.mode === "live" ? "Live preview" : "Raw markdown"}
          </span>
          {pane.readOnly && <span className="font-medium text-[#f0cf8a]">Read-only</span>}
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
