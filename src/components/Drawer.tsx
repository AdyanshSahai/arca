// The sliding sidebar drawer that hosts the five panels.
//
// It snaps to three sizes: ¼ of the window, ½, or "full", which covers the
// whole editing area (editors stay mounted underneath). Use the header
// buttons, or drag the right edge and let go: the width snaps to the nearest
// size, and dragging nearly shut closes the drawer.

import { Maximize2, X } from "lucide-react";
import { useRef, useState } from "react";
import { type DrawerSize, type PanelId, useUi } from "../store/ui";
import { BacklinksPanel } from "./panels/BacklinksPanel";
import { GraphPanel } from "./panels/GraphPanel";
import { PostitPanel } from "./panels/PostitPanel";
import { SearchPanel } from "./panels/SearchPanel";
import { TreePanel } from "./panels/TreePanel";

const TITLES: Record<PanelId, string> = {
  tree: "Chapters",
  graph: "Graph",
  search: "Search",
  backlinks: "Backlinks",
  postits: "Post-its",
};

/** Fraction of the window width for each snap point. */
const SNAP: Record<DrawerSize, number> = { quarter: 0.25, half: 0.5, full: 1 };

/** Below this fraction of the window, releasing a drag closes the drawer. */
const CLOSE_BELOW = 0.12;

export function Drawer() {
  const panel = useUi((s) => s.panel);
  const size = useUi((s) => s.drawerSize);
  const { setDrawerSize, closeDrawer } = useUi.getState();
  /** Width in px while a drag is in progress; null when snapped. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  if (!panel) return null;
  const full = size === "full";

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    // Measure from the drawer's left edge (it sits right of the action rail).
    const left = root.current!.getBoundingClientRect().left;
    const total = window.innerWidth;
    let latest = 0;
    const move = (ev: PointerEvent) => {
      latest = Math.max(0, ev.clientX - left);
      setDragWidth(latest);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
      setDragWidth(null);
      const frac = latest / total;
      if (frac < CLOSE_BELOW) {
        closeDrawer();
        return;
      }
      // Snap to the closest of the three sizes.
      const nearest = (Object.keys(SNAP) as DrawerSize[]).reduce((best, k) =>
        Math.abs(SNAP[k] - frac) < Math.abs(SNAP[best] - frac) ? k : best,
      );
      setDrawerSize(nearest);
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Snapped widths are in vw so they track window resizes; "full" just
  // flex-grows over the work area (the parent hides the editors).
  const style: React.CSSProperties =
    dragWidth !== null
      ? { width: dragWidth, flex: "none" }
      : full
        ? { flex: "1 1 auto" }
        : { width: `${SNAP[size] * 100}vw`, flex: "none" };

  return (
    <aside ref={root} style={style} className="relative flex min-w-0 shrink-0 flex-col border-r border-line bg-alt">
      <header className="flex h-10 shrink-0 items-center gap-1 border-b border-line pr-2 pl-4">
        <span className="flex-1 text-[13px] font-semibold text-fg">{TITLES[panel]}</span>
        {/* Snap-size switch, drawn as one segmented control. */}
        <div className="mr-1 flex items-center rounded-md border border-line p-[2px]">
          <SizeButton label="¼" title="Quarter width" active={size === "quarter"} onClick={() => setDrawerSize("quarter")} />
          <SizeButton label="½" title="Half width" active={size === "half"} onClick={() => setDrawerSize("half")} />
          <SizeButton
            label={<Maximize2 size={11} />}
            title="Full view"
            active={full}
            onClick={() => setDrawerSize("full")}
          />
        </div>
        <button
          onClick={closeDrawer}
          title="Close drawer  (Ctrl+B)"
          className="flex h-6 w-6 items-center justify-center rounded-md text-muted transition-colors hover:bg-hover hover:text-fg"
        >
          <X size={14} />
        </button>
      </header>
      <div className="min-h-0 flex-1">
        {panel === "tree" && <TreePanel />}
        {panel === "graph" && <GraphPanel />}
        {panel === "search" && <SearchPanel />}
        {panel === "backlinks" && <BacklinksPanel />}
        {panel === "postits" && <PostitPanel />}
      </div>
      {/* Resize handle along the right edge (hidden in full mode). */}
      {!full && (
        <div
          onPointerDown={onPointerDown}
          className="absolute inset-y-0 -right-[3px] z-20 w-[6px] cursor-col-resize transition-colors hover:bg-accent/40"
        />
      )}
    </aside>
  );
}

function SizeButton({
  label,
  title,
  active,
  onClick,
}: {
  label: React.ReactNode;
  title: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex h-5 w-6 items-center justify-center rounded-[4px] text-[12px] transition-colors ${
        active ? "bg-btn text-accent shadow-[inset_0_0_0_1px_var(--line-strong)]" : "text-muted hover:text-fg"
      }`}
    >
      {label}
    </button>
  );
}
