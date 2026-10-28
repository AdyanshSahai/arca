// Interactive 2D link graph (react-force-graph-2d, canvas-rendered).
//
// - Nodes are notes; edges are resolved [[links]]. Ghost nodes are links to
//   notes that don't exist yet. They're hollow, and clicking one offers to
//   create the note.
// - The focused note is magenta; hovering a node lights up its neighbours.
// - "Local" limits the graph to N hops around the focused note.
// - Bigger drawer sizes (½, full) make this genuinely usable.
//
// The graph never animates. Positions are computed up front by
// lib/graphLayout.ts (d3-force, with chapters clustered and coloured in
// the global view) and handed over pinned, so the canvas only draws.
// Refreshes start from the previous positions, so the picture stays put.
// Node dragging is disabled; pan with the mouse, and zoom with the wheel,
// the +/−/fit buttons, or + − 0 when the graph has focus.

import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { clusterColor, layoutGraph, nodeRadius, type Positioned, topFolder } from "../../lib/graphLayout";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { followLink, openFromSidebar } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import type { Graph, GraphNode } from "../../lib/types";
import { useContextPane } from "../../store/layout";
import { Segmented } from "../ui/Segmented";
import { useUi } from "../../store/ui";
import { useVault } from "../../store/vault";

type GNode = NodeObject<GraphNode>;
type GLink = LinkObject<GraphNode, { source: string; target: string }>;

/** Canvas can't resolve CSS variables, so read the palette once. */
function palette() {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    bg: v("--bg-normal"),
    fg: v("--fg-normal"),
    muted: v("--fg-inactive"),
    accent: v("--accent-magenta"),
    line: v("--line-strong"),
    font: v("--font-ui") || "sans-serif",
  };
}

/** After d3 runs, link ends are node objects; before, they're ids. */
const endId = (end: unknown): string => (typeof end === "object" && end ? (end as GNode).id : (end as string));

