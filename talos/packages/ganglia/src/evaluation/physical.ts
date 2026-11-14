import { evaluateRoute, verifyRoute } from '#@/src/evaluation/route.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { jumpConnection, runOffConnection, jumpDuration } from '#@/src/model/flight.ts';
import { findGoalHit } from '#@/src/model/goals.ts';
import { createLocomotionRules } from '#@/src/model/locomotion.ts';
import { projectPoint } from '#@/src/model/support.ts';
import type { PhysicalWorld } from '#@/src/model/world.ts';
import type { Segment, JumpModel } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';

const close = (a: number, b: number) =>
  Number.isFinite(a) &&
  Number.isFinite(b) &&
  Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a), Math.abs(b));
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
// Trajectories may use different knot density. Compare at common breakpoints;
// controls define the executed motion, with a 5 mm representation tolerance.
const sameTrace = (
  a: Pick<Segment, 'points' | 'times'>,
  b: Pick<Segment, 'points' | 'times'>,
  tolerance = 1e-5,
) => {
  if (
    !close(a.times.at(-1)!, b.times.at(-1)!) ||
    distance(a.points[0], b.points[0]) > 1e-5 ||
    distance(a.points.at(-1)!, b.points.at(-1)!) > 1e-5
  )
    return false;
  const position = (trace: typeof a, time: number): Vec3 => {
    let index = 1;
    while (index < trace.times.length - 1 && trace.times[index] < time) index++;
    const span = trace.times[index] - trace.times[index - 1];
    const t = span > 0 ? Math.max(0, Math.min(1, (time - trace.times[index - 1]) / span)) : 1;
    return trace.points[index - 1].map(
      (v, axis) => v + t * (trace.points[index][axis] - v),
    ) as Vec3;
  };
  return [...a.times, ...b.times].every(
    (time) => distance(position(a, time), position(b, time)) <= tolerance,
  );
};
const phases = (segments: Segment[]) => {
  const output: { key: string; points: Vec3[]; times: number[] }[] = [];
  for (const segment of segments) {
    if (stationary(segment)) continue;
    const key = JSON.stringify([
      segment.mode,
      segment.gait,
      segment.connection,
      segment.traversal,
      segment.requiredGait,
      segment.boost,
    ]);
    const last = output.at(-1);
    if (last?.key === key) {
      const offset = last.times.at(-1)!;
      last.points.push(...segment.points.slice(1));
      last.times.push(...segment.times.slice(1).map((time) => time + offset));
    } else output.push({ key, points: [...segment.points], times: [...segment.times] });
  }
  return output;
};
const stationary = (s: Segment) =>
  s.times.at(-1) === 0 && s.points.every((p) => distance(p, s.points[0]) <= 1e-9);

// A projection can find nearby support without establishing that the submitted
// feet are on it. Match both endpoints and charge the actual support-following
// distance, including bends in the interior of a walking chord.
function supportedWalk(
  segment: Segment,
  { standing, walkTrace }: Pick<ReturnType<PhysicalWorld['configured']>, 'standing' | 'walkTrace'>,
) {
  const start = standing(segment.points[0]);
  return (
    !!start &&
    distance(start, segment.points[0]) <= 1e-5 &&
    segment.points.slice(1).every((point, index) => {
      const previous = segment.points[index];
      const trace = walkTrace(previous, point);
      if (!trace || distance(trace[0], previous) > 1e-5 || distance(trace.at(-1)!, point) > 1e-5)
        return false;
      const length = trace.slice(1).reduce((sum, p, i) => sum + distance(trace[i], p), 0);
      return Math.abs(length - distance(previous, point)) <= 1e-5 * Math.max(1, length);
    })
  );
}

/** A verifier owns no search state. It re-executes the submitted controls against
 * provider-owned snapshots; unknown actions, missing witnesses and coverage
 * failures are rejected. A failed search never establishes physical impossibility. */
