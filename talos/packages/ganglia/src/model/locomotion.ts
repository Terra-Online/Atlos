import type { Vec3 } from '#@/src/geometry.ts';
import type { LocomotionModel, Segment } from '#@/src/movement.ts';

export interface LocomotionState {
  energy: number;
  minimum: number;
  delay: number;
  sprinting: boolean;
  hasActivated: boolean;
  velocity: number;
  previousDirection: number[] | null;
  dashCooldown?: number;
  dashRemaining?: number;
  dashCount?: number;
}
export interface Scheduled {
  segments: Segment[];
  state: LocomotionState;
  duration: number;
}
const epsilon = 1e-9;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
export const interpolate = (a: Vec3, b: Vec3, fraction: number): Vec3 => [
  a[0] + (b[0] - a[0]) * fraction,
  a[1] + (b[1] - a[1]) * fraction,
  a[2] + (b[2] - a[2]) * fraction,
];
export function validateOptions(options: LocomotionModel) {
  const { speed, sprintSpeed, sprintAcceleration, stamina, dash } = options;
  if (
    ![speed, sprintSpeed, sprintAcceleration].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
    sprintSpeed < speed
  )
    throw new Error('Invalid locomotion speeds');
  if (
    options.sprintThrough !== undefined &&
    (!Array.isArray(options.sprintThrough) ||
      options.sprintThrough.some((mode) => !['jump', 'drop', 'rope', 'launch'].includes(mode)))
  ) {
    throw new Error('Invalid sprint-through modes');
  }
  if (
    dash &&
    (![dash.speed, dash.duration, dash.cooldown, dash.cost].every(
      (value) => Number.isFinite(value) && value > 0,
    ) ||
      dash.speed < sprintSpeed ||
      dash.cooldown < dash.duration ||
      !stamina)
  )
    throw new Error('Invalid dash policy');
  if (stamina === undefined) return;
  if (!stamina || typeof stamina !== 'object') throw new Error('Invalid locomotion stamina');
  const {
    capacity,
    initial,
    sprintDrain = 0,
    activationCost = 0,
    recoveryRate,
    recoveryDelay,
    reserve,
    recoveryDuringSprint = false,
    recoveryDuringNonWalk = false,
  } = stamina;
  if (
    ![capacity, initial, sprintDrain, activationCost, recoveryRate, recoveryDelay, reserve].every(
      Number.isFinite,
    ) ||
    capacity <= 0 ||
    initial < 0 ||
    initial > capacity ||
    sprintDrain < 0 ||
    activationCost < 0 ||
    recoveryRate < 0 ||
    typeof recoveryDuringSprint !== 'boolean' ||
    typeof recoveryDuringNonWalk !== 'boolean' ||
    recoveryDelay < 0 ||
    reserve < 0 ||
    reserve > capacity
  )
    throw new Error('Invalid locomotion stamina');
}
function sprintTime(length: number, speed: number, cap: number, acceleration: number) {
  const accelerationTime = Math.max(0, (cap - speed) / acceleration);
  const accelerationDistance = ((speed + cap) * accelerationTime) / 2;
  if (length <= accelerationDistance) {
    // This form avoids cancellation for very short spans at nonzero speed.
    return (2 * length) / (Math.sqrt(speed * speed + 2 * acceleration * length) + speed);
  }
  return accelerationTime + (length - accelerationDistance) / cap;
}
function sprintDistance(seconds: number, speed: number, cap: number, acceleration: number) {
  const accelerated = Math.min(seconds, Math.max(0, (cap - speed) / acceleration));
  return (
    speed * accelerated +
    (acceleration * accelerated * accelerated) / 2 +
    cap * (seconds - accelerated)
  );
}
export function scheduleBlock(
  block: Segment[],
  options: LocomotionModel,
  state: LocomotionState,
  allowSprint: boolean,
  allowDash = false,
  materialize = true,
): Scheduled | null {
  const { sprintAcceleration, stamina, dash } = options;
  const speed = options.speed * (block[0].boost?.multiplier ?? 1);
  const sprintSpeed = options.sprintSpeed * (block[0].boost?.multiplier ?? 1);
  const drain = stamina?.sprintDrain ?? 0;
  const draining = drain > 0;
  const activationCost = stamina?.activationCost ?? 0;
  const recoveryRate = stamina?.recoveryRate ?? 0;
  const reserve = stamina?.reserve ?? 0;
  let { energy, minimum, delay, sprinting, hasActivated, velocity, previousDirection } = state;
  let dashCooldown = state.dashCooldown ?? 0,
    dashRemaining = state.dashRemaining ?? 0;
  let dashCount = state.dashCount ?? 0;
  const advanceClock = (duration: number) => {
    dashCooldown = Math.max(0, dashCooldown - duration);
  };
  if (!allowSprint && dashRemaining > epsilon) return null;
  if (!allowSprint) {
    if (sprinting && draining) delay = stamina!.recoveryDelay;
    sprinting = false;
    velocity = speed;
  }
  // Frontier labels need resource states and clocks, while only the selected
  // chain needs playback samples. Keep the same per-output clock additions in
  // both modes: summing physical phase durations would change tie rounding.
  type Output = { gait?: Segment['gait']; duration: number; segment?: Segment };
  const outputs: Output[] = [];
  for (const segment of block) {
    if (segment.mode !== 'walk') {
      // A faster authored air trajectory cannot activate sprint or spend energy
      // retroactively. Only a feasible approach may establish its required gait.
      if (segment.requiredGait === 'sprint' && !sprinting) return null;
      advanceClock(segment.times.at(-1)!);
      dashRemaining = 0;
      outputs.push({
        duration: segment.times.at(-1)!,
        ...(materialize
          ? {
              segment: {
                ...segment,
                points: segment.points.map((point) => [...point]),
                times: [...segment.times],
              },
            }
          : {}),
      });
      if (stamina?.recoveryDuringNonWalk) {
        const duration = segment.times.at(-1)!;
        const recovering = Math.max(0, duration - delay);
        delay = Math.max(0, delay - duration);
        energy = Math.min(stamina!.capacity, energy + recovering * recoveryRate);
      }
      sprinting = sprinting && (options.sprintThrough?.includes(segment.mode) ?? false);
      velocity = speed;
      previousDirection = null;
      continue;
    }
    let output: Output | null = null;
    const append = (
      gait: Segment['gait'],
      point: Vec3 | null,
      elapsed: number,
      start: Vec3 | null,
    ) => {
      if (!output || output.gait !== gait) {
        output = {
          gait,
          duration: 0,
          ...(materialize
            ? { segment: { ...segment, gait, points: [[...start!]], times: [0] } }
            : {}),
        };
        outputs.push(output);
      }
      output.duration += elapsed;
      if (output.segment) {
        output.segment.points.push([...point!]);
        output.segment.times.push(output.duration);
      }
    };
    for (let index = 1; index < segment.points.length; index++) {
      const a = segment.points[index - 1];
      const b = segment.points[index];
      const length = distance(a, b);
      if (length <= epsilon) continue;
      const direction = b.map((value, axis) => (value - a[axis]) / length);
      if (previousDirection) {
        const alignment = direction.reduce(
          (sum, value, axis) => sum + value * previousDirection![axis],
          0,
        );
        if (alignment < Math.cos(Math.PI / 6)) velocity = speed;
        // A dash pulse follows one direction. Collinear navmesh seams retain it,
        // while a geometric turn ends the pulse and keeps its paid cooldown.
        if (alignment < 1 - 1e-6) dashRemaining = 0;
      }
      previousDirection = direction;
      let travelled = 0;
      while (length - travelled > epsilon) {
        if (
          allowDash &&
          dash &&
          dashRemaining <= epsilon &&
          dashCooldown <= epsilon &&
          energy + epsilon >= reserve + dash.cost
        ) {
          energy = Math.max(reserve, energy - dash.cost);
          minimum = Math.min(minimum, energy);
          delay = stamina!.recoveryDelay;
          dashCooldown = dash.cooldown;
          dashRemaining = dash.duration;
          dashCount++;
          sprinting = true;
          hasActivated = true;
          output = null;
        }
        if (dashRemaining > epsilon) {
          const dashSpeed = dash!.speed * (segment.boost?.multiplier ?? 1);
          const duration = Math.min(dashRemaining, (length - travelled) / dashSpeed);
          const start = materialize ? interpolate(a, b, travelled / length) : null;
          travelled = Math.min(length, travelled + dashSpeed * duration);
          append(
            'dash',
            materialize ? interpolate(a, b, travelled / length) : null,
            duration,
            start,
          );
          dashRemaining = Math.max(0, dashRemaining - duration);
          advanceClock(duration);
          // Dash blocks recovery just like its activation. The delay still elapses.
          delay = Math.max(0, delay - duration);
          velocity = sprintSpeed;
          continue;
        }
        let dashBoundary = Infinity;
        if (allowDash && dash && reserve + dash.cost <= stamina!.capacity) {
          const recharge = Math.max(0, reserve + dash.cost - energy);
          const recovery =
            recharge > epsilon && recoveryRate > 0 && stamina!.recoveryDuringSprint
              ? delay + recharge / recoveryRate
              : recharge > epsilon
                ? Infinity
                : 0;
          dashBoundary = Math.max(dashCooldown, recovery);
          if (dashBoundary <= epsilon) dashBoundary = Infinity;
        }
        const recoveringSprint = stamina?.recoveryDuringSprint && delay <= epsilon;
        const netDrain = drain - (recoveringSprint ? recoveryRate : 0);
        if (netDrain > 0 && sprinting && energy - reserve <= epsilon) {
          sprinting = false;
          delay = stamina!.recoveryDelay;
          velocity = speed;
        }
        if (!sprinting) {
          const required =
            draining || activationCost > 0
              ? reserve + activationCost + (hasActivated ? drain : 0)
              : 0;
          const enoughEnergy =
            energy + epsilon >= required &&
            (!draining || energy - reserve - activationCost > epsilon);
          if (allowSprint && sprintSpeed > speed && enoughEnergy) {
            energy = Math.max(0, energy - activationCost);
            minimum = Math.min(minimum, energy);
            sprinting = true;
            hasActivated = true;
            delay = stamina?.recoveryDelay ?? 0;
            continue;
          }
          const remainingTime = (length - travelled) / speed;
          let duration = Math.min(remainingTime, dashBoundary);
          // Recharge one second of drain even before the first activation to avoid
          // entering an infinitesimal sprint when starting at the reserve.
          const restartEnergy = reserve + activationCost + drain;
          const canResume =
            allowSprint &&
            stamina &&
            sprintSpeed > speed &&
            restartEnergy <= stamina!.capacity &&
            recoveryRate > 0;
          if (canResume) {
            const rechargeTime = delay + Math.max(0, restartEnergy - energy) / recoveryRate;
            duration = Math.min(duration, rechargeTime);
          }
          const start = materialize ? interpolate(a, b, travelled / length) : null;
          travelled = Math.min(length, travelled + speed * duration);
          append(
            'run',
            materialize ? interpolate(a, b, travelled / length) : null,
            duration,
            start,
          );
          if (stamina) {
            const recovering = Math.max(0, duration - delay);
            delay = Math.max(0, delay - duration);
            energy = Math.min(stamina!.capacity, energy + recovering * recoveryRate);
          }
          advanceClock(duration);
          velocity = speed;
          continue;
        }
        const availableTime = netDrain > 0 ? Math.max(0, (energy - reserve) / netDrain) : Infinity;
        const recoveryBoundary =
          stamina?.recoveryDuringSprint && delay > epsilon ? delay : Infinity;
        const duration = Math.min(
          sprintTime(length - travelled, velocity, sprintSpeed, sprintAcceleration),
          availableTime,
          recoveryBoundary,
          dashBoundary,
        );
        const accelerationTime = Math.min(duration, (sprintSpeed - velocity) / sprintAcceleration);
        const samples = [];
        const count = Math.ceil(accelerationTime / 0.1);
        for (let sample = 1; sample <= count; sample++)
          samples.push((accelerationTime * sample) / count);
        if (!samples.length || duration - samples.at(-1)! > epsilon) samples.push(duration);
        const initialDistance = travelled;
        let previousTime = 0;
        for (const sample of samples) {
          const start = materialize ? interpolate(a, b, travelled / length) : null;
          travelled = Math.min(
            length,
            initialDistance + sprintDistance(sample, velocity, sprintSpeed, sprintAcceleration),
          );
          append(
            'sprint',
            materialize ? interpolate(a, b, travelled / length) : null,
            sample - previousTime,
            start,
          );
          previousTime = sample;
        }
        advanceClock(duration);
        velocity = Math.min(sprintSpeed, velocity + sprintAcceleration * duration);
        if (stamina) {
          const recovering = stamina!.recoveryDuringSprint ? Math.max(0, duration - delay) : 0;
          delay = Math.max(0, delay - duration);
          energy = Math.min(
            stamina!.capacity,
            Math.max(0, energy - duration * drain + recovering * recoveryRate),
          );
          minimum = Math.min(minimum, energy);
        }
      }
    }
  }
  return {
    segments: materialize ? outputs.map((output) => output.segment!) : [],
    state: {
      energy,
      minimum,
      delay,
      sprinting,
      hasActivated,
      velocity,
      previousDirection,
      ...(dash ? { dashCooldown, dashRemaining, dashCount } : {}),
    },
    duration: outputs.reduce((sum, output) => sum + output.duration, 0),
  };
}

/** Execute a chosen sprint/dash control, preserving resources across blocks. */
export function createLocomotionRules(options: LocomotionModel) {
  validateOptions(options);
  const energy = options.stamina?.initial ?? 0;
  return {
    initial: (): LocomotionState => ({
      energy,
      minimum: energy,
      delay: 0,
      sprinting: false,
      hasActivated: false,
      velocity: options.speed,
      previousDirection: null,
    }),
    advance(
      block: Segment[],
      state: LocomotionState,
      control: { allowSprint: boolean; allowDash: boolean },
    ) {
      return scheduleBlock(block, options, state, control.allowSprint, control.allowDash);
    },
  };
}
