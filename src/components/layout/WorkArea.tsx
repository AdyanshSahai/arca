// The main editing area: every tab's split tree is mounted, but only the
// active one is displayed. Keeping inactive tabs mounted preserves each
// editor's undo history, cursor and scroll position across tab switches.

import { useRenderCount } from "../../lib/perf";
import { useEffect } from "react";
import { editorRegistry } from "../../editor/registry";
import { paneIds, useLayout } from "../../store/layout";
import { useUi } from "../../store/ui";
import { stem } from "../../lib/paths";
import { SplitView } from "./SplitView";

export function WorkArea({ hidden }: { hidden: boolean }) {
  useRenderCount("WorkArea");
  const tabs = useLayout((s) => s.tabs);
  const activeTab = useLayout((s) => s.activeTab);
  const choice = useUi((s) => s.paneChoice);

  // Editors in a `display:none` tab can't measure themselves; ask them to
  // re-measure once their tab becomes visible again.
  useEffect(() => {
    const tab = useLayout.getState().tabs.find((t) => t.id === activeTab);
    if (!tab) return;
    requestAnimationFrame(() => {
      for (const id of paneIds(tab.root)) editorRegistry.get(id)?.requestMeasure();
    });
  }, [activeTab, hidden]);

  return (
    // `hidden` is set when the drawer is in full-view mode and covers this area.
    <main className={`relative min-h-0 min-w-0 flex-1 ${hidden ? "hidden" : "flex"}`}>
      {/* While a note waits for a pane, offer the other destinations too:
          a new pane (N) or a new tab (T). */}
      {choice && <PlacementBar />}
      {tabs.map((tab) => (
        <div key={tab.id} className={`min-h-0 min-w-0 flex-1 ${tab.id === activeTab ? "flex" : "hidden"}`}>
          <SplitView node={tab.root} focusedPane={tab.focusedPane} />
        </div>
      ))}
    </main>
  );
}

/** The "or put it somewhere else" buttons shown under the pane prompt. */
function PlacementBar() {
  const choice = useUi((s) => s.paneChoice)!;
  const ui = useUi.getState();
  const layout = useLayout.getState();
  const btn = "btn-soft rounded-full px-4 py-2 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.5)]";
  return (
    <div className="absolute inset-x-0 bottom-5 z-40 flex justify-center gap-2">
      <span className="self-center rounded-full bg-btn/90 px-3 py-1.5 text-[12px] text-muted">
        Put {stem(choice.path)} in…
      </span>
      <button
        className={btn}
        onClick={() => layout.openNoteInNewPane(choice.path, { line: choice.line, create: choice.create })}
      >
        A new pane <kbd className="ml-1.5">N</kbd>
      </button>
      <button
        className={btn}
        onClick={() => {
          ui.cancelPaneChoice();
          layout.openNote(choice.path, { newTab: true, line: choice.line, create: choice.create });
        }}
      >
        A new tab <kbd className="ml-1.5">T</kbd>
      </button>
    </div>
  );
}
