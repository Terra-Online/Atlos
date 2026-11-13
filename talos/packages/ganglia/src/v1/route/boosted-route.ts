import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Surface } from '#@/src/geometry.ts';
import { findGoalHit, trimGoalFlight } from '#@/src/model/goals.ts';
import type { SpeedBoost } from '#@/src/movement.ts';
import type { GroundArrival, Route } from '#@/src/route.ts';
import { jumpConnection } from '#@/src/v1/motion/jumps.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import type { JumpDiagnostics, PlannerOptions, JumpResult } from '#@/src/v1/route/jump-planner.ts';

const findPickup = (route: Extract<Route, { status: 'complete' }>, boost: SpeedBoost) => {
  if (!route.segments.length) {
    const hit = findGoalHit([route.points[0], route.points[0]], boost.position, boost.interaction);
    return hit ? { time: 0, position: hit.position } : null;
  }
  let elapsed = 0;
  for (const segment of route.segments) {
    const hit = findGoalHit(segment.points, boost.position, boost.interaction);
    if (hit)
      return {
        position: hit.position,
        time:
          elapsed +
          segment.times[hit.index - 1] +
          hit.fraction * (segment.times[hit.index] - segment.times[hit.index - 1]),
      };
    elapsed += segment.times.at(-1)!;
  }
  return null;
};
/** One pickup followed by a bounded boosted route. The final jump can outlast
 * the buff after revalidation with its ordinary-speed continuation. Pickup approach uses the ordinary movement model and
 * the joined route is resource-scheduled again without resetting stamina.
 */
