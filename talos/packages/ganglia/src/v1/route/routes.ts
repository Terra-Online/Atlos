import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createWallChecker, type WallChecker } from '#@/src/model/walls.ts';
import type { MovementMode, Segment, LocomotionOptions } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import { validateMotion, routeSegment } from '#@/src/v1/motion/motion.ts';
import {
  type CondensedTopology,
  type GroundTopology,
  groundComponents,
  condenseComponents,
  directedComponents,
  canReach,
} from '#@/src/v1/reach/connectivity.ts';
import { searchResources } from '#@/src/v1/resource/resource-search.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

export interface Node {
  id: string;
  position: Vec3;
}

export interface Edge {
  flight?: Segment['flight'];
  traversal?: Segment['traversal'];
  from: string;
  to: string;
  cost: number;
  state: 'open' | 'closed' | 'unknown';
  points: Vec3[];
  mode?: MovementMode;
  times?: number[];
  connection?: string;
  requiredGait?: 'sprint';
}

export interface Graph {
  nodes: Node[];
  edges: Edge[];
}

export interface Arrival {
  id: string;
  node: string;
  cost: number;
  state: 'available' | 'locked' | 'unknown';
}

export interface RouteConstraints {
  walls: Wall[];
  profile: { radius: number; height: number };
  locomotion?: LocomotionOptions;
}

interface Index<V> {
  has(key: string): boolean;
  get(key: string): V | undefined;
  set(key: string, value: V): unknown;
}
export interface RouteBase {
  nodes: Index<Vec3>;
  edges: Index<Edge[]>;
  blocked: WallChecker | null;
}
interface PreparedGraph extends RouteBase {
  maxSpeed: number;
  links?: Edge[];
}
interface Estimates {
  targetKey?: string;
  distances?: WeakMap<Vec3, number>;
}
interface Connectivity {
  components?: CondensedTopology;
  links?: Edge[];
  exhausted(): void;
}

// Edges are directed, clearance-checked corridors supplied by the navigation importer.
// This module never connects points by proximity or projects between floors.
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const finitePoint = (p: unknown): p is Vec3 =>
  Array.isArray(p) &&
  p.length === 3 &&
  Number.isFinite(p[0]) &&
  Number.isFinite(p[1]) &&
  Number.isFinite(p[2]);
/** Find the least-cost route on a verified graph. Unknown/closed edges are excluded.
 * Endpoint IDs must come from a floor-aware projection by the caller.
 * Cost is supplied in seconds; optimality is on this graph, not continuous space.
 */
export function route(
  graph: Graph,
  start: string,
  goal: string,
  constraints?: RouteConstraints,
): Route {
  return routeFrom(
    graph,
    [{ id: start, node: start, cost: 0, state: 'available' }],
    goal,
    constraints,
  );
}
/** Compare walking and available teleport arrivals in one multi-source search.
 * Entry costs and corridor costs use the same units. Unknown/locked arrivals are excluded.
 */
export function routeFrom(
  graph: Graph,
  starts: Arrival[],
  goal: string | string[],
  constraints?: RouteConstraints,
): Route {
  return search(
    prepareGraph(graph, constraints),
    starts,
    goal,
    {},
    undefined,
    constraints?.locomotion,
  );
}
/** Internal mutable edge index for lazy validation. Nodes and unchanged edges
 * remain immutable caller-owned data. Replacements retain endpoint identity. */
