// The sidebar views in one place: their names, icons and components.
// The drawer, the action rail and panes (a view can take over a pane) all
// read from here, so a view looks and behaves the same wherever it's shown.

import { FolderTree, Link2, ListTree, Search, StickyNote, Waypoints } from "lucide-react";
import type { PanelId } from "../../store/ui";
import { BacklinksPanel } from "./BacklinksPanel";
import { GraphPanel } from "./GraphPanel";
import { OutlinePanel } from "./OutlinePanel";
import { PostitPanel } from "./PostitPanel";
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
  outline: { title: "Outline", hint: "Outline (headings in this note)", Icon: ListTree, Component: OutlinePanel },
  graph: { title: "Graph", hint: "Graph view", Icon: Waypoints, Component: GraphPanel },
  search: { title: "Search", hint: "Search (Ctrl+Shift+F)", Icon: Search, Component: SearchPanel },
  backlinks: { title: "Backlinks", hint: "Backlinks & topics", Icon: Link2, Component: BacklinksPanel },
  postits: { title: "Post-its", hint: "Post-its", Icon: StickyNote, Component: PostitPanel },
};

/** Rail order. */
export const PANEL_ORDER: PanelId[] = ["tree", "outline", "graph", "search", "backlinks", "postits"];
