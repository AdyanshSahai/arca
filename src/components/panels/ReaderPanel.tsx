// Reader: a note shown fully rendered, never editable, with no markdown
// ever revealed, for scrolling through notes comfortably while the panes
// stay as they are.
//
// - By default it follows the note you're working on (the context pane).
// - Clicking a [[link]] (or #tag) inside it navigates the Reader itself;
//   Back returns, and "Follow current note" goes back to following.
// - "Open in pane" opens the note being read in a pane, the same way any
//   sidebar opens notes.

import { ArrowLeft, BookOpen, Crosshair, PanelRight } from "lucide-react";
import { useCallback, useEffect } from "react";
import { Editor } from "../../editor/Editor";
import { openFromSidebar } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import { isNotePath, isTextPath, stem } from "../../lib/paths";
import { useBuffers } from "../../store/buffers";
import { type Pane, useContextPane } from "../../store/layout";
import { useUi } from "../../store/ui";

export function ReaderPanel() {
  const reader = useUi((s) => s.reader);
  const contextPath = useContextPane()?.path ?? null;
  // An explicit note, or the note being worked on.
  const path = reader.path ?? contextPath;
  const following = reader.path === null;

  // Make sure the note's text is loaded (it may not be open in any pane).
  useEffect(() => {
    if (path) void useBuffers.getState().ensure(path);
  }, [path]);

  /** Links clicked inside the Reader navigate the Reader. */
  const follow = useCallback(
    async (target: string) => {
      if (!path) return;
      try {
        // Rust resolves the link; URLs and files are opened by it directly.
        const res = await ipc.followLink(target, path);
        if (res.kind === "note") useUi.getState().readNote(res.path);
        else if (res.kind === "missing") useUi.getState().toast(`“${res.target}” doesn't exist yet`);
      } catch (err) {
        useUi.getState().toast(errorMessage(err), "error");
      }
    },
    [path],
  );

  if (!path || !(isNotePath(path) || isTextPath(path))) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <BookOpen size={22} className="text-muted/50" />
        <p className="text-[13px] text-muted/70">Open a note and it shows up here, rendered and read-only.</p>
      </div>
    );
  }

  // A minimal pane description for the shared Editor component; "reader" is
  // its own id, so it never collides with a real pane.
  const readerPane: Pane = { id: "reader", path, mode: "live" };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line px-3">
        <button
          onClick={() => useUi.getState().readerBack()}
          disabled={reader.history.length === 0 && following}
          title="Back"
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-30"
        >
          <ArrowLeft size={15} />
        </button>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-fg" title={path}>
          {stem(path)}
        </span>
        {!following && (
          <button
            onClick={() => useUi.getState().readNote(null)}
            title="Go back to following the note you're working on"
            className="btn-soft flex shrink-0 items-center gap-1 rounded-md px-2 py-[3px] text-[11px]"
          >
            <Crosshair size={12} /> Follow current
          </button>
        )}
        <button
          onClick={() => openFromSidebar(path)}
          title="Open this note in a pane to edit it"
          className="btn-soft flex shrink-0 items-center gap-1 rounded-md px-2 py-[3px] text-[11px]"
        >
          <PanelRight size={12} /> Open in pane
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {/* Keyed by path so each note gets a fresh read-only editor. */}
        <Editor key={path} pane={readerPane} path={path} focused={false} readOnly onFollow={follow} />
      </div>
    </div>
  );
}
