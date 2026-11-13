import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { JumpModel } from '#@/src/movement.ts';

export interface Arc {
  mode: 'jump' | 'drop';
  points: Vec3[];
  times: number[];
  motionValidation: 'model-based';
  peakHorizontalSpeed?: number;
}
export type JumpOptions = JumpModel & {
  profile: { radius: number; height: number };
  mode: 'jump' | 'drop';
  sweep: CollisionWorld['sweepCapsule'];
  walls: Wall[];
  clearance?: number;
  /** Fraction of displacement completed early, followed by a stop and late completion.
   * Requires explicit airAcceleration and airDeceleration. Omit for constant speed.
   */
  horizontalSplit?: number;
  /** Optional XZ air waypoint, reached early before the late landing leg. */
  horizontalWaypoint?: [number, number];
  /** Final jump continuation after a speed boost expires. */
  expireAfter?: number;
  expiredHorizontalSpeed?: number;
  /** Optional prepared checker for the same immutable walls and body profile. */
  wallCheck?: ReturnType<typeof createWallChecker>;
};

export type VerticalOptions = Omit<JumpModel, 'maxHorizontalSpeed'> & { mode: 'jump' | 'drop' };
export interface MotionControl {
  mode: 'jump' | 'drop';
  exit?: [number, number];
  speedFraction?: number;
  terminal?: 'average' | 'balanced' | 'fast';
  horizontalWaypoint?: [number, number];
  horizontalSplit?: number;
  expireAfter?: number;
  expiredHorizontalSpeed?: number;
}
interface Phase {
  y: number;
  velocity: number;
  acceleration: number;
  duration: number;
}
interface Trajectory {
  phases: Phase[];
  duration: number;
}
export interface Approach {
  launch: Vec3;
  points: Vec3[];
  distances: number[];
}
export type ApproachCache = Map<string, Approach | null>;
export type ApproachProof = (key: string, compute: () => Approach | null) => Approach | null;
export type ExitCache = Map<string, [number, number] | null>;

export type RunOffOptions = Omit<JumpOptions, 'mode'> &
  Partial<MotionControl> & { world: CollisionWorld; maxSlope: number };
interface SweepOptions {
  profile: JumpOptions['profile'];
  clearance: number;
  wallCheck: NonNullable<JumpOptions['wallCheck']>;
  sweep: JumpOptions['sweep'];
  horizontalAt(time: number): readonly number[];
  horizontalAcceleration: number;
  peakHorizontalSpeed?: number;
  mode: 'jump' | 'drop';
}

