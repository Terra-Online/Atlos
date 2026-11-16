import type { Vec3 } from '#@/src/geometry.ts';
import { trimGoalFlight } from '#@/src/model/goals.ts';
import { findGoalHit } from '#@/src/model/goals.ts';
import type { PhysicalWorld } from '#@/src/model/world.ts';
import type { Segment } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';

/** Navigation heights are a search representation. Construct actual capsule-foot
 * paths before assigning resource clocks, so slope correction cannot supply free
 * distance or airborne launch height. The verifier never performs this repair. */
export function executeRoute(route: Route, query: RouteQuery, snapshot: PhysicalWorld): Route {
  if (route.status !== 'complete') return route;
  const physical = snapshot.configured(route.placements);
  const origin = physical.standing(route.points[0]);
  if (
    query.interaction?.airborne &&
    origin &&
    findGoalHit([origin, origin], query.goal, query.interaction)
  ) {
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
      segments.push(segment);
      continue;
    }
    const points: Vec3[] = [];
    for (let i = 1; i < segment.points.length; i++) {
      const trace = physical.walkTrace(segment.points[i - 1], segment.points[i]);
      if (!trace) return { status: 'no-verified-route' };
      points.push(...(points.length ? trace.slice(1) : trace));
    }
    if (!points.length) continue;
    const previous = segments.at(-1)?.points.at(-1);
    if (previous && distance(previous, points[0]) > 1e-5) return { status: 'no-verified-route' };
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
        return { status: 'no-verified-route' };
      const scale =
        Math.max(0, Math.sqrt(query.interaction.radius ** 2 - dy ** 2) - 1e-5) / horizontal;
      const seed: Vec3 = [
        query.goal[0] + (point[0] - query.goal[0]) * Math.min(1, scale),
        point[1],
        query.goal[2] + (point[2] - query.goal[2]) * Math.min(1, scale),
      ];
      const trace = physical.walkTrace(point, seed);
      if (!trace) return { status: 'no-verified-route' };
      last.points.push(...trace.slice(1));
      point = last.points.at(-1)!;
      if (findGoalHit([point, point], query.goal, query.interaction)) break;
    }
    if (!findGoalHit([point, point], query.goal, query.interaction))
      return { status: 'no-verified-route' };
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
  return retimeGroundRoute(updated, snapshot.input.locomotion);
}
