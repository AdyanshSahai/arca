// Interactive 2D link graph (react-force-graph-2d, canvas-rendered).
//
// - Nodes are notes; edges are resolved [[links]]. Ghost nodes are links to
//   notes that don't exist yet. They're hollow, and clicking one offers to
//   create the note.
// - Always local: the active note and its neighbours up to 1–3 links away
//   (depth slider). There's no whole-vault view; it was slow on big vaults
//   and not useful.
// - The active note is drawn as a square (size means hover, hollow means
//   ghost), with its label always shown in bold. Hovering a node lights up
//   its neighbours.
// - Bigger drawer sizes (½, full) make this genuinely usable.
//
// The graph never animates. Positions are computed up front by
// lib/graphLayout.ts (d3-force) and handed over pinned, so the canvas
// only draws.
// Refreshes start from the previous positions, so the picture stays put.
// Node dragging is disabled; pan with the mouse, and zoom with the wheel,
// the +/−/fit buttons, or + − 0 when the graph has focus.

import { bump, useRenderCount } from "../../lib/perf";
import { Maximize, Minus, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { layoutGraph, nodeRadius, type Positioned } from "../../lib/graphLayout";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { followLink, openFromSidebar } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import type { Graph, GraphNode } from "../../lib/types";
import { useContextPane } from "../../store/layout";
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
  useRenderCount("GraphPanel");
  const revision = useVault((s) => s.revision);
  const active = useContextPane()?.path ?? null;
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  // Mode, depth and filters live in the ui store (they survive the panel
  // closing). Local view needs an active note; without one, show global.
  const { depth, ghosts: showGhosts } = useUi((s) => s.graph);
  const setGraphPrefs = useUi((s) => s.setGraph);
  const [hover, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink>>(undefined);
  // Canvas colours come from CSS variables, so re-read them on theme change.
  const theme = useUi((s) => `${s.prefs.theme}:${JSON.stringify(s.prefs.customColors)}`);
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

  /** The note the neighbourhood is drawn around. */
  const localRoot = active;

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
    // No active note = nothing to draw (there's no whole-vault view).
    if (!keep) return { nodes: [], links: [] };
    let shown = graph.nodes.filter((n) => !n.ghost && keep.has(n.id));
    if (showGhosts) {
      // Ghosts only appear next to a note that's shown.
      const ids = new Set(shown.map((n) => n.id));
      const linked = new Set(graph.edges.filter((e) => ids.has(e.source)).map((e) => e.target));
      shown = shown.concat(graph.nodes.filter((n) => n.ghost && linked.has(n.id) && keep.has(n.id)));
    }
    const ids = new Set(shown.map((n) => n.id));
    const edges = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target));
    // Lay out once, here, then pin every node (fx/fy) so the widget's own
    // physics has nothing to move. Global view clusters by chapter.
    const viewKey = `local:${localRoot}:${depth}`;
    const memory = positions.current.get(viewKey) ?? new Map<string, Positioned>();
    bump("graph:layout"); // profiling: how often the (costly) layout runs
    const placed = layoutGraph(shown, edges, memory, false);
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
    bump("graph:data-changed"); // profiling: graphData identity changes
  }, [data]);

  const hoverSet = hover ? neighbours.get(hover) : undefined;


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
    if (isActive) {
      // The current note is a square (same area as its circle would be):
      // shape is the one channel not already used for something else.
      const half = r * 0.89;
      ctx.rect(node.x! - half, node.y! - half, half * 2, half * 2);
    } else {
      ctx.arc(node.x!, node.y!, r, 0, 2 * Math.PI);
    }
    if (node.ghost) {
      ctx.strokeStyle = colors.muted;
      ctx.lineWidth = 1 / scale;
      ctx.stroke();
    } else {
      const base = colors.muted;
      ctx.fillStyle = isHover ? colors.fg : base;
      ctx.fill();
    }
    // Labels: focused/hovered/related nodes, hubs (3+ links), everything in
    // local view, and everything once zoomed in. Keeps the global view calm.
    if (isActive || lit || localRoot || node.degree >= 3 || scale > 1.4) {
      const fontSize = 11 / scale;
      // The current note's label is bold (and always shown).
      ctx.font = `${isActive ? "700 " : ""}${fontSize}px ${colors.font}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = node.ghost ? colors.muted : colors.fg;
      ctx.fillText(node.label, node.x!, node.y! + r + 2 / scale);
    }
    ctx.globalAlpha = 1;
  };

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 space-y-2 border-b border-line px-4 py-2.5 text-[12px]">
        <div className="flex items-center gap-2">
          {localRoot && (
            // Depth slider: how many links away from the active note.
            <label className="flex items-center gap-2 text-muted" title="How many links away from the active note">
              Depth
              <input
                type="range"
                min={1}
                max={3}
                step={1}
                value={depth}
                onChange={(e) => setGraphPrefs({ depth: Number(e.target.value) })}
                className="w-20 accent-[var(--accent-magenta)]"
              />
              <span className="w-3 text-fg tabular-nums">{depth}</span>
            </label>
          )}
          <div className="flex-1" />
          <label className="flex cursor-pointer items-center gap-1.5 text-muted hover:text-fg" title="Show links to notes that don't exist yet">
            <input
              type="checkbox"
              checked={showGhosts}
              onChange={() => setGraphPrefs({ ghosts: !showGhosts })}
              className="cm-task !m-0"
            />
            Ghosts
          </label>
          <span className="text-muted/50 tabular-nums" title="nodes · links">
            {data.nodes.length} · {data.links.length}
          </span>
        </div>
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
        {!localRoot && (
          <p className="absolute inset-x-0 top-1/3 z-10 px-6 text-center text-[13px] text-muted/60">
            Open a note to see how it connects to others.
          </p>
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