export const maximumStep = 0.025;
const finitePoint = (point: unknown) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
export const horizontalLeg = (
  distance: number,
  speed: number,
  acceleration: number,
  deceleration: number,
) => {
  if (distance === 0) return { duration: 0, peak: 0, at: () => 0 };
  const peak = Math.min(speed, Math.sqrt((2 * distance) / (1 / acceleration + 1 / deceleration)));
  if (peak === 0) return null;
  const rise = peak / acceleration,
    fall = peak / deceleration;
  const coast = Math.max(0, distance / peak - (rise + fall) / 2);
  const duration = rise + coast + fall;
  return {
    duration,
    peak,
    at(time: number) {
      if (time <= 0) return 0;
      if (time >= duration) return distance;
      if (time < rise) return (acceleration * time * time) / 2;
      if (time < rise + coast) return peak * (time - rise / 2);
      const remaining = duration - time;
      return distance - (deceleration * remaining * remaining) / 2;
    },
  };
};
// Distance for the forward-input flight family, including a launch impulse.
export const jumpTravel = (
  initial: number,
  time: number,
  model: Pick<
    JumpOptions,
    'maxHorizontalSpeed' | 'airOverspeedDeceleration' | 'expireAfter' | 'expiredHorizontalSpeed'
  >,
) => {
  const { maxHorizontalSpeed, airOverspeedDeceleration, expireAfter, expiredHorizontalSpeed } =
    model;
  const travel = (speed: number, cap: number, duration: number) => {
    if (speed <= cap) return speed * duration;
    const braking = Math.min(duration, (speed - cap) / airOverspeedDeceleration!);
    return (
      speed * braking -
      (airOverspeedDeceleration! * braking * braking) / 2 +
      cap * (duration - braking)
    );
  };
  if (expireAfter === undefined || time <= expireAfter)
    return travel(initial, maxHorizontalSpeed, time);
  const speed = Math.max(
    Math.min(initial, maxHorizontalSpeed),
    initial - airOverspeedDeceleration! * expireAfter,
  );
  return (
    travel(initial, maxHorizontalSpeed, expireAfter) +
    travel(speed, expiredHorizontalSpeed!, time - expireAfter)
  );
};
// Candidate retrieval needs only elapsed time. Build phase records only when a
// physical trajectory will actually be swept, using the same summation order.
const verticalDuration = (
  startHeight: number,
  endHeight: number,
  options: VerticalOptions,
  phases?: Phase[],
): number | null => {
  const { gravity, fallingGravity, maxJumpHeight, maxFallingSpeed, apexTime, mode } = options ?? {};
  if (
    ![
      startHeight,
      endHeight,
      gravity,
      fallingGravity,
      maxJumpHeight,
      maxFallingSpeed,
      apexTime,
    ].every(Number.isFinite) ||
    gravity <= 0 ||
    fallingGravity <= 0 ||
    maxJumpHeight < 0 ||
    maxFallingSpeed <= 0 ||
    apexTime < 0 ||
    !['jump', 'drop'].includes(mode) ||
    (mode === 'jump' && maxJumpHeight === 0)
  )
    throw new Error('Invalid jump model');
  const peak = startHeight + (mode === 'jump' ? maxJumpHeight : 0);
  if (!Number.isFinite(peak)) throw new Error('Non-finite jump model');
  if (endHeight > peak) return null;
  let duration = 0;
  if (mode === 'jump') {
    const velocity = Math.sqrt(2 * gravity * maxJumpHeight);
    const ascent = velocity / gravity;
    phases?.push({ y: startHeight, velocity, acceleration: -gravity, duration: ascent });
    duration += ascent;
    if (apexTime > 0) {
      phases?.push({ y: peak, velocity: 0, acceleration: 0, duration: apexTime });
      duration += apexTime;
    }
  }
  const fallDistance = peak - endHeight;
  const terminalTime = maxFallingSpeed / fallingGravity;
  const terminalDistance = (maxFallingSpeed * terminalTime) / 2;
  if (fallDistance > 0) {
    if (fallDistance <= terminalDistance) {
      const descent = Math.sqrt((2 * fallDistance) / fallingGravity);
      phases?.push({
        y: peak,
        velocity: 0,
        acceleration: -fallingGravity,
        duration: descent,
      });
      duration += descent;
    } else {
      phases?.push({ y: peak, velocity: 0, acceleration: -fallingGravity, duration: terminalTime });
      duration += terminalTime;
      const coast = (fallDistance - terminalDistance) / maxFallingSpeed;
      phases?.push({
        y: peak - terminalDistance,
        velocity: -maxFallingSpeed,
        acceleration: 0,
        duration: coast,
      });
      duration += coast;
    }
  }
  if (!Number.isFinite(duration)) throw new Error('Non-finite jump model');
  if (duration <= 0) return null;
  return duration;
};
const jumpPhases = (
  startHeight: number,
  endHeight: number,
  options: VerticalOptions,
): Trajectory | null => {
  const phases: Phase[] = [],
    duration = verticalDuration(startHeight, endHeight, options, phases);
  return duration === null ? null : { phases, duration };
};
/** Analytic duration under the same explicit vertical model as jumpConnection.
 * Null means that the destination height cannot be reached by the selected mode.
 * This does not check horizontal reach, collision, state or landing support.
 */
