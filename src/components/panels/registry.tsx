// The five sidebar views in one place: their names, icons and components.
// The drawer, the action rail and panes (a view can take over a pane) all
// read from here, so a view looks and behaves the same wherever it's shown.

import { BookOpen, FolderTree, Link2, Search, StickyNote, Waypoints } from "lucide-react";
import type { PanelId } from "../../store/ui";
import { BacklinksPanel } from "./BacklinksPanel";
import { GraphPanel } from "./GraphPanel";
import { PostitPanel } from "./PostitPanel";
import { ReaderPanel } from "./ReaderPanel";
import { SearchPanel } from "./SearchPanel";
import { TreePanel } from "./TreePanel";

export interface PanelDef {
  /** Short name, used in headers ("Graph"). */
  title: string;
  /** Tooltip on the action rail, with shortcuts where there are any. */
  hint: string;
  Icon: typeof FolderTree;
  Component: () => React.ReactNode;
}

export const PANELS: Record<PanelId, PanelDef> = {
  tree: { title: "Chapters", hint: "Chapters (tree view)", Icon: FolderTree, Component: TreePanel },
  graph: { title: "Graph", hint: "Graph view", Icon: Waypoints, Component: GraphPanel },
  search: { title: "Search", hint: "Search (Ctrl+Shift+F)", Icon: Search, Component: SearchPanel },
  backlinks: { title: "Backlinks", hint: "Backlinks & topics", Icon: Link2, Component: BacklinksPanel },
  postits: { title: "Post-its", hint: "Post-its", Icon: StickyNote, Component: PostitPanel },
  reader: {
    title: "Reader",
    hint: "Reader: read notes without the markdown  (Ctrl+Shift+E)",
    Icon: BookOpen,
    Component: ReaderPanel,
  },
};

/** Rail order. */
export const PANEL_ORDER: PanelId[] = ["tree", "reader", "graph", "search", "backlinks", "postits"];
