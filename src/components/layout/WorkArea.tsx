// The main editing area: every tab's split tree is mounted, but only the
// active one is displayed. Keeping inactive tabs mounted preserves each
// editor's undo history, cursor and scroll position across tab switches.

import { useEffect } from "react";
import { editorRegistry } from "../../editor/registry";
import { paneIds, useLayout } from "../../store/layout";
import { useUi } from "../../store/ui";
import { PANELS } from "../panels/registry";
import { SplitView } from "./SplitView";

export function WorkArea({ hidden }: { hidden: boolean }) {
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
      {/* While a sidebar view waits for a pane, also offer a new pane of its
          own (N) or the sidebar (S). */}
      {choice?.kind === "view" && (
        <div className="absolute inset-x-0 bottom-5 z-40 flex justify-center gap-2">
          <button
            onClick={() => {
              useUi.getState().cancelPaneChoice();
              useLayout.getState().openViewInNewPane(choice.view);
            }}
            className="btn-soft rounded-full px-4 py-2 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
          >
            {PANELS[choice.view].title} in a new pane <kbd className="ml-1.5">N</kbd>
          </button>
          <button
            onClick={() => {
              useUi.getState().cancelPaneChoice();
              useUi.getState().showPanel(choice.view);
            }}
            className="btn-soft rounded-full px-4 py-2 text-[13px] shadow-[0_8px_24px_rgb(0_0_0/0.5)]"
          >
            Keep it in the sidebar <kbd className="ml-1.5">S</kbd>
          </button>
        </div>
      )}
      {tabs.map((tab) => (
        <div key={tab.id} className={`min-h-0 min-w-0 flex-1 ${tab.id === activeTab ? "flex" : "hidden"}`}>
          <SplitView node={tab.root} focusedPane={tab.focusedPane} />
        </div>
      ))}
    </main>
  );
}
