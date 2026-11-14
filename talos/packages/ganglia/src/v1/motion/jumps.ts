import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import {
  horizontalLeg,
  maximumStep,
  jumpDuration,
  type JumpOptions,
  type ExitCache,
  type ApproachCache,
  type MotionControl,
} from '#@/src/model/flight.ts';
import type { JumpModel } from '#@/src/movement.ts';
export * from '#@/src/model/flight.ts';

// Bounded control primitives share the same vertical model and collision proof.
// A split moves partway early, brakes, then completes the motion late. This can
// clear a railing, descend through an opening and move under an overhang.
export function createMotionVariants(
  model: JumpModel,
  world: CollisionWorld,
  profile: JumpOptions['profile'],
  exits: ExitCache = new Map(),
  approaches: ApproachCache = new Map(),
  allowJump?: (start: Vec3, end: Vec3) => boolean,
) {
  return function* (start: Vec3, end: Vec3, exit?: [number, number]): Generator<MotionControl> {
    const jumping = !allowJump || allowJump(start, end);
    yield { mode: 'drop' };
    if (jumping) yield { mode: 'jump' };
    if (exit && model.airAcceleration !== undefined) {
      const key = JSON.stringify([start, exit]);
      steering: for (const speedFraction of [0.5, 0.25, 1, 0.125]) {
        for (const terminal of ['average', 'balanced', 'fast'] as const) {
          if (approaches.has(key) && approaches.get(key) === null) break steering;
          yield { mode: 'drop', exit, speedFraction, terminal };
        }
      }
    }
    if (!jumping || model.airAcceleration === undefined || model.airDeceleration === undefined)
      return;
    const duration = jumpDuration(start[1], end[1], { ...model, mode: 'jump' });
    if (duration === null) return;
    const fits = (point: [number, number]) => {
      const first = horizontalLeg(
        Math.hypot(point[0] - start[0], point[1] - start[2]),
        model.maxHorizontalSpeed,
        model.airAcceleration!,
        model.airDeceleration!,
      );
      const last = horizontalLeg(
        Math.hypot(end[0] - point[0], end[2] - point[1]),
        model.maxHorizontalSpeed,
        model.airAcceleration!,
        model.airDeceleration!,
      );
      return first !== null && last !== null && first.duration + last.duration <= duration;
    };
    const padding =
      profile.radius +
      (Math.hypot(
        Math.max(model.gravity, model.fallingGravity),
        model.airAcceleration!,
        model.airDeceleration!,
      ) *
        maximumStep ** 2) /
        8;
    if (exit) {
      const key = JSON.stringify([start, exit]);
      if (!exits.has(key)) {
        let waypoint: [number, number] | null = null;
        const length = Math.hypot(exit[0] - start[0], exit[1] - start[2]);
        if (length > 0)
          for (let offset = -1.5; offset <= 2; offset += 0.25) {
            const position: [number, number] = [
              exit[0] + ((exit[0] - start[0]) / length) * profile.radius * offset,
              exit[1] + ((exit[1] - start[2]) / length) * profile.radius * offset,
            ];
            if (
              world.bounds &&
              position.some(
                (value, axis) =>
                  value - padding < world.bounds!.min[axis] ||
                  value + padding > world.bounds!.max[axis],
              )
            )
              continue;
            // A pause needs a clear body column through the source floor. Its
            // collision-verified opening is shared by all landings at this takeoff.
            if (
              world.sweepCapsule(
                [position[0], start[1] + model.maxJumpHeight, position[1]],
                [position[0], start[1] - profile.height, position[1]],
                { ...profile, inflation: 0.005 },
              ) !== null
            )
              continue;
            waypoint = position;
            break;
          }
        exits.set(key, waypoint);
      }
      const waypoint = exits.get(key);
      if (waypoint && fits(waypoint)) yield { mode: 'jump', horizontalWaypoint: waypoint };
    }
    for (const horizontalSplit of [0.5, 0.25, 0.75, 0, 1]) {
      if (
        fits([
          start[0] + (end[0] - start[0]) * horizontalSplit!,
          start[2] + (end[2] - start[2]) * horizontalSplit!,
        ])
      )
        yield { mode: 'jump', horizontalSplit };
    }
  };
}