export function jumpDuration(
  startHeight: number,
  endHeight: number,
  options: VerticalOptions,
): number | null {
  return verticalDuration(startHeight, endHeight, options);
}
// Internal goal broadphase uses the same phase boundaries and vertical physics
// as the sampled trajectory, including apex holds and terminal-speed descent.
export function jumpVerticalRange(
  startHeight: number,
  endHeight: number,
  options: VerticalOptions,
  fromTime: number,
  toTime: number,
) {
  const trajectory = jumpPhases(startHeight, endHeight, options);
  if (!trajectory) return null;
  const lower = Math.max(0, fromTime),
    upper = Math.min(trajectory.duration, toTime);
  if (lower > upper) return null;
  let min = Infinity,
    max = -Infinity,
    elapsed = 0;
  const include = (phase: Phase, time: number) => {
    const height = phase.y + phase.velocity * time + (phase.acceleration * time * time) / 2;
    min = Math.min(min, height);
    max = Math.max(max, height);
  };
  for (const phase of trajectory.phases) {
    const low = Math.max(0, lower - elapsed),
      high = Math.min(phase.duration, upper - elapsed);
    if (low <= high) {
      include(phase, low);
      include(phase, high);
      const turning = -phase.velocity / phase.acceleration;
      if (turning > low && turning < high) include(phase, turning);
    }
    elapsed += phase.duration;
  }
  return { min, max };
}
/** Construct one directed, model-based jump or drop between caller-supported feet.
 * Gravity values are positive magnitudes. A jump uses the full authored height,
 * followed by an explicit vertical apex hold and terminal-speed-limited descent.
 * Horizontal motion uses the speed cap, optional launch impulse and expiry,
 * or the explicitly supplied split/waypoint control.
 *
 * Each chord receives a continuous full-body capsule sweep. Its inflation bounds
 * the complete quadratic arc between samples, including optional extra clearance.
 * Feet must already have real collision clearance at takeoff and landing. No
 * floor contact or initial overlap is ignored, and endpoints are never lifted.
 * Passing this model does not establish the game's live air-control behaviour.
 */
