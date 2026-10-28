// Static layout for the graph view, computed with d3-force *before* the
// graph is drawn. The canvas widget then only renders: every node arrives
// with fixed coordinates, so nothing on screen ever moves by itself.
//
// Forces:
//   - links pull connected notes together,
//   - many-body charge pushes everything apart,
//   - collision keeps dots (plus room for a label) from overlapping,
//   - cluster pull draws each top-level chapter towards its own spot on a
//     ring, so a global graph reads as groups instead of one hairball.
//     Ghost nodes and root-level notes don't cluster.

import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { GraphEdge, GraphNode } from "./types";

export interface Positioned {
  x: number;
  y: number;
}

/** Drawn radius of a node, shared by the layout and the painter. */
export function nodeRadius(degree: number): number {
  return 3 + Math.sqrt(degree) * 1.6;
}

/** First folder of a path ("hardware/cpu" → "hardware"), "" at the root. */
export function topFolder(folder: string): string {
  return folder.split("/")[0] ?? "";
}

type SimNode = SimulationNodeDatum & { id: string; degree: number; cluster: string | null };

/**
 * Computes positions for `nodes`. `previous` holds last known positions:
 * nodes that have one stay exactly there (pinned), so a refresh never
 * shifts the existing picture. New nodes start near a placed neighbour
 * (or their chapter) and settle around the pinned ones.
 */
export function layoutGraph(
  nodes: GraphNode[],
  edges: GraphEdge[],
  previous: Map<string, Positioned>,
  clustered: boolean,
): Map<string, Positioned> {
  // Cluster anchors: top-level folders spread evenly on a ring whose size
  // grows with the graph.
  const clusters = [...new Set(nodes.filter((n) => !n.ghost).map((n) => topFolder(n.folder)).filter(Boolean))].sort();
  const ring = 60 + Math.sqrt(nodes.length) * 28;
  const anchor = new Map<string, Positioned>(
    clusters.map((c, i) => {
      const a = (2 * Math.PI * i) / Math.max(1, clusters.length) - Math.PI / 2;
      return [c, { x: Math.cos(a) * ring, y: Math.sin(a) * ring }];
    }),
  );

  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target]);
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source]);
  }

  const sim: SimNode[] = nodes.map((n) => {
    const cluster = clustered && !n.ghost ? topFolder(n.folder) || null : null;
    // Start from: last position → a placed neighbour → the cluster anchor → near the centre.
    const prev =
      previous.get(n.id) ??
      (neighbours.get(n.id) ?? []).map((id) => previous.get(id)).find(Boolean) ??
      (cluster ? anchor.get(cluster) : undefined);
    // New nodes get a little jitter so ones starting at the same spot can
    // separate; nodes with their own previous position keep it exactly.
    const own = previous.has(n.id);
    const jitter = () => (own ? 0 : (Math.random() - 0.5) * 20);
    const x = (prev?.x ?? 0) + jitter();
    const y = (prev?.y ?? 0) + jitter();
    // Nodes that were already placed are pinned (fx/fy): a refresh only
    // finds spots for new nodes and never shifts the existing picture.
    return own ? { id: n.id, degree: n.degree, cluster, x, y, fx: x, fy: y } : { id: n.id, degree: n.degree, cluster, x, y };
  });

  const links: SimulationLinkDatum<SimNode>[] = edges.map((e) => ({ source: e.source, target: e.target }));
  const simulation = forceSimulation(sim)
    .force(
      "link",
      forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
        .id((d) => d.id)
        .distance(45)
        .strength(0.4),
    )
    .force("charge", forceManyBody<SimNode>().strength(-140).distanceMax(500))
    // Radius + room for a label underneath.
    .force("collide", forceCollide<SimNode>((d) => nodeRadius(d.degree) + 14).strength(0.9))
    .force("x", forceX<SimNode>((d) => (d.cluster ? (anchor.get(d.cluster)?.x ?? 0) : 0)).strength((d) => (d.cluster ? 0.09 : 0.03)))
    .force("y", forceY<SimNode>((d) => (d.cluster ? (anchor.get(d.cluster)?.y ?? 0) : 0)).strength((d) => (d.cluster ? 0.09 : 0.03)))
    .stop();
  // Run the whole simulation now, synchronously; ~300 ticks fully settles it.
  for (let i = 0; i < 300; i++) simulation.tick();

  return new Map(sim.map((n) => [n.id, { x: n.x ?? 0, y: n.y ?? 0 }]));
}

/** Distinct, muted colours for chapters (cycled when there are more). */
const CLUSTER_COLORS = ["#bc8bca", "#9db8ff", "#9fdcb4", "#f0cf8a", "#ff9ab8", "#8fd3e0", "#c9b6ff", "#e0b38f"];

export function clusterColor(clusters: string[], cluster: string): string {
  const i = clusters.indexOf(cluster);
  return i === -1 ? "#7d6a8c" : CLUSTER_COLORS[i % CLUSTER_COLORS.length];
}
