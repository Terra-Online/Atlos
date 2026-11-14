import type { Vec3 } from '#@/src/geometry.ts';
import { trimGoalFlight } from '#@/src/model/goals.ts';
import { findGoalHit } from '#@/src/model/goals.ts';
import type { PhysicalWorld } from '#@/src/model/world.ts';
import type { Segment } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';

export type ExecutionFailure = {
  reason:
    | 'walk-unproved'
    | 'discontinuous-route'
    | 'goal-unproved'
    | 'coverage-missing'
    | 'resource-unproved';
  walk?: { from: Vec3; to: Vec3 };
};

/** Navigation heights are a search representation. Construct actual capsule-foot
 * paths before assigning resource clocks, so slope correction cannot supply free
 * distance or airborne launch height. The verifier never performs this repair. */
export function executeRoute(
  route: Route,
  query: RouteQuery,
  snapshot: PhysicalWorld,
  rejected?: (failure: ExecutionFailure) => void,
): Route {
  try {
    return materialize(route, query, snapshot, rejected);
  } catch (error) {
    // Missing coverage is not empty space and cannot justify geometry repair.
    // Malformed source facts still propagate as input errors.
    if (!(error instanceof Error) || !/^Incomplete .*coverage$/.test(error.message)) throw error;
    rejected?.({ reason: 'coverage-missing' });
    return { status: 'no-verified-route' };
  }
}
function materialize(
  route: Route,
  query: RouteQuery,
  snapshot: PhysicalWorld,
  rejected?: (failure: ExecutionFailure) => void,
): Route {
  const reject = (reason: ExecutionFailure['reason'], walk?: ExecutionFailure['walk']): Route => {
    rejected?.({ reason, ...(walk ? { walk } : {}) });
    return { status: 'no-verified-route' };
  };
  if (route.status !== 'complete') return route;
  const physical = snapshot.configured(route.placements);
  const origin = physical.standing(route.points[0]);
  if (
    query.interaction?.airborne &&
    origin &&
    findGoalHit([origin, origin], query.goal, query.interaction)
  ) {
    if (!physical.walkTrace(origin, origin))
      return reject('walk-unproved', { from: origin, to: origin });
    return retimeGroundRoute(
      {
        ...route,
        cost: route.arrivalCost,
        length: 0,
        points: [origin],
        segments: [{ mode: 'walk', points: [origin, origin], times: [0, 0] }],
        goalHit: { segment: 0, time: 0, position: origin },
      },
      snapshot.input.locomotion,
    );
  }
  const segments: Segment[] = [];
  const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
  for (const segment of route.segments) {
    if (segment.mode !== 'walk') {
      const previous = segments.at(-1)?.points.at(-1);
      if (previous && distance(previous, segment.points[0]) > 1e-5)
        return reject('discontinuous-route');
      segments.push(segment);
      continue;
    }
    const points: Vec3[] = [];
    for (let i = 1; i < segment.points.length; i++) {
      const trace = physical.walkTrace(segment.points[i - 1], segment.points[i]);
      if (!trace)
        return reject('walk-unproved', {
          from: [...segment.points[i - 1]],
          to: [...segment.points[i]],
        });
      points.push(...(points.length ? trace.slice(1) : trace));
    }
    if (!points.length) continue;
    const previous = segments.at(-1)?.points.at(-1);
    if (previous && distance(previous, points[0]) > 1e-5) return reject('discontinuous-route');
    const times = [0];
    for (let i = 1; i < points.length; i++)
      times.push(
        times[i - 1] + distance(points[i - 1], points[i]) / snapshot.input.locomotion.speed,
      );
    const { gait: _gait, ...base } = segment;
    segments.push({ ...base, points, times });
  }
  let goalHit = route.goalHit;
  if (query.interaction?.airborne) {
    for (let index = 0; index < segments.length; index++) {
      const clipped = trimGoalFlight(segments[index], query.goal, query.interaction);
      if (!clipped) continue;
      segments.splice(index, segments.length - index, clipped);
      goalHit = { segment: index, time: clipped.times.at(-1)!, position: clipped.points.at(-1)! };
      break;
    }
  }
  const last = segments.at(-1);
  if (
    last?.mode === 'walk' &&
    query.interaction &&
    !findGoalHit([last.points.at(-1)!, last.points.at(-1)!], query.goal, query.interaction)
  ) {
    // Select an interior supported endpoint when voxel-height correction shifts
    // a navigation-boundary witness just outside the interaction volume.
    let point = last.points.at(-1)!;
    for (let iteration = 0; iteration < 8; iteration++) {
      const dy = point[1] - query.goal[1],
        horizontal = Math.hypot(point[0] - query.goal[0], point[2] - query.goal[2]);
      if (Math.abs(dy) >= query.interaction.radius || horizontal === 0)
        return reject('goal-unproved');
      // Airborne collection has already been clipped to its first event. Only
      // roundoff-sized interior correction is admissible there; a fixed inward
      // step would continue travelling after the event and fail independent replay.
      const margin = query.interaction.airborne
        ? 32 *
          Number.EPSILON *
          Math.max(1, query.interaction.radius, ...point.map(Math.abs), ...query.goal.map(Math.abs))
        : 1e-5;
      const scale =
        Math.max(0, Math.sqrt(query.interaction.radius ** 2 - dy ** 2) - margin) / horizontal;
      const seed: Vec3 = [
        query.goal[0] + (point[0] - query.goal[0]) * Math.min(1, scale),
        point[1],
        query.goal[2] + (point[2] - query.goal[2]) * Math.min(1, scale),
      ];
      const trace = physical.walkTrace(point, seed);
      if (!trace) return reject('walk-unproved', { from: [...point], to: [...seed] });
      if (query.interaction.airborne && distance(point, seed) <= 1e-7) {
        const endpoint = physical.standing(seed);
        if (
          endpoint &&
          distance(endpoint, seed) <= 1e-7 &&
          findGoalHit([endpoint, endpoint], query.goal, query.interaction)
        ) {
          // walkTrace intentionally coalesces sub-resolution points. Preserve
          // this independently supported rounding correction as the endpoint,
          // rather than appending a post-collection walk or losing it on retime.
          last.points[last.points.length - 1] = endpoint;
          point = endpoint;
          break;
        }
      }
      last.points.push(...trace.slice(1));
      point = last.points.at(-1)!;
      if (findGoalHit([point, point], query.goal, query.interaction)) break;
    }
    if (!findGoalHit([point, point], query.goal, query.interaction)) return reject('goal-unproved');
    last.times = [0];
    for (let i = 1; i < last.points.length; i++)
      last.times.push(
        last.times[i - 1] +
          distance(last.points[i - 1], last.points[i]) / snapshot.input.locomotion.speed,
      );
  }
  const points = segments.length
    ? [segments[0].points[0], ...segments.flatMap((s) => s.points.slice(1))]
    : route.points;
  const updated = {
    ...route,
    ...(goalHit ? { goalHit } : {}),
    segments,
    points,
    length: points.slice(1).reduce((sum, p, i) => sum + distance(points[i], p), 0),
  };
  if (updated.goalHit && last?.mode === 'walk')
    updated.goalHit = {
      segment: segments.length - 1,
      time: last.times.at(-1)!,
      position: last.points.at(-1)!,
    };
  const timed = retimeGroundRoute(updated, snapshot.input.locomotion);
  if (timed.status !== 'complete') return reject('resource-unproved');
  // Radius-based standing can lift a navigation chord above its continuous
  // support, and resource scheduling introduces new interior endpoints. Check
  // the submitted geometry after both transformations before it can bound search.
  for (const segment of timed.segments) {
    if (segment.mode !== 'walk') continue;
    const start = physical.standing(segment.points[0]);
    if (!start || distance(start, segment.points[0]) > 1e-5)
      return reject('walk-unproved', { from: segment.points[0], to: segment.points[0] });
    for (let i = 1; i < segment.points.length; i++) {
      const from = segment.points[i - 1],
        to = segment.points[i];
      const trace = physical.walkTrace(from, to);
      if (!trace || distance(trace[0], from) > 1e-5 || distance(trace.at(-1)!, to) > 1e-5)
        return reject('walk-unproved', { from, to });
      const length = trace.slice(1).reduce((sum, p, index) => sum + distance(trace[index], p), 0);
      if (Math.abs(length - distance(from, to)) > 1e-5 * Math.max(1, length))
        return reject('walk-unproved', { from, to });
    }
  }
  return timed;
}
