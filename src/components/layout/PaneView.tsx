// One editing viewport: a slim header (breadcrumb, save state, live/raw
// switch, split and close buttons) above an Editor, or a friendly empty
// state with the essential shortcuts when no note is open.

import { ChevronRight, Columns2, FilePlus, Rows2, Search, X } from "lucide-react";
import { Editor } from "../../editor/Editor";
import { useBuffers } from "../../store/buffers";
import { type EditorMode, useLayout } from "../../store/layout";
import { useUi } from "../../store/ui";
import { useVault } from "../../store/vault";
import { IconButton } from "../ui/IconButton";
import { ArcaMark } from "../ui/ArcaMark";

export function PaneView({ paneId, focused }: { paneId: string; focused: boolean }) {
  const pane = useLayout((s) => s.panes[paneId]);
  const { focusPane, split, closePane, toggleMode } = useLayout.getState();
  // Dirty = text not yet written to disk.
  const dirty = useBuffers((s) => {
    const b = pane?.path ? s.buffers[pane.path] : undefined;
    return !!b && b.loaded && b.content !== b.saved;
  });
  if (!pane) return null;

  const segments = pane.path ? pane.path.replace(/\.(md|markdown)$/i, "").split("/") : [];

  return (
    <div
      data-pane-id={paneId}
      // Capture phase so focus moves even when CodeMirror stops propagation.
      onMouseDownCapture={() => focusPane(paneId)}
      onFocusCapture={() => focusPane(paneId)}
      // w-full + min-w-0: fill the split slot instead of shrinking to content.
      className="relative flex h-full w-full min-w-0 flex-col bg-void"
    >
      {/* Focused pane: a thin accent line along the top edge. */}
      <div className={`absolute inset-x-0 top-0 h-[2px] ${focused ? "bg-accent/70" : "bg-transparent"}`} />
      <div className="flex h-11 shrink-0 items-center gap-1.5 border-b border-line px-4">
        {/* Breadcrumb: folders muted, note name bright. */}
        <div className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-[13px]">
          {segments.length === 0 && <span className="text-muted/50">No note</span>}
          {segments.map((seg, i) => (
            <span key={i} className="flex min-w-0 items-center gap-1">
              {i > 0 && <ChevronRight size={12} className="shrink-0 text-line-strong" />}
              <span
                className={`truncate ${
                  i === segments.length - 1 ? `font-medium ${focused ? "text-fg" : "text-fg/70"}` : "text-muted/70"
                }`}
              >
                {seg}
              </span>
            </span>
          ))}
          {/* Unsaved indicator; autosave clears it within a second. */}
          <span
            className={`ml-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent transition-opacity ${dirty ? "opacity-100" : "opacity-0"}`}
            title="Unsaved changes (autosaving)"
          />
        </div>
        {pane.path && <ModeSwitch mode={pane.mode} onToggle={() => toggleMode(paneId)} />}
        <div className="ml-1 flex items-center">
          <IconButton
            small
            title="Split left / right  (Ctrl+Shift+( )"
            onClick={() => {
              focusPane(paneId);
              split("row");
            }}
          >
            <Columns2 size={14} />
          </IconButton>
          <IconButton
            small
            title="Split top / bottom  (Ctrl+Shift+) )"
            onClick={() => {
              focusPane(paneId);
              split("col");
            }}
          >
            <Rows2 size={14} />
          </IconButton>
          <IconButton small title="Close pane  (Ctrl+Shift+X)" onClick={() => closePane(paneId)}>
            <X size={15} />
          </IconButton>
        </div>
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

/** Two-segment "Live | Raw" switch; clicking either toggles. */
function ModeSwitch({ mode, onToggle }: { mode: EditorMode; onToggle: () => void }) {
  const seg = (m: EditorMode, label: string) => (
    <span
      className={`rounded-[3px] px-2 py-[2px] transition-colors ${
        mode === m ? "bg-btn text-fg shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted/70"
      }`}
    >
      {label}
    </span>
  );
  return (
    <button
      onClick={onToggle}
      title="Toggle live preview / raw markdown  (Ctrl+E)"
      className="flex items-center rounded-[5px] border border-line p-[2px] text-[11px] hover:border-line-strong"
    >
      {seg("live", "Live")}
      {seg("raw", "Raw")}
    </button>
  );
}

/** Shown in panes with no note: quick actions plus the essential shortcuts. */
function EmptyPane() {
  const shortcuts: [string[], string][] = [
    [["Ctrl", "P"], "Quick open"],
    [["Ctrl", "Shift", "F"], "Search the vault"],
    [["Ctrl", "Shift", "("], "Split left / right"],
    [["Ctrl", "Shift", ")"], "Split top / bottom"],
    [["Ctrl", "Alt", "←→"], "Move between panes"],
    [["Ctrl", "E"], "Live / raw markdown"],
    [["Ctrl", "Alt", "P"], "Insert a post-it"],
  ];
  return (
    <div className="flex h-full items-center justify-center overflow-auto p-6">
      <div className="flex w-[340px] max-w-full flex-col items-center">
        <ArcaMark size={36} />
        <p className="mt-4 text-[14px] font-medium text-fg/85">No note open</p>
        <p className="mt-1 text-[12px] text-muted/70">Pick one from the chapters, or start fresh.</p>
        <div className="mt-5 flex gap-2">
          <EmptyAction icon={<Search size={13} />} label="Quick open" onClick={() => useUi.getState().requestSearch("files", "")} />
          <EmptyAction
            icon={<FilePlus size={13} />}
            label="New note"
            onClick={() => useVault.getState().promptNewNote("")}
          />
        </div>
        <div className="mt-8 w-full border-t border-line pt-5">
          {shortcuts.map(([keys, label]) => (
            <div key={label} className="flex items-center justify-between py-[5px] text-[12px]">
              <span className="text-fg/55">{label}</span>
              <span className="flex gap-1">
                {keys.map((k) => (
                  <kbd key={k}>{k}</kbd>
                ))}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function EmptyAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5 rounded-md border border-line-strong bg-btn px-3 py-1.5 text-[12px] text-fg/85 transition-colors hover:border-accent/60 hover:text-accent"
    >
      {icon}
      {label}
    </button>
  );
}