export function createUpdatingRoutePlanner(graph: Graph) {
  const base = prepareGraph(graph);
  const estimates: Estimates = {};
  return {
    plan(starts: Arrival[], goal: string | string[]) {
      let path: Edge[] = [];
      const route = search(base, starts, goal, estimates, undefined, undefined, (edges) => {
        path = edges;
      });
      return { route, path };
    },
    replace(previous: Edge, next: Edge) {
      if (previous.from !== next.from || previous.to !== next.to)
        throw new Error('Changed edge endpoints');
      const checked = prepareGraph({ nodes: [], edges: [next] }, null, base);
      const outgoing = base.edges.get(previous.from);
      const index = outgoing?.indexOf(previous) ?? -1;
      if (index < 0) throw new Error('Missing replaced edge');
      if (next.state === 'open') outgoing![index] = next;
      else outgoing!.splice(index, 1);
      // Keeping an older, larger bound is admissible after a cost increase.
      base.maxSpeed = Math.max(base.maxSpeed, checked.maxSpeed);
    },
  };
}
// The ground planner owns its immutable base graph. Only query endpoints and
// newly validated actions need corridor checks on each successive planning pass.
export function createRoutePlanner(graph: Graph, constraints?: RouteConstraints) {
  const base = prepareGraph(graph, constraints);
  const ids = graph.nodes.map((node) => node.id);
  return preparedSearch(base, () => directedComponents(ids, base.edges));
}
// Ground and movement already need the full numeric topology. Own it once in
// their shared preparation, without retaining it for standalone graph searches.
export function prepareRoutePlanner(graph: Graph, constraints?: RouteConstraints) {
  const accepted: Edge[] = [];
  const base = prepareGraph(graph, constraints, undefined, accepted);
  const graphSnapshot = {
    nodes: graph.nodes,
    edges: accepted.length === graph.edges.length ? graph.edges : accepted,
  };
  let topology: GroundTopology | undefined;
  let condensed: CondensedTopology | undefined;
  const preparedBase: {
    graph: Graph;
    forward: Index<Edge[]>;
    blocked: RouteBase['blocked'];
    maxSpeed: number;
    topology: GroundTopology;
    condensed: CondensedTopology;
    plan: ReturnType<typeof preparedSearch>;
  } = {
    graph: graphSnapshot,
    forward: base.edges,
    blocked: base.blocked,
    maxSpeed: base.maxSpeed,
    get topology() {
      return (topology ??= groundComponents(graphSnapshot));
    },
    get condensed() {
      return (condensed ??= condenseComponents(preparedBase.topology));
    },
    plan: preparedSearch(base, () => preparedBase.condensed),
  };
  return preparedBase;
}

/**
 * Lightweight route planner overlaid on an immutable static preparedBase.
 * Filters ONLY static outgoing adjacency lists in affectedFromIds against
 * extraBlocked and appends extraGraph nodes/edges in O(|affected| + |extra|),
 * avoiding rescanning 600k+ static ground edges per box placement layout.
 */
