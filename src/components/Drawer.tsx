// The sliding sidebar drawer that hosts the sidebar views.
//
// Drag its right edge to any width; that width is remembered as the
// "custom" size (◇ in the header). The header also has presets: ¼ of the
// window, ½, and "full", which covers the whole editing area (editors stay
// mounted underneath). Dragging nearly shut closes the drawer.

import { useRenderCount } from "../lib/perf";
import { Maximize2, X } from "lucide-react";
import { useRef, useState } from "react";
import { type PanelId, useUi } from "../store/ui";
import { PANELS } from "./panels/registry";

/** Fraction of the window width for each preset. */
const PRESETS = { quarter: 0.25, half: 0.5, full: 1 } as const;

/** Below this fraction of the window, releasing a drag closes the drawer. */
const CLOSE_BELOW = 0.12;
/** Releasing this close to a preset snaps to it exactly. */
const SNAP_WITHIN = 0.015;
/** Past this fraction a drag becomes "full" (a sliver of editor is useless). */
const FULL_ABOVE = 0.92;
/** The narrowest width a drag can leave, so the header still fits. */
const MIN_PX = 220;

export function Drawer() {
  useRenderCount("Drawer");
  const panel = useUi((s) => s.panel);
  const size = useUi((s) => s.drawerSize);
  const customWidth = useUi((s) => s.drawerWidth);
  const { setDrawerSize, setDrawerWidth, closeDrawer } = useUi.getState();
  /** Width in px while a drag is in progress; null otherwise. */
  const [dragWidth, setDragWidth] = useState<number | null>(null);
  const root = useRef<HTMLDivElement>(null);

  if (!panel) return null;
  const full = size === "full";

  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    // Measure from the drawer's left edge (it sits right of the action rail).
    const left = root.current!.getBoundingClientRect().left;
    const total = window.innerWidth;
    let latest = root.current!.getBoundingClientRect().width;
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
      if (frac < CLOSE_BELOW) return closeDrawer();
      if (frac > FULL_ABOVE) return setDrawerSize("full");
      // Landing right on ¼ or ½ selects that preset, so its button lights up.
      for (const k of ["quarter", "half"] as const) {
        if (Math.abs(PRESETS[k] - frac) < SNAP_WITHIN) return setDrawerSize(k);
      }
      setDrawerWidth(Math.max(MIN_PX / total, frac));
    };
    document.body.style.cursor = "col-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  // Widths are in vw so they track window resizes; "full" just flex-grows
  // over the work area (the parent hides the editors).
  const fraction = size === "custom" ? customWidth : size === "full" ? 1 : PRESETS[size];
  const style: React.CSSProperties =
    dragWidth !== null
      ? { width: Math.max(dragWidth, MIN_PX), flex: "none" }
      : full
        ? { flex: "1 1 auto" }
        : { width: `${fraction * 100}vw`, minWidth: MIN_PX, flex: "none" };

  return (
    <aside ref={root} style={style} className="relative flex min-w-0 shrink-0 flex-col border-r border-line bg-alt">
      <header className="flex h-12 shrink-0 items-center gap-1.5 border-b border-line pr-3 pl-5">
        <span className="flex-1 text-[14px] font-semibold text-fg">{PANELS[panel].title}</span>
        {/* Width: your own dragged width (◇), then the presets. */}
        <div className="mr-1 flex items-center rounded-md border border-line p-[2px]">
          <SizeButton
            label="◇"
            title={`Your width (${Math.round(customWidth * 100)}%), drag the edge to change it`}
            active={size === "custom"}
            onClick={() => setDrawerSize("custom")}
          />
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
        <Panel id={panel} />
      </div>
      {/* Resize handle along the right edge (hidden in full mode; pick a
          smaller preset first to drag from there). */}
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

/** Renders one view by id. */
export function Panel({ id }: { id: PanelId }) {
  const { Component } = PANELS[id];
  return <Component />;
}
