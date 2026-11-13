import type { Vec3 } from '#@/src/geometry.ts';
import type { Segment, LocomotionOptions } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import { routeSegment } from '#@/src/v1/motion/motion.ts';
import { type LocomotionState, createLocomotion } from '#@/src/v1/resource/locomotion.ts';
import type { Arrival, RouteBase } from '#@/src/v1/route/routes.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

interface Label {
  node: string;
  cost: number;
  arrival: Arrival;
  state: LocomotionState;
  previous: Label | null;
  segments: Segment[];
  key?: string;
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
// Equal continuation states are substitutable under the existing deterministic
// scheduling policy. More energy alone is insufficient: automatic sprint restart
// may occur earlier and alter the entry gait at the next action.
const stateKey = (state: LocomotionState) =>
  JSON.stringify([
    state.energy,
    state.delay,
    state.sprinting,
    state.hasActivated,
    state.velocity,
    state.previousDirection,
    state.dashCooldown,
    state.dashRemaining,
  ]);
/** Label-setting search over the finite retained graph and exact resource states.
 * Limits bound cyclic continuous-state graphs. Reaching either limit is exposed
 * on both successful and unresolved results; it never establishes unreachability.
 */
export function searchResources(
  { nodes, edges, blocked }: RouteBase,
  starts: Arrival[],
  goals: Set<string>,
  options: LocomotionOptions,
): Route {
  const locomotion = createLocomotion(options);
  const maxLabels = options.search?.maxLabels ?? 256;
  const maxExpanded = options.search?.maxExpanded ?? 100000;
  if (![maxLabels, maxExpanded].every((value) => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Invalid resource search limits');
  }
  const search = { truncated: false, expanded: 0, maxLabels, maxExpanded };
  const labels = new Map<string, Map<string, Label>>(),
    heap = createMinHeap<Label>(),
    ids = new Set<string>();
  let best: Label | null = null;
  const retain = (label: Label, incumbent: Label | null): Label | null => {
    const key = stateKey(label.state);
    let atNode = labels.get(label.node);
    if (!atNode) {
      atNode = new Map<string, Label>();
      labels.set(label.node, atNode);
    }
    const previous = atNode.get(key);
    if (previous && previous.cost <= label.cost) return incumbent;
    // Keep every complete candidate even if its node's label allowance is full.
    if (goals.has(label.node) && (!incumbent || label.cost < incumbent.cost)) incumbent = label;
    if (!previous && atNode.size >= maxLabels) {
      search.truncated = true;
      return incumbent;
    }
    label.key = key;
    atNode.set(key, label);
    heap.push(label);
    return incumbent;
  };
  for (const start of starts) {
    if (
      typeof start.id !== 'string' ||
      ids.has(start.id) ||
      !Number.isFinite(start.cost) ||
      start.cost < 0 ||
      !['available', 'locked', 'unknown'].includes(start.state)
    )
      throw new Error('Invalid arrival');
    ids.add(start.id);
    if (start.state !== 'available' || !nodes.has(start.node)) continue;
    const point = nodes.get(start.node)!;
    if (blocked?.(point, point)) continue;
    best = retain(
      {
        node: start.node,
        cost: start.cost,
        arrival: start,
        state: locomotion.initial(),
        previous: null,
        segments: [],
      },
      best,
    );
  }
  if (!heap.size && !best) return { status: 'unmapped', search };
  while (heap.size) {
    const current = heap.pop()!;
    if (labels.get(current.node)!.get(current.key!) !== current) continue;
    if (best && current.cost >= best.cost) break;
    if (search.expanded >= maxExpanded) {
      search.truncated = true;
      break;
    }
    search.expanded++;
    for (const edge of edges.get(current.node) ?? []) {
      for (const next of locomotion.advance(routeSegment(edge), current.state)) {
        best = retain(
          {
            node: edge.to,
            cost: current.cost + next.duration,
            state: next.state,
            arrival: current.arrival,
            previous: current,
            segments: next.segments,
          },
          best,
        );
      }
    }
  }
  const selected = best;
  if (!selected) return { status: 'no-verified-route', search };
  const path = [];
  for (let label = selected; label.previous; label = label.previous) path.push(label.segments);
  const segments = path.reverse().flat(),
    points: Vec3[] = [[...nodes.get(selected.arrival.node)!]];
  for (const segment of segments)
    for (const point of segment.points.slice(1)) {
      if (distance(points.at(-1)!, point) > 1e-9) points.push([...point]);
    }
  const energy = options.stamina?.initial ?? 0;
  return {
    status: 'complete',
    start: selected.arrival.id,
    arrivalCost: selected.arrival.cost,
    cost: selected.cost,
    segments,
    points,
    search,
    length: points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0),
    ...(options.stamina
      ? {
          locomotion: {
            initial: energy,
            final: selected.state.energy,
            minimum: selected.state.minimum,
          },
        }
      : {}),
  };
}
