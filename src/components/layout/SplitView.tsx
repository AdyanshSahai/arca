// Recursively renders a tab's split tree. A split node is a flex container
// (row = side-by-side, col = stacked) with a draggable 1px divider between
// its two children. Leaves render a PaneView.

import { useRenderCount } from "../../lib/perf";
import { useRef } from "react";
import { type LayoutNode, useLayout } from "../../store/layout";
import { PaneView } from "./PaneView";

export function SplitView({ node, focusedPane }: { node: LayoutNode; focusedPane: string }) {
  useRenderCount("SplitView");
  if (node.kind === "pane") return <PaneView paneId={node.paneId} focused={node.paneId === focusedPane} />;
  return <Split node={node} focusedPane={focusedPane} />;
}

function Split({
  node,
  focusedPane,
}: {
  node: Extract<LayoutNode, { kind: "split" }>;
  focusedPane: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const setRatio = useLayout((s) => s.setRatio);
  const isRow = node.dir === "row";

  /** Drags the divider: the ratio follows the pointer within this split's box. */
  const onPointerDown = (e: React.PointerEvent) => {
    e.preventDefault();
    const box = container.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const r = isRow ? (ev.clientX - box.left) / box.width : (ev.clientY - box.top) / box.height;
      setRatio(node.id, r);
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.style.cursor = "";
    };
    // Keep the resize cursor even when the pointer leaves the thin handle.
    document.body.style.cursor = isRow ? "col-resize" : "row-resize";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  };

  return (
    <div ref={container} className={`flex h-full w-full min-h-0 min-w-0 ${isRow ? "flex-row" : "flex-col"}`}>
      {/* flex-basis as a percentage; min-0 lets editors shrink below content size. */}
      <div className="min-h-0 min-w-0 overflow-hidden" style={{ flex: `0 0 ${node.ratio * 100}%` }}>
        <SplitView node={node.a} focusedPane={focusedPane} />
      </div>
      <div
        onPointerDown={onPointerDown}
        // A 1px visible line inside a 5px hit area (via negative margins).
        className={`group relative z-10 shrink-0 ${isRow ? "-mx-[2px] w-[5px] cursor-col-resize" : "-my-[2px] h-[5px] cursor-row-resize"}`}
      >
        <div
          className={`absolute bg-line group-hover:bg-muted ${isRow ? "inset-y-0 left-[2px] w-px" : "inset-x-0 top-[2px] h-px"}`}
        />
      </div>
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
        <SplitView node={node.b} focusedPane={focusedPane} />
      </div>
    </div>
  );
}
