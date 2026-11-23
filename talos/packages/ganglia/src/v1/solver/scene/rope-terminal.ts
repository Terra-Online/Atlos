import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createTypeScriptCollisionWorld } from '#@/src/model/collision.ts';
import { physicalCoverage, physicalTileSpan } from '#@/src/model/coverage.ts';
import { findGoalHit, type GoalProjector } from '#@/src/model/goals.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { GroundArrival, Route } from '#@/src/route.ts';
import { checkpoint } from '#@/src/solver/checkpoint.ts';
import type { RouteQuery, RouteResult, SolveOptions } from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import type {
  PhysicalSnapshot,
  SceneNavigation,
  SceneResources,
  WindowJob,
} from '#@/src/solver/resources.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
import { findGoalFlights } from '#@/src/v1/route/airborne-goal.ts';
import { createScopedGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { createCandidatePlanner } from '#@/src/v1/search/candidate-planner.ts';
import { createDeviceConnections } from '#@/src/v1/solver/physical/devices.ts';
import { composeRoutes } from '#@/src/v1/solver/route-result.ts';
import type { AirbornePrepCache, AirborneWindow } from '#@/src/v1/solver/scene/airborne.ts';

type Complete = Extract<Route, { status: 'complete' }>;
type Scene<Source> = { scene: string; source: Source; walls: Wall[] };
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
function footprint(points: Vec3[], margin: number) {
  const min: Vec3 = [...points[0]],
    max: Vec3 = [...points[0]];
  for (const point of points)
    for (const axis of [0, 2]) {
      min[axis] = Math.min(min[axis], point[axis]);
      max[axis] = Math.max(max[axis], point[axis]);
    }
  return { min, max, ...physicalCoverage(min, max, { margin }) };
}

async function physicalWindow<Source, Job extends WindowJob>(
  scene: Scene<Source>,
  resources: SceneResources<Source, Job>,
  arrival: GroundArrival,
  target: Vec3,
  points: Vec3[],
  margin: number,
  maxTiles: number,
  signal?: AbortSignal,
) {
  if (!resources.physical) return;
  const { min, max, bounds: b, tiles: count } = footprint(points, margin);
  if (count > maxTiles) return;
  const bounds: { min: [number, number]; max: [number, number] } = {
    min: [b[0], b[1]],
    max: [b[2], b[3]],
  };
  const tiles = [];
  for (let x = Math.floor(b[0] / physicalTileSpan); x < Math.ceil(b[2] / physicalTileSpan); x++)
    for (let z = Math.floor(b[1] / physicalTileSpan); z < Math.ceil(b[3] / physicalTileSpan); z++)
      tiles.push({ x, z });
  for (;;) {
    signal?.throwIfAborted();
    const job = await resources.query(scene.scene, scene.source, min, max, {
      margin,
      startBuild: true,
      corridor: {
        kind: 'corridor-proposal',
        bounds,
        tiles,
        coarse: { regions: 0, edges: 0, path: points, halo: margin },
      },
    });
    if (!job || job.status === 'failed') return;
    if (job.status === 'ready') return resources.physical(job, { ...scene, arrival, target });
    await resources.wait(signal);
  }
}

function movement(
  snapshot: PhysicalSnapshot,
  config: GangliaV1Config,
  prepCache?: AirbornePrepCache,
) {
  const { input, coverage } = snapshot;
  const { surfaces } = input.ground;
  if (!surfaces.length) return;
  const { model, maxSlope, runAirSpeed } = input.movement;
  let base: CollisionWorld;
  let physical: ReturnType<typeof createPhysicalWorld>;
  if (prepCache) {
    const cached = prepCache.getPrepared(snapshot, true);
    base = cached.baseWorld;
    physical = cached.physical;
  } else {
    const scope = coverage === 'complete' ? input.ground.build?.bounds : coverage.bounds;
    const geometry = { positions: input.collision.positions, indices: input.collision.indices };
    base = createTypeScriptCollisionWorld(
      geometry,
      scope
        ? {
            bounds: {
              min: [scope.min[0] - 0.5, scope.min[1] - 0.5],
              max: [scope.max[0] + 0.5, scope.max[1] + 0.5],
            },
          }
        : undefined,
    );
    physical = createPhysicalWorld({ ...input, collision: geometry }, coverage, {
      geometry,
      world: base,
    });
  }
  const configured = physical.configured();
  const { covered } = physical;
  // Discovery probes also sample candidates near a window edge. Unknown
  // support yields no candidate, and unknown swept space rejects the action.
  const world: CollisionWorld = {
    bounds: base.bounds,
    groundAt(point, options) {
      return covered(point, point, options.radius ?? 0)
        ? configured.world.groundAt(point, options)
        : null;
    },
    sweepCapsule(from, to, body) {
      return covered(from, to, body.radius + (body.inflation ?? 0))
        ? configured.world.sweepCapsule(from, to, body)
        : { triangle: -1, distance: 0 };
    },
  };
  // The exported surface graph belongs to the same source window. Rounded
  // exclusions keep the source blockers when the last rope contact is joined.
  const options = {
    ...input.ground.options,
    walls: input.roundedWalls ?? input.ground.options.walls,
    locomotion: input.locomotion,
    maxVertical: 0.5,
  };
  const planner = createScopedGroundPlanner(surfaces, options);
  let min = Infinity,
    max = -Infinity;
  for (const surface of surfaces)
    for (const p of surface.vertices) {
      min = Math.min(min, p[1]);
      max = Math.max(max, p[1]);
    }
  const maxDrop = max - min;
  const duration = jumpDuration(maxDrop, 0, { ...model, mode: 'jump' });
  if (duration === null || !Number.isFinite(duration)) return;
  const params: JumpRouteOptions = {
    ...options,
    groundPlanner: planner,
    model,
    maxSlope,
    runAirSpeed,
    maxDrop,
    maxHorizontalDistance:
      duration * Math.max(model.startHorizontalSpeed, model.maxHorizontalSpeed),
    sampleSpacing: config.sampleSpacing,
    maxCandidates: Math.min(config.maxCandidates, 2400),
    maxLinks: config.maxLinks,
    maxShortcutCandidates: 0,
  };
  return { world, covered, planner, params, surfaces };
}

function waypoints(points: Vec3[]) {
  return points.slice(1, -1).slice(0, 128);
}

function findGoalContact(
  terminal: PhysicalSnapshot,
  config: GangliaV1Config,
  starts: GroundArrival[],
  goal: Vec3,
  interaction: NonNullable<RouteQuery['interaction']>,
  projection: GoalProjector,
  prepCache?: AirbornePrepCache,
): Vec3 | undefined {
  const local = movement(terminal, config, prepCache);
  if (!local) return;
  const terminalFlights = findGoalFlights(local.surfaces, local.world, starts, goal, {
    ...local.params,
    interaction,
    maxCandidates: Math.min(local.params.maxCandidates, 1400),
  });
  return terminalFlights.candidates
    .map((flight) => ({
      point: flight.start.position,
      projection: projection.closest(flight.start.position, { interaction: { radius: 0.5 } }),
    }))
    .filter((flight) => flight.projection)
    .sort((a, b) => a.projection!.distance - b.projection!.distance)[0]?.point;
}

/** Probe a source rope as an intermediate destination before committing the
 * coarse guide to an unsupported airborne goal. Every supplied rope, takeoff and
 * terminal flight is constructed from the current collision and device facts. */
export async function discoverRopeTerminal<Source, Job extends WindowJob>(
  scene: Scene<Source>,
  navigation: SceneNavigation,
  projection: GoalProjector,
  resources: SceneResources<Source, Job>,
  config: GangliaV1Config,
  query: RouteQuery,
  options: SolveOptions,
  load: () => Promise<AirborneWindow<Job> | undefined>,
  prepCache?: AirbornePrepCache,
): Promise<RouteResult | undefined> {
  const interaction = query.interaction;
  // Starts with a separate projection range belong to the ordinary window
  // path, which owns admission against that explicit bound.
  const starts = query.starts.filter(
    (start) => start.state === 'available' && !('groundRange' in start),
  );
  if (!interaction?.airborne || !starts.length || !resources.physical || !config.maxCandidates)
    return;
  // A mapped contact can be handled by the ordinary ground/terminal flow.
  if (projection.closest(query.goal, { interaction })) return;
  options.onEvent?.({ type: 'progress', phase: 'validate' });
  const terminal = (await load())?.snapshot;
  if (!terminal?.input.devices?.ropes.length) return;
  // Filter candidate nearby ropes BEFORE building collision/ground indices and
  // searching terminal flights (avoids ~10s of dead work when no rope is nearby).
  const devices = new Map(terminal.input.devices.devices.map((device) => [device.id, device]));
  const ropes = terminal.input.devices.ropes
    .flatMap((pair) => {
      const bottom = devices.get(pair.bottom),
        top = devices.get(pair.top);
      return bottom?.goal && top?.goal && distance(top.position, query.goal) <= 3 * config.gridSpan
        ? [{ pair, bottom: bottom.goal, top: top.goal }]
        : [];
    })
    .sort((a, b) => distance(a.top.position, query.goal) - distance(b.top.position, query.goal))
    .slice(0, config.maxAttempts);
  if (!ropes.length) return;
  const goalContact = findGoalContact(
    terminal,
    config,
    starts,
    query.goal,
    interaction,
    projection,
    prepCache,
  );
  if (!goalContact) return;
  await checkpoint(options.signal);
  // Localize only the proposal graph. Physical windows and proofs are still
  // required for all movement. A full-scene optimistic transfer expansion is
  // unnecessary for this bounded fallback.
  const radius = 5 * config.gridSpan;
  const surfaces = navigation.surfaces.filter((surface) =>
    surface.vertices.some((p) => Math.hypot(p[0] - query.goal[0], p[2] - query.goal[2]) <= radius),
  );
  const ids = new Set(surfaces.map((s) => s.id));
  const coarse = createCandidatePlanner({
    surfaces,
    options: {
      ...navigation.options,
      portals: navigation.options.portals?.filter((p) => ids.has(p.from) && ids.has(p.to)),
    },
  });
  const localStarts = starts.filter((start) => distance(start.position, query.goal) <= radius);
  const ranked = ropes
    .flatMap(({ pair, bottom, top }) => {
      const exit = projection.closest(top.position, { interaction: top.interaction });
      if (!exit) return [];
      const candidates = localStarts.filter(
        (start) =>
          footprint([start.position, bottom.position, top.position, query.goal], 2).tiles <=
          config.maxTiles,
      );
      if (!candidates.length) return [];
      const head = coarse.plan(candidates, bottom.position, { interaction: bottom.interaction });
      const tail = coarse.plan(
        [{ id: pair.top, position: exit.position, cost: 0, state: 'available' }],
        goalContact,
        { interaction: { radius: 0.5 } },
      );
      return head.status === 'candidate' && tail.status === 'candidate'
        ? [{ pair, head, tail, bottom, top, score: head.score + tail.score }]
        : [];
    })
    .sort((a, b) => a.score - b.score);
  for (const { pair, head, tail, bottom, top } of ranked.slice(
    0,
    Math.min(2, config.maxAttempts),
  )) {
    await checkpoint(options.signal);
    const arrival = head.arrival;
    const points = [...head.points, ...tail.points, query.goal];
    // A nominal halo can move the envelope across a complete tile boundary.
    // Try a smaller input envelope while requiring full body coverage of the
    // solved route. Existing scene policy still bounds the number of tiles.
    const snapshot =
      (await physicalWindow(
        scene,
        resources,
        arrival,
        query.goal,
        points,
        config.gridSpan / 4,
        config.maxTiles,
        options.signal,
      )) ??
      (await physicalWindow(
        scene,
        resources,
        arrival,
        query.goal,
        points,
        2,
        config.maxTiles,
        options.signal,
      )) ??
      (await physicalWindow(
        scene,
        resources,
        arrival,
        query.goal,
        [arrival.position, bottom.position, top.position, query.goal],
        2,
        config.maxTiles,
        options.signal,
      ));
    if (!snapshot?.input.devices) continue;
    const route = movement(snapshot, config);
    if (!route) continue;
    const { surfaces, world, params, planner, covered } = route;
    const facts = snapshot.input.devices;
    const rope = createDeviceConnections(
      {
        devices: facts.devices.filter(
          (device) => device.id === pair.bottom || device.id === pair.top,
        ),
        ropes: facts.ropes.filter(
          (entry) => entry.bottom === pair.bottom && entry.top === pair.top,
        ),
      },
      { ...params, surfaces, world, project: planner.project },
    ).connections.find((edge) => edge.points.every((p) => covered(p, p)));
    const start = planner.project(arrival.position, { maxVertical: params.maxVertical })[0];
    if (!rope || !start || !covered(start.position, start.position)) continue;
    const projected = { ...arrival, position: start.position };
    const prefix = planJumpRoute(surfaces, world, [projected], rope.points.at(-1)!, {
      ...params,
      connections: [rope],
      endpointTolerance: params.profile.radius,
      waypoints: waypoints(head.points),
    });
    if (
      prefix.route.status !== 'complete' ||
      !prefix.route.segments.some((segment) => segment.connection === rope.id)
    )
      continue;
    const departure: GroundArrival = {
      id: '@rope-exit',
      position: prefix.route.points.at(-1)!,
      cost: 0,
      state: 'available',
    };
    const flights = findGoalFlights(surfaces, world, [departure], query.goal, {
      ...params,
      interaction,
      maxCandidates: Math.min(params.maxCandidates, 1400),
    });
    const tried = new Set<string>();
    for (const flight of flights.candidates) {
      if (tried.size >= Math.min(4, config.maxAttempts)) break;
      const key = flight.start.position.map((v) => Math.floor(v / params.profile.radius)).join('/');
      if (tried.has(key)) continue;
      tried.add(key);
      await checkpoint(options.signal);
      const approach = planJumpRoute(surfaces, world, [departure], flight.start.position, {
        ...params,
        endpointTolerance: params.profile.radius,
        waypoints: waypoints(tail.points),
      });
      if (approach.route.status !== 'complete') continue;
      // Reassemble the local action overlay through the same ground planner.
      // It retains the exact rope endpoint and proves the transfer to the tail
      // without treating its projected synthetic arrival as free travel.
      const connections = new Map(prefix.connections.map((edge) => [edge.id, edge]));
      connections.set(rope.id, rope);
      for (const edge of approach.connections) {
        const previous = connections.get(edge.id);
        if (!previous) connections.set(edge.id, edge);
        else if (JSON.stringify(previous) !== JSON.stringify(edge)) {
          const id = '@rope-tail/' + edge.id;
          connections.set(id, { ...edge, id });
        }
      }
      const joined = planner.plan([projected], flight.start.position, {
        connections: [...connections.values()],
        endpointTolerance: params.profile.radius,
      });
      if (
        joined.status !== 'complete' ||
        !joined.segments.some((segment) => segment.connection === rope.id)
      )
        continue;
      const arc = flight.arc;
      const end = arc.points.at(-1)!,
        duration = arc.times.at(-1)!;
      const terminal: Complete = {
        status: 'complete',
        start: '@rope-terminal',
        arrivalCost: 0,
        cost: duration,
        length: arc.points
          .slice(1)
          .reduce((sum, point, index) => sum + distance(arc.points[index], point), 0),
        points: arc.points,
        segments: [{ ...arc, connection: 'airborne-goal/rope' }],
        goalHit: { segment: 0, position: end, time: duration },
      };
      const complete = composeRoutes([joined, terminal], snapshot.input.locomotion);
      if (
        complete.status !== 'complete' ||
        complete.points.some((p, i) => !covered(complete.points[Math.max(0, i - 1)], p)) ||
        !findGoalHit([end, end], query.goal, interaction) ||
        complete.segments.findIndex((segment) =>
          findGoalHit(segment.points, query.goal, interaction),
        ) !==
          complete.segments.length - 1
      )
        continue;
      return {
        route: complete,
        connections: [rope],
        arrival,
        partial: false,
        diagnostics: { truncated: true },
      };
    }
  }
}
