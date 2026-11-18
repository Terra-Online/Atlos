import type { Vec3 } from '#@/src/geometry.ts';
import { createBoundsIndex } from '#@/src/model/bounds.ts';
import { jumpDuration, jumpTravel } from '#@/src/model/flight.ts';
import { type GoalProjection, closestOnSurface, findGoalHit } from '#@/src/model/goals.ts';
import type { InteractionGoal, JumpModel } from '#@/src/movement.ts';
import type { GroundArrival } from '#@/src/route.ts';
import type { SceneTransfer, SceneNavigation } from '#@/src/solver/resources.ts';
import { surfaceGraph, surfacePortals } from '#@/src/v1/geo/surfaces.ts';
import { groundComponents } from '#@/src/v1/reach/connectivity.ts';
import { createGroundStraightener } from '#@/src/v1/route/straighten.ts';
import { createTransferQuery } from '#@/src/v1/search/candidate-transfers.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';
import { createTransportGuide } from '#@/src/v1/search/transport-guide.ts';

export interface CandidateEdge {
  mode?: string;
  device?: string;
  index: number;
  /** Stable within immutable input geometry, independent of lazy expansion order. */
  key?: string;
  from: string;
  to: string;
  points: Vec3[];
  unresolved: boolean;
}

export interface CandidatePlannerOptions {
  radius?: number;
  verticalRange?: number;
  transferPenalty?: number;
  ascentPenalty?: number;
  endpointRadius?: number;
  connections?: { from: string; to: string; points: Vec3[]; mode?: string; device?: string }[];
}
export interface CandidateQueryOptions {
  interaction?: InteractionGoal;
  jumpModel?: JumpModel;
  excludedEdges?: (number | string)[];
  excludedTransfers?: { from: string; to: string; min: Vec3; max: Vec3 }[];
}
export type CandidatePlanResult =
  | {
      status: 'candidate';
      arrival: GroundArrival;
      points: Vec3[];
      path: CandidateEdge[];
      unresolved: CandidateEdge[];
      score: number;
    }
  | { status: 'unmapped' | 'no-candidate' };

type Arc = Omit<CandidateEdge, 'index' | 'unresolved'> & {
  unresolved?: boolean;
  order?: number[];
  reverse?: boolean;
  connectionIndex?: number;
  length?: number;
  cost?: number;
  localStart?: boolean;
  goalFallback?: boolean;
  attachment?: 'start' | 'goal';
  state?: 'open' | 'closed' | 'unknown';
};

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
/** Navigation proposals for local physical planning. Every returned segment still
 * requires physical validation. Scores prioritize fewer unresolved transfers and
 * are deliberately separate from travel time. Input geometry is immutable. */