export function jumpConnection(start: Vec3, end: Vec3, options: JumpOptions): Arc | null {
  const {
    profile,
    gravity,
    fallingGravity,
    maxJumpHeight,
    maxFallingSpeed,
    apexTime,
    maxHorizontalSpeed,
    mode,
    sweep,
    walls,
    clearance = 0,
  } = options ?? {};
  if (
    !finitePoint(start) ||
    !finitePoint(end) ||
    !profile ||
    ![
      profile.radius,
      profile.height,
      gravity,
      fallingGravity,
      maxJumpHeight,
      maxFallingSpeed,
      apexTime,
      maxHorizontalSpeed,
      clearance,
    ].every(Number.isFinite) ||
    profile.radius < 0 ||
    profile.height <= 0 ||
    profile.height < 2 * profile.radius ||
    gravity <= 0 ||
    fallingGravity <= 0 ||
    maxJumpHeight < 0 ||
    maxFallingSpeed <= 0 ||
    apexTime < 0 ||
    maxHorizontalSpeed < 0 ||
    clearance < 0 ||
    !['jump', 'drop'].includes(mode) ||
    (mode === 'jump' && maxJumpHeight === 0) ||
    typeof sweep !== 'function' ||
    !Array.isArray(walls)
  )
    throw new Error('Invalid jump model');
  // Validate all wall records even when endpoint heights make the model impossible.
  const wallCheck = options.wallCheck ?? createWallChecker(walls, profile);
  if (wallCheck(start, start)) return null;
  const trajectory = jumpPhases(start[1], end[1], options);
  if (!trajectory) return null;
  const { duration } = trajectory;
  // Avoid an unbounded allocation for inputs outside any practical scene extent.
  if (duration / maximumStep > 100000) throw new Error('Jump model exceeds the sweep budget');
  const horizontalDistance = Math.hypot(end[0] - start[0], end[2] - start[2]);
  let horizontalAt = (time: number): [number, number] => [
    start[0] + ((end[0] - start[0]) * time) / duration,
    start[2] + ((end[2] - start[2]) * time) / duration,
  ];
  let horizontalAcceleration = 0,
    peakHorizontalSpeed;
  const { startHorizontalSpeed, airOverspeedDeceleration } = options;
  if (startHorizontalSpeed !== undefined || airOverspeedDeceleration !== undefined) {
    if (
      ![startHorizontalSpeed, airOverspeedDeceleration].every(Number.isFinite) ||
      startHorizontalSpeed! < 0 ||
      airOverspeedDeceleration! <= 0
    )
      throw new Error('Invalid jump launch speed');
  }
  const expires = options.expireAfter !== undefined;
  if (
    expires &&
    (!Number.isFinite(options.expireAfter) ||
      options.expireAfter! < 0 ||
      !Number.isFinite(options.expiredHorizontalSpeed) ||
      options.expiredHorizontalSpeed! < 0 ||
      options.expiredHorizontalSpeed! > maxHorizontalSpeed ||
      !Number.isFinite(airOverspeedDeceleration))
  ) {
    throw new Error('Invalid flight speed expiry');
  }
  if (horizontalDistance / duration > maxHorizontalSpeed || expires) {
    if (
      mode !== 'jump' ||
      startHorizontalSpeed === undefined ||
      (!expires && startHorizontalSpeed! <= maxHorizontalSpeed) ||
      options.horizontalSplit !== undefined ||
      options.horizontalWaypoint !== undefined
    )
      return null;
    // A jump impulse can exceed the sustained air-speed limit. Keep steering
    // forward while the excess decays, then continue at the sustained speed.
    const travelled = (initial: number, time: number) => jumpTravel(initial, time, options);
    if (
      travelled(Math.max(startHorizontalSpeed, maxHorizontalSpeed), duration) < horizontalDistance
    )
      return null;
    let low = expires ? 0 : maxHorizontalSpeed,
      high = Math.max(startHorizontalSpeed, maxHorizontalSpeed);
    for (let index = 0; index < 40; index++) {
      const middle = (low + high) / 2;
      if (travelled(middle, duration) < horizontalDistance) low = middle;
      else high = middle;
    }
    peakHorizontalSpeed = high;
    horizontalAcceleration = airOverspeedDeceleration!;
    horizontalAt = (time) => {
      const fraction = travelled(high, time) / horizontalDistance;
      return [start[0] + (end[0] - start[0]) * fraction, start[2] + (end[2] - start[2]) * fraction];
    };
  }
  if (options.horizontalSplit !== undefined || options.horizontalWaypoint !== undefined) {
    const { horizontalSplit, airAcceleration, airDeceleration } = options;
    if (
      ![airAcceleration, airDeceleration].every(Number.isFinite) ||
      airAcceleration! <= 0 ||
      airDeceleration! <= 0 ||
      (options.horizontalWaypoint === undefined &&
        (!Number.isFinite(horizontalSplit) || horizontalSplit! < 0 || horizontalSplit! > 1)) ||
      (options.horizontalWaypoint !== undefined &&
        (!Array.isArray(options.horizontalWaypoint) ||
          options.horizontalWaypoint.length !== 2 ||
          !options.horizontalWaypoint.every(Number.isFinite)))
    ) {
      throw new Error('Invalid horizontal jump control');
    }
    const middle = options.horizontalWaypoint ?? [
      start[0] + (end[0] - start[0]) * horizontalSplit!,
      start[2] + (end[2] - start[2]) * horizontalSplit!,
    ];
    const firstDistance = Math.hypot(middle[0] - start[0], middle[1] - start[2]);
    const lastDistance = Math.hypot(end[0] - middle[0], end[2] - middle[1]);
    const first = horizontalLeg(
      firstDistance,
      maxHorizontalSpeed,
      airAcceleration!,
      airDeceleration!,
    );
    const last = horizontalLeg(
      lastDistance,
      maxHorizontalSpeed,
      airAcceleration!,
      airDeceleration!,
    );
    if (!first || !last || first.duration + last.duration > duration) return null;
    horizontalAt = (time) => {
      const a = firstDistance === 0 ? 1 : first.at(time) / firstDistance;
      const b = lastDistance === 0 ? 1 : last.at(time - (duration - last.duration)) / lastDistance;
      return [
        start[0] + (middle[0] - start[0]) * a + (end[0] - middle[0]) * b,
        start[2] + (middle[1] - start[2]) * a + (end[2] - middle[1]) * b,
      ];
    };
    horizontalAcceleration = Math.max(airAcceleration!, airDeceleration!);
    peakHorizontalSpeed = Math.max(first.peak, last.peak);
  }
  return sweepTrajectory(start, end, trajectory, {
    profile,
    clearance,
    wallCheck,
    sweep,
    horizontalAt,
    horizontalAcceleration,
    peakHorizontalSpeed,
    mode,
  });
}
function sweepTrajectory(
  start: Vec3,
  end: Vec3,
  { phases }: Trajectory,
  {
    profile,
    clearance,
    wallCheck,
    sweep,
    horizontalAt,
    horizontalAcceleration,
    peakHorizontalSpeed,
    mode,
  }: SweepOptions,
): Arc | null {
  const points: Vec3[] = [[...start]],
    times = [0];
  let elapsed = 0;
  for (let phaseIndex = 0; phaseIndex < phases.length; phaseIndex++) {
    const phase = phases[phaseIndex],
      count = Math.ceil(phase.duration / maximumStep);
    const advance = (previousTime: number, localTime: number, last: boolean): boolean => {
      const time = elapsed + localTime;
      const horizontal = horizontalAt(time);
      const point: Vec3 = last
        ? [...end]
        : [
            horizontal[0],
            phase.y + phase.velocity * localTime + (phase.acceleration * localTime * localTime) / 2,
            horizontal[1],
          ];
      const delta = localTime - previousTime;
      const inflation =
        clearance + (Math.hypot(phase.acceleration, horizontalAcceleration) * delta * delta) / 8;
      const previous = points.at(-1)!;
      const blocked =
        wallCheck(previous, point, inflation) ||
        sweep(previous, point, { ...profile, inflation }) !== null;
      if (blocked) {
        // Curvature inflation can overlap the supporting ledge while the actual
        // arc clears it. Refine that interval without ignoring any contact.
        if (delta <= maximumStep / 16) return false;
        const middle = (previousTime + localTime) / 2;
        return advance(previousTime, middle, false) && advance(middle, localTime, last);
      }
      points.push(point);
      times.push(time);
      return true;
    };
    for (let step = 1; step <= count; step++) {
      if (
        !advance(
          (phase.duration * (step - 1)) / count,
          (phase.duration * step) / count,
          phaseIndex === phases.length - 1 && step === count,
        )
      )
        return null;
    }
    elapsed += phase.duration;
  }
  return {
    mode,
    points,
    times,
    motionValidation: 'model-based',
    ...(peakHorizontalSpeed === undefined ? {} : { peakHorizontalSpeed }),
  };
}
/** Follow continuous support to a ledge before starting free fall. Recast erodes
 * standing surfaces inward, so falling immediately from a supported seed drives
 * the capsule into its own floor. This approach remains collision checked and
 * cannot bridge a missing support interval or step through an obstacle.
 * Internal discovery helper; callers supply validated world/model options.
 */
