// One editing viewport: a thin header (path, save state, mode, split and
// close buttons) above an Editor, or a shortcut cheat-sheet when empty.

import { Columns2, Rows2, X } from "lucide-react";
import { Editor } from "../../editor/Editor";
import { useBuffers } from "../../store/buffers";
import { useLayout } from "../../store/layout";
import { IconButton } from "../ui/IconButton";

export function PaneView({ paneId, focused }: { paneId: string; focused: boolean }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const { focusPane, split, closePane, toggleMode } = useLayout.getState();
  // Dirty = text not yet written to disk.
  const dirty = useBuffers((s) => {
    const b = pane?.path ? s.buffers[pane.path] : undefined;
    return !!b && b.loaded && b.content !== b.saved;
  });
  if (!pane) return null;

  const segments = pane.path ? pane.path.split("/") : [];

  return (
    <div
      data-pane-id={paneId}
      // Capture phase so focus moves even when CodeMirror stops propagation.
      onMouseDownCapture={() => focusPane(paneId)}
      onFocusCapture={() => focusPane(paneId)}
      className="flex h-full min-h-0 flex-col bg-void"
    >
      <div
        className={`flex h-[26px] shrink-0 items-center gap-2 border-b px-2 font-mono text-[11px] ${
          // The focused pane's header gets the accent underline (Konsole-style).
          focused ? "border-accent/60 bg-alt" : "border-line bg-void"
        }`}
      >
        {/* Breadcrumb: folders muted, file name bright. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 truncate">
          {segments.length === 0 && <span className="text-muted/60">empty</span>}
          {segments.map((seg, i) => (
            <span key={i} className="flex items-center gap-1 truncate">
              {i > 0 && <span className="text-line-strong">/</span>}
              <span className={i === segments.length - 1 ? (focused ? "text-fg" : "text-fg/70") : "text-muted/70"}>
                {seg}
              </span>
            </span>
          ))}
          {dirty && <span className="ml-1 text-accent" title="Unsaved changes (autosaving)">●</span>}
        </div>
        {pane.path && (
          <button
            onClick={() => toggleMode(paneId)}
            title="Toggle live preview / raw markdown (Ctrl+E)"
            className="px-1 tracking-wider text-muted hover:text-accent"
          >
            {pane.mode === "live" ? "LIVE" : "RAW"}
          </button>
        )}
        <IconButton
          small
          title="Split left/right (Ctrl+Shift+()"
          onClick={() => {
            focusPane(paneId);
            split("row");
          }}
        >
          <Columns2 size={13} />
        </IconButton>
        <IconButton
          small
          title="Split top/bottom (Ctrl+Shift+))"
          onClick={() => {
            focusPane(paneId);
            split("col");
          }}
        >
          <Rows2 size={13} />
        </IconButton>
        <IconButton small title="Close pane (Ctrl+Shift+X)" onClick={() => closePane(paneId)}>
          <X size={13} />
        </IconButton>
      </div>
      <div className="min-h-0 flex-1">
        {pane.path ? (
          // Keyed by path: a different note gets a fresh editor (own history).
          <Editor key={pane.path} pane={pane} path={pane.path} focused={focused} />
        ) : (
          <EmptyPane />
        )}
      </div>
    </div>
  );
}

/** Shortcut list shown in empty panes. Plain and dense, like a man page. */
function EmptyPane() {
  const rows: [string, string][] = [
    ["Ctrl+P", "quick open"],
    ["Ctrl+N", "new note"],
    ["Ctrl+Shift+F", "search vault"],
    ["Ctrl+Shift+(", "split left / right"],
    ["Ctrl+Shift+)", "split top / bottom"],
    ["Ctrl+Alt+Arrows", "move between panes"],
    ["Ctrl+Tab", "next tab"],
    ["Ctrl+E", "live / raw"],
    ["Ctrl+Alt+P", "insert post-it"],
    ["Ctrl+B", "toggle drawer"],
  ];
  return (
    <div className="flex h-full items-center justify-center">
      <table className="font-mono text-[11px]">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k}>
              <td className="pr-6 text-right text-muted">{k}</td>
              <td className="py-[3px] text-fg/50">{v}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