export function prepareOverlayRoutePlanner(
  baseRouteBase: ReturnType<typeof prepareRoutePlanner>,
  baseNodes: Pick<ReadonlyMap<string, Vec3>, 'get' | 'has'>,
  extraGraph: Graph,
  affectedFromIds: Iterable<string>,
  extraBlocked: RouteBase['blocked'],
): ReturnType<typeof prepareRoutePlanner> {
  const baseBlocked = baseRouteBase.blocked;
  const activeBase = baseBlocked && !baseBlocked.empty ? baseBlocked : null;
  const activeExtra = extraBlocked && !extraBlocked.empty ? extraBlocked : null;
  const combinedBlocked: RouteBase['blocked'] =
    activeBase && activeExtra
      ? (start, end, inflation = 0) =>
          activeBase(start, end, inflation) || activeExtra(start, end, inflation)
      : (activeBase ?? activeExtra ?? baseBlocked ?? extraBlocked);

  const ownNodes = new Map<string, Vec3>();
  for (let i = 0; i < extraGraph.nodes.length; i++) {
    const node = extraGraph.nodes[i];
    if (
      typeof node.id !== 'string' ||
      ownNodes.has(node.id) ||
      baseNodes.has(node.id) ||
      !finitePoint(node.position)
    )
      throw new Error('Invalid node');
    ownNodes.set(node.id, node.position);
  }
  const nodes: Index<Vec3> = {
    has: (key: string) => ownNodes.has(key) || baseNodes.has(key),
    get: (key: string) => ownNodes.get(key) ?? baseNodes.get(key),
    set: (key: string, value: Vec3) => ownNodes.set(key, value),
  };

  const ownEdges = new Map<string, Edge[]>();
  const removedEdges = new Set<Edge>();
  if (extraBlocked) {
    for (const fromId of affectedFromIds) {
      if (ownEdges.has(fromId)) continue;
      const baseList = baseRouteBase.forward.get(fromId);
      if (!baseList || !baseList.length) continue;
      let kept: Edge[] | undefined;
      for (let i = 0; i < baseList.length; i++) {
        const edge = baseList[i];
        const pts = edge.points;
        let hit = false;
        for (let j = 1; j < pts.length; j++) {
          if (extraBlocked(pts[j - 1], pts[j])) {
            hit = true;
            break;
          }
        }
        if (hit) {
          if (!kept) kept = baseList.slice(0, i);
          removedEdges.add(edge);
        } else if (kept) {
          kept.push(edge);
        }
      }
      if (kept) ownEdges.set(fromId, kept);
    }
  }

  let maxSpeed = baseRouteBase.maxSpeed;
  const acceptedExtra: Edge[] = [];
  for (let e = 0; e < extraGraph.edges.length; e++) {
    const edge = extraGraph.edges[e];
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    const pts = edge.points;
    if (
      fromNode === undefined ||
      toNode === undefined ||
      !Number.isFinite(edge.cost) ||
      edge.cost < 0 ||
      (edge.state !== 'open' && edge.state !== 'closed' && edge.state !== 'unknown') ||
      !Array.isArray(pts) ||
      pts.length < 2
    )
      throw new Error('Invalid corridor');
    for (let i = 0; i < pts.length; i++) {
      if (!finitePoint(pts[i])) throw new Error('Invalid corridor');
    }
    const p0 = pts[0],
      pLast = pts[pts.length - 1];
    if (
      (p0 !== fromNode && distance(p0, fromNode) > 1e-6) ||
      (pLast !== toNode && distance(pLast, toNode) > 1e-6)
    )
      throw new Error('Invalid corridor');
    validateMotion(edge);
    if (edge.state === 'open') {
      let edgeBlocked = false;
      if (combinedBlocked) {
        for (let i = 1; i < pts.length; i++) {
          if (combinedBlocked(pts[i - 1], pts[i])) {
            edgeBlocked = true;
            break;
          }
        }
      }
      if (!edgeBlocked) {
        const span = distance(fromNode, toNode);
        if (span > 0) maxSpeed = Math.max(maxSpeed, edge.cost === 0 ? Infinity : span / edge.cost);
        let outgoing = ownEdges.get(edge.from);
        if (!outgoing) {
          const prev = baseRouteBase.forward.get(edge.from);
          outgoing = prev ? prev.slice() : [];
          ownEdges.set(edge.from, outgoing);
        }
        outgoing.push(edge);
        acceptedExtra.push(edge);
      }
    }
  }

  const forward: Index<Edge[]> = {
    has: (key: string) => ownEdges.has(key) || baseRouteBase.forward.has(key),
    get: (key: string) => (ownEdges.has(key) ? ownEdges.get(key) : baseRouteBase.forward.get(key)),
    set: (key: string, value: Edge[]) => ownEdges.set(key, value),
  };

  const basePrepared: PreparedGraph = {
    nodes,
    edges: forward,
    blocked: combinedBlocked,
    maxSpeed,
  };

  let graphSnapshot: Graph | undefined;
  let topology: GroundTopology | undefined;
  let condensed: CondensedTopology | undefined;
  const extraDisjoint =
    removedEdges.size === 0 &&
    acceptedExtra.every((edge) => ownNodes.has(edge.from) && ownNodes.has(edge.to));
  const getGraphSnapshot = (): Graph => {
    if (!graphSnapshot) {
      const baseEdges = baseRouteBase.graph.edges;
      let edges: Edge[];
      if (removedEdges.size === 0) {
        edges = acceptedExtra.length ? [...baseEdges, ...acceptedExtra] : baseEdges;
      } else {
        edges = [];
        for (let i = 0; i < baseEdges.length; i++) {
          const edge = baseEdges[i];
          if (!removedEdges.has(edge)) edges.push(edge);
        }
        for (let i = 0; i < acceptedExtra.length; i++) edges.push(acceptedExtra[i]);
      }
      graphSnapshot = {
        nodes: extraGraph.nodes.length
          ? [...baseRouteBase.graph.nodes, ...extraGraph.nodes]
          : baseRouteBase.graph.nodes,
        edges,
      };
    }
    return graphSnapshot;
  };
  const preparedBase: ReturnType<typeof prepareRoutePlanner> = {
    get graph() {
      return getGraphSnapshot();
    },
    forward,
    blocked: combinedBlocked,
    maxSpeed,
    get topology() {
      if (!topology) {
        if (extraDisjoint && extraGraph.nodes.length === 0) {
          topology = baseRouteBase.topology;
        } else {
          topology = groundComponents(getGraphSnapshot());
        }
      }
      return topology;
    },
    get condensed() {
      if (!condensed) {
        if (extraDisjoint) {
          const baseCond = baseRouteBase.condensed;
          if (extraGraph.nodes.length === 0) {
            condensed = baseCond;
          } else {
            // Extend base condensed DAG in O(|extraGraph|) without running
            // Kosaraju DFS over 409k static surfaces.
            const baseCount = baseCond.forward.length;
            const extraCond = condenseComponents(
              groundComponents({ nodes: extraGraph.nodes, edges: acceptedExtra }),
            );
            const extraCompMap = new Map<string, number>();
            for (const [id, comp] of extraCond.components) extraCompMap.set(id, baseCount + comp);
            const overlayForward = baseCond.forward.slice();
            for (let i = 0; i < extraCond.forward.length; i++) {
              const shifted = new Set<number>();
              for (const target of extraCond.forward[i]) shifted.add(baseCount + target);
              overlayForward.push(shifted);
            }
            const baseCompMap = baseCond.components;
            // Lightweight Map-compatible lookup wrapper (canReach only calls .get()).
            const components = {
              get: (key: string) => extraCompMap.get(key) ?? baseCompMap.get(key),
              has: (key: string) => extraCompMap.has(key) || baseCompMap.has(key),
            } as Map<string, number>;
            condensed = { components, forward: overlayForward };
          }
        } else {
          condensed = condenseComponents(preparedBase.topology);
        }
      }
      return condensed;
    },
    plan: preparedSearch(basePrepared, () => preparedBase.condensed),
  };
  return preparedBase;
}
const preparedSearch = (base: PreparedGraph, getComponents: () => CondensedTopology) => {
  const estimates: Estimates = {};
  let disconnected = false,
    components: CondensedTopology | undefined;
  return (
    extra: Graph,
    starts: Arrival[],
    goal: string | string[],
    locomotion?: LocomotionOptions,
  ): Route => {
    const prepared = prepareGraph(extra, null, base);
    // Successful queries avoid all component work. Only after a complete failed
    // search do refinements condense the planner's immutable accepted base graph.
    components ??= disconnected ? getComponents() : undefined;
    return search(
      prepared,
      starts,
      goal,
      estimates,
      {
        components,
        links: prepared.links,
        exhausted: () => {
          disconnected = true;
        },
      },
      locomotion,
    );
  };
};
const overlay = <V>(base: Index<V>): Index<V> => {
  const own = new Map<string, V>();
  return {
    has: (key: string) => own.has(key) || (base?.has(key) ?? false),
    get: (key: string) => (own.has(key) ? own.get(key) : base?.get(key)),
    set: (key: string, value: V) => own.set(key, value),
  };
};
function prepareGraph(
  graph: Graph,
  constraints?: RouteConstraints | null,
  base?: PreparedGraph,
  accepted?: Edge[],
): PreparedGraph {
  const blocked =
    base?.blocked ??
    (constraints ? createWallChecker(constraints.walls, constraints.profile) : null);
  // Skip calling blocked() across 600k edges when no active wall exists while
  // still validating all walls/profile via createWallChecker above.
  const checkBlocked =
    base !== undefined
      ? blocked && !blocked.empty
        ? blocked
        : null
      : constraints && constraints.walls.some((wall) => wall.state !== 'inactive')
        ? blocked
        : null;
  // Query endpoints and actions overlay the immutable scene. Copying million-node
  // maps on every refinement pass costs memory without changing their contents.
  const nodes = base ? overlay(base.nodes) : new Map<string, Vec3>();
  for (let i = 0; i < graph.nodes.length; i++) {
    const node = graph.nodes[i];
    if (typeof node.id !== 'string' || nodes.has(node.id) || !finitePoint(node.position))
      throw new Error('Invalid node');
    nodes.set(node.id, node.position);
  }
  const edges = base ? overlay(base.edges) : new Map<string, Edge[]>();
  let maxSpeed = base?.maxSpeed ?? 0;
  const copied = base ? new Set<string>() : null,
    links: Edge[] | undefined = base ? [] : undefined;
  for (let e = 0; e < graph.edges.length; e++) {
    const edge = graph.edges[e];
    const fromNode = nodes.get(edge.from);
    const toNode = nodes.get(edge.to);
    const pts = edge.points;
    if (
      fromNode === undefined ||
      toNode === undefined ||
      !Number.isFinite(edge.cost) ||
      edge.cost < 0 ||
      (edge.state !== 'open' && edge.state !== 'closed' && edge.state !== 'unknown') ||
      !Array.isArray(pts) ||
      pts.length < 2
    )
      throw new Error('Invalid corridor');
    for (let i = 0; i < pts.length; i++) {
      if (!finitePoint(pts[i])) throw new Error('Invalid corridor');
    }
    const p0 = pts[0],
      pLast = pts[pts.length - 1];
    // Reference equality fast-path: surfaceGraph shares node position tuples
    // directly as edge endpoints, skipping 2x Math.hypot per ground edge.
    if (
      (p0 !== fromNode && distance(p0, fromNode) > 1e-6) ||
      (pLast !== toNode && distance(pLast, toNode) > 1e-6)
    )
      throw new Error('Invalid corridor');
    validateMotion(edge);
    if (edge.state === 'open') {
      let edgeBlocked = false;
      if (checkBlocked) {
        for (let i = 1; i < pts.length; i++) {
          if (checkBlocked(pts[i - 1], pts[i])) {
            edgeBlocked = true;
            break;
          }
        }
      }
      if (!edgeBlocked) {
        const span = distance(fromNode, toNode);
        if (span > 0) maxSpeed = Math.max(maxSpeed, edge.cost === 0 ? Infinity : span / edge.cost);
        let outgoing = edges.get(edge.from);
        if (base && !copied!.has(edge.from)) {
          outgoing = outgoing ? [...outgoing] : [];
          edges.set(edge.from, outgoing);
          copied!.add(edge.from);
        } else if (!outgoing) {
          outgoing = [];
          edges.set(edge.from, outgoing);
        }
        outgoing.push(edge);
        links?.push(edge);
        accepted?.push(edge);
      }
    }
  }
  return { nodes, edges, blocked, maxSpeed, links };
}
function search(
  { nodes, edges, blocked, maxSpeed }: PreparedGraph,
  starts: Arrival[],
  goal: string | string[],
  estimates: Estimates = {},
  connectivity: Connectivity | undefined,
  locomotion: LocomotionOptions | undefined,
  onPath?: (edges: Edge[]) => void,
): Route {
  const requested = Array.isArray(goal) ? goal : [goal];
  const mapped = requested.filter((id) => nodes.has(id));
  if (!mapped.length) return { status: 'unmapped' };
  const goals = new Set<string>(
    mapped.filter((id) => !blocked || !blocked(nodes.get(id)!, nodes.get(id)!)),
  );
  if (!goals.size) return { status: 'no-verified-route' };
  if (locomotion) return searchResources({ nodes, edges, blocked }, starts, goals, locomotion);
  // Derive the speed bound from all usable edges, including fast authored actions.
  // Triangle inequality makes distance / this bound admissible and consistent.
  // A displaced zero-cost edge correctly falls back to Dijkstra.
  const targets = [...goals].map((id) => nodes.get(id)!);
  // Action discovery repeatedly searches the same goal with additional edges.
  // Only geometric distance is reusable: new actions can change the speed bound.
  // Key by target positions, not transient endpoint IDs, and retain just one goal.
  const targetKey = JSON.stringify(targets);
  if (estimates.targetKey !== targetKey) {
    estimates.targetKey = targetKey;
    estimates.distances = new WeakMap<Vec3, number>();
  }
  const distances = estimates.distances!;
  const estimate =
    Number.isFinite(maxSpeed) && maxSpeed > 0
      ? (id: string) => {
          const position = nodes.get(id)!;
          let best = distances.get(position);
          if (best === undefined) {
            best = Infinity;
            for (const target of targets) best = Math.min(best, distance(position, target));
            distances.set(position, best);
          }
          return best / (maxSpeed * (1 + 1e-12));
        }
      : () => 0;
  const costs = new Map<string, number>(),
    previous = new Map<string, Edge>(),
    origins = new Map<string, string>(),
    heap = createMinHeap<{ id: string; travelled: number; cost: number }>();
  const { push, pop } = heap;
  const sourceIds = new Set<string>(),
    sourceNodes: string[] = [];
  for (const start of starts) {
    if (
      typeof start.id !== 'string' ||
      sourceIds.has(start.id) ||
      !Number.isFinite(start.cost) ||
      start.cost < 0 ||
      !['available', 'locked', 'unknown'].includes(start.state)
    )
      throw new Error('Invalid arrival');
    sourceIds.add(start.id);
    if (start.state !== 'available' || !nodes.has(start.node)) continue;
    if (blocked && blocked(nodes.get(start.node)!, nodes.get(start.node)!)) continue;
    if (start.cost < (costs.get(start.node) ?? Infinity)) {
      sourceNodes.push(start.node);
      costs.set(start.node, start.cost);
      origins.set(start.node, start.id);
      const priority = start.cost + estimate(start.node);
      push({ id: start.node, travelled: start.cost, cost: priority });
    }
  }
  if (!heap.size) return { status: 'unmapped' };
  // Starts, goals and every extra edge have already passed the original guards.
  // A failed optimistic check saves the exhaustive fine-graph search only; a
  // passing check continues through the exact same A* and tie-breaking below.
  if (
    connectivity?.components &&
    !canReach(connectivity.components, connectivity.links!, sourceNodes, goals)
  ) {
    return { status: 'no-verified-route' };
  }
  const finish = (
    root: string,
    path: Edge[],
    origin: string,
    cost: number,
    arrivalCost: number,
  ): Route => {
    path.reverse();
    onPath?.(path);
    const points: Vec3[] = [[...nodes.get(root)!]];
    for (const edge of path)
      for (const point of edge.points.slice(1)) {
        if (distance(points.at(-1)!, point) > 1e-9) points.push([...point]);
      }
    return {
      status: 'complete',
      start: origin,
      cost,
      points,
      arrivalCost,
      segments: path.map(routeSegment),
      length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0),
    };
  };
  while (heap.size) {
    const entry = pop()!,
      current = entry.id;
    if (entry.travelled !== costs.get(current)) continue;
    if (goals.has(current)) {
      const goal = current;
      const path: Edge[] = [];
      let root = goal;
      for (let id = goal; previous.has(id);) {
        const edge = previous.get(id)!;
        path.push(edge);
        id = edge.from;
        root = id;
      }
      return finish(root, path, origins.get(goal)!, costs.get(goal)!, costs.get(root)!);
    }
    for (const edge of edges.get(current) ?? []) {
      const cost = costs.get(current)! + edge.cost;
      if (cost < (costs.get(edge.to) ?? Infinity)) {
        costs.set(edge.to, cost);
        previous.set(edge.to, edge);
        origins.set(edge.to, origins.get(current)!);
        push({ id: edge.to, travelled: cost, cost: cost + estimate(edge.to) });
      }
    }
  }
  connectivity?.exhausted();
  return { status: 'no-verified-route' };
}