export function runOffConnection(
  start: Vec3,
  end: Vec3,
  options: RunOffOptions,
  cache?: ApproachCache,
  proof?: ApproachProof,
): Arc | null {
  const { world, maxSlope, profile, walls } = options;
  const wallCheck = options.wallCheck ?? createWallChecker(walls, profile);
  const span = Math.hypot(end[0] - start[0], end[2] - start[2]);
  if (span === 0 && !options.exit) return null;
  const exit = options.exit ?? [end[0], end[2]];
  const exitDistance = Math.hypot(exit[0] - start[0], exit[1] - start[2]);
  if (exitDistance === 0) return null;
  const direction = [(exit[0] - start[0]) / exitDistance, (exit[1] - start[2]) / exitDistance];
  const limit = options.exit ? exitDistance + profile.radius : span;
  const cacheKey = options.exit ? JSON.stringify([start, options.exit]) : null;
  if (cacheKey && cache?.has(cacheKey)) {
    const prefix = cache.get(cacheKey);
    return prefix
      ? steerDrop(prefix.launch, end, direction, prefix.points, prefix.distances, {
          ...options,
          wallCheck,
        })
      : null;
  }
  if (cacheKey) cache?.set(cacheKey, null);
  const compute = () =>
    marchToLedge(start, direction, limit, { world, maxSlope, profile, wallCheck });
  const prefix = proof ? proof(JSON.stringify([start, exit, limit]), compute) : compute();
  if (!prefix) return null;
  if (options.exit) {
    // Publish the proof only when this logical attempt reaches the supported
    // approach. Preloading it would change the motion generator's control flow.
    if (cacheKey) cache?.set(cacheKey, prefix);
    return steerDrop(prefix.launch, end, direction, prefix.points, prefix.distances, {
      ...options,
      wallCheck,
    });
  }
  const arc = jumpConnection(prefix.launch, end, { ...options, mode: 'drop' });
  if (!arc) return null;
  const low = prefix.distances.at(-1)!;
  const airSpeed = (span - low) / arc.times.at(-1)!;
  if (airSpeed <= 0 || airSpeed > options.maxHorizontalSpeed) return null;
  const approachTime = low / airSpeed;
  return {
    ...arc,
    points: [...prefix.points, ...arc.points.slice(1)],
    times: [
      ...prefix.distances.map((distance) => distance / airSpeed),
      ...arc.times.slice(1).map((time) => approachTime + time),
    ],
  };
}