export function createCandidatePlanner(
  data: SceneNavigation,
  {
    radius = 16,
    verticalRange = 50,
    transferPenalty = 10000,
    ascentPenalty = 1000000,
    endpointRadius = 96,
    connections = [],
  }: CandidatePlannerOptions = {},
) {
  if (
    ![radius, verticalRange, transferPenalty, ascentPenalty, endpointRadius].every(
      (v) => Number.isFinite(v) && v > 0,
    )
  ) {
    throw new Error('Invalid candidate search options');
  }
  const portals = surfacePortals(data.surfaces);
  const graph = surfaceGraph(data.surfaces, data.options, portals);
  const topology = groundComponents(graph);
  const ids = topology.ids;
  const adjacency = graph.nodes.map((): number[] => []);
  const edges: Arc[] = graph.edges;
  const edgeCost = (edge: Arc, score = 0) => {
    const ascent = edge.points.at(-1)![1] - edge.points[0][1];
    const penalty =
      edge.unresolved && !edge.localStart
        ? ascent > 2.1 && !edge.mode
          ? ascentPenalty
          : transferPenalty
        : 0;
    return (
      score + penalty + (edge.goalFallback ? transferPenalty : 0) + (edge.length ?? edge.cost!)
    );
  };
  const groundEdgeCount = edges.length;
  for (let index = 0; index < edges.length; index++)
    adjacency[ids.get(edges[index].from)!].push(index);
  const transfers = createTransferQuery(data.surfaces, topology, radius, verticalRange);
  const expanded = new Set<number>(),
    materialized = new Set<string>(),
    dirty = new Set<number>();
  const expand = (component: number | undefined) => {
    if (component === undefined || expanded.has(component)) return;
    expanded.add(component);
    // Earlier expansions already materialized every proposal for their component
    // pairs in both directions, including the same encounter ranks and keys.
    for (const proposal of transfers(component, expanded)) {
      if (materialized.has(proposal.key)) continue;
      materialized.add(proposal.key);
      const { key, rank, first, ...forward } = proposal;
      for (const edge of [
        forward,
        { ...forward, from: forward.to, to: forward.from, points: [...forward.points].reverse() },
      ]) {
        adjacency[ids.get(edge.from)!].push(edges.length);
        dirty.add(ids.get(edge.from)!);
        edges.push({
          ...edge,
          order: first,
          reverse: edge !== forward,
          key: JSON.stringify(['transfer', key, edge.from, edge.to]),
        });
      }
    }
  };
  for (const [connectionIndex, connection] of connections.entries()) {
    if (
      !ids.has(connection.from) ||
      !ids.has(connection.to) ||
      !Array.isArray(connection.points) ||
      connection.points.length < 2
    ) {
      throw new Error('Invalid candidate connection');
    }
    adjacency[ids.get(connection.from)!].push(edges.length);
    edges.push({
      ...connection,
      connectionIndex,
      key: JSON.stringify(['connection', connectionIndex, connection]),
      unresolved: true,
      length: connection.points
        .slice(1)
        .reduce((sum, point, index) => sum + distance(connection.points[index], point), 0),
    });
  }
  const surfaceBounds = data.surfaces.map((surface, order) => ({
    surface,
    order,
    min: [0, 1, 2].map((axis) => Math.min(...surface.vertices.map((point) => point[axis]))),
    max: [0, 1, 2].map((axis) => Math.max(...surface.vertices.map((point) => point[axis]))),
  }));
  const endpointIndex = createBoundsIndex(surfaceBounds);
  const endpoints = new Map<string, number>(),
    attachments = new Map<number, number>(),
    endpointComponents = new Map<number, number>();
  const componentOf = (node: number) => topology.components[node] ?? endpointComponents.get(node);
  const endpoint = (
    position: Vec3,
    direction: 'start' | 'goal',
    interaction?: InteractionGoal,
  ): number => {
    const key = JSON.stringify([direction, position, interaction]);
    if (endpoints.has(key)) return endpoints.get(key)!;
    const supports = new Map<string, GoalProjection>();
    const bounds = {
      min: position.map((value) => value - endpointRadius),
      max: position.map((value) => value + endpointRadius),
    };
    // Restore input order so ties retain their established support witness.
    const nearby = [...endpointIndex(bounds, position, endpointRadius)].sort(
      (a, b) => a.order - b.order,
    );
    for (const { surface } of nearby) {
      const support = closestOnSurface(surface, position);
      if (!support || support.distance > endpointRadius) continue;
      const node = ids.get(surface.id)!,
        component = topology.components[node];
      const cell = [component, ...support.position.map((v) => Math.floor(v / radius))].join('/');
      if ((supports.get(cell)?.distance ?? Infinity) > support.distance)
        supports.set(cell, support);
    }
    const node = graph.nodes.length,
      id = `@candidate-endpoint/${node}`;
    graph.nodes.push({ id, position });
    ids.set(id, node);
    adjacency.push([]);
    const nearest = [...supports.values()].sort((a, b) => a.distance - b.distance)[0];
    if (nearest && nearest.distance <= data.options.maxVertical) {
      endpointComponents.set(node, topology.components[ids.get(nearest.surface)!]);
    }
    const goalContacts =
      interaction && !interaction.airborne
        ? new Set(
            [...supports.values()]
              .filter((support) =>
                findGoalHit([support.position, support.position], position, interaction),
              )
              .map((support) => support.surface),
          )
        : undefined;
    let attachment = Infinity;
    for (const support of supports.values()) {
      const other = ids.get(support.surface)!;
      // A source navigation witness inside the real interaction volume is
      // already a valid coarse contact. The physical window still owns body
      // support, obstacles, action timing and the original interaction request.
      const localGoal = goalContacts?.has(support.surface);
      const points = localGoal
        ? [support.position, graph.nodes[other].position]
        : [position, support.position, graph.nodes[other].position];
      const from = direction === 'start' ? node : other,
        to = direction === 'start' ? other : node;
      adjacency[from].push(edges.length);
      dirty.add(from);
      edges.push({
        key: JSON.stringify(['endpoint', direction, position, support.surface, support.position]),
        from: graph.nodes[from].id,
        to: graph.nodes[to].id,
        points: direction === 'start' ? points : points.reverse(),
        // A short authored-start attachment is still physically unresolved, but
        // does not carry the exploration penalty of a generated movement transfer.
        attachment: direction,
        localStart:
          direction === 'start' &&
          Math.hypot(position[0] - support.position[0], position[2] - support.position[2]) <=
            (data.options.profile?.radius ?? 0) &&
          Math.abs(position[1] - support.position[1]) <= data.options.maxVertical,
        // An attachment outside an ordinary interaction volume still has value
        // when the fine physical mesh supplies better support. Charge it an
        // additional transfer before favouring it over a mapped goal contact.
        goalFallback: !!goalContacts?.size && !localGoal,
        unresolved:
          !localGoal &&
          (Math.hypot(position[0] - support.position[0], position[2] - support.position[2]) >
            1e-6 ||
            Math.abs(position[1] - support.position[1]) > data.options.maxVertical),
        length:
          (localGoal ? 0 : support.distance) +
          distance(support.position, graph.nodes[other].position),
      });
      attachment = Math.min(attachment, edgeCost(edges.at(-1)!));
    }
    endpoints.set(key, node);
    attachments.set(node, attachment);
    return node;
  };
  const append = (points: Vec3[], point: Vec3) => {
    if (!points.length || distance(points.at(-1)!, point) > 1e-6) points.push(point);
  };
  const groundPoints = (arrival: GroundArrival, path: CandidateEdge[], goal: Vec3) => {
    const points: Vec3[] = [],
      run: Vec3[] = [],
      selected = new Set<number>();
    const include = (id: string) => {
      const node = ids.get(id)!;
      if (node < data.surfaces.length) selected.add(node);
    };
    const flush = () => {
      if (!run.length) return;
      let output = run;
      if (run.length > 2 && selected.size) {
        // Prepare only the selected corridor and one ring of known neighbours.
        // The global portals remain authoritative: recomputing a subset could
        // reopen a boundary that was ambiguous in the complete scene.
        const local = new Set<number>(selected);
        for (const node of selected)
          for (const index of adjacency[node]) {
            if (index < groundEdgeCount) local.add(ids.get(edges[index].to)!);
          }
        const surfaces = [...local].map((node) => data.surfaces[node]);
        const shared = portals.filter(
          (portal) => local.has(ids.get(portal.from)!) && local.has(ids.get(portal.to)!),
        );
        const imported = (data.options.portals ?? []).filter(
          (portal) => local.has(ids.get(portal.from)!) && local.has(ids.get(portal.to)!),
        );
        const straighten = createGroundStraightener(
          surfaces,
          {
            walls: data.options.walls ?? [],
            profile: data.options.profile ?? { radius: 0, height: 1 },
            portals: imported,
          },
          shared,
        );
        output = straighten(run);
      }
      for (const point of output) append(points, point);
      run.length = 0;
      selected.clear();
    };
    append(run, arrival.position);
    for (const edge of path) {
      include(edge.from);
      if (edge.unresolved || edge.mode || edge.device) {
        // The in-face approach can straighten, but the transfer itself is a
        // hard boundary. Its authored trajectory and endpoints stay intact.
        append(run, edge.points[0]);
        flush();
        for (const point of edge.points) append(points, point);
        append(run, edge.points.at(-1)!);
        include(edge.to);
      } else {
        include(edge.to);
        for (const point of edge.points) append(run, point);
      }
    }
    append(run, goal);
    flush();
    // Projection roundoff must not replace the caller's actual destination.
    if (points.length === 1 && distance(points[0], goal) > 0) points.push(goal);
    else points[points.length - 1] = goal;
    return points;
  };
  // Lazy materialization must not let an earlier query reorder equal-cost choices.
  const compareEdges = (a: number, b: number) => {
    const left = edges[a],
      right = edges[b];
    const category = (edge: Arc, index: number) =>
      index < groundEdgeCount ? 0 : edge.order ? 1 : edge.connectionIndex !== undefined ? 2 : 3;
    const difference = category(left, a) - category(right, b);
    if (difference) return difference;
    if (left.order && right.order) {
      for (let axis = 0; axis < left.order.length; axis++) {
        const delta = left.order[axis] - right.order[axis];
        if (delta) return delta;
      }
      return Number(left.reverse) - Number(right.reverse);
    }
    return a - b;
  };
  const edgeKey = (edge: Arc, index: number) => edge.key ?? JSON.stringify(['ground', index]);
  const edgeOutput = (index: number): CandidateEdge => {
    const edge = edges[index];
    return {
      index,
      key: edgeKey(edge, index),
      from: edge.from,
      to: edge.to,
      points: edge.points,
      unresolved: Boolean(edge.unresolved),
      ...(edge.mode ? { mode: edge.mode } : {}),
      ...(edge.device ? { device: edge.device } : {}),
    };
  };
  const rejected = new Set<number | string>();
  let guide: ReturnType<typeof createTransportGuide> | undefined;

  return {
    moving(
      starts: GroundArrival[],
      goal: Vec3,
      interaction: InteractionGoal,
      transfers: readonly SceneTransfer[],
    ) {
      if (!transfers.length) return;
      // The candidate planner also owns temporary endpoint nodes. Only immutable
      // ground nodes and edges belong to this scene-wide transport guide.
      guide ??= createTransportGuide(
        data.surfaces,
        {
          nodes: graph.nodes.slice(0, data.surfaces.length),
          edges: graph.edges.slice(0, groundEdgeCount),
        },
        topology,
        data.options.speed,
        data.options.maxVertical,
        transfers,
      );
      return guide(starts, goal, interaction);
    },
    reject(indices: (number | string)[]) {
      for (const index of indices) {
        if (
          typeof index !== 'string' &&
          (!Number.isInteger(index) || index < 0 || index >= edges.length)
        )
          throw new Error('Invalid candidate edge');
        rejected.add(index);
      }
    },
    plan(
      arrivals: GroundArrival[],
      goal: Vec3,
      {
        excludedEdges = [],
        excludedTransfers = [],
        interaction,
        jumpModel,
      }: CandidateQueryOptions = {},
    ): CandidatePlanResult {
      const finish = (
        arrival: GroundArrival,
        path: CandidateEdge[],
        score: number,
      ): CandidatePlanResult => ({
        status: 'candidate',
        arrival,
        points: groundPoints(arrival, path, goal),
        path,
        unresolved: path.filter((edge) => edge.unresolved),
        score,
      });
      const excluded = new Set(excludedEdges);
      const hasKeys = [...excluded, ...rejected].some((value) => typeof value === 'string');
      const end = endpoint(goal, 'goal', interaction);
      const starts = arrivals
        .filter((arrival) => arrival.state === 'available')
        .map((arrival) => ({ arrival, node: endpoint(arrival.position, 'start') }));
      const regions = excludedTransfers.map((region) => {
        if (
          !ids.has(region.from) ||
          !ids.has(region.to) ||
          !Array.isArray(region.min) ||
          !Array.isArray(region.max) ||
          region.min.length !== 3 ||
          region.max.length !== 3 ||
          region.min.some(
            (value, axis) =>
              !Number.isFinite(value) ||
              !Number.isFinite(region.max[axis]) ||
              value > region.max[axis],
          )
        ) {
          throw new Error('Invalid excluded transfer region');
        }
        return {
          ...region,
          fromComponent: componentOf(ids.get(region.from)!),
          toComponent: componentOf(ids.get(region.to)!),
        };
      });
      const ordinaryJump = jumpModel && { ...jumpModel, mode: 'jump' as const };
      const snap = Math.min(data.options.maxVertical, data.options.profile?.radius ?? 0);
      const fitsMovement = (edge: Arc) => {
        if (!ordinaryJump) return true;
        if (edge.attachment === 'start') return !edge.unresolved || Boolean(edge.localStart);
        if (edge.attachment === 'goal') return !edge.unresolved && !edge.goalFallback;
        if (!edge.order) return true;
        const [from, to] = edge.points;
        // Coarse supports can snap by one body radius in the physical window.
        // Even with that allowance, a reverse or overlong gap cannot guide
        // an ordinary jump. Max-height flight bounds an ordinary drop too.
        const duration = jumpDuration(from[1] + snap, to[1] - snap, ordinaryJump);
        return (
          duration !== null &&
          Math.hypot(from[0] - to[0], from[2] - to[2]) - 2 * snap <=
            jumpTravel(
              ordinaryJump.startHorizontalSpeed ?? ordinaryJump.maxHorizontalSpeed,
              duration,
              ordinaryJump,
            )
        );
      };
      const skip = (edge: Arc, index: number, from: number, to: number) =>
        rejected.has(index) ||
        excluded.has(index) ||
        !fitsMovement(edge) ||
        (hasKeys && (rejected.has(edgeKey(edge, index)) || excluded.has(edgeKey(edge, index)))) ||
        (edge.unresolved &&
          regions.some(
            (region) =>
              region.fromComponent === componentOf(from) &&
              region.toComponent === componentOf(to) &&
              edge.points.every((point) =>
                point.every(
                  (value, axis) => value >= region.min[axis] && value <= region.max[axis],
                ),
              ),
          ));
      const scoreEdge = (edge: Arc, score: number) =>
        ordinaryJump
          ? score +
            (edge.length === undefined ? edge.cost! : edge.length / data.options.speed) +
            (edge.unresolved && !edge.attachment ? 2 : 0)
          : edgeCost(edge, score);
      const search = (discover: boolean, limit = Infinity): CandidatePlanResult => {
        const scores = new Float64Array(graph.nodes.length).fill(Infinity);
        const previous = new Int32Array(graph.nodes.length).fill(-1),
          origins = new Map<number, GroundArrival>(),
          heap = createMinHeap<{ node: number; cost: number }>();
        for (const { arrival, node } of starts) {
          const score = arrival.cost ?? 0;
          if (score >= scores[node]) continue;
          scores[node] = score;
          origins.set(node, arrival);
          heap.push({ node, cost: score });
        }
        while (heap.size) {
          const current = heap.pop()!;
          if (current.cost !== scores[current.node]) continue;
          if (current.cost >= limit) break;
          if (current.node === end) break;
          if (discover) expand(topology.components[current.node]);
          if (dirty.delete(current.node)) adjacency[current.node].sort(compareEdges);
          for (const index of adjacency[current.node]) {
            const edge = edges[index],
              to = ids.get(edge.to)!;
            if (skip(edge, index, current.node, to)) continue;
            const score = scoreEdge(edge, current.cost);
            if (score >= scores[to]) continue;
            scores[to] = score;
            previous[to] = index;
            origins.set(to, origins.get(current.node)!);
            heap.push({ node: to, cost: score });
          }
        }
        if (!Number.isFinite(scores[end]) || scores[end] >= limit)
          return { status: 'no-candidate' };
        const path: CandidateEdge[] = [];
        for (let node = end; previous[node] !== -1;) {
          const index = previous[node],
            edge = edges[index];
          path.push(edgeOutput(index));
          node = ids.get(edge.from)!;
        }
        path.reverse();
        return finish(origins.get(end)!, path, scores[end]);
      };
      // Every new transfer pays at least one exploration penalty, in addition
      // to the cheapest original-source and goal attachments. A known corridor
      // below that bound cannot be improved or tied by expanding a component.
      const bound = ordinaryJump
        ? Math.min(...starts.map(({ arrival }) => arrival.cost ?? 0)) + 2
        : Math.min(
            ...starts.map(({ arrival, node }) => (arrival.cost ?? 0) + attachments.get(node)!),
          ) +
          attachments.get(end)! +
          Math.min(transferPenalty, ascentPenalty);
      if (Number.isFinite(bound)) {
        const known = search(false, bound - 8 * Number.EPSILON * Math.max(1, Math.abs(bound)));
        if (known.status === 'candidate') return known;
      }
      return search(true);
    },
  };
}
