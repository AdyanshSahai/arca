// Fixed vertical action bar on the far left. Each icon toggles its drawer
// panel; the bottom button switches vaults.

import { open } from "@tauri-apps/plugin-dialog";
import { FolderOpen, FolderTree, Link2, Search, StickyNote, Waypoints } from "lucide-react";
import { type PanelId, useUi } from "../store/ui";
import { useVault } from "../store/vault";
import { IconButton } from "./ui/IconButton";

/** Rail entries in display order, with their shortcut hints. */
const ITEMS: { id: PanelId; title: string; Icon: typeof FolderTree }[] = [
  { id: "tree", title: "Chapters (tree view)", Icon: FolderTree },
  { id: "graph", title: "Graph view", Icon: Waypoints },
  { id: "search", title: "Search (Ctrl+Shift+F)", Icon: Search },
  { id: "backlinks", title: "Backlinks & topics", Icon: Link2 },
  { id: "postits", title: "Post-its", Icon: StickyNote },
];

/** Shows the native folder picker and opens the chosen folder as a vault. */
export async function pickVault(): Promise<void> {
  const dir = await open({ directory: true, multiple: false, title: "Open vault folder" });
  if (typeof dir === "string") await useVault.getState().open(dir);
}

export function ActionRail() {
  const panel = useUi((s) => s.panel);
  const togglePanel = useUi((s) => s.togglePanel);

  return (
    <nav className="flex w-10 shrink-0 flex-col items-center gap-1 border-r border-line bg-alt py-2">
      {ITEMS.map(({ id, title, Icon }) => (
        <div key={id} className="relative">
          {/* Accent tick on the left edge marks the open panel. */}
          {panel === id && <div className="absolute top-1 -left-[6px] h-5 w-[2px] bg-accent" />}
          <IconButton title={title} active={panel === id} onClick={() => togglePanel(id)}>
            <Icon size={16} strokeWidth={1.75} />
          </IconButton>
        </div>
      ))}
      <div className="flex-1" />
      <IconButton title="Open another vault…" onClick={() => void pickVault()}>
        <FolderOpen size={16} strokeWidth={1.75} />
      </IconButton>
    </nav>
  );
}
