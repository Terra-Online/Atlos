import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Surface } from '#@/src/geometry.ts';
import type { InteractionGoal } from '#@/src/movement.ts';
import type { GroundArrival, GroundConnection, Route } from '#@/src/route.ts';
import { createWallChecker } from '#@/src/v1/geo/walls.ts';
import { mayReachGoal } from '#@/src/v1/motion/flight-steering.ts';
import { createGoalProjector, findGoalHit, trimGoalFlight } from '#@/src/v1/motion/goals.ts';
import {
  type MotionControl,
  type Arc,
  createMotionVariants,
  jumpConnection,
  jumpDuration,
  runOffConnection,
} from '#@/src/v1/motion/jumps.ts';
import { boundaryLanding } from '#@/src/v1/motion/landings.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import type { PlannerOptions, JumpResult } from '#@/src/v1/route/jump-planner.ts';
import { movementGeometry } from '#@/src/v1/route/movement-geometry.ts';
import { standingFoot, validateDiscovery } from '#@/src/v1/search/traversal.ts';

type Options = PlannerOptions & { interaction: InteractionGoal };
interface Witness {
  position: Vec3;
  surface?: string;
  exit?: [number, number];
}
interface Candidate {
  start: Witness;
  end: Witness;
  arc: Arc & { requiredGait?: 'sprint' };
}

const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
/** Search supported takeoffs and flight controls around an airborne interaction volume.
 * A collectible completes at its first hit. Only its prefix must clear collision.
 * Pair sampling is bounded and failure leaves reachability unresolved.
 */
