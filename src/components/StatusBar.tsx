// One-line status bar for the focused pane: path, save state, mode,
// cursor position and word count. Dense and monospace, like a terminal
// multiplexer's status line.

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
    <footer className="flex h-[22px] shrink-0 items-center gap-4 border-t border-line bg-alt px-3 font-mono text-[11px] text-muted">
      {pane?.path ? (
        <>
          <span className={pane.mode === "live" ? "text-accent" : "text-fg/70"}>{pane.mode.toUpperCase()}</span>
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