export function planBoostedRoute(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: PlannerOptions,
  incumbent: JumpResult,
  plan: (
    surfaces: Surface[],
    world: CollisionWorld,
    starts: GroundArrival[],
    goal: Vec3,
    options: PlannerOptions,
  ) => JumpResult,
): JumpResult {
  const diagnostics = [];
  let best = incumbent;
  const ids = new Set<string>();
  for (const boost of options.boosts ?? []) {
    if (
      typeof boost.id !== 'string' ||
      !boost.id ||
      ids.has(boost.id) ||
      !Array.isArray(boost.position) ||
      boost.position.length !== 3 ||
      !boost.position.every(Number.isFinite) ||
      !Number.isFinite(boost.duration) ||
      boost.duration <= 0 ||
      !Number.isFinite(boost.multiplier) ||
      boost.multiplier <= 1 ||
      !boost.interaction ||
      !Number.isFinite(boost.interaction.radius) ||
      boost.interaction.radius < 0
    ) {
      throw new Error('Invalid speed boost');
    }
    ids.add(boost.id);
    const speed = Math.max(
      options.model.maxHorizontalSpeed,
      options.model.startHorizontalSpeed ?? 0,
      options.locomotion?.sprintSpeed ?? options.speed,
      options.locomotion?.dash?.speed ?? 0,
    );
    if (
      Math.hypot(boost.position[0] - goal[0], boost.position[2] - goal[2]) >
      boost.duration * speed * boost.multiplier +
        boost.interaction.radius +
        (options.interaction?.radius ?? 0)
    )
      continue;
    const ordinary = { ...options, boosts: undefined, connections: incumbent.connections };
    const approach = plan(surfaces, world, starts, boost.position, {
      ...ordinary,
      interaction: boost.interaction,
      maxShortcutCandidates: 0,
    });
    const evidence: {
      id: string;
      status: string;
      stage: string;
      duration: number;
      multiplier: number;
      airborne?: JumpDiagnostics['airborne'];
      truncated?: boolean;
      elapsed?: number;
    } = {
      id: boost.id,
      status: approach.route.status,
      stage: 'approach',
      duration: boost.duration,
      multiplier: boost.multiplier,
    };
    diagnostics.push(evidence);
    if (approach.route.status !== 'complete') continue;
    const prefix = approach.route;
    const pickup = findPickup(prefix, boost);
    if (pickup === null) {
      evidence.status = 'trigger-not-entered';
      continue;
    }
    const pickupElapsed = prefix.cost - prefix.arrivalCost - pickup.time;
    if (pickupElapsed >= boost.duration) {
      evidence.status = 'expired';
      continue;
    }
    const multiplier = boost.multiplier;
    const locomotion = options.locomotion && {
      ...options.locomotion,
      speed: options.locomotion.speed * multiplier,
      sprintSpeed: options.locomotion.sprintSpeed * multiplier,
      ...(options.locomotion.dash
        ? {
            dash: { ...options.locomotion.dash, speed: options.locomotion.dash.speed * multiplier },
          }
        : {}),
    };
    const tail = plan(
      surfaces,
      world,
      [{ id: '@boost', position: prefix.points.at(-1)!, cost: 0, state: 'available' }],
      goal,
      {
        ...ordinary,
        groundPlanner: undefined,
        connections: approach.connections,
        activeBoost: boost.id,
        speed: options.speed * multiplier,
        locomotion,
        model: {
          ...options.model,
          maxHorizontalSpeed: options.model.maxHorizontalSpeed * multiplier,
          ...(options.model.startHorizontalSpeed === undefined
            ? {}
            : { startHorizontalSpeed: options.model.startHorizontalSpeed * multiplier }),
        },
        runAirSpeed: options.runAirSpeed * multiplier,
        maxHorizontalDistance: options.maxHorizontalDistance * multiplier,
      },
    );
    evidence.status = tail.route.status;
    evidence.stage = 'boosted';
    evidence.airborne = tail.diagnostics.airborne;
    evidence.truncated = tail.diagnostics.truncated;
    if (tail.route.status !== 'complete') continue;
    const annotation = { id: boost.id, multiplier, duration: boost.duration - pickupElapsed };
    const known = new Set<string>(approach.connections.map((edge) => edge.id));
    const references = new Map<string, string>(
      tail.connections.map((edge) => [
        edge.id,
        known.has(edge.id) ? edge.id : `boost/${boost.id}/${edge.id}`,
      ]),
    );
    const segments = [
      ...prefix.segments,
      ...tail.route.segments.map((segment) => ({
        ...segment,
        boost: annotation,
        ...(segment.connection
          ? { connection: references.get(segment.connection) ?? segment.connection }
          : {}),
      })),
    ];
    let route: Route = {
      ...prefix,
      goalHit: undefined,
      segments,
      points: [...prefix.points, ...tail.route.points.slice(1)],
      cost: prefix.cost + tail.route.cost,
      length: prefix.length + tail.route.length,
    };
    if (options.locomotion) route = retimeGroundRoute(route, options.locomotion);
    if (route.status !== 'complete') {
      evidence.status = route.status;
      continue;
    }
    const beforePickup = findPickup(route, boost);
    if (beforePickup === null) {
      evidence.status = 'trigger-not-entered';
      continue;
    }
    let elapsed = route.cost - route.arrivalCost - beforePickup.time;
    evidence.elapsed = elapsed;
    if (elapsed > boost.duration + 1e-7) {
      const last = route.segments.at(-1)!;
      const flightStart = route.cost - route.arrivalCost - last.times.at(-1)!;
      const remaining = beforePickup.time + boost.duration - flightStart;
      if (
        last.mode !== 'jump' ||
        remaining <= 0 ||
        options.model.airOverspeedDeceleration === undefined
      ) {
        evidence.status = 'expired';
        continue;
      }
      // Only the final jump may cross expiry in this bounded model. Re-solve
      // its launch control, sweep the full changed curve and keep the same endpoint.
      let arc = jumpConnection(last.points[0], last.points.at(-1)!, {
        ...options.model,
        maxHorizontalSpeed: options.model.maxHorizontalSpeed * multiplier,
        startHorizontalSpeed:
          (options.model.startHorizontalSpeed ?? options.model.maxHorizontalSpeed) * multiplier,
        expireAfter: remaining,
        expiredHorizontalSpeed: options.model.maxHorizontalSpeed,
        mode: 'jump',
        profile: options.profile,
        walls: options.walls,
        sweep: world.sweepCapsule.bind(world),
      });
      if (options.interaction?.airborne) arc = trimGoalFlight(arc, goal, options.interaction);
      if (!arc) {
        evidence.status = 'expiry-continuation-blocked';
        continue;
      }
      route.segments = [
        ...route.segments.slice(0, -1),
        {
          ...last,
          ...arc,
          boostExpiry: remaining,
          ...(arc.peakHorizontalSpeed! > options.runAirSpeed * multiplier
            ? { requiredGait: 'sprint' }
            : {}),
        },
      ];
      route.points = [
        route.segments[0].points[0],
        ...route.segments.flatMap((segment) => segment.points.slice(1)),
      ];
      const points = route.points;
      route.length = points
        .slice(1)
        .reduce(
          (sum, point, index) =>
            sum + Math.hypot(...point.map((value, axis) => value - points[index][axis])),
          0,
        );
      if (options.locomotion) route = retimeGroundRoute(route, options.locomotion);
      if (
        route.status !== 'complete' ||
        Math.abs(
          route.cost - route.arrivalCost - route.segments.at(-1)!.times.at(-1)! - flightStart,
        ) > 1e-7 ||
        Math.abs((findPickup(route, boost)?.time ?? Infinity) - beforePickup.time) > 1e-7
      ) {
        evidence.status = 'expiry-entry-changed';
        continue;
      }
      elapsed = boost.duration;
    }
    evidence.status = 'complete';
    if (best.route.status === 'complete' && best.route.cost <= route.cost) continue;
    if (options.interaction?.airborne) {
      for (let index = 0; index < route.segments.length; index++) {
        const segment = route.segments[index],
          hit = findGoalHit(segment.points, goal, options.interaction);
        if (!hit) continue;
        route.goalHit = {
          segment: index,
          position: hit.position,
          time:
            segment.times[hit.index - 1] +
            hit.fraction * (segment.times[hit.index] - segment.times[hit.index - 1]),
        };
        break;
      }
      if (!route.goalHit) {
        evidence.status = 'goal-missed-after-retiming';
        continue;
      }
    }
    route.boosts = [
      { ...annotation, duration: boost.duration, position: beforePickup.position, elapsed },
    ];
    const connections = [
      ...approach.connections,
      ...tail.connections
        .filter((edge) => !known.has(edge.id))
        .map((edge) => {
          const id = references.get(edge.id)!;
          const replay = route.segments.find(
            (segment) => segment.connection === id && segment.boostExpiry !== undefined,
          );
          return {
            ...edge,
            id,
            requiredBoost: boost.id,
            ...(replay
              ? {
                  points: replay.points,
                  times: replay.times,
                  boostExpiry: replay.boostExpiry,
                  requiredGait: replay.requiredGait,
                }
              : {}),
          };
        }),
    ];
    best = {
      ...best,
      route,
      connections,
      diagnostics: { ...best.diagnostics, selectedCost: route.cost },
    };
  }
  return {
    ...best,
    diagnostics: {
      ...best.diagnostics,
      boosts: diagnostics,
      truncated: best.diagnostics.truncated || diagnostics.some((entry) => entry.truncated),
    },
  };
}
