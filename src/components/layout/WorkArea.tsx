// The main editing area: every tab's split tree is mounted, but only the
// active one is displayed. Keeping inactive tabs mounted preserves each
// editor's undo history, cursor and scroll position across tab switches.

import { useEffect } from "react";
import { editorRegistry } from "../../editor/registry";
import { paneIds, useLayout } from "../../store/layout";
import { SplitView } from "./SplitView";

export function WorkArea({ hidden }: { hidden: boolean }) {
  const tabs = useLayout((s) => s.tabs);
  const activeTab = useLayout((s) => s.activeTab);

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
    <main className={`min-h-0 min-w-0 flex-1 ${hidden ? "hidden" : "flex"}`}>
      {tabs.map((tab) => (
        <div key={tab.id} className={`min-h-0 min-w-0 flex-1 ${tab.id === activeTab ? "flex" : "hidden"}`}>
          <SplitView node={tab.root} focusedPane={tab.focusedPane} />
        </div>
      ))}
    </main>
  );
}
