import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
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
import {
  createPreparedRouteSearch,
  type PreparedRouteSearch,
  type RouteSearchSeed,
} from '#@/src/v1/search/route-search.ts';

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
  blocked: ReturnType<typeof createWallChecker> | null;
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
const finitePoint = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
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
  const accepted: Edge[] = [];
  const base = prepareGraph(graph, constraints, undefined, accepted);
  const ids = graph.nodes.map((node) => node.id);
  return preparedSearch(base, () => directedComponents(ids, base.edges), {
    nodes: graph.nodes,
    edges: accepted,
  });
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
  const preparedBase: {
    graph: Graph;
    forward: Index<Edge[]>;
    blocked: RouteBase['blocked'];
    topology: GroundTopology;
    plan: ReturnType<typeof preparedSearch>;
  } = {
    graph: graphSnapshot,
    forward: base.edges,
    blocked: base.blocked,
    get topology() {
      return (topology ??= groundComponents(graphSnapshot));
    },
    plan: preparedSearch(base, () => condenseComponents(preparedBase.topology), graphSnapshot),
  };
  return preparedBase;
}
const preparedSearch = (
  base: PreparedGraph,
  getComponents: () => CondensedTopology,
  snapshot: Graph,
) => {
  const estimates: Estimates = {};
  const numeric = createPreparedRouteSearch(snapshot);
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
      undefined,
      numeric && { search: numeric, nodes: extra.nodes, links: prepared.links! },
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
  // Query endpoints and actions overlay the immutable scene. Copying million-node
  // maps on every refinement pass costs memory without changing their contents.
  const nodes = base ? overlay(base.nodes) : new Map<string, Vec3>();
  for (const node of graph.nodes) {
    if (typeof node.id !== 'string' || nodes.has(node.id) || !finitePoint(node.position))
      throw new Error('Invalid node');
    nodes.set(node.id, node.position);
  }
  const edges = base ? overlay(base.edges) : new Map<string, Edge[]>();
  let maxSpeed = base?.maxSpeed ?? 0;
  const copied = base ? new Set<string>() : null,
    links: Edge[] | undefined = base ? [] : undefined;
  for (const edge of graph.edges) {
    if (
      !nodes.has(edge.from) ||
      !nodes.has(edge.to) ||
      !Number.isFinite(edge.cost) ||
      edge.cost < 0 ||
      !['open', 'closed', 'unknown'].includes(edge.state) ||
      !Array.isArray(edge.points) ||
      edge.points.length < 2 ||
      !edge.points.every(finitePoint) ||
      distance(edge.points[0], nodes.get(edge.from)!) > 1e-6 ||
      distance(edge.points.at(-1)!, nodes.get(edge.to)!) > 1e-6
    )
      throw new Error('Invalid corridor');
    validateMotion(edge);
    if (
      edge.state === 'open' &&
      (!blocked || !edge.points.slice(1).some((p, i) => blocked(edge.points[i], p)))
    ) {
      const span = distance(nodes.get(edge.from)!, nodes.get(edge.to)!);
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
  numeric?: { search: PreparedRouteSearch; nodes: Node[]; links: Edge[] },
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
  const seeds: RouteSearchSeed[] | undefined = numeric ? [] : undefined;
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
      seeds?.push({ node: start.node, origin: start.id, travelled: start.cost, priority });
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
  if (numeric) {
    const result = numeric.search.search({
      nodes: numeric.nodes,
      links: numeric.links,
      seeds: seeds!,
      goals: [...goals],
      targetKey,
      ...(Number.isFinite(maxSpeed) && maxSpeed > 0
        ? { estimateDenominator: maxSpeed * (1 + 1e-12) }
        : {}),
    });
    if (result)
      return finish(
        result.root,
        result.reversePath,
        result.origin,
        result.cost,
        result.arrivalCost,
      );
    connectivity?.exhausted();
    return { status: 'no-verified-route' };
  }
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
