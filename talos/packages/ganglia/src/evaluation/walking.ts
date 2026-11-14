import type { VerificationPolicy } from '#@/src/evaluation/policy.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { createLocomotionRules } from '#@/src/model/locomotion.ts';
import type { PhysicalWorld } from '#@/src/model/world.ts';
import type { Segment } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';

type Complete = Extract<Route, { status: 'complete' }>;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));

/** Interpret navigation-height walks as local supported motion. No horizontal
 * search, new action or flight adjustment is permitted. The caller verifies
 * the submitted controls first and the resulting execution afterward. */
export function executeWalking(
  route: Complete,
  worlds: readonly PhysicalWorld[],
  policy: VerificationPolicy,
) {
  const input = worlds.find((w) => w.covered(route.points[0], route.points[0]))!.input;
  const following = [
    ...new Map(
      worlds.flatMap((w) => w.input.devices?.followingSupports ?? []).map((s) => [s.id, s]),
    ).values(),
  ];
  const configured = worlds.map((w) =>
    w.configured(route.placements, {
      followingSupports: following,
      scopedPlacements: true,
      contactTolerance: policy.walkContactTolerance,
    }),
  );
  let maxWalkSnap = 0;
  const execute = (segment: Segment): Segment => {
    if (segment.mode !== 'walk') return segment;
    const points: Vec3[] = [];
    for (let i = 1; i < segment.points.length; i++) {
      const a = segment.points[i - 1],
        b = segment.points[i];
      const failures = new Set<string>();
      let accepted: Vec3[] | undefined;
      let correction = 0;
      for (const physical of configured) {
        try {
          // Navigation quantization is independent of the physical model's
          // narrow standing-contact tolerance. Bound projection by the caller's
          // walk policy, then validate the resulting capsule feet normally.
          const project = (point: Vec3) => {
            const retained = physical.standing(point);
            if (retained) return retained;
            const hit = physical.world.groundAt(point, {
              maxUp: policy.walkSnap,
              maxDown: policy.walkSnap,
              maxSlope: input.movement.maxSlope,
              radius: input.ground.options.profile.radius,
            });
            return hit ? physical.standing([point[0], hit.position[1] + 0.005, point[2]]) : null;
          };
          const start = project(a),
            end = project(b);
          if (!start || !end) {
            failures.add('Unsupported walk endpoint');
            continue;
          }
          const trace = physical.walkTrace(start, end);
          if (!trace) {
            failures.add('Unsupported or obstructed walk');
            continue;
          }
          const dx = b[0] - a[0],
            dz = b[2] - a[2],
            squared = dx * dx + dz * dz;
          // Vertical spans have no horizontal interpolation parameter. Always
          // bound both submitted endpoints before checking interior corrections.
          let maximum = Math.max(Math.abs(start[1] - a[1]), Math.abs(end[1] - b[1]));
          for (const p of trace) {
            const t = squared
              ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[2] - a[2]) * dz) / squared))
              : 0;
            const intended: Vec3 = [a[0] + t * dx, a[1] + t * (b[1] - a[1]), a[2] + t * dz];
            if (Math.hypot(p[0] - intended[0], p[2] - intended[2]) > 1e-6)
              throw new Error('Walk execution changed horizontal path');
            maximum = Math.max(maximum, Math.abs(p[1] - intended[1]));
          }
          if (maximum > policy.walkSnap + 1e-6) {
            failures.add('Walk snap exceeds configured tolerance');
            continue;
          }
          accepted = trace;
          correction = maximum;
          break;
        } catch (error) {
          // Another complete snapshot may certify this span.
          failures.add(error instanceof Error ? error.message : String(error));
        }
      }
      if (!accepted) throw new Error([...failures].join('; ') || 'Missing walk coverage');
      if (points.length && distance(points.at(-1)!, accepted[0]) > 1e-6)
        throw new Error('Discontinuous supported walk');
      points.push(...(points.length ? accepted.slice(1) : accepted));
      maxWalkSnap = Math.max(maxWalkSnap, correction);
    }
    const times = [0];
    for (let i = 1; i < points.length; i++)
      times.push(times[i - 1] + distance(points[i - 1], points[i]) / input.locomotion.speed);
    return { ...segment, points, times };
  };
  const schedule = route.schedule?.map((block) => ({
    ...block,
    segments: block.segments.map(execute),
  }));
  const controller = createLocomotionRules(input.locomotion);
  let state = controller.initial(),
    duration = 0;
  const segments: Segment[] = [];
  for (const block of schedule ?? [])
    for (const segment of block.segments) {
      // Boosts belong to individual motions, even when controls share a block.
      // Match authoritative verification's segment-wise state continuation.
      const replay = controller.advance([segment], state, block);
      if (!replay) throw new Error('Executed walk exceeds resource budget');
      segments.push(...replay.segments);
      state = replay.state;
      duration += replay.duration;
    }
  if (!schedule) segments.push(...route.segments.map(execute));
  let points = segments.length
    ? [segments[0].points[0], ...segments.flatMap((s) => s.points.slice(1))]
    : route.points;
  if (!segments.length) {
    const origin = configured
      .map((w) => w.standing(points[0]))
      .find((p) => p && distance(p, points[0]) <= policy.walkSnap + 1e-6);
    if (!origin) throw new Error('Unsupported route origin');
    maxWalkSnap = distance(origin, points[0]);
    points = [origin];
  }
  const length = segments.reduce(
    (sum, s) => sum + s.points.slice(1).reduce((n, p, i) => n + distance(s.points[i], p), 0),
    0,
  );
  const executed: Complete = {
    ...route,
    points,
    segments,
    schedule,
    cost: route.arrivalCost + duration,
    length,
    ...(route.locomotion
      ? {
          locomotion: {
            ...route.locomotion,
            initial: controller.initial().energy,
            final: state.energy,
            minimum: state.minimum,
            dashes: state.dashCount ?? 0,
          },
        }
      : {}),
    ...(route.goalHit
      ? {
          goalHit: {
            ...route.goalHit,
            segment: segments.length - 1,
            time: segments.at(-1)!.times.at(-1)!,
            position: points.at(-1)!,
          },
        }
      : {}),
  };
  return { route: executed, maxWalkSnap };
}
