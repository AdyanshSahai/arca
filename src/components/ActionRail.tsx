// Fixed vertical action bar on the far left. Each icon opens a view
// (chapters, graph, search, backlinks, post-its) in the sidebar drawer, or,
// in a split tab, in a pane the user picks. The bottom button switches
// vaults.

import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, FolderOpen, PenLine, Settings } from "lucide-react";
import { paneIds, useLayout } from "../store/layout";
import { type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { PANEL_ORDER, PANELS } from "./panels/registry";
import { IconButton } from "./ui/IconButton";

/**
 * Rail click. If the view is already in the drawer, close it; if it's
 * already shown in a pane of this tab, focus that pane. Otherwise follow
 * the "views open in" preference: straight into the sidebar (default; the
 * drawer's "Move to pane" button moves it later), or ask every time (a
 * pane 1–9, a new pane N, a new tab T, or the sidebar S).
 */
function openView(id: PanelId) {
  const ui = useUi.getState();
  const layout = useLayout.getState();
  if (ui.panel === id) return ui.closeDrawer();
  const tab = layout.tabs.find((t) => t.id === layout.activeTab);
  const ids = tab ? paneIds(tab.root) : [];
  const existing = ids.find((p) => layout.panes[p]?.view === id);
  if (existing) return layout.focusPane(existing);
  if (ui.prefs.viewPlacement === "ask") ui.askForPane({ kind: "view", view: id });
  else ui.showPanel(id);
}

/** Shows the native folder picker and opens the chosen folder as a vault. */
export async function pickVault(): Promise<void> {
  const dir = await open({ directory: true, multiple: false, title: "Open vault folder" });
  // Focus returns to the button that opened the dialog, which then shows a
  // stray focus ring; drop focus instead.
  (document.activeElement as HTMLElement | null)?.blur();
  if (typeof dir === "string") await useVault.getState().open(dir);
}

export function ActionRail() {
  const panel = useUi((s) => s.panel);
  const reading = useUi((s) => s.reading);

  return (
    <nav className="flex w-14 shrink-0 flex-col items-center gap-2 border-r border-line bg-alt py-3">
      {PANEL_ORDER.map((id) => {
        const { hint, Icon } = PANELS[id];
        return (
          <div key={id} className="relative">
            {/* Accent tick flush with the rail's left edge ((56px rail − 40px button) / 2 = 8px). */}
            {panel === id && <div className="absolute top-2 -left-2 h-6 w-[3px] rounded-r-full bg-accent" />}
            <IconButton title={hint} active={panel === id} onClick={() => openView(id)} className="!h-10 !w-10 !rounded-lg">
              <Icon size={19} strokeWidth={1.6} />
            </IconButton>
          </div>
        );
      })}
      <div className="flex-1" />
      {/* Reading ↔ Writing for the whole app (every pane at once). The icon
          shows the mode you're in; the accent fill means Reading. */}
      <IconButton
        title={
          reading
            ? "Reading mode (all notes): click to write  (Ctrl+Shift+E)"
            : "Writing mode (all notes): click to read  (Ctrl+Shift+E)"
        }
        active={reading}
        onClick={() => useUi.getState().toggleReading()}
        className="!h-10 !w-10 !rounded-lg"
      >
        {reading ? <BookOpen size={19} strokeWidth={1.6} /> : <PenLine size={19} strokeWidth={1.6} />}
      </IconButton>
      <div className="my-1 h-px w-6 bg-line" />
      <IconButton title="Settings  (Ctrl+,)" onClick={() => useUi.getState().openSettings()} className="!h-10 !w-10 !rounded-lg">
        <Settings size={19} strokeWidth={1.6} />
      </IconButton>
      <IconButton title="Open another vault…" onClick={() => void pickVault()} className="!h-10 !w-10 !rounded-lg">
        <FolderOpen size={19} strokeWidth={1.6} />
      </IconButton>
    </nav>
  );
}