export function createPhysicalVerifier(snapshots: () => readonly PhysicalWorld[]) {
  return (query: RouteQuery, route: Route) => {
    const trace = evaluateRoute(route);
    if (!trace.valid) return { ...trace, scope: 'physical' as const };
    const worlds = snapshots();
    const first =
      route.status === 'complete' &&
      worlds.find((w) => w.covered(route.points[0], route.points[0]));
    const contract = verifyRoute(query, route, {
      maxVertical: first ? first.input.ground.options.maxVertical : 0,
    });
    const issues = [...contract.issues];
    const result = () => ({
      ...contract,
      scope: 'physical' as const,
      valid: contract.valid && !issues.length,
      issues,
      costSeconds: issues.length ? null : contract.costSeconds,
      length: issues.length ? null : contract.length,
    });
    if (!contract.valid || route.status !== 'complete') return result();
    if (!first) {
      issues.push('Missing physical snapshot');
      return result();
    }
    const input = first.input;
    const placements = route.placements ?? [];
    const boosts = worlds.flatMap(
      (w) => w.input.devices?.devices.filter((d) => d.kind === 'accelerate') ?? [],
    );
    const pickup = (id: string) => {
      const boost = boosts.find((b) => b.id === id);
      if (!boost?.goal || typeof boost.duration !== 'number' || boost.duration <= 0)
        throw new Error('Unknown speed boost');
      let time = 0;
      for (const segment of route.segments) {
        const hit = findGoalHit(segment.points, boost.goal.position, boost.goal.interaction);
        if (hit)
          return {
            boost,
            time:
              time +
              segment.times[hit.index - 1] +
              hit.fraction * (segment.times[hit.index] - segment.times[hit.index - 1]),
          };
        time += segment.times.at(-1)!;
      }
      throw new Error('Boost trigger was not reached');
    };
    const activeBoost = (s: Segment, elapsed: number, duration: number) => {
      if (!s.boost) {
        if (s.boostExpiry !== undefined) throw new Error('Expiry without a boost');
        return 1;
      }
      const { boost, time } = pickup(s.boost.id);
      if (
        !close(s.boost.multiplier, boost.boostMultiplier) ||
        s.boost.duration > (boost.duration as number) + 1e-6 ||
        elapsed < time - 1e-6 ||
        elapsed >= time + (boost.duration as number) - 1e-6
      )
        throw new Error('Invalid boost activation');
      const remaining = time + (boost.duration as number) - elapsed;
      if (
        s.boostExpiry === undefined
          ? duration > remaining + 1e-6
          : s.mode !== 'jump' || !close(s.boostExpiry, remaining)
      )
        throw new Error('Boost expired during motion');
      return boost.boostMultiplier;
    };
    const physical = (s: Segment, elapsed: number, sprinting: boolean, duration: number) => {
      const errors: string[] = [];
      const multiplier = activeBoost(s, elapsed, duration);
      for (const snapshot of worlds) {
        if (!s.points.every((p) => snapshot.covered(p, p))) continue;
        try {
          const { world, blocked, standing, walkTrace } = snapshot.configured(placements);
          const rules = snapshot.input,
            profile = rules.ground.options.profile;
          if (
            JSON.stringify(rules.movement) !== JSON.stringify(input.movement) ||
            JSON.stringify(rules.locomotion) !== JSON.stringify(input.locomotion)
          )
            throw new Error('Movement snapshot mismatch');
          if (s.mode === 'walk') {
            if (!supportedWalk(s, { standing, walkTrace }))
              throw new Error('Unsupported or obstructed walk');
            return;
          }
          const takeoff = standing(s.points[0]);
          if (!takeoff || distance(takeoff, s.points[0]) > 1e-5)
            throw new Error('Unsupported takeoff');
          const terminal =
            s === route.segments.at(-1) ||
            (distance(s.points.at(-1)!, route.points.at(-1)!) <= 1e-6 &&
              query.interaction?.airborne);
          const collection =
            terminal && query.interaction?.airborne
              ? { target: query.goal, interaction: query.interaction }
              : undefined;
          if (!collection) {
            const landing = standing(s.points.at(-1)!);
            if (!landing || distance(landing, s.points.at(-1)!) > 1e-5)
              throw new Error('Unsupported landing');
          }
          if (s.mode === 'jump' || s.mode === 'drop' || s.mode === 'launch') {
            const witness = s.flight;
            if (!witness || distance(witness.start, s.points[0]) > 1e-6)
              throw new Error('Missing flight control');
            if (
              witness.control.mode !== (s.mode === 'launch' ? 'jump' : s.mode) ||
              (witness.kind === 'run-off' && s.mode !== 'drop')
            )
              throw new Error('Flight mode does not match controls');
            if (witness.kind !== 'flight' && witness.kind !== 'run-off')
              throw new Error('Unknown flight control family');
            const model = witness.model,
              authority = rules.movement.model;
            for (const key of ['gravity', 'fallingGravity', 'maxFallingSpeed', 'apexTime'] as const)
              if (!close(model[key], authority[key])) throw new Error(`Invalid flight ${key}`);
            let height = authority.maxJumpHeight;
            if (s.mode === 'launch') {
              const device = rules.devices?.devices.find((d) => s.connection === `launch/${d.id}`);
              if (!device?.fixedLaunch || !device.unitScale || !Array.isArray(device.aim))
                throw new Error('Unknown launch device');
              if (
                !device.goal ||
                !findGoalHit(
                  [witness.start, witness.start],
                  device.goal.position,
                  device.goal.interaction,
                )
              )
                throw new Error('Launch entry misses device trigger');
              if (
                witness.kind !== 'flight' ||
                witness.control.horizontalSplit !== undefined ||
                witness.control.horizontalWaypoint !== undefined ||
                witness.control.expireAfter !== undefined ||
                model.startHorizontalSpeed !== undefined ||
                model.airAcceleration !== undefined ||
                model.airDeceleration !== undefined
              )
                throw new Error('Fixed launch cannot use character air controls');
              const aim = device.aim as Vec3;
              const direct =
                Math.hypot(aim[0] - witness.end[0], aim[2] - witness.end[2]) <= profile.radius;
              if (direct && Math.abs(aim[1] - witness.end[1]) > 0.51)
                throw new Error('Launch landing is outside authored aim support');
              height = Math.max(
                device.height,
                (direct ? witness.end[1] : aim[1]) + device.aimClearance - witness.start[1],
              );
              if (!direct) {
                const aimTime = jumpDuration(witness.start[1], aim[1], {
                  ...authority,
                  maxJumpHeight: height,
                  mode: 'jump',
                });
                const endTime = jumpDuration(witness.start[1], witness.end[1], {
                  ...authority,
                  maxJumpHeight: height,
                  mode: 'jump',
                });
                if (
                  !aimTime ||
                  !endTime ||
                  [0, 2].some(
                    (axis) =>
                      !close(
                        (witness.end[axis] - witness.start[axis]) / endTime,
                        (aim[axis] - witness.start[axis]) / aimTime,
                      ),
                  )
                )
                  throw new Error('Launch trajectory misses authored aim');
              }
            }
            if (!close(model.maxJumpHeight, height)) throw new Error('Invalid jump height');
            if (s.mode !== 'launch') {
              if (
                model.maxHorizontalSpeed > authority.maxHorizontalSpeed * multiplier + 1e-6 ||
                (model.startHorizontalSpeed ?? 0) >
                  authority.startHorizontalSpeed * multiplier + 1e-6
              )
                throw new Error('Air speed exceeds movement rules');
              for (const key of ['airAcceleration', 'airDeceleration'] as const)
                if (model[key] !== undefined && model[key]! > authority[key] + 1e-6)
                  throw new Error('Air acceleration exceeds movement rules');
              if (
                model.startHorizontalSpeed !== undefined &&
                !close(model.airOverspeedDeceleration!, authority.airOverspeedDeceleration)
              )
                throw new Error('Invalid overspeed decay');
            }
            if (
              s.boostExpiry !== undefined &&
              (!close(witness.control.expireAfter!, s.boostExpiry) ||
                !close(witness.control.expiredHorizontalSpeed!, authority.maxHorizontalSpeed))
            )
              throw new Error('Invalid boost continuation');
            if (s.boostExpiry === undefined && witness.control.expireAfter !== undefined)
              throw new Error('Unbound boost continuation');
            const replayModel: JumpModel = {
              gravity: model.gravity,
              fallingGravity: model.fallingGravity,
              maxJumpHeight: model.maxJumpHeight,
              maxFallingSpeed: model.maxFallingSpeed,
              apexTime: model.apexTime,
              maxHorizontalSpeed: model.maxHorizontalSpeed,
              airAcceleration: model.airAcceleration,
              airDeceleration: model.airDeceleration,
              startHorizontalSpeed: model.startHorizontalSpeed,
              airOverspeedDeceleration: model.airOverspeedDeceleration,
            };
            const control = witness.control;
            const options = {
              ...replayModel,
              mode: control.mode,
              exit: control.exit,
              speedFraction: control.speedFraction,
              terminal: control.terminal,
              horizontalSplit: control.horizontalSplit,
              horizontalWaypoint: control.horizontalWaypoint,
              expireAfter: control.expireAfter,
              expiredHorizontalSpeed: control.expiredHorizontalSpeed,
              profile,
              walls: rules.roundedWalls ?? rules.ground.options.walls,
              world,
              maxSlope: rules.movement.maxSlope,
              sweep: world.sweepCapsule.bind(world),
              collection,
            };
            const replay =
              witness.kind === 'run-off'
                ? runOffConnection(witness.start, witness.end, options)
                : jumpConnection(witness.start, witness.end, options);
            if (!replay || !sameTrace(s, replay, 0.005))
              throw new Error('Flight does not match collision-checked controls');
            const airSpeed =
              replay.peakHorizontalSpeed ??
              // Without a peak, horizontal motion is uniform. Collection can
              // stop before the nominal landing, so use the executed span.
              Math.hypot(
                replay.points.at(-1)![0] - replay.points[0][0],
                replay.points.at(-1)![2] - replay.points[0][2],
              ) / replay.times.at(-1)!;
            if (
              s.mode !== 'launch' &&
              airSpeed > rules.movement.runAirSpeed * multiplier + 1e-6 &&
              !sprinting
            )
              throw new Error('Fast flight requires active sprint');
          } else {
            const authored = rules.ground.options.connections?.find(
              (edge) => edge.id === s.connection && edge.state === 'open',
            );
            if (authored && sameTrace(s, authored) && authored.mode === s.mode) {
              if (authored.requiredGait === 'sprint' && !sprinting)
                throw new Error('Authored action requires active sprint');
              if (authored.requiredBoost && authored.requiredBoost !== s.boost?.id)
                throw new Error('Authored action requires boost');
            } else if (s.traversal === 'moving-support') {
              let verified = false;
              for (const support of rules.devices?.movingSupports ?? [])
                for (const [index, transfer] of support.transfers.entries()) {
                  const id = `moving-ride/${support.id}/${index}`;
                  const reverse = s.connection === id + '/reverse';
                  if (s.connection !== id && !reverse) continue;
                  const a = reverse ? transfer.to : transfer.from,
                    b = reverse ? transfer.from : transfer.to;
                  if (
                    !transfer.speed ||
                    s.points.length !== 2 ||
                    distance(s.points[0], a) > profile.radius + 0.05 ||
                    distance(s.points[1], b) > profile.radius + 0.05 ||
                    !close(s.times.at(-1)!, distance(a, b) / transfer.speed)
                  )
                    throw new Error('Invalid moving support ride');
                  verified = true;
                }
              if (
                !verified &&
                s.connection?.startsWith('moving-join/') &&
                (rules.devices?.movingSupports ?? []).some((support) =>
                  [s.points[0], s.points.at(-1)!].some((point) =>
                    projectPoint(support.surfaces, point, {
                      maxVertical: (rules.ground.build?.cellHeight ?? 0.1) * 3 + 0.02,
                    }),
                  ),
                ) &&
                Math.hypot(
                  s.points[0][0] - s.points.at(-1)![0],
                  s.points[0][2] - s.points.at(-1)![2],
                ) < 1e-6 &&
                distance(s.points[0], s.points.at(-1)!) <= rules.ground.options.maxVertical &&
                close(
                  s.times.at(-1)!,
                  distance(s.points[0], s.points.at(-1)!) / rules.ground.options.speed,
                )
              )
                verified = true;
              if (!verified) throw new Error('Unknown moving support action');
            } else {
              const pair = rules.devices?.ropes.find(
                ({ bottom, top }) => s.connection === `rope/${bottom}/${top}`,
              );
              const lower = pair && rules.devices?.devices.find((d) => d.id === pair.bottom),
                upper = pair && rules.devices?.devices.find((d) => d.id === pair.top);
              if (
                !lower?.resolved ||
                !upper?.resolved ||
                !lower.unitScale ||
                !upper.unitScale ||
                !lower.goal ||
                !upper.goal ||
                lower.speed <= 0
              )
                throw new Error('Unknown rope action');
              const a = s.points[0],
                b = s.points.at(-1)!;
              if (
                !findGoalHit([a, a], lower.goal.position, lower.goal.interaction) ||
                !findGoalHit([b, b], upper.goal.position, upper.goal.interaction)
              )
                throw new Error('Rope misses device trigger');
              const points: Vec3[] = [a, a, [a[0], b[1] + 0.1, a[2]], [b[0], b[1] + 0.1, b[2]], b];
              const times = [0, lower.overhead];
              for (let i = 2; i < points.length; i++)
                times.push(times[i - 1] + distance(points[i - 1], points[i]) / lower.speed);
              if (!sameTrace(s, { points, times }))
                throw new Error('Invalid rope timing or trajectory');
            }
            if (
              s.points.some(
                (p, i) =>
                  blocked(i ? s.points[i - 1] : p, p) ||
                  world.sweepCapsule(i ? s.points[i - 1] : p, p, profile),
              )
            )
              throw new Error('Obstructed device trajectory');
          }
          return;
        } catch (error) {
          errors.push(error instanceof Error ? error.message : String(error));
        }
      }
      throw new Error(errors[0] ?? 'Missing complete physical coverage');
    };
    try {
      const controller = createLocomotionRules(input.locomotion);
      let state = controller.initial(),
        elapsed = 0;
      const output: Segment[] = [];
      if (!route.schedule && route.segments.some((s) => !stationary(s)))
        throw new Error('Missing whole-route resource controls');
      for (const block of route.schedule ?? [])
        for (const segment of block.segments) {
          const before = state;
          const replay = controller.advance([segment], state, block);
          if (!replay) throw new Error('Resource controls are infeasible');
          physical(segment, elapsed, before.sprinting, replay.duration);
          output.push(...replay.segments);
          state = replay.state;
          elapsed += replay.duration;
        }
      // Resource replay allows small differences in trajectory representation.
      // Check submitted geometry as well, so that tolerance cannot cross a wall
      // or move an interaction away from the physically supported trajectory.
      for (const segment of route.segments) {
        const clear = worlds.some((snapshot) => {
          try {
            const configured = snapshot.configured(placements);
            if (segment.mode === 'walk') return supportedWalk(segment, configured);
            const { world, blocked } = configured;
            const profile = snapshot.input.ground.options.profile;
            return segment.points.every((point, index) => {
              const previous = index ? segment.points[index - 1] : point;
              return !blocked(previous, point) && !world.sweepCapsule(previous, point, profile);
            });
          } catch {
            return false;
          }
        });
        if (!clear) throw new Error('Submitted trajectory intersects collision or lacks support');
      }
      const actual = phases(route.segments),
        expected = phases(output);
      if (
        actual.length !== expected.length ||
        actual.some(
          (phase, i) => phase.key !== expected[i].key || !sameTrace(phase, expected[i], 0.005),
        )
      )
        throw new Error('Route differs from resource replay');
      if (
        route.locomotion &&
        (!close(route.locomotion.initial, controller.initial().energy) ||
          !close(route.locomotion.final, state.energy) ||
          !close(route.locomotion.minimum, state.minimum) ||
          (route.locomotion.dashes ?? 0) !== (state.dashCount ?? 0))
      )
        throw new Error('Resource summary differs from replay');
      const origin = first.configured(placements).standing(route.points[0]);
      if (!origin || distance(origin, route.points[0]) > 1e-5)
        throw new Error('Unsupported route origin');
      if (query.interaction?.airborne) {
        for (let index = 0; index < route.segments.length; index++) {
          const segment = route.segments[index],
            hit = findGoalHit(segment.points, query.goal, query.interaction);
          if (!hit) continue;
          const time =
            segment.times[hit.index - 1] +
            hit.fraction * (segment.times[hit.index] - segment.times[hit.index - 1]);
          if (
            index !== route.segments.length - 1 ||
            !close(time, segment.times.at(-1)!) ||
            distance(hit.position, route.points.at(-1)!) > 1e-6
          )
            throw new Error('Airborne collection must stop at the first goal event');
          if (
            !route.goalHit ||
            route.goalHit.segment !== index ||
            !close(route.goalHit.time, time) ||
            distance(route.goalHit.position, hit.position) > 1e-6
          )
            throw new Error('Invalid terminal goal event');
          break;
        }
      }
      if (!close(route.cost, route.arrivalCost + elapsed))
        throw new Error('Physical cost differs from route');
    } catch (error) {
      issues.push(error instanceof Error ? error.message : String(error));
    }
    return result();
  };
}
