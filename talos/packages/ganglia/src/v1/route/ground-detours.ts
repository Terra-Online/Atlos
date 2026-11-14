import type { Vec3 } from '#@/src/geometry.ts';
import { hasTerminalGroundEvent, markTerminalGoal } from '#@/src/model/goals.ts';
import type { Segment, LocomotionOptions } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import {
  type CondensedTopology,
  groundComponents,
  condenseComponents,
  canReach,
} from '#@/src/v1/reach/connectivity.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { type GroundPlanner, groundPreparation } from '#@/src/v1/route/ground.ts';
import type { Graph } from '#@/src/v1/route/routes.ts';
import type { GroundStraightener } from '#@/src/v1/route/straighten.ts';

type CompleteRoute = Extract<Route, { status: 'complete' }>;

const topologies = new WeakMap<Graph, CondensedTopology>();
const detourTopology = (graph: Graph) => {
  let topology = topologies.get(graph);
  if (!topology) {
    topology = condenseComponents(groundComponents(graph));
    topologies.set(graph, topology);
  }
  return topology;
};
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const pointsOf = (segments: Segment[], start?: Vec3): Vec3[] =>
  segments.length
    ? [segments[0].points[0], ...segments.flatMap((s) => s.points.slice(1))]
    : [start!];
const lengthOf = (points: Vec3[]) =>
  points.slice(1).reduce((sum, point: Vec3, index) => sum + distance(points[index], point), 0);
const minimumDuration = (segments: Segment[], locomotion: LocomotionOptions) => {
  const maximumSpeed = Math.max(locomotion.sprintSpeed, locomotion.dash?.speed ?? 0);
  let duration = 0,
    coordinateScale = 1,
    operations = segments.length + 1;
  for (const segment of segments) {
    if (segment.mode !== 'walk') {
      duration += segment.times.at(-1)!;
      continue;
    }
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1],
        b = segment.points[i],
        length = distance(a, b);
      duration += length / maximumSpeed;
      for (let axis = 0; axis < 3; axis++)
        coordinateScale = Math.max(coordinateScale, Math.abs(a[axis]), Math.abs(b[axis]));
      operations += 1 + Math.ceil(length / (locomotion.speed * 0.1));
      if (locomotion.dash)
        operations += Math.ceil(length / (locomotion.dash.speed * locomotion.dash.duration));
    }
  }
  // Ignore stamina, acceleration and cooldown costs. Leave slack for skipped
  // subnanometre remnants, dash splits and sampled-clock rounding; near ties
  // must still reach the ordinary scheduler and its unchanged acceptance test.
  const slack =
    operations *
    (1e-9 / maximumSpeed +
      64 * Number.EPSILON * Math.max(1, coordinateScale / maximumSpeed, duration));
  return Math.max(0, duration - slack);
};
const straightenWalking = (
  route: CompleteRoute,
  straighten: GroundStraightener,
  speed: number,
): CompleteRoute => {
  const segments: Segment[] = [],
    pending: Segment[] = [];
  const goalSegment = route.goalHit?.segment;
  let changed = false,
    goalHit = route.goalHit;
  const flush = () => {
    if (!pending.length) return;
    const before = pointsOf(pending),
      points = straighten(before);
    if (lengthOf(points) < lengthOf(before) - 1e-6) {
      const times = [0];
      for (let i = 1; i < points.length; i++)
        times.push(times.at(-1)! + distance(points[i - 1], points[i]) / speed);
      if (points.length > 1) segments.push({ ...pending[0], points, times });
      changed = true;
    } else segments.push(...pending);
    pending.length = 0;
  };
  for (let i = 0; i < route.segments.length; i++) {
    const segment = route.segments[i];
    if (segment.mode === 'walk') {
      pending.push(segment);
      continue;
    }
    flush();
    if (goalSegment === i) goalHit = { ...goalHit!, segment: segments.length };
    segments.push(segment);
  }
  flush();
  if (!changed) return route;
  const points = pointsOf(segments, route.points[0]);
  return { ...route, points, segments, goalHit, length: lengthOf(points) };
};
// Sampling only route-segment ends misses a nearby return inside a long walk
// polyline. Split only ground motion at regular distances and real sharp turns;
// the original air/device trajectories stay indivisible.
const splitWalking = (route: CompleteRoute, interval = 4): CompleteRoute => {
  const segments: Segment[] = [];
  const goalSegment = route.goalHit?.segment;
  let goalHit = route.goalHit;
  for (let ordinal = 0; ordinal < route.segments.length; ordinal++) {
    const segment = route.segments[ordinal];
    if (goalSegment === ordinal) goalHit = { ...goalHit!, segment: segments.length };
    if (segment.mode !== 'walk') {
      segments.push(segment);
      continue;
    }
    let points = [segment.points[0]],
      times = [0],
      remaining = interval,
      elapsed = 0;
    const flush = () => {
      if (points.length > 1) segments.push({ ...segment, points, times });
      points = [points.at(-1)!];
      times = [0];
      remaining = interval;
    };
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1],
        b = segment.points[i],
        length = distance(a, b);
      let offset = 0;
      while (length - offset > 1e-9) {
        const step = Math.min(remaining, length - offset);
        offset += step;
        const fraction = offset / length;
        const point: Vec3 =
          length - offset < 1e-9
            ? b
            : ([
                a[0] + fraction * (b[0] - a[0]),
                a[1] + fraction * (b[1] - a[1]),
                a[2] + fraction * (b[2] - a[2]),
              ] satisfies Vec3);
        const time = segment.times[i - 1] + fraction * (segment.times[i] - segment.times[i - 1]);
        points.push(point);
        times.push(times.at(-1)! + time - elapsed);
        elapsed = time;
        remaining -= step;
        if (remaining < 1e-9) flush();
      }
      if (length > 1e-9 && i + 1 < segment.points.length) {
        const c = segment.points[i + 1],
          next = distance(b, c);
        const alignment =
          next > 1e-9
            ? a.reduce((sum, value, axis) => sum + (b[axis] - value) * (c[axis] - b[axis]), 0) /
              (length * next)
            : 1;
        if (alignment < Math.cos(Math.PI / 6)) flush();
      }
    }
    flush();
  }
  return { ...route, segments, goalHit };
};
/** Compare a selected action excursion with supported walking, including across
 * local-query seams. No airborne motion is cut in half. The supplied immutable
 * ground planner must cover each replacement and use the same walls/body constraints.
 * This bounded improvement pass does not establish global optimality. */
