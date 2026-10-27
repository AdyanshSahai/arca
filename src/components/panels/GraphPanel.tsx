// Interactive 2D link graph (react-force-graph-2d, canvas-rendered).
//
// - Nodes are notes; edges are resolved [[links]]. Ghost nodes are links to
//   notes that don't exist yet. They're hollow, and clicking one offers to
//   create the note.
// - The focused note is magenta; hovering a node lights up its neighbours.
// - "Local" limits the graph to N hops around the focused note.
// - Bigger drawer sizes (½, full) make this genuinely usable.

import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { type ForceGraphMethods, type LinkObject, type NodeObject } from "react-force-graph-2d";
import { followLink } from "../../lib/actions";
import { errorMessage, ipc } from "../../lib/ipc";
import type { Graph, GraphNode } from "../../lib/types";
import { useFocusedPane, useLayout } from "../../store/layout";
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
  const active = useFocusedPane()?.path ?? null;
  const [graph, setGraph] = useState<Graph>({ nodes: [], edges: [] });
  const [local, setLocal] = useState(false);
  const [depth, setDepth] = useState(1);
  const [showGhosts, setShowGhosts] = useState(true);
  const [hover, setHover] = useState<string | null>(null);
  const [size, setSize] = useState({ w: 300, h: 300 });
  const box = useRef<HTMLDivElement>(null);
  const fg = useRef<ForceGraphMethods<GNode, GLink>>(undefined);
  const colors = useMemo(palette, []);

  // Refetch the graph whenever the vault changes.
  useEffect(() => {
    let cancelled = false;
    ipc
      .graph()
      .then((g) => !cancelled && setGraph(g))
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

  // The data actually drawn, after the local/ghost filters. Fresh objects
  // each time: the force engine mutates them (x, y, vx…).
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
    const nodes = graph.nodes.filter(visible).map((n) => ({ ...n }));
    const ids = new Set(nodes.map((n) => n.id));
    const links = graph.edges.filter((e) => ids.has(e.source) && ids.has(e.target)).map((e) => ({ ...e }));
    return { nodes, links };
  }, [graph, depth, localRoot, showGhosts, neighbours]);

  // After new data arrives, fit the view once the simulation has come to
  // rest (see `onEngineStop`), not on a guessed timer.
  const fitPending = useRef(true);
  useEffect(() => {
    fitPending.current = true;
  }, [data]);

  const hoverSet = hover ? neighbours.get(hover) : undefined;

  /** Custom node painter: dot sized by degree, label when zoomed or relevant. */
  const paintNode = (node: GNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const r = 2.5 + Math.sqrt(node.degree) * 1.4;
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
      ctx.fillStyle = isActive ? colors.accent : lit ? colors.fg : colors.muted;
      ctx.fill();
    }
    // Labels: always for focused/hovered nodes, otherwise once zoomed in.
    if (isActive || isHover || lit || scale > 1.6) {
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
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-3 text-[12px]">
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
      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden" onMouseLeave={() => setHover(null)}>
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
              else useLayout.getState().openNote(n.id as string, { newTab: ev.ctrlKey || ev.metaKey });
            }}
            // Physics: d3's default friction (0.4) plus faster cooling, so the
            // layout settles in about a second and then stays perfectly still.
            d3VelocityDecay={0.4}
            d3AlphaDecay={0.05}
            cooldownTime={2500}
            // Pre-run part of the simulation before the first paint, so the
            // graph appears nearly settled instead of exploding outwards.
            warmupTicks={40}
            onEngineStop={() => {
              if (fitPending.current) {
                fitPending.current = false;
                fg.current?.zoomToFit(300, 48);
              }
            }}
          />
        </div>
      </div>
    </div>
  );
}
