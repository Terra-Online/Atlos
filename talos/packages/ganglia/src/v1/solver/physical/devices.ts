import type { CollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { createGoalProjector, findGoalHit } from '#@/src/model/goals.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { InteractionGoal, SpeedBoost } from '#@/src/movement.ts';
import type { GroundConnection } from '#@/src/route.ts';
import type { DeviceFacts } from '#@/src/solver/physical.ts';
import { jumpConnection, jumpDuration } from '#@/src/v1/motion/jumps.ts';
interface Options {
  surfaces: Surface[];
  world: CollisionWorld;
  profile: { radius: number; height: number };
  walls: Wall[];
  model: { gravity: number; fallingGravity: number; maxFallingSpeed: number; apexTime: number };
  maxSlope: number;
  runAirSpeed?: number;
}
const vector = (v: unknown): v is Vec3 =>
  Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
// A reference aim may be airborne. Preserve its proposed horizontal velocity
// while descending to support, then validate the complete swept arc.
const launchLanding = (
  starts: Vec3[],
  aim: Vec3,
  height: number,
  aimClearance: number,
  options: Options,
  support: (seed: Vec3) => Vec3 | null,
  inside: (seed: Vec3) => boolean,
  freeSpeed?: number,
) => {
  const { world, surfaces, profile, walls } = options;
  let minimum = Infinity;
  for (const surface of surfaces) {
    for (const point of surface.vertices) {
      minimum = Math.min(minimum, point[1]);
    }
  }
  for (const start of starts) {
    // Fixed pads clear their aim; free steering retains the authored pad height.
    const model = {
      gravity: options.model.gravity,
      fallingGravity: options.model.fallingGravity,
      maxFallingSpeed: options.model.maxFallingSpeed,
      apexTime: options.model.apexTime,
      maxJumpHeight:
        freeSpeed === undefined ? Math.max(height, aim[1] + aimClearance - start[1]) : height,
      mode: 'jump' as const,
    };
    const aimTime = jumpDuration(start[1], aim[1], model);
    const endTime = jumpDuration(start[1], minimum, model);
    if (!aimTime || !endTime) {
      continue;
    }
    const vx = (aim[0] - start[0]) / aimTime;
    const vz = (aim[2] - start[2]) / aimTime;
    const speed = Math.hypot(vx, vz);
    if (freeSpeed !== undefined && speed > freeSpeed + 1e-7) continue;
    const speedTolerance = Math.max(1, speed) * 1e-7;
    const end: Vec3 = [start[0] + vx * endTime, minimum, start[2] + vz * endTime];
    // this unverified curve only proposes landings. only the final call uses
    // collision and walls and may supply an action to the planner.
    const proposal = jumpConnection(start, end, {
      ...model,
      profile,
      walls: [],
      maxHorizontalSpeed: freeSpeed ?? speed + speedTolerance,
      sweep: () => null,
    });
    if (!proposal) {
      continue;
    }
    for (let i = 1; i < proposal.points.length; i++) {
      const point = proposal.points[i],
        previous = proposal.points[i - 1];
      if (point[1] >= previous[1]) {
        continue;
      }
      if (!inside(point)) {
        break;
      }
      const span = previous[1] - point[1] + 0.01;
      const hit = world.groundAt(point, {
        maxUp: span,
        maxDown: span,
        maxSlope: options.maxSlope,
        radius: profile.radius,
      });
      if (!hit) {
        continue;
      }
      let seed = hit.position,
        foot: Vec3 | null = null;
      // solve landing time and support height together on slopes. the stop
      // tolerance bounds position error, independent of any scene distance.
      for (let iteration = 0; iteration < 16; iteration++) {
        const time = jumpDuration(start[1], seed[1] + 0.01, model);
        if (!time) {
          break;
        }
        const position: Vec3 = [start[0] + vx * time, seed[1], start[2] + vz * time];
        if (!inside(position)) {
          break;
        }
        const next = world.groundAt(position, {
          maxUp: 0.5,
          maxDown: 0.5,
          maxSlope: options.maxSlope,
          radius: profile.radius,
        });
        if (!next) {
          break;
        }
        if (distance(next.position, seed) < 1e-5) {
          foot = support(next.position);
          break;
        }
        seed = next.position;
      }
      if (!foot) {
        continue;
      }
      const arc = jumpConnection(start, foot, {
        ...model,
        profile,
        walls,
        maxHorizontalSpeed: freeSpeed ?? speed + speedTolerance,
        sweep: (a, b, body) => world.sweepCapsule(a, b, body),
        funnelWorld: world,
      });
      if (arc) {
        return arc;
      }
    }
  }
  return null;
};

export const prepareDeviceConnections = (input: DeviceFacts, options: Options) => {
  const { surfaces, world, profile, walls } = options;
  const blocked = createWallChecker(options.walls, profile);
  const project = createGoalProjector(surfaces);
  const connections: GroundConnection[] = [];
  const boosts: SpeedBoost[] = [];
  const outcomes: { id: string; mode: string; reason: string }[] = [];
  const inside = (p: Vec3) =>
    !world.bounds ||
    [p[0], p[2]].every(
      (v, i) =>
        v - profile.radius - 0.02 >= world.bounds!.min[i] &&
        v + profile.radius + 0.02 <= world.bounds!.max[i],
    );
  const support = (seed: Vec3) => {
    if (!inside(seed)) {
      return null;
    }
    const hit = world.groundAt(seed, {
      maxUp: 0.5,
      maxDown: 0.5,
      maxSlope: options.maxSlope,
      radius: profile.radius,
    });
    if (!hit) {
      return null;
    }
    const foot: Vec3 = [hit.position[0], hit.position[1] + 0.01, hit.position[2]];
    if (
      !project(foot, { maxVertical: profile.radius }).length ||
      blocked(foot, foot) ||
      world.sweepCapsule(foot, foot, profile)
    ) {
      return null;
    }
    return foot;
  };
  const clear = (points: Vec3[]) =>
    points.every(inside) &&
    points.every(
      (point, i) =>
        !blocked(i ? points[i - 1] : point, point) &&
        !world.sweepCapsule(i ? points[i - 1] : point, point, profile),
    );
  const nearby = (d: DeviceFacts['devices'][number]) => {
    const goal = d.goal;
    if (!goal) {
      return [];
    }
    const points: Vec3[] = project(goal.position, {
      maxVertical: 0.5,
      interaction: goal.interaction,
    })
      .slice(0, 32)
      .map((p) => p.position);
    points.push(...d.seeds);
    return points.map(support).filter((p): p is Vec3 => {
      if (!p || distance(p, goal.position) > goal.interaction.radius) {
        return false;
      }
      const { maxVertical, facing, halfAngle } = goal.interaction;
      if (maxVertical !== undefined && Math.abs(p[1] - goal.position[1]) > maxVertical) {
        return false;
      }
      const dx = p[0] - goal.position[0],
        dz = p[2] - goal.position[2];
      return (
        !facing ||
        halfAngle === undefined ||
        dx * facing[0] + dz * facing[2] >=
          Math.hypot(dx, dz) * Math.cos((halfAngle * Math.PI) / 180) - 1e-9
      );
    });
  };
  for (const device of input.devices) {
    if (device.kind !== 'accelerate' || !inside(device.position)) continue;
    const duration = device.duration;
    const goal = device.goal;
    if (typeof duration !== 'number' || !Number.isFinite(duration) || duration <= 0 || !goal) {
      outcomes.push({ id: device.id, mode: 'accelerate', reason: 'device-model-unresolved' });
      continue;
    }
    boosts.push({
      id: device.id,
      position: goal.position,
      interaction: goal.interaction,
      duration,
      multiplier: device.boostMultiplier,
    });
    outcomes.push({ id: device.id, mode: 'accelerate', reason: 'trigger-retained' });
  }
  const byId = new Map(input.devices.map((d) => [d.id, d]));
  for (const pair of input.ropes) {
    const lower = byId.get(pair.bottom)!,
      upper = byId.get(pair.top)!;
    if (!inside(lower.position) || !inside(upper.position)) {
      continue;
    }
    const p = lower,
      q = upper;
    let reason = 'device-model-unresolved';
    if (p.resolved && q.resolved && lower.unitScale && upper.unitScale) {
      reason = 'support-or-clearance-unresolved';
      const speed = p.speed,
        overhead = p.overhead;
      if (Number.isFinite(speed) && speed > 0 && Number.isFinite(overhead) && overhead >= 0) {
        const from = nearby(lower),
          to = nearby(upper);
        let accepted = false;
        for (const a of from) {
          for (const b of to) {
            // rise outside the ledge before transferring onto its supported exit.
            const points: Vec3[] = [a, a, [a[0], b[1] + 0.1, a[2]], [b[0], b[1] + 0.1, b[2]], b];
            if (!clear(points)) {
              continue;
            }
            const times = [0, overhead];
            for (let i = 2; i < points.length; i++) {
              times.push(times[i - 1] + distance(points[i - 1], points[i]) / speed);
            }
            connections.push({
              id: `rope/${lower.id}/${upper.id}`,
              mode: 'rope',
              state: 'open',
              points,
              times,
              endpointTolerance: profile.radius,
            });
            accepted = true;
            break;
          }
          if (accepted) {
            break;
          }
        }
        if (accepted) {
          reason = 'accepted';
        }
      }
    }
    outcomes.push({ id: lower.id, mode: 'rope', reason });
  }
  for (const d of input.devices) {
    if (d.kind !== 'launch' || !inside(d.position)) {
      continue;
    }
    const p = d;
    let reason = 'device-state-or-model-unresolved';
    if (p.fixedLaunch && d.unitScale) {
      const aim = p.aim,
        height = p.height;
      const entries = nearby(d);
      const start = entries[0],
        end = vector(aim) ? support(aim) : null;
      reason = !start
        ? 'entry-support-or-clearance-unresolved'
        : !end
          ? 'aim-support-unresolved'
          : 'launch-motion-blocked';
      if (start && end && Number.isFinite(height) && height > 0) {
        const model = {
          gravity: options.model.gravity,
          fallingGravity: options.model.fallingGravity,
          maxFallingSpeed: options.model.maxFallingSpeed,
          apexTime: options.model.apexTime,
          maxJumpHeight: Math.max(height, end[1] + d.aimClearance - start[1]),
          mode: 'jump' as const,
        };
        const duration = jumpDuration(start[1], end[1], model);
        if (duration) {
          const arc = jumpConnection(start, end, {
            ...model,
            profile,
            walls: options.walls,
            maxHorizontalSpeed: distance(start, end) / duration + 1,
            sweep: (a, b, body) => world.sweepCapsule(a, b, body),
            funnelWorld: world,
          });
          if (arc) {
            connections.push({
              ...arc,
              id: `launch/${d.id}`,
              mode: 'launch',
              state: 'open',
              endpointTolerance: profile.radius,
            });
            reason = 'accepted';
          }
        }
      }
      if (reason !== 'accepted' && vector(aim) && Number.isFinite(height) && height > 0) {
        const arc = launchLanding(entries, aim, height, d.aimClearance, options, support, inside);
        if (arc) {
          connections.push({
            ...arc,
            id: `launch/${d.id}`,
            mode: 'launch',
            state: 'open',
            endpointTolerance: profile.radius,
          });
          reason = 'accepted';
        }
      }
    } else if (
      p.freeLaunch === true &&
      p.resolved &&
      d.unitScale &&
      options.runAirSpeed !== undefined
    ) {
      const speed = options.runAirSpeed;
      const height = p.height;
      if (Number.isFinite(speed) && speed > 0 && Number.isFinite(height) && height > 0) {
        reason = 'launch-motion-blocked';
        const entries = nearby(d);
        if (!entries.length) reason = 'entry-support-or-clearance-unresolved';
        for (const start of entries) {
          const duration = jumpDuration(start[1], start[1], {
            ...options.model,
            maxJumpHeight: height,
            mode: 'jump',
          });
          if (!duration) continue;
          // Free launch uses the pad's vertical height and character air speed.
          // The authored aim is a proposal, not a required destination. Sampling
          // additional headings is query independent so prepared device caches
          // can safely retain these model-based actions across requests.
          const aims: Vec3[] = vector(p.aim) ? [p.aim] : [];
          const angle = vector(p.aim) ? Math.atan2(p.aim[2] - start[2], p.aim[0] - start[0]) : 0;
          for (let i = 0; i < 8; i++) {
            const heading = angle + (i * Math.PI) / 4;
            aims.push([
              start[0] + Math.cos(heading) * speed * duration,
              start[1],
              start[2] + Math.sin(heading) * speed * duration,
            ]);
          }
          for (const aim of aims) {
            const arc = launchLanding([start], aim, height, 0, options, support, inside, speed);
            if (!arc) continue;
            connections.push({
              ...arc,
              id: `launch/${d.id}/${connections.length}`,
              mode: 'launch',
              state: 'open',
              endpointTolerance: profile.radius,
            });
            reason = 'accepted';
          }
        }
      }
    }
    outcomes.push({ id: d.id, mode: 'launch', reason });
  }
  const terminalLaunches = (target: Vec3, interaction: InteractionGoal): GroundConnection[] => {
    const speed = options.runAirSpeed;
    const { gravity, fallingGravity, maxFallingSpeed, apexTime } = options.model;
    if (!interaction.airborne || speed === undefined || !Number.isFinite(speed) || speed <= 0)
      return [];
    const entries: GroundConnection[] = [];
    for (const device of input.devices) {
      if (
        device.kind !== 'launch' ||
        device.fixedLaunch ||
        !device.freeLaunch ||
        !device.resolved ||
        !device.unitScale ||
        !inside(device.position) ||
        !Number.isFinite(device.height) ||
        device.height <= 0 ||
        !device.goal ||
        !inside(target)
      )
        continue;
      const model = {
        gravity,
        fallingGravity,
        maxFallingSpeed,
        apexTime,
        maxJumpHeight: device.height,
        maxHorizontalSpeed: speed,
        mode: 'jump' as const,
      };
      // The latest possible hit occurs as the flight descends below the
      // source volume. Include the launch trigger extent in the broadphase.
      const lowest = target[1] - interaction.radius;
      const source = device.goal;
      const latestFeet = source.position[1] + source.interaction.radius;
      const latest = jumpDuration(latestFeet, lowest, model);
      if (
        !latest ||
        Math.hypot(target[0] - source.position[0], target[2] - source.position[2]) >
          speed * latest + source.interaction.radius + interaction.radius
      )
        continue;
      const ceiling = target[1] + interaction.radius;
      const feet = new Map(nearby(device).map((start) => [JSON.stringify(start), start]));
      for (const start of feet.values()) {
        const dx = target[0] - start[0],
          dz = target[2] - start[2];
        const distance = Math.hypot(dx, dz);
        const upper = Math.min(start[1] + device.height, ceiling);
        if (upper < lowest) continue;
        // Each sample is a cross-section of the authored goal volume reached
        // during descent. Motion still uses the independent capsule sweep.
        let fastest: GroundConnection | undefined;
        for (let step = 0; step <= 12; step++) {
          const y = upper + ((lowest - upper) * step) / 12;
          const time = jumpDuration(start[1], y, model);
          if (!time) continue;
          const displacement = Math.min(distance, speed * time * (1 - 1e-10));
          const fraction = distance ? displacement / distance : 0;
          const aim: Vec3 = [start[0] + dx * fraction, y, start[2] + dz * fraction];
          if (!findGoalHit([aim, aim], target, interaction)) continue;
          const arc = jumpConnection(start, aim, {
            ...model,
            profile,
            walls,
            sweep: (a, b, body) => world.sweepCapsule(a, b, body),
            funnelWorld: world,
            collection: { target, interaction },
          });
          const endpoint = arc?.points.at(-1);
          if (!arc || !endpoint || !findGoalHit([endpoint, endpoint], target, interaction))
            continue;
          if (!fastest || arc.times.at(-1)! < fastest.times.at(-1)!)
            fastest = {
              ...arc,
              id: `launch/${device.id}/terminal/${entries.length}`,
              mode: 'launch',
              state: 'open',
              terminal: true,
              endpointTolerance: profile.radius,
            };
        }
        if (fastest) entries.push(fastest);
      }
    }
    return entries;
  };

  return {
    terminalLaunches,
    facts: {
      connections,
      boosts,
      outcomes,
      snapshot: 'all-devices-enabled-and-powered',
      motionValidation: 'model-based',
    },
  };
};

export const createDeviceConnections = (input: DeviceFacts, options: Options) =>
  prepareDeviceConnections(input, options).facts;