export function findGoalFlights(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: Options,
) {
  const { profile, model, interaction, maxCandidates, maxLinks } = options;
  const diagnostics = { attempted: 0, nominalHits: 0, hits: 0, approaches: 0, truncated: false };
  const first = starts.find((start) => start.state === 'available');
  if (!first) return { candidates: [], diagnostics };
  validateDiscovery(world, { ...options, from: first.position, to: goal });
  const project = options.groundPlanner?.project ?? createGoalProjector(surfaces);
  const blocked = createWallChecker(options.walls, profile);
  const radius = Math.hypot(
    options.maxHorizontalDistance + interaction.radius,
    options.maxDrop + model.maxJumpHeight + interaction.radius,
  );
  const nearby = project(goal, { maxVertical: options.maxVertical, interaction: { radius } });
  const feet: Witness[] = [],
    cells = new Set<string>(),
    layers = new Map<number, number>();
  const spacing = Math.max(profile.radius, options.sampleSpacing);
  for (const nav of nearby) {
    const p = nav.position;
    if (
      Math.hypot(p[0] - goal[0], p[2] - goal[2]) >
        options.maxHorizontalDistance + interaction.radius ||
      p[1] < goal[1] - options.maxDrop - interaction.radius ||
      p[1] > goal[1] + options.maxDrop + interaction.radius
    )
      continue;
    const key = p.map((value) => Math.round(value / spacing)).join(',');
    if (cells.has(key)) continue;
    cells.add(key);
    const layer = Math.floor(p[1] / profile.height);
    if ((layers.get(layer) ?? 0) >= 32) continue;
    const foot = standingFoot(nav, world, { ...options, blocked, project });
    if (foot.reason) continue;
    feet.push(foot);
    layers.set(layer, (layers.get(layer) ?? 0) + 1);
    if (feet.length >= Math.min(256, maxCandidates)) {
      diagnostics.truncated = true;
      break;
    }
  }
  const geometry = movementGeometry(surfaces, options);
  const sourceSurface = geometry.projectSupport(first.position, options.maxVertical)?.surface;
  const topology = geometry.topology;
  const sourceRegion =
    sourceSurface === undefined ? undefined : topology.components[topology.ids.get(sourceSurface)!];
  const sameRegion = (surface: string | undefined) =>
    sourceRegion !== undefined && topology.components[topology.ids.get(surface!)!] === sourceRegion;
  const ledges = geometry.boundaries
    .filter(
      (boundary) =>
        boundary.midpoint[1] > goal[1] + profile.height &&
        distance(boundary.midpoint, goal) <= options.maxDrop + options.maxHorizontalDistance,
    )
    .sort(
      (a, b) =>
        Number(sameRegion(b.surface)) - Number(sameRegion(a.surface)) ||
        distance(a.midpoint, goal) - distance(b.midpoint, goal),
    );
  const takeoffs: Witness[] = [],
    ledgeCells = new Set<string>();
  const span = Math.hypot(goal[0] - first.position[0], goal[2] - first.position[2]);
  const samples = Math.min(64, Math.ceil(span / spacing));
  for (let index = 0; index <= samples; index++) {
    const fraction = samples ? index / samples : 0;
    const point: Vec3 = [
      first.position[0] + fraction * (goal[0] - first.position[0]),
      first.position[1],
      first.position[2] + fraction * (goal[2] - first.position[2]),
    ];
    const nav = project(point, { maxVertical: options.maxDrop })[0];
    if (!nav || nav.position[1] + model.maxJumpHeight + interaction.radius < goal[1]) continue;
    const foot = standingFoot(nav, world, { ...options, blocked, project });
    if (foot.reason) continue;
    takeoffs.push(foot);
    ledgeCells.add(nav.position.map((value) => Math.round(value / spacing)).join(','));
  }
  // Include the departure roof even when closer, lower faces fill the goal's
  // landing samples. Airborne collection depends on where the flight passes.
  const sourceFaces = nearby
    .filter(
      (nav: { position: Vec3; surface: string }) =>
        nav.position[1] + model.maxJumpHeight + interaction.radius >= goal[1],
    )
    .sort((a, b) => distance(a.position, first.position) - distance(b.position, first.position));
  const corridorScore = (nav: { position: Vec3; surface: string }) =>
    distance(nav.position, first.position) + distance(nav.position, goal);
  const forwardFaces = [...sourceFaces].sort((a, b) => corridorScore(a) - corridorScore(b));
  const regionFaces = sourceFaces
    .filter((nav: { position: Vec3; surface: string }) => sameRegion(nav.surface))
    .sort((a, b) => distance(a.position, goal) - distance(b.position, goal));
  for (const family of [regionFaces, sourceFaces, forwardFaces]) {
    let retained = 0;
    for (const nav of family) {
      const key = nav.position.map((value) => Math.round(value / spacing)).join(',');
      if (ledgeCells.has(key)) continue;
      ledgeCells.add(key);
      const foot = standingFoot(nav, world, { ...options, blocked, project });
      if (foot.reason) continue;
      takeoffs.push(foot);
      if (++retained >= 32) break;
    }
  }
  for (const boundary of ledges) {
    const point = boundaryLanding(boundary, goal, profile.radius / 4);
    const cell = point.map((value) => Math.round(value / spacing)).join(',');
    if (ledgeCells.has(cell)) continue;
    ledgeCells.add(cell);
    const nav = project(point, { maxVertical: options.maxVertical })[0];
    if (!nav) continue;
    const foot = standingFoot(nav, world, { ...options, blocked, project });
    if (foot.reason) continue;
    takeoffs.push({
      ...foot,
      exit: [
        point[0] - boundary.inward[0] * profile.radius * 2,
        point[2] - boundary.inward[1] * profile.radius * 2,
      ],
    });
    if (takeoffs.length >= 192) break;
  }
  const variants = createMotionVariants(model, world, profile);
  const candidates: Candidate[] = [],
    nearMisses: { start: Witness; end: Witness; mode: MotionControl['mode']; distance: number }[] =
      [];
  const attempt = (start: Witness, end: Witness, control: MotionControl, refine: boolean) => {
    const { mode } = control;
    if (
      start.position[1] + model.maxJumpHeight + interaction.radius < goal[1] ||
      start.position[1] - end.position[1] > options.maxDrop ||
      Math.hypot(start.position[0] - end.position[0], start.position[2] - end.position[2]) >
        options.maxHorizontalDistance
    )
      return;
    if (diagnostics.attempted >= maxCandidates) {
      diagnostics.truncated = true;
      return;
    }
    diagnostics.attempted++;
    if (
      !mayReachGoal(
        start.position,
        end.position,
        goal,
        interaction.radius + (refine ? spacing : 0),
        model,
        control,
      )
    )
      return;
    let arc = jumpConnection(start.position, end.position, {
      ...model,
      profile,
      ...control,
      walls: options.walls,
      wallCheck: () => false,
      sweep: () => null,
    });
    let collected = false;
    const wallCheck = (from: Vec3, to: Vec3, inflation = 0) =>
      collected
        ? false
        : blocked(from, findGoalHit([from, to], goal, interaction)?.position ?? to, inflation);
    const sweep = (from: Vec3, to: Vec3, body: Parameters<CollisionWorld['sweepCapsule']>[2]) => {
      if (collected) return null;
      const hit = findGoalHit([from, to], goal, interaction);
      const collision = world.sweepCapsule(from, hit?.position ?? to, body);
      if (!collision && hit) collected = true;
      return collision;
    };
    let supportedDrop = null;
    if (mode === 'drop' && start.position[1] > end.position[1] + profile.radius) {
      supportedDrop = runOffConnection(start.position, end.position, {
        ...model,
        profile,
        world,
        maxSlope: options.maxSlope,
        walls: options.walls,
        wallCheck,
        ...control,
        sweep,
      });
      if (supportedDrop) arc = supportedDrop;
    }
    if (!arc) return;
    if (!findGoalHit(arc.points, goal, interaction)) {
      if (refine) {
        const nearbyHit = findGoalHit(arc.points, goal, {
          ...interaction,
          radius: interaction.radius + spacing,
        });
        if (nearbyHit)
          nearMisses.push({ start, end, mode, distance: distance(nearbyHit.position, goal) });
      }
      return;
    }
    diagnostics.nominalHits++;
    collected = false;
    const verified =
      supportedDrop ??
      jumpConnection(start.position, end.position, {
        ...model,
        profile,
        ...control,
        walls: options.walls,
        wallCheck,
        sweep,
      });
    const clipped = trimGoalFlight(verified, goal, interaction);
    if (!clipped) return;
    const speed =
      verified!.peakHorizontalSpeed ??
      Math.hypot(end.position[0] - start.position[0], end.position[2] - start.position[2]) /
        verified!.times.at(-1)!;
    candidates.push({
      start,
      end: { position: clipped.points.at(-1)! },
      arc: {
        ...clipped,
        ...(speed > options.runAirSpeed + 1e-7 ? { requiredGait: 'sprint' } : {}),
      },
    });
    diagnostics.hits++;
  };
  // Aiming into the interaction volume works even when no landing surface
  // exists below it. Supported endpoint pairs remain a second control family.
  directed: for (const start of takeoffs) {
    const aimDistance = Math.hypot(goal[0] - start.position[0], goal[2] - start.position[2]);
    const inset = aimDistance ? Math.min(1, (interaction.radius * 0.8) / aimDistance) : 0;
    const near = [
      goal[0] + inset * (start.position[0] - goal[0]),
      goal[1],
      goal[2] + inset * (start.position[2] - goal[2]),
    ];
    const heights = [
      ...new Set<number>([
        goal[1],
        goal[1] - interaction.radius * 0.75,
        Math.min(goal[1], start.position[1] + model.maxJumpHeight),
      ]),
    ];
    for (const height of heights)
      for (const aim of [goal, near]) {
        for (const mode of model.maxJumpHeight > 0
          ? (['jump', 'drop'] as const)
          : (['drop'] as const)) {
          attempt(start, { position: [aim[0], height, aim[2]] }, { mode }, false);
          if (diagnostics.attempted >= maxCandidates / 4 || candidates.length >= maxLinks) {
            diagnostics.truncated = true;
            break directed;
          }
        }
      }
  }
  const coarseBudget = Math.max(1, Math.floor(maxCandidates / 2));
  const landingScore = (foot: Witness) =>
    Math.hypot(foot.position[0] - goal[0], foot.position[2] - goal[2]) +
    0.05 * Math.abs(foot.position[1] - goal[1]);
  const landings = [...feet].sort((a, b) => landingScore(a) - landingScore(b));
  // Rank endpoint pairs by where their nominal flight crosses the pickup's
  // height. Nearest landing alone can consume the budget on unrelated floors.
  const pairs = [];
  const departures = [
    ...new Map<string, Witness>(
      [...takeoffs, ...feet].map((foot) => [JSON.stringify(foot.position), foot]),
    ).values(),
  ];
  for (const start of departures)
    for (const end of landings) {
      let miss = Infinity;
      for (const mode of model.maxJumpHeight > 0
        ? (['drop', 'jump'] as const)
        : (['drop'] as const)) {
        const landing = jumpDuration(start.position[1], end.position[1], { ...model, mode });
        if (!landing) continue;
        const apex = start.position[1] + (mode === 'jump' ? model.maxJumpHeight : 0);
        for (const height of [
          goal[1],
          goal[1] - interaction.radius * 0.75,
          Math.min(goal[1], apex),
        ]) {
          const crossing = jumpDuration(start.position[1], height, { ...model, mode });
          if (!crossing || crossing > landing) continue;
          const fraction = crossing / landing;
          miss = Math.min(
            miss,
            Math.hypot(
              start.position[0] + fraction * (end.position[0] - start.position[0]) - goal[0],
              height - goal[1],
              start.position[2] + fraction * (end.position[2] - start.position[2]) - goal[2],
            ),
          );
        }
      }
      if (Number.isFinite(miss))
        pairs.push({ start, end, score: miss + 0.02 * distance(start.position, first.position) });
    }
  pairs.sort((a, b) => a.score - b.score);
  pairs: for (const { start, end } of pairs) {
    if (diagnostics.attempted >= coarseBudget) break;
    for (const mode of model.maxJumpHeight > 0
      ? (['drop', 'jump'] as const)
      : (['drop'] as const)) {
      attempt(start, end, { mode }, true);
      if (diagnostics.attempted >= coarseBudget || candidates.length >= maxLinks) {
        diagnostics.truncated = true;
        break pairs;
      }
    }
  }
  ledgeFlights: for (const { start, end } of pairs) {
    for (const control of variants(start.position, end.position, start.exit)) {
      if (diagnostics.attempted >= maxCandidates * 0.75 || candidates.length >= maxLinks) {
        diagnostics.truncated = true;
        break ledgeFlights;
      }
      attempt(start, end, control, false);
    }
  }
  // A nearest point on each face can miss a pickup by centimetres. Refine the
  // nearby flight families on actual support instead of enlarging its trigger.
  const refinedFeet = new Map<string, Witness[]>();
  const offsets = (foot: Witness): Witness[] => {
    const key = JSON.stringify(foot.position);
    if (refinedFeet.has(key)) return refinedFeet.get(key)!;
    const result = [foot];
    for (const x of [-0.5, 0, 0.5])
      for (const z of [-0.5, 0, 0.5]) {
        if (x === 0 && z === 0) continue;
        const point: Vec3 = [
          foot.position[0] + x * spacing,
          foot.position[1],
          foot.position[2] + z * spacing,
        ];
        const nav = project(point, { maxVertical: options.maxVertical })[0];
        if (!nav) continue;
        const adjusted = standingFoot(nav, world, { ...options, blocked, project });
        if (!adjusted.reason) result.push(adjusted);
      }
    refinedFeet.set(key, result);
    return result;
  };
  nearMisses.sort((a, b) => a.distance - b.distance);
  refinement: for (const near of nearMisses) {
    if (
      near.mode === 'jump' &&
      model.airAcceleration !== undefined &&
      model.airDeceleration !== undefined
    ) {
      for (const horizontalSplit of [0, 1, 0.5])
        attempt(near.start, near.end, { mode: near.mode, horizontalSplit }, false);
    }
    for (const start of offsets(near.start))
      for (const end of offsets(near.end)) {
        if (diagnostics.attempted >= maxCandidates || candidates.length >= maxLinks) {
          diagnostics.truncated = true;
          break refinement;
        }
        attempt(start, end, { mode: near.mode }, false);
      }
  }
  return { candidates, diagnostics };
}
export function planAirborneGoal(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: Options,
  approach: (position: Vec3, maxCost: number) => Pick<JumpResult, 'route' | 'connections'>,
): {
  route: Route;
  connections: GroundConnection[];
  diagnostics: ReturnType<typeof findGoalFlights>['diagnostics'];
} {
  const { candidates, diagnostics } = findGoalFlights(surfaces, world, starts, goal, options);
  const { profile, interaction } = options;
  const first = starts.find((start) => start.state === 'available');
  if (!first) return { route: { status: 'unmapped' }, connections: [], diagnostics };
  candidates.sort(
    (a, b) =>
      distance(first.position, a.start.position) - distance(first.position, b.start.position) ||
      a.arc.times.at(-1)! - b.arc.times.at(-1)!,
  );
  let maxSpeed = Math.max(
    options.speed,
    options.locomotion?.sprintSpeed ?? 0,
    options.locomotion?.dash?.speed ?? 0,
    options.model.maxHorizontalSpeed,
    options.model.startHorizontalSpeed ?? 0,
  );
  for (const edge of options.connections ?? [])
    for (let index = 1; index < edge.points.length; index++) {
      const span = Math.hypot(
        edge.points[index][0] - edge.points[index - 1][0],
        edge.points[index][2] - edge.points[index - 1][2],
      );
      if (span > 0)
        maxSpeed = Math.max(maxSpeed, span / (edge.times[index] - edge.times[index - 1]));
    }
  let best: Route = { status: 'no-verified-route' },
    connections: GroundConnection[] = [];
  const prefixes = new Map<
    string,
    { result: Pick<JumpResult, 'route' | 'connections'>; maxCost: number }
  >();
  const ids = new Set<string>((options.connections ?? []).map((edge) => edge.id));
  let serial = 0;
  for (const candidate of candidates) {
    // A known complete result bounds further entry searches. Include supplied
    // device speeds so a fast transport cannot be pruned by a walking estimate.
    const incumbent = best;
    if (
      incumbent.status === 'complete' &&
      starts.every(
        (start) =>
          start.state !== 'available' ||
          start.cost +
            Math.hypot(
              start.position[0] - candidate.start.position[0],
              start.position[2] - candidate.start.position[2],
            ) /
              maxSpeed +
            candidate.arc.times.at(-1)! >=
            incumbent.cost,
      )
    )
      continue;
    // The authored final flight keeps its duration during resource retiming.
    // Any improving prefix must therefore fit the incumbent's remaining cost.
    const maxCost: number =
      best.status === 'complete' ? best.cost - candidate.arc.times.at(-1)! : Infinity;
    const key = JSON.stringify(candidate.start.position);
    let saved = prefixes.get(key);
    // Current duration ordering tightens repeated bounds. Preserve correctness
    // if a later ordering widens one after an incomplete or over-budget solve.
    if (
      !saved ||
      (maxCost > saved.maxCost &&
        (saved.result.route.status !== 'complete' || saved.result.route.cost > saved.maxCost))
    ) {
      diagnostics.approaches++;
      saved = { result: approach(candidate.start.position, maxCost), maxCost };
      prefixes.set(key, saved);
    }
    const prefix: Pick<JumpResult, 'route' | 'connections'> = saved.result;
    if (prefix.route.status !== 'complete') continue;
    let id;
    do {
      id = `airborne-goal/${serial++}`;
    } while (ids.has(id));
    ids.add(id);
    const segment = { ...candidate.arc, connection: id };
    let route: Route = {
      ...prefix.route,
      segments: [...prefix.route.segments, segment],
      points: [...prefix.route.points, ...segment.points.slice(1)],
      cost: prefix.route.cost + segment.times.at(-1)!,
      length:
        prefix.route.length +
        segment.points.slice(1).reduce((sum, p, i) => sum + distance(p, segment.points[i]), 0),
    };
    if (options.locomotion) route = retimeGroundRoute(route, options.locomotion);
    if (route.status !== 'complete' || (best.status === 'complete' && route.cost >= best.cost))
      continue;
    for (let index = 0; index < route.segments.length; index++) {
      const part = route.segments[index],
        hit = findGoalHit(part.points, goal, interaction);
      if (!hit) continue;
      route.goalHit = {
        segment: index,
        position: hit.position,
        time:
          part.times[hit.index - 1] +
          hit.fraction * (part.times[hit.index] - part.times[hit.index - 1]),
      };
      break;
    }
    best = route;
    connections = [
      ...prefix.connections,
      {
        ...candidate.arc,
        id,
        state: 'open',
        terminal: true,
        fromSurface: candidate.start.surface,
        toSurface: candidate.end.surface,
        endpointTolerance: Math.min(options.maxVertical, profile.radius),
      },
    ];
  }
  return { route: best, connections, diagnostics };
}