function marchToLedge(
  start: Vec3,
  direction: number[],
  limit: number,
  {
    world,
    maxSlope,
    profile,
    wallCheck,
  }: Pick<RunOffOptions, 'world' | 'maxSlope' | 'profile'> & {
    wallCheck: NonNullable<JumpOptions['wallCheck']>;
  },
): Approach | null {
  const spacing = profile.radius / 4;
  const slope = Math.tan((maxSlope * Math.PI) / 180);
  const points: Vec3[] = [[...start]],
    distances = [0];
  let travelled = 0;
  const supportAt = (distance: number, previous: Vec3): Vec3 | null => {
    const foot: Vec3 = [
      start[0] + direction[0] * distance,
      previous[1] - 0.005,
      start[2] + direction[1] * distance,
    ];
    if (
      world.bounds &&
      [0, 2].some(
        (axis, index) =>
          foot[axis] - profile.radius < world.bounds!.min[index] ||
          foot[axis] + profile.radius > world.bounds!.max[index],
      )
    )
      return null;
    const support = world.groundAt(foot, {
      maxUp: spacing * slope + profile.radius,
      maxDown: spacing * slope + profile.radius,
      maxSlope,
      radius: profile.radius,
    });
    if (!support) return null;
    const position: Vec3 = [...support.position];
    position[1] += 0.005;
    return position;
  };
  const appendSupport = (distance: number, position: Vec3): boolean => {
    const previous = points.at(-1)!,
      previousDistance = distances.at(-1)!;
    if (wallCheck(previous, position) || world.sweepCapsule(previous, position, profile) !== null) {
      if (distance - previousDistance <= spacing / 128) return false;
      const middle = (distance + previousDistance) / 2,
        supported = supportAt(middle, previous);
      return (
        supported !== null && appendSupport(middle, supported) && appendSupport(distance, position)
      );
    }
    points.push(position);
    distances.push(distance);
    return true;
  };
  while (travelled < limit) {
    const nextDistance = Math.min(limit, travelled + spacing);
    let next = supportAt(nextDistance, points.at(-1)!);
    if (!next) {
      let low = travelled,
        high = nextDistance,
        launch = points.at(-1)!;
      // Locate support loss independently of navmesh erosion and triangulation.
      for (let refinement = 0; refinement < 12; refinement++) {
        const middle = (low + high) / 2,
          position = supportAt(middle, launch);
        if (position) {
          low = middle;
          launch = position;
        } else high = middle;
      }
      if (low > travelled && !appendSupport(low, launch)) return null;
      return { launch, points, distances };
    }
    if (!appendSupport(nextDistance, next)) return null;
    travelled = nextDistance;
  }
  return null;
}
// A supported approach supplies the initial air velocity. Cubic velocity controls
// bound speed and acceleration over the entire fall, including turns under roofs.
function steerDrop(
  start: Vec3,
  end: Vec3,
  direction: number[],
  approach: Vec3[],
  distances: number[],
  options: RunOffOptions & { wallCheck: NonNullable<JumpOptions['wallCheck']> },
): Arc | null {
  const trajectory = jumpPhases(start[1], end[1], { ...options, mode: 'drop' });
  if (!trajectory) return null;
  const { duration } = trajectory;
  const average = [(end[0] - start[0]) / duration, (end[2] - start[2]) / duration];
  const length = Math.hypot(...average),
    cap = options.maxHorizontalSpeed;
  if (length > cap) return null;
  const speed = cap * options.speedFraction!;
  if (!Number.isFinite(speed) || speed <= 0) return null;
  const initial = direction.map((value) => value * speed);
  const terminal =
    options.terminal === 'average'
      ? average
      : options.terminal === 'balanced'
        ? average.map((value, axis) => 2 * value - initial[axis])
        : average.map((value) => (length > 0 ? (value * cap) / length : 0));
  const middle = average.map((value, axis) => 3 * value - initial[axis] - terminal[axis]);
  const peakHorizontalSpeed = Math.max(
    ...[initial, middle, terminal].map((value) => Math.hypot(...value)),
  );
  const horizontalAcceleration =
    (2 / duration) *
    Math.max(
      Math.hypot(...middle.map((value, axis) => value - initial[axis])),
      Math.hypot(...terminal.map((value, axis) => value - middle[axis])),
    );
  if (peakHorizontalSpeed > cap || horizontalAcceleration > options.airAcceleration!) return null;
  if (options.world.bounds) {
    const padding =
      options.profile.radius +
      (Math.hypot(options.fallingGravity, horizontalAcceleration) * maximumStep ** 2) / 8;
    const controls = [
      start,
      end,
      [start[0] + (initial[0] * duration) / 3, start[1], start[2] + (initial[1] * duration) / 3],
      [end[0] - (terminal[0] * duration) / 3, end[1], end[2] - (terminal[1] * duration) / 3],
    ];
    if (
      controls.some((point) =>
        [0, 2].some(
          (axis, index) =>
            point[axis] - padding < options.world.bounds!.min[index] ||
            point[axis] + padding > options.world.bounds!.max[index],
        ),
      )
    )
      return null;
  }
  const horizontalAt = (time: number): [number, number] => {
    const t = time / duration;
    return [0, 1].map(
      (axis) =>
        start[axis * 2] +
        duration *
          (initial[axis] * t +
            (middle[axis] - initial[axis]) * t * t +
            ((terminal[axis] - 2 * middle[axis] + initial[axis]) * t * t * t) / 3),
    ) as [number, number];
  };
  const arc = sweepTrajectory(start, end, trajectory, {
    profile: options.profile,
    clearance: 0,
    wallCheck: options.wallCheck,
    sweep: options.sweep,
    horizontalAt,
    horizontalAcceleration,
    peakHorizontalSpeed,
    mode: 'drop',
  });
  if (!arc) return null;
  const approachTime = distances.at(-1)! / speed;
  return {
    ...arc,
    points: [...approach, ...arc.points.slice(1)],
    times: [
      ...distances.map((distance) => distance / speed),
      ...arc.times.slice(1).map((time) => approachTime + time),
    ],
  };
}
