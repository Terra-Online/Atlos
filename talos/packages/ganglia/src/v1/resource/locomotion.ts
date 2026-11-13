import type { Vec3 } from '#@/src/geometry.ts';
import type { LocomotionOptions, Segment } from '#@/src/movement.ts';
import type { Route } from '#@/src/route.ts';
import { hasTerminalGroundEvent, markTerminalGoal } from '#@/src/v1/motion/goals.ts';
import { validateMotion } from '#@/src/v1/motion/motion.ts';

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
interface Scheduled {
  segments: Segment[];
  state: LocomotionState;
  duration: number;
}
interface Label extends Scheduled {
  previous: Label | null;
  transition: { block: Segment[]; allowSprint: boolean; allowDash: boolean } | null;
}

const epsilon = 1e-9;
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const finitePoint = (point: unknown) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const interpolate = (a: Vec3, b: Vec3, fraction: number): Vec3 => [
  a[0] + (b[0] - a[0]) * fraction,
  a[1] + (b[1] - a[1]) * fraction,
  a[2] + (b[2] - a[2]) * fraction,
];
function validateOptions(options: LocomotionOptions) {
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
function scheduleBlock(
  block: Segment[],
  options: LocomotionOptions,
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
const sameContinuation = (a: LocomotionState, b: LocomotionState) => {
  if (
    Math.abs((a.dashCooldown ?? 0) - (b.dashCooldown ?? 0)) > epsilon ||
    Math.abs((a.dashRemaining ?? 0) - (b.dashRemaining ?? 0)) > epsilon
  )
    return false;
  if (
    a.sprinting !== b.sprinting ||
    a.hasActivated !== b.hasActivated ||
    Math.abs(a.velocity - b.velocity) > epsilon
  )
    return false;
  if (!a.previousDirection || !b.previousDirection)
    return a.previousDirection === b.previousDirection;
  return a.previousDirection.every(
    (value, axis) => Math.abs(value - b.previousDirection![axis]) <= epsilon,
  );
};
const dominates = (a: Scheduled, b: Scheduled) =>
  sameContinuation(a.state, b.state) &&
  a.duration <= b.duration + epsilon &&
  a.state.energy >= b.state.energy - epsilon &&
  a.state.delay <= b.state.delay + epsilon;
/** Shared transitions for graph search and fixed-corridor scheduling. The authored
 * non-ground policy still resets ground velocity at exit; physical air replay is
 * a separate contract. Do not infer a landing velocity from these resource states.
 */
export function createLocomotion(options: LocomotionOptions) {
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
    advance(segment: Segment, state: LocomotionState) {
      const choices = segment.mode === 'walk' ? [true, false] : [true];
      return choices
        .flatMap((choice) =>
          (options.dash && choice && segment.mode === 'walk' ? [true, false] : [false]).map(
            (dashing) => scheduleBlock([segment], options, state, choice, dashing),
          ),
        )
        .filter((scheduled) => scheduled !== null);
    },
  };
}
export interface ScheduleChoice {
  allowSprint: boolean;
  allowDash: boolean;
}
export interface ScheduleDecision {
  choices: ScheduleChoice[];
  truncated: boolean;
  maxLabels: number;
}
export type ScheduleChooser = (
  blocks: Segment[][],
  options: LocomotionOptions,
) => ScheduleDecision | null;
let prototypeChooser: ScheduleChooser | undefined;
export function installSchedulePrototype(choose: ScheduleChooser | undefined) {
  const previous = prototypeChooser;
  prototypeChooser = choose;
  return previous;
}

export function chooseTypeScriptSchedule(
  blocks: Segment[][],
  options: LocomotionOptions,
  maxLabels = 256,
): ScheduleDecision | null {
  if (!Number.isSafeInteger(maxLabels) || maxLabels < 2 || maxLabels % 2)
    throw new Error('Invalid locomotion label limit');
  const { speed, stamina } = options;
  const initialEnergy = stamina?.initial ?? 0;
  let labels: Label[] = [
    {
      duration: 0,
      previous: null,
      transition: null,
      segments: [],
      state: {
        energy: initialEnergy,
        minimum: initialEnergy,
        delay: 0,
        sprinting: false,
        hasActivated: false,
        velocity: speed,
        previousDirection: null,
      },
    },
  ];
  let truncated = false;
  for (const block of blocks) {
    const next: Label[] = [];
    const choices = block[0].mode === 'walk' ? [true, false] : [true];
    for (const label of labels)
      for (const allowSprint of choices)
        for (const allowDash of options.dash && allowSprint && block[0].mode === 'walk'
          ? [true, false]
          : [false]) {
          const scheduled = scheduleBlock(
            block,
            options,
            label.state,
            allowSprint,
            allowDash,
            false,
          );
          if (!scheduled) continue;
          const candidate = {
            ...scheduled,
            duration: label.duration + scheduled.duration,
            previous: label,
            transition: { block, allowSprint, allowDash },
          };
          if (next.some((other) => dominates(other, candidate))) continue;
          for (let index = next.length - 1; index >= 0; index--) {
            if (dominates(candidate, next[index])) next.splice(index, 1);
          }
          next.push(candidate);
        }
    if (!next.length) return null;
    if (next.length > maxLabels) {
      // Retain diverse high-energy states alongside faster partial journeys.
      next.sort((a, b) => a.duration - b.duration);
      const fastest = next.slice(0, maxLabels / 2);
      const remainder = next
        .slice(maxLabels / 2)
        .sort((a, b) => b.state.energy - a.state.energy || a.duration - b.duration);
      labels = [...fastest, ...remainder.slice(0, maxLabels / 2)];
      truncated = true;
    } else labels = next;
  }
  const best = labels.reduce((chosen, label) =>
    label.duration < chosen.duration - epsilon ||
    (Math.abs(label.duration - chosen.duration) <= epsilon &&
      label.state.energy < chosen.state.energy - epsilon)
      ? label
      : chosen,
  );

  const choices: ScheduleChoice[] = [];
  for (let current = best; current.previous; current = current.previous) {
    const { allowSprint, allowDash } = current.transition!;
    choices.push({ allowSprint, allowDash });
  }
  return { choices: choices.reverse(), truncated, maxLabels };
}

/** Retime a continuous path while allocating sprint activations across ground runs.
 * Each run offers running or the feasible sprint/recovery schedule. Labels carry exact
 * energy, recovery delay, gait and velocity across movement boundaries. Dominance pruning
 * compares time and resources only for equivalent continuation states. At most 256 labels
 * are retained; a reached limit is reported in locomotion.search.truncated.
 * With dash enabled, spatial decision intervals add spend/save choices within ground runs.
 * This bounded dynamic program optimizes the retained controls and reports label truncation.
 * Explicit sprintThrough modes retain the active gait across supplied non-ground motion.
 * Their trajectory/timing stays authored and ground speed resets on landing. No movement
 * resource cost is inferred. Recovery during sprint/non-ground motion requires flags.
 * A non-ground requiredGait prunes labels without that active entry gait. If all
 * labels fail, the result is no-verified-route. No takeoff activation is invented.
 * Ground turns of 30 degrees reset speed without paying another activation. Acceleration
 * uses samples at no more than 0.1-second intervals for linear trajectory playback.
 */
export function retimeGroundRoute(route: Route, options: LocomotionOptions): Route {
  validateOptions(options);
  if (route.status !== 'complete') return { ...route };
  const { stamina } = options;
  if (
    !Number.isFinite(route.arrivalCost) ||
    route.arrivalCost < 0 ||
    !Array.isArray(route.points) ||
    !route.points.length ||
    !route.points.every(finitePoint) ||
    !Array.isArray(route.segments)
  ) {
    throw new Error('Invalid locomotion route');
  }
  for (const segment of route.segments) {
    if (
      !Array.isArray(segment.points) ||
      segment.points.length < 2 ||
      !segment.points.every(finitePoint)
    ) {
      throw new Error('Invalid locomotion segment');
    }
    validateMotion({ ...segment, cost: segment.times?.at(-1)! });
  }
  let endpoint = route.points[0];
  let blocks: Segment[][] = [];
  for (const segment of route.segments) {
    if (distance(endpoint, segment.points[0]) > 1e-6)
      throw new Error('Discontinuous locomotion route');
    endpoint = segment.points.at(-1)!;
    const last = blocks.at(-1);
    if (
      segment.mode === 'walk' &&
      last?.[0].mode === 'walk' &&
      JSON.stringify(segment.boost) === JSON.stringify(last[0].boost)
    )
      last.push(segment);
    else blocks.push([segment]);
  }
  if (distance(endpoint, route.points.at(-1)!) > 1e-6)
    throw new Error('Inconsistent locomotion endpoint');
  if (options.dash) {
    // Fixed spatial decision intervals bound the control search independently of
    // navigation tessellation. Each label can spend now or carry its charge onward.
    const interval = options.dash!.speed * options.dash.duration;
    blocks = blocks.flatMap((block) => {
      if (block[0].mode !== 'walk') return [block];
      const decisions: Segment[][] = [];
      let current: Segment[] = [],
        remaining = interval;
      for (const segment of block)
        for (let index = 1; index < segment.points.length; index++) {
          let from = segment.points[index - 1];
          const to = segment.points[index];
          let length = distance(from, to);
          while (length > epsilon) {
            const step = Math.min(length, remaining);
            const end = interpolate(from, to, step / length);
            current.push({
              ...segment,
              points: [[...from], end],
              times: [0, step / options.speed],
            });
            from = end;
            length -= step;
            remaining -= step;
            if (remaining <= epsilon) {
              decisions.push(current);
              current = [];
              remaining = interval;
            }
          }
        }
      if (current.length) decisions.push(current);
      return decisions;
    });
  }
  const initialEnergy = stamina?.initial ?? 0;
  const decision = (prototypeChooser ?? chooseTypeScriptSchedule)(blocks, options);
  if (!decision) return { status: 'no-verified-route' };
  const { truncated, maxLabels } = decision;
  const best = { state: createLocomotion(options).initial(), duration: 0 };
  const segments: Segment[] = [];
  for (let index = 0; index < blocks.length; index++) {
    const choice = decision.choices[index];
    const scheduled = scheduleBlock(
      blocks[index],
      options,
      best.state,
      choice.allowSprint,
      choice.allowDash,
    );
    if (!scheduled) return { status: 'no-verified-route' };
    segments.push(...scheduled.segments);
    best.state = scheduled.state;
    best.duration += scheduled.duration;
  }
  let goalHit = route.goalHit;
  if (goalHit && route.segments[goalHit.segment]?.mode !== 'walk') {
    // Resource scheduling splits ground motion but preserves every authored air
    // or device segment in order. Match that ordinal rather than its old index.
    const ordinal =
      route.segments.slice(0, goalHit.segment + 1).filter((segment) => segment.mode !== 'walk')
        .length - 1;
    let seen = -1;
    const segment = segments.findIndex((part) => part.mode !== 'walk' && ++seen === ordinal);
    goalHit = { ...goalHit, segment, position: [...goalHit.position] };
  } else if (goalHit) {
    // Gait scheduling can split walking segments and change their clocks. Arc
    // distance preserves event order even when a route revisits the same point.
    const length = (part: Segment) =>
      part.points.slice(1).reduce((sum, point, i) => sum + distance(part.points[i], point), 0);
    let remaining = route.segments
      .slice(0, goalHit.segment)
      .reduce((sum, part) => sum + length(part), 0);
    const original = route.segments[goalHit.segment];
    for (let i = 1; i < original.points.length; i++) {
      const span = distance(original.points[i - 1], original.points[i]);
      const end = original.times[i];
      if (goalHit.time >= end) remaining += span;
      else {
        const start = original.times[i - 1];
        remaining += span * Math.max(0, (goalHit.time - start) / (end - start));
        break;
      }
    }
    let mapped = false;
    for (let index = 0; index < segments.length && !mapped; index++) {
      const part = segments[index];
      for (let i = 1; i < part.points.length; i++) {
        const span = distance(part.points[i - 1], part.points[i]);
        if (part.mode === 'walk' && remaining <= span + epsilon) {
          const fraction = span > 0 ? Math.max(0, Math.min(1, remaining / span)) : 0;
          goalHit = {
            ...goalHit,
            segment: index,
            time: part.times[i - 1] + fraction * (part.times[i] - part.times[i - 1]),
            position: [...goalHit.position],
          };
          mapped = true;
          break;
        }
        remaining -= span;
      }
    }
  }
  const points: Vec3[] = [[...route.points[0]]];
  for (const segment of segments)
    for (const point of segment.points.slice(1)) {
      if (distance(points.at(-1)!, point) > epsilon) points.push([...point]);
    }
  const result: Extract<Route, { status: 'complete' }> = {
    ...route,
    segments,
    points,
    ...(goalHit ? { goalHit } : {}),
    cost: route.arrivalCost + best.duration,
    length: points.slice(1).reduce((sum, point, index) => sum + distance(points[index], point), 0),
    ...(stamina
      ? {
          locomotion: {
            initial: initialEnergy,
            final: best.state.energy,
            minimum: best.state.minimum,
            ...(options.dash
              ? { dashes: best.state.dashCount ?? 0, dash: { ...options.dash } }
              : {}),
            ...(truncated ? { search: { truncated: true, maxLabels } } : {}),
          },
        }
      : {}),
  };
  return hasTerminalGroundEvent(route) ? markTerminalGoal(result) : result;
}