export function GraphPanel() {
  const revision = useVault((s) => s.revision);
  const active = useContextPane()?.path ?? null;
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(1);
  const [showGhosts, setShowGhosts] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink>>(undefined);
  // Canvas colours come from CSS variables, so re-read them on theme change.
  const theme = useUi((s) => s.prefs.theme);
  const colors = useMemo(palette, [theme]);

  // Refetch the graph whenever the vault changes. Most saves don't change
  // any links, so an identical graph is dropped here instead of triggering
  // a re-layout.
  const lastJson = useRef("");
  useEffect(() => {
    let cancelled = false;
    ipc
      .graph()
      .then((g) => {
        const json = JSON.stringify(g);
        if (cancelled || json === lastJson.current) return;
        lastJson.current = json;
        setGraph(g);
      })
      .catch((err) => useUi.getState().toast(errorMessage(err), "error"));
    return () => {
      cancelled = true;
    };
  }, [revision]);

  // Track the container size; the canvas needs explicit pixel dimensions.
  // The canvas sits in an absolutely positioned layer (see JSX), so its own
  // size can never push the container larger: without that, the canvas's
  // inline baseline gap grew the box, which resized the canvas, and so on,
  // and the graph never stopped twitching. Sizes are floored to whole
  // pixels so sub-pixel layout noise can't trigger re-renders either.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const w = Math.floor(entry.contentRect.width);
      const h = Math.floor(entry.contentRect.height);
      setSize((prev) => (prev.w === w && prev.h === h ? prev : { w, h }));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Adjacency for hover highlights and local mode.
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    const add = (a: string, b: string) => {
      if (!map.has(a)) map.set(a, new Set());
      map.get(a)!.add(b);
    };
    for (const e of graph.edges) {
      add(e.source, e.target);
      add(e.target, e.source);
    }
    return map;
  }, [graph]);

  // In global mode the focused note only changes colours, not the data, so
  // it must not be a dependency there. Otherwise every note switch would
  // rebuild the data and restart the physics simulation.
  const localRoot = local ? active : null;

  /**
   * Last computed positions, kept per view ("global", or one per local
   * root + depth), so refreshes don't re-shuffle and the views don't
   * inherit each other's layouts.
   */
  const positions = useRef(new Map<string, Map<string, Positioned>>());

  // The data actually drawn, after the local/ghost filters. Fresh objects
  // each time: the force engine mutates them (x, y, vx…). Known nodes are
  // pinned (fx/fy) at their old spot; new ones are free to settle around them.
  const data = useMemo(() => {
    let keep: Set<string> | null = null;
    if (localRoot) {
      // Breadth-first walk `depth` hops out from the focused note.
      keep = new Set([localRoot]);
      let frontier = [localRoot];
      for (let d = 0; d < depth; d++) {
        const next: string[] = [];
        for (const id of frontier) {
          for (const n of neighbours.get(id) ?? []) {
            if (!keep.has(n)) {
              keep.add(n);
              next.push(n);
            }
          }
        }
        frontier = next;
      }
    }
    const visible = (n: GraphNode) => (showGhosts || !n.ghost) && (!keep || keep.has(n.id));
    const shown = graph.nodes.filter(visible);
    const ids = new Set(shown.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    // Lay out once, here, then pin every node (fx/fy) so the widget's own
    // physics has nothing to move. Global view clusters by chapter.
    const viewKey = localRoot ? `local:${localRoot}:${depth}` : "global";
    const memory = positions.current.get(viewKey) ?? new Map<string, Positioned>();
    const placed = layoutGraph(shown, edges, memory, !localRoot);
    positions.current.set(viewKey, placed);
    const nodes: GNode[] = shown.map((n) => {
      const p = placed.get(n.id)!;
      return { ...n, x: p.x, y: p.y, fx: p.x, fy: p.y };
    });
    return { nodes, links: edges.map((e) => ({ ...e })) };
  }, [graph, depth, localRoot, showGhosts, neighbours]);

  // After new data arrives, fit the view once the simulation has come to
  // rest (see `onEngineStop`), not on a guessed timer.
  const fitPending = useRef(true);
  useEffect(() => {
    fitPending.current = true;
  }, [data]);

  const hoverSet = hover ? neighbours.get(hover) : undefined;

  // Chapters in the drawn data (for colours and the legend). Only the
  // global view colours by chapter; local view is small enough without.
  const clusters = useMemo(
    () => [...new Set(data.nodes.filter((n) => !n.ghost).map((n) => topFolder(n.folder)).filter(Boolean))].sort(),
    [data],
  );
  const colorByChapter = !localRoot && clusters.length > 1;

  /** Zooms by a factor around the centre, animated briefly. */
  const zoomBy = (factor: number) => {
    const k = fg.current?.zoom() ?? 1;
    fg.current?.zoom(Math.min(8, Math.max(0.2, k * factor)), 200);
  };

  /** Custom node painter: dot sized by degree, label when zoomed or relevant. */
  const paintNode = (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
    // Hovered dots grow ~40% so it's obvious which one the pointer is on.
    const r = nodeRadius(node.degree) * (node.id === hover ? 1.4 : 1);
    const isActive = node.id === active;
    const isHover = node.id === hover;
    const lit = isActive || isHover || hoverSet?.has(node.id);
    // Dim everything that isn't related while hovering.
    const dimmed = hover !== null && !lit;

    ctx.globalAlpha = dimmed ? 0.25 : 1;
    ctx.beginPath();
    ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
    if (node.ghost) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1 / scale;
      ctx.stroke();
    } else {
      const base = colorByChapter ? clusterColor(clusters, topFolder(node.folder)) : colors.muted;
      ctx.fillStyle = isActive ? colors.accent : isHover ? colors.fg : base;
      ctx.fill();
    }
    // Labels: focused/hovered/related nodes, hubs (3+ links), everything in
    // local view, and everything once zoomed in. Keeps the global view calm.
    if (isActive || lit || localRoot || node.degree >= 3 || scale > 1.4) {
      const fontSize = 11 / scale;
      ctx.font = `${fontSize}px ${colors.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = isActive ? colors.accent : node.ghost ? colors.muted : colors.fg;
      ctx.fillText(node.label, node.x!, node.y! + r + 2 / scale);
    }
    ctx.globalAlpha = 1;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-[12px]">
        <Segmented
          value={local ? "local" : "global"}
          options={[
            { id: "global", label: "Global" },
            { id: "local", label: "Local", disabled: !active, title: "Only notes near the focused one" },
          ]}
          onChange={(v) => setLocal(v === "local")}
        />
        {local && (
          <Segmented
            value={String(depth)}
            options={[1, 2, 3].map((d) => ({ id: String(d), label: d, title: `${d} hop${d > 1 ? "s" : ""}` }))}
            onChange={(v) => setDepth(Number(v))}
          />
        )}
        <div className="flex-1" />
        <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg" title="Show links to notes that don't exist yet">
          <input
            type="checkbox"
            checked={showGhosts}
            onChange={() => setShowGhosts(!showGhosts)}
            className="cm-task !m-0"
          />
          Ghosts
        </label>
        <span className="text-muted/50 tabular-nums" title="nodes · links">
          {data.nodes.length} · {data.links.length}
        </span>
      </div>
      {/* `relative` box measured by the ResizeObserver; the canvas lives in an
          absolute layer inside it so it can't affect the box's size. */}
      <div
        ref={box}
        tabIndex={0}
        // + / − zoom, 0 fits everything, when the graph has focus.
        onKeyDown={(e) => {
          if (e.key === "+" || e.key === "=") zoomBy(1.4);
          else if (e.key === "-") zoomBy(1 / 1.4);
          else if (e.key === "0") fg.current?.zoomToFit(250, 48);
          else return;
          e.preventDefault();
        }}
        className="relative min-h-0 flex-1 overflow-hidden outline-none"
        onMouseLeave={() => setHover(null)}
      >
        {/* Zoom controls. */}
        <div className="absolute right-3 bottom-3 z-10 flex flex-col overflow-hidden rounded-lg border border-line-strong bg-btn/95 shadow-[0_6px_18px_rgb(0_0_0/0.4)]">
          <ZoomButton title="Zoom in  (+)" onClick={() => zoomBy(1.4)}>
            <Plus size={15} />
          </ZoomButton>
          <ZoomButton title="Zoom out  (−)" onClick={() => zoomBy(1 / 1.4)}>
            <Minus size={15} />
          </ZoomButton>
          <ZoomButton title="Fit everything  (0)" onClick={() => fg.current?.zoomToFit(250, 48)}>
            <Maximize size={14} />
          </ZoomButton>
        </div>
        {/* Chapter colour legend (global view only). */}
        {colorByChapter && (
          <div className="absolute bottom-3 left-3 z-10 flex max-w-[60%] flex-wrap gap-x-3 gap-y-1 rounded-lg border border-line bg-btn/90 px-3 py-2 text-[11px] text-fg/75">
            {clusters.map((c) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className="h-2 w-2 rounded-full" style={{ background: clusterColor(clusters, c) }} />
                {c}
              </span>
            ))}
          </div>
        )}
        <div className="absolute inset-0">
          <ForceGraph2D<GraphNode, { source: string; target: string }>
            ref={fg}
            width={size.w}
            height={size.h}
            graphData={data}
            backgroundColor={colors.bg}
            nodeId="id"
            nodeLabel={(n) => n.id}
            nodeCanvasObject={paintNode}
            // Hit area for hover/click matches the drawn dot (plus a little slack).
            nodePointerAreaPaint={(node, color, ctx) => {
              ctx.fillStyle = color;
              ctx.beginPath();
              ctx.arc(node.x!, node.y!, 4 + Math.sqrt(node.degree) * 1.4, 0, 2 * Math.PI);
              ctx.fill();
            }}
            linkColor={(l) => {
              const s = endId(l.source);
              const t = endId(l.target);
              const lit = hover !== null && (s === hover || t === hover);
              return lit ? colors.accent : colors.line;
            }}
            linkWidth={(l) => (hover !== null && (endId(l.source) === hover || endId(l.target) === hover) ? 1.5 : 0.6)}
            linkDirectionalArrowLength={2.5}
            linkDirectionalArrowRelPos={1}
            onNodeHover={(n) => setHover(n ? (n.id as string) : null)}
            onNodeClick={(n, ev) => {
              if (n.ghost) void followLink(n.label, active ?? "");
              else openFromSidebar(n.id as string, { newTab: ev.ctrlKey || ev.metaKey });
            }}
            // Layout is precomputed and pinned (see `data`), so the widget's
            // engine runs zero ticks and nothing ever moves on its own.
            warmupTicks={0}
            cooldownTicks={0}
            // Dragging would unpin nodes and make things move.
            enableNodeDrag={false}
            enableZoomInteraction
            enablePanInteraction
            minZoom={0.2}
            maxZoom={8}
            onEngineStop={() => {
              if (fitPending.current) {
                fitPending.current = false;
                fg.current?.zoomToFit(250, 48);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}

function ZoomButton({ title, onClick, children }: { title: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={title}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center text-muted transition-colors hover:bg-hover hover:text-fg"
    >
      {children}
    </button>
  );
}
