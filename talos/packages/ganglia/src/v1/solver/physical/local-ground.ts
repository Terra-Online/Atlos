import type { Vec3 } from '#@/src/geometry.ts';
import { findGoalHit } from '#@/src/model/goals.ts';
import type { PhysicalWorld } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

interface Options {
  maxExpanded: number;
  signal?: AbortSignal;
}
interface Node {
  readonly x: number;
  readonly z: number;
  readonly point: Vec3;
  readonly length: number;
  readonly cost: number;
  readonly key: string;
  readonly parent?: { node: Node; trace: Vec3[] };
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const lengthOf = (points: Vec3[]) =>
  points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0);
const directions = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
];

/** A bounded raw-support walking proposal. The fixed half-metre lattice samples
 * local alternatives; exhausting it never proves that the query is unreachable.
 * The caller must execute and accept the complete result before using its cost. */
export function localGround(snapshot: PhysicalWorld, query: RouteQuery, options: Options) {
  if (!Number.isSafeInteger(options.maxExpanded) || options.maxExpanded < 0)
    throw new Error('Invalid local walking expansion limit');
  options.signal?.throwIfAborted();
  const maxExpanded = Math.min(2048, options.maxExpanded);
  const diagnostics = {
    expanded: 0,
    proofs: 0,
    shortcutProofs: 0,
    maxExpanded,
    remaining: 0,
    coverageMissing: 0,
    truncated: false,
    reason: 'no-proposal',
  };
  const result = (routes: Route[] = []) => ({ routes, diagnostics });
  if (query.starts.length !== 1 || query.waypoints?.length) {
    diagnostics.reason = 'unsupported-query';
    return result();
  }
  const arrival = query.starts[0];
  if (!maxExpanded || arrival.state !== 'available') {
    diagnostics.reason = !maxExpanded ? 'budget' : 'start-unavailable';
    diagnostics.truncated = !maxExpanded;
    return result();
  }
  const physical = snapshot.configured();
  const covered = (a: Vec3, b = a) => {
    if (snapshot.covered(a, b)) return true;
    diagnostics.coverageMissing++;
    diagnostics.truncated = true;
    return false;
  };
  const standing = (point: Vec3) => (covered(point) ? physical.standing(point) : null);
  const start = standing(arrival.position);
  if (!start) {
    diagnostics.reason = 'start-unproved';
    return result();
  }
  // walkTrace can change endpoints or insert support bends. Each retained leg
  // must itself replay as that same supported chord before entering the lattice.
  const prove = (a: Vec3, b: Vec3): Vec3[] | null => {
    options.signal?.throwIfAborted();
    diagnostics.proofs++;
    if (!covered(a, b)) return null;
    const trace = physical.walkTrace(a, b);
    if (!trace || distance(trace[0], a) > 1e-5 || distance(trace.at(-1)!, b) > 1e-5) return null;
    for (let i = 1; i < trace.length; i++) {
      options.signal?.throwIfAborted();
      const from = trace[i - 1],
        to = trace[i];
      const leg = physical.walkTrace(from, to);
      if (!leg || distance(leg[0], from) > 1e-5 || distance(leg.at(-1)!, to) > 1e-5) return null;
      const length = lengthOf(leg);
      if (Math.abs(length - distance(from, to)) > 1e-5 * Math.max(1, length)) return null;
      for (const fraction of [0.25, 0.5, 0.75]) {
        const point = from.map((v, axis) => v + fraction * (to[axis] - v)) as Vec3;
        const feet = physical.standing(point);
        if (!feet || distance(feet, point) > 1e-5) return null;
      }
    }
    return trace;
  };
  if (!prove(start, start)) {
    diagnostics.reason = 'start-unproved';
    return result();
  }
  let target: Vec3 | null = null;
  if (covered(query.goal)) {
    const hit = physical.world.groundAt(query.goal, {
      maxUp: snapshot.input.ground.options.maxVertical,
      maxDown: snapshot.input.ground.options.maxVertical,
      maxSlope: snapshot.input.movement.maxSlope,
      radius: snapshot.input.ground.options.profile.radius,
    });
    if (hit) target = standing([query.goal[0], hit.position[1] + 0.005, query.goal[2]]);
  }
  const reached = (point: Vec3) =>
    query.interaction
      ? Boolean(findGoalHit([point, point], query.goal, query.interaction))
      : target !== null && distance(point, target) <= 1e-6;
  if (!query.interaction && !target) {
    diagnostics.reason = 'goal-unproved';
    return result();
  }
  const heuristic = (point: Vec3) =>
    Math.max(
      0,
      Math.hypot(point[0] - query.goal[0], point[2] - query.goal[2]) -
        (query.interaction?.radius ?? 0),
    );
  const keyOf = (x: number, z: number, point: Vec3) => `${x}/${z}/${Math.round(point[1] * 1000)}`;
  const origin: Node = {
    x: 0,
    z: 0,
    point: start,
    length: 0,
    cost: heuristic(start),
    key: keyOf(0, 0, start),
  };
  const heap = createMinHeap<Node>();
  const best = new Map<string, Node>([[origin.key, origin]]);
  heap.push(origin);
  let selected: Node | undefined;
  const append = (node: Node, trace: Vec3[], x: number, z: number): Node => {
    const point = trace.at(-1)!;
    const length = node.length + lengthOf(trace);
    return {
      x,
      z,
      point,
      length,
      cost: length + heuristic(point),
      key: keyOf(x, z, point),
      parent: { node, trace },
    };
  };
  const direct = target && reached(target) && prove(start, target);
  if (direct) selected = append(origin, direct, 0, 0);
  while (!selected && heap.size && diagnostics.expanded < maxExpanded) {
    options.signal?.throwIfAborted();
    const node = heap.pop()!;
    if (best.get(node.key) !== node) continue;
    diagnostics.expanded++;
    if (reached(node.point)) {
      selected = node;
      break;
    }
    if (target && reached(target) && distance(node.point, target) <= Math.SQRT1_2) {
      const trace = prove(node.point, target);
      if (trace) {
        selected = append(node, trace, node.x, node.z);
        break;
      }
    }
    for (const [dx, dz] of directions) {
      const x = node.x + dx,
        z = node.z + dz;
      const point = standing([start[0] + x * 0.5, node.point[1], start[2] + z * 0.5]);
      if (!point) continue;
      const key = keyOf(x, z, point),
        previous = best.get(key);
      if (node.length + distance(node.point, point) >= (previous?.length ?? Infinity)) continue;
      const trace = prove(node.point, point);
      if (!trace) continue;
      const next = append(node, trace, x, z);
      if (next.length >= (previous?.length ?? Infinity)) continue;
      best.set(key, next);
      heap.push(next);
    }
  }
  diagnostics.remaining = heap.size;
  diagnostics.truncated ||= heap.size > 0;
  if (!selected) {
    diagnostics.reason = diagnostics.expanded >= maxExpanded ? 'budget' : 'no-proposal';
    return result();
  }
  // Parent objects are immutable: replacing a cheaper key cannot splice an old
  // descendant onto a different prefix. Smoothing only replaces proved subpaths.
  const nodes: Node[] = [];
  for (let node: Node | undefined = selected; node; node = node.parent?.node) nodes.push(node);
  nodes.reverse();
  const original: Vec3[] = [
    start,
    ...nodes.slice(1).flatMap((node) => node.parent!.trace.slice(1)),
  ];
  const points: Vec3[] = [start];
  let changed = false;
  const shortcutLimit = Math.min(64, maxExpanded);
  for (let from = 0; from < nodes.length - 1;) {
    let next = from + 1,
      trace = nodes[next].parent!.trace;
    const targets = new Set(
      [1, 0.75, 0.5, 0.25].map(
        (fraction) => from + Math.ceil((nodes.length - 1 - from) * fraction),
      ),
    );
    for (const to of targets) {
      if (to <= from + 1 || diagnostics.shortcutProofs >= shortcutLimit) continue;
      diagnostics.shortcutProofs++;
      const shortcut = prove(nodes[from].point, nodes[to].point);
      if (shortcut && lengthOf(shortcut) < nodes[to].length - nodes[from].length - 1e-7) {
        next = to;
        trace = shortcut;
        changed = true;
        break;
      }
    }
    points.push(...trace.slice(1));
    from = next;
  }
  const routes: Route[] = [];
  for (const candidatePoints of changed ? [original, points] : [original]) {
    if (candidatePoints.length === 1) candidatePoints.push(start);
    const times = [0];
    for (let i = 1; i < candidatePoints.length; i++)
      times.push(
        times[i - 1] +
          distance(candidatePoints[i - 1], candidatePoints[i]) / snapshot.input.locomotion.speed,
      );
    const route = retimeGroundRoute(
      {
        status: 'complete',
        start: arrival.id,
        arrivalCost: arrival.cost,
        cost: arrival.cost + times.at(-1)!,
        length: lengthOf(candidatePoints),
        points: candidatePoints,
        segments: [{ mode: 'walk', points: candidatePoints, times }],
      },
      snapshot.input.locomotion,
    );
    if (route.status === 'complete') routes.push(route);
  }
  // Geometry length does not order resource schedules. Keep both independently
  // constructed proposals for the caller's full execution and cost comparison.
  diagnostics.reason = routes.length ? 'proposal' : 'resource-unproved';
  return result(routes);
}
