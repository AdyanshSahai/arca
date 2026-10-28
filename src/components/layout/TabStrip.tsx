// Note tabs, sitting directly on top of the panes they own (each tab is
// one Konsole-style split layout). The active tab shares the pane area's
// background so the two read as one surface.
//
// Panes can be moved between tabs by dragging a pane's header onto a tab,
// or onto any empty part of the strip (or "+") for a new tab. From the
// keyboard: Ctrl+Shift+PageUp / PageDown / Ctrl+Shift+H (see useKeybindings).

import { useRenderCount } from "../../lib/perf";
import { FileText, Plus, X } from "lucide-react";
import { useState } from "react";
import { stem } from "../../lib/paths";
import { paneIds, type Tab, useLayout } from "../../store/layout";

/** Drag payload type for panes (set by PaneView's header). */
export const PANE_DND_TYPE = "application/x-arca-pane";

export function TabStrip() {
  useRenderCount("TabStrip");
  const tabs = useLayout((s) => s.tabs);
  const activeTab = useLayout((s) => s.activeTab);
  const { newTab, movePane } = useLayout.getState();
  /** Tab (or "new") currently under a dragged pane, for highlighting. */
  const [dropOn, setDropOn] = useState<string | null>(null);

  /**
   * Props that make an element accept dropped panes. Tabs and "+" stop the
   * event there; anything that reaches the strip itself means "new tab".
   */
  const dropTarget = (target: string) => ({
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes(PANE_DND_TYPE)) return;
      e.preventDefault();
      e.stopPropagation(); // the innermost target wins
      e.dataTransfer.dropEffect = "move";
      setDropOn(target);
    },
    onDragLeave: (e: React.DragEvent) => {
      // Moving onto a child element also fires dragleave; ignore those.
      if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
      setDropOn((cur) => (cur === target ? null : cur));
    },
    onDrop: (e: React.DragEvent) => {
      const paneId = e.dataTransfer.getData(PANE_DND_TYPE);
      e.preventDefault();
      e.stopPropagation();
      setDropOn(null);
      if (paneId) movePane(paneId, target);
    },
  });

  return (
    <div
      // The whole strip is a drop zone: empty space = move into a new tab.
      {...dropTarget("new")}
      className={`flex h-10 shrink-0 items-end gap-1 overflow-x-auto border-b border-line px-2 transition-colors [scrollbar-width:none] ${
        dropOn === "new" ? "bg-accent-soft" : "bg-alt"
      }`}
    >
      {tabs.map((tab, i) => (
        <TabButton
          key={tab.id}
          tab={tab}
          index={i}
          active={tab.id === activeTab}
          dropping={dropOn === tab.id}
          dropProps={dropTarget(tab.id)}
        />
      ))}
      <button
        onClick={() => newTab()}
        title="New tab  (Ctrl+T). Drop a pane anywhere on this strip to move it into a new tab"
        className={`mb-1 ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg ${
          dropOn === "new" ? "text-accent" : ""
        }`}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

function TabButton({
  tab,
  index,
  active,
  dropping,
  dropProps,
}: {
  tab: Tab;
  index: number;
  active: boolean;
  dropping: boolean;
  dropProps: Record<string, unknown>;
}) {
  const panes = useLayout((s) => s.panes);
  const { activateTab, closeTab } = useLayout.getState();
  const focused = panes[tab.focusedPane];
  const count = paneIds(tab.root).length;
  const label = focused?.path ? stem(focused.path) : "New tab";

  return (
    <div
      {...dropProps}
      onMouseDown={(e) => {
        // Middle click closes, like browsers and Konsole.
        if (e.button === 1) {
          e.preventDefault();
          closeTab(tab.id);
        } else if (e.button === 0) {
          activateTab(tab.id);
        }
      }}
      title={`${focused?.path ?? "Empty tab"}  (Ctrl+${index + 1})`}
      className={`group relative flex h-9 w-52 shrink-0 cursor-default items-center gap-2.5 rounded-t-lg border-x border-t pr-1.5 pl-3 text-[13px] transition-colors ${
        active
          ? // Same background as the panes below; the 1px overlap hides the
            // strip's bottom border under the active tab.
            "-mb-px border-line bg-void text-fg"
          : "border-transparent text-muted hover:bg-hover/70 hover:text-fg/90"
      } ${dropping ? "ring-1 ring-accent ring-inset bg-accent-soft" : ""}`}
    >
      {active && <div className="absolute inset-x-3 top-0 h-[2px] rounded-b-full bg-accent" />}
      <FileText size={14} className={`shrink-0 ${active ? "text-accent" : "text-muted/70"}`} />
      <span className={`min-w-0 flex-1 truncate ${focused?.path ? "" : "italic opacity-70"}`}>{label}</span>
      {count > 1 && (
        <span className="rounded bg-btn px-1.5 text-[11px] text-muted" title={`${count} split panes`}>
          {count}
        </span>
      )}
      <button
        onMouseDown={(e) => e.stopPropagation()} // don't activate the tab first
        onClick={() => closeTab(tab.id)}
        title="Close tab  (Ctrl+W)"
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-opacity hover:bg-hover hover:text-accent ${
          active ? "opacity-70" : "opacity-0 group-hover:opacity-70"
        }`}
      >
        <X size={13} />
      </button>
    </div>
  );
}