export function pruneGroundDetours(
  route: Route,
  planner: GroundPlanner,
  locomotion: LocomotionOptions,
  { maxQueries = 48 }: { maxQueries?: number } = {},
): { route: Route; replacements: number; queries: number } {
  if (!Number.isInteger(maxQueries) || maxQueries < 0)
    throw new Error('Invalid detour query budget');
  let best: Route = route,
    replacements = 0,
    queries = 0;
  // Boost expiry is tied to the original event timeline. Keep that evidence until
  // a replacement can explicitly repropagate boost activation and expiry.
  if (
    route.status !== 'complete' ||
    route.boosts?.length ||
    route.segments.some((s) => s.boost || s.boostExpiry !== undefined) ||
    (route.goalHit &&
      route.segments[route.goalHit.segment]?.mode === 'walk' &&
      !hasTerminalGroundEvent(route))
  ) {
    return { route, replacements, queries };
  }
  const terminalEvent = hasTerminalGroundEvent(route);
  const scheduled = retimeGroundRoute(
    terminalEvent ? { ...route, goalHit: undefined } : route,
    locomotion,
  );
  if (scheduled.status !== 'complete') return { route, replacements, queries };
  const preparation = groundPreparation(planner);
  // Impossible cross-floor goals must not consume all comparisons before a
  // nearby ground return is considered. Use unfiltered support topology here:
  // conservative blocked polygon centres can still have a valid walking bypass.
  const topology = preparation && detourTopology(preparation.graph);
  best = scheduled;
  while (true) {
    if (preparation) {
      const smoothed = straightenWalking(best, preparation.straighten, locomotion.speed);
      if (smoothed !== best) {
        const timed = retimeGroundRoute(smoothed, locomotion);
        if (timed.status === 'complete' && timed.cost < best.cost - 0.01) {
          best = timed;
          replacements++;
        }
      }
    }
    if (queries >= maxQueries) break;
    const comparison = splitWalking(best);
    const samples: { index: number; point: Vec3; supports?: string[] }[] = [],
      elapsed = [0],
      actions = [0];
    for (let i = 0; i < comparison.segments.length; i++) {
      const segment = comparison.segments[i];
      elapsed.push(elapsed[i] + segment.times.at(-1)!);
      actions.push(actions[i] + (segment.mode === 'walk' ? 0 : 1));
      if (segment.mode !== 'walk') continue;
      if (i === 0 || comparison.segments[i - 1].mode !== 'walk') {
        samples.push({ index: i, point: segment.points[0] });
      }
      samples.push({ index: i + 1, point: segment.points.at(-1)! });
    }
    if (topology)
      for (const sample of samples) {
        sample.supports = planner
          .project(sample.point, { maxVertical: 1e-7 })
          .map((hit) => hit.surface);
      }
    const pairs = [];
    for (let i = 0; i < samples.length; i++)
      for (let j = i + 1; j < samples.length; j++) {
        const from = samples[i],
          to = samples[j];
        if (
          actions[to.index] === actions[from.index] ||
          (comparison.goalHit &&
            comparison.goalHit.segment >= from.index &&
            comparison.goalHit.segment < to.index)
        )
          continue;
        if (
          topology &&
          (!from.supports!.length ||
            !to.supports!.length ||
            !canReach(topology, [], from.supports!, new Set<string>(to.supports)))
        )
          continue;
        const bound =
          elapsed[to.index] -
          elapsed[from.index] -
          distance(from.point, to.point) /
            Math.max(locomotion.sprintSpeed, locomotion.dash?.speed ?? 0);
        if (bound > 0.01) pairs.push({ from, to, bound });
      }
    pairs.sort((a, b) => b.bound - a.bound);
    let improved = false;
    for (const { from, to } of pairs) {
      if (queries >= maxQueries) break;
      queries++;
      const walk = preparation
        ? preparation.planWalkingGeometry(from.point, to.point)
        : planner.plan(
            [{ id: '@detour', position: from.point, state: 'available', cost: 0 }],
            to.point,
            { connections: [] },
          );
      if (
        walk.status !== 'complete' ||
        distance(walk.points[0], from.point) > 1e-7 ||
        distance(walk.points.at(-1)!, to.point) > 1e-7
      )
        continue;
      const segments = [
        ...comparison.segments.slice(0, from.index),
        ...walk.segments,
        ...comparison.segments.slice(to.index),
      ].map(({ gait: _gait, ...segment }) => segment);
      const lowerCost = best.arrivalCost + minimumDuration(segments, locomotion);
      const comparisonSlack =
        64 * Number.EPSILON * Math.max(1, Math.abs(lowerCost), Math.abs(best.cost));
      if (lowerCost > best.cost - 0.01 + comparisonSlack) continue;
      const points = pointsOf(segments, best.points[0]);
      let goalHit = comparison.goalHit;
      if (goalHit && goalHit.segment >= to.index)
        goalHit = {
          ...goalHit,
          segment: goalHit.segment + walk.segments.length - (to.index - from.index),
        };
      const candidate = retimeGroundRoute(
        {
          ...best,
          points,
          segments,
          goalHit,
          length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0),
        },
        locomotion,
      );
      if (candidate.status !== 'complete' || candidate.cost >= best.cost - 0.01) continue;
      best = candidate;
      replacements++;
      improved = true;
      break;
    }
    if (!improved) break;
  }
  return {
    route: replacements ? (terminalEvent ? markTerminalGoal(best) : best) : route,
    replacements,
    queries,
  };
}
