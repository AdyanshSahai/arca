// Fixed vertical action bar on the far left. Each icon opens a view
// (chapters, outline, graph, search, backlinks, post-its) in the sidebar
// drawer. The bottom buttons switch modes, open settings and switch vaults.

import { useRenderCount } from "../lib/perf";
import { open } from "@tauri-apps/plugin-dialog";
import { BookOpen, FolderOpen, PenLine, Settings } from "lucide-react";
import { type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { PANEL_ORDER, PANELS } from "./panels/registry";
import { IconButton } from "./ui/IconButton";

/** Rail click: shows the view in the sidebar, or closes it if it's already shown. */
function openView(id: PanelId) {
  useUi.getState().togglePanel(id);
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
  useRenderCount("ActionRail");
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
