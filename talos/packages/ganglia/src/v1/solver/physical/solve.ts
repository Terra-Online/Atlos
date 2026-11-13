import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import type { SpeedBoost, InteractionGoal } from '#@/src/movement.ts';
import type { GroundArrival, GroundConnection, GroundOptions, Route } from '#@/src/route.ts';
import type { SolverConfig } from '#@/src/solver/contract.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { createCollisionWorld } from '#@/src/v1/geo/collision.ts';
import { verticalProjectionCandidates } from '#@/src/v1/geo/support-projector.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
import { registerCatalogSurfaces } from '#@/src/v1/route/action-catalog.ts';
import { pruneGroundDetours } from '#@/src/v1/route/ground-detours.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type InitialGroundProof } from '#@/src/v1/route/jump-planner.ts';
import { refineGoalGround } from '#@/src/v1/solver/ground-refinement.ts';
import { createDeviceConnections as deviceConnections } from '#@/src/v1/solver/physical/devices.ts';
import { planFollowingRoute } from '#@/src/v1/solver/physical/following-route.ts';
import { movingGround } from '#@/src/v1/solver/physical/moving-ground.ts';
import {
  type SupportBox,
  createMovingRouteAnnotator,
} from '#@/src/v1/solver/physical/moving-route.ts';
export type PhysicalQuery = {
  arrival: GroundArrival & { groundRange?: [number, number] };
  target: Vec3;
  interaction?: InteractionGoal;
  walls: Wall[];
  waypoints?: Vec3[];
};

export interface PhysicalCache {
  memo<T>(
    slot: 'ground' | 'collision' | 'devices' | 'moving' | 'refinement',
    key: string,
    create: () => T | Promise<T>,
  ): Promise<{ value: T; reused: boolean }>;
  release(slot: 'ground' | 'moving'): void;
}
export interface PhysicalResult {
  status: string;
  reason?: string;
  route?: Route;
  connections?: GroundConnection[];
  groundedTarget?: Vec3;
  supportBoxes?: SupportBox[];
}
export interface PhysicalContext {
  generation?: string;
  cache?: PhysicalCache;
  progress?: (progress: Record<string, unknown>) => void;
  emit: (
    result: PhysicalResult,
    optimizing: boolean,
    diagnostics: Record<string, unknown>,
  ) => void | Promise<void>;
  effort?: 'walking' | 'devices' | 'all';
}
const targetSupport = (surfaces: Surface[], target: Vec3) => {
  const nearest = projectPoint(verticalProjectionCandidates(surfaces, target, 0.5), target, {
    maxVertical: 0.5,
  });
  if (nearest) {
    return nearest;
  }
  let below: ReturnType<typeof projectPoint> = null;
  for (const surface of verticalProjectionCandidates(surfaces, target, 4)) {
    const support = projectPoint([surface], target, { maxVertical: 4 });
    if (
      support &&
      support.position[1] <= target[1] &&
      (!below || support.position[1] > below.position[1])
    ) {
      below = support;
    }
  }
  return below;
};

export const solvePhysicalRoute = async (
  input: PhysicalInput,
  request: PhysicalQuery,
  context: PhysicalContext,
  policy: SolverConfig,
): Promise<void> => {
  const { ground, collision, movement: config, devices: deviceInput } = input;
  const started = performance.now();
  const progress = context.progress ?? (() => {});
  const generation = context.generation ?? '';
  const memo = async <T>(
    slot: Parameters<PhysicalCache['memo']>[0],
    key: string,
    create: () => T | Promise<T>,
  ) =>
    context.cache
      ? context.cache.memo(slot, key, create)
      : { value: await create(), reused: false };
  const profile = ground.options.profile;
  const options: GroundOptions & { walls: Wall[] } = {
    ...ground.options,
    maxVertical: 0.5,
    walls: [...ground.options.walls, ...request.walls],
    locomotion: input.locomotion,
  };
  const timing: Record<string, number> = {};
  const limits = {
    maxCandidates: policy.maxCandidates,
    maxLinks: policy.maxLinks,
    sampleSpacing: policy.sampleSpacing,
  };
  const prepareReuse: Record<string, boolean> = {};
  const diagnostics: Record<string, unknown> = {
    prepareReuse,
    limits,
    timingMs: timing,
    truncated: false,
  };
  let collisionQueryStats: (() => unknown) | undefined;
  let annotateMovingRoute: ReturnType<typeof createMovingRouteAnnotator> | undefined;
  const emit = async (
    result: {
      status: string;
      reason?: string;
      route?: Route;
      connections?: GroundConnection[];
      groundedTarget?: Vec3;
      supportBoxes?: SupportBox[];
    },
    optimizing = false,
  ) => {
    if (collisionQueryStats) {
      diagnostics.collisionQueries = collisionQueryStats();
    }
    const annotationStart = performance.now();
    const supportBoxes = [
      ...(result.supportBoxes ?? []),
      ...(result.route && annotateMovingRoute
        ? annotateMovingRoute(result.route, result.connections ?? [])
        : []),
    ];
    if (result.route && annotateMovingRoute) {
      timing.annotations = (timing.annotations ?? 0) + performance.now() - annotationStart;
    }
    timing.total = performance.now() - started;
    await context.emit(
      { ...result, ...(supportBoxes.length ? { supportBoxes } : {}) },
      optimizing,
      diagnostics,
    );
  };
  // Authored landings may settle down by the player's step distance. A factory
  // centre is a volume seed instead: its source bounds explicitly constrain the
  // vertical projection. Neither rule changes general route floor matching.
  const settling = Math.max(0.5, config.stepDown + (ground.build?.cellHeight ?? 0));
  const range = request.arrival.groundRange ?? [
    request.arrival.position[1] - settling,
    request.arrival.position[1] + 0.5,
  ];
  if (
    !Array.isArray(range) ||
    range.length !== 2 ||
    !range.every(Number.isFinite) ||
    range[0] > range[1]
  ) {
    throw new Error('invalid arrival support range');
  }
  const maxVertical = Math.max(
    ...range.map((height) => Math.abs(height - request.arrival.position[1])),
  );
  let supportedStart: ReturnType<typeof projectPoint> = null;
  for (const surface of verticalProjectionCandidates(
    ground.surfaces,
    request.arrival.position,
    maxVertical,
  )) {
    const start = projectPoint([surface], request.arrival.position, { maxVertical });
    if (
      start &&
      start.position[1] >= range[0] &&
      start.position[1] <= range[1] &&
      (!supportedStart ||
        Math.abs(start.position[1] - request.arrival.position[1]) <
          Math.abs(supportedStart.position[1] - request.arrival.position[1]))
    ) {
      supportedStart = start;
    }
  }
  if (!supportedStart || request.arrival.state !== 'available') {
    await emit({
      status: 'unavailable',
      reason: supportedStart ? 'arrival-unavailable' : 'arrival-unmapped',
    });
    return;
  }
  const arrival = { ...request.arrival, position: supportedStart.position };
  diagnostics.arrival = { requested: request.arrival.position, grounded: arrival.position };
  const target = request.interaction ? null : targetSupport(ground.surfaces, request.target);
  const followingTarget = Boolean(deviceInput?.followingSupports?.length);
  const movingTarget = Boolean(
    deviceInput?.movingSupports?.length &&
    ground.build?.bounds &&
    ground.build.cellSize &&
    ground.build.cellHeight,
  );
  if (!request.interaction && !target && !movingTarget && !followingTarget) {
    await emit({ status: 'unavailable', reason: 'target-unmapped' });
    return;
  }
  let goal = target?.position ?? request.target;
  progress({ phase: 'ground-search', surfaces: ground.surfaces.length });
  const groundStart = performance.now();
  let groundKey = JSON.stringify([generation, request.walls]);
  let groundPlanner: ReturnType<typeof createGroundPlanner> | undefined;
  {
    const preparedGround = await memo('ground', groundKey, () =>
      createGroundPlanner(ground.surfaces, { ...options }),
    );
    prepareReuse.ground = preparedGround.reused;
    groundPlanner = preparedGround.value;
  }
  let candidates = groundPlanner.project(goal, {
    maxVertical: 0.5,
    interaction: request.interaction,
  });
  if (!candidates.length && !request.interaction?.airborne && !movingTarget && !followingTarget) {
    await emit({ status: 'unavailable', reason: 'target-region-unmapped' });
    return;
  }
  // Publish supported walking feasibility before indexing airborne collision and
  // spending the optional action-discovery budget. The parent keeps polling for
  // a faster complete route while this atomic provisional result is available.
  let walking = groundPlanner.plan([arrival], goal, {
    interaction: request.interaction,
  });
  if (walking.status !== 'complete') {
    const rounded = input.roundedWalls ?? options.walls;
    if (rounded.some((wall, index) => wall !== options.walls[index])) {
      // Refine conservative occupancy only after it fails to connect the query.
      // Unrelated refinements must not reorder a completed graph's bounded
      // shortcut discovery and displace previously covered action chains.
      options.walls = rounded;
      groundKey = JSON.stringify([generation, rounded]);
      groundPlanner = undefined;
      const prepared = await memo('ground', groundKey, () =>
        createGroundPlanner(ground.surfaces, { ...options }),
      );
      groundPlanner = prepared.value;
      prepareReuse.roundGround = prepared.reused;
      walking = groundPlanner.plan([arrival], goal, { interaction: request.interaction });
      diagnostics.roundOccupancy = { refined: true, groundStatus: walking.status };
    }
  }
  let initialGround: InitialGroundProof = {
    planner: groundPlanner,
    surfaces: ground.surfaces,
    arrival,
    goal,
    interaction: request.interaction,
    connections: [...(options.connections ?? [])],
    route: walking,
  };
  timing.ground = performance.now() - groundStart;
  // Interactive optimization starts from an existing supported route. Bound its
  // optional shortcut comparison separately from unresolved reachability work.
  if (walking.status === 'complete') {
    limits.maxCandidates = Math.min(limits.maxCandidates ?? 640, 640);
    await emit(
      {
        status: 'candidate',
        route: walking,
        connections: [],
        groundedTarget: walking.points.at(-1),
      },
      !(context.effort === 'walking') && !(context.effort === 'devices' && !deviceInput),
    );
    progress({ phase: 'ground-route', cost: walking.cost });
  }
  if (context.effort === 'walking' || (context.effort === 'devices' && !deviceInput)) {
    if (walking.status !== 'complete') {
      await emit({ status: 'unavailable', reason: walking.status });
    }
    return;
  }
  const { model, maxSlope, runAirSpeed } = config;
  if (!Number.isFinite(runAirSpeed) || runAirSpeed < 0) {
    throw new Error('invalid running air-speed limit');
  }
  let minY = Infinity,
    maxY = -Infinity;
  const minXZ = [Infinity, Infinity],
    maxXZ = [-Infinity, -Infinity];
  for (const surface of ground.surfaces) {
    for (const point of surface.vertices) {
      minY = Math.min(minY, point[1]);
      maxY = Math.max(maxY, point[1]);
      minXZ[0] = Math.min(minXZ[0], point[0]);
      minXZ[1] = Math.min(minXZ[1], point[2]);
      maxXZ[0] = Math.max(maxXZ[0], point[0]);
      maxXZ[1] = Math.max(maxXZ[1], point[2]);
    }
  }
  const builtBounds = ground.build?.bounds;
  if (builtBounds !== undefined) {
    if (
      !builtBounds ||
      ![builtBounds.min, builtBounds.max].every(
        (point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite),
      ) ||
      builtBounds.min.some((value, axis) => value > builtBounds.max[axis])
    ) {
      throw new Error('invalid physical ground build bounds');
    }
    // empty air inside the selected collision build remains available to jump arcs.
    // restricting the index to surface extrema can cut off a platform's outside edge.
    minXZ.splice(0, 2, ...builtBounds.min);
    maxXZ.splice(0, 2, ...builtBounds.max);
  }
  const maxDrop = maxY - minY;
  const maximumDuration = jumpDuration(maxDrop, 0, { ...model, mode: 'jump' });
  if (!maximumDuration || !Number.isFinite(maxDrop)) {
    throw new Error('invalid collision vertical extent');
  }
  const maxHorizontalDistance =
    maximumDuration * Math.max(model.maxHorizontalSpeed, model.startHorizontalSpeed);
  diagnostics.model = { ...model, runAirSpeed };
  progress({ phase: 'collision-index', triangles: collision.indices.length / 3 });
  // The complete body and curved-arc chord inflation must remain in the indexed world.
  const curveInflationMargin =
    (Math.hypot(
      Math.max(model.gravity, model.fallingGravity),
      Math.max(model.airAcceleration, model.airDeceleration),
    ) *
      0.1 ** 2) /
      8 +
    0.01;
  const padding = profile.radius + curveInflationMargin;
  const bounds = {
    min: [minXZ[0] - padding, minXZ[1] - padding] as [number, number],
    max: [maxXZ[0] + padding, maxXZ[1] + padding] as [number, number],
  };
  diagnostics.collisionScope = { bounds, padding, curveInflationMargin };
  const indexStart = performance.now();
  const preparedCollision = await memo('collision', JSON.stringify([generation, bounds]), () => {
    const geometry = { positions: collision.positions, indices: collision.indices };
    return { geometry, world: createCollisionWorld(geometry, { bounds }) };
  });
  prepareReuse.collision = preparedCollision.reused;
  const { geometry } = preparedCollision.value;
  let { world } = preparedCollision.value;
  let surfaces = ground.surfaces;
  const initialQueryStats = world.queryCacheStats;
  if (context && initialQueryStats) {
    collisionQueryStats = () => {
      const current = world.queryCacheStats;
      if (!current) {
        return undefined;
      }
      return {
        ...current,
        runHits: current.hits - initialQueryStats.hits,
        runMisses: current.misses - initialQueryStats.misses,
      };
    };
  }

  timing.collision = performance.now() - indexStart;
  let knownRoute = walking;
  let boosts: SpeedBoost[] = [];
  let knownConnections = options.connections ?? [];
  if (deviceInput) {
    progress({ phase: 'device-links' });
    const deviceStart = performance.now();
    const deviceKey = JSON.stringify([groundKey, deviceInput]);
    const preparedDevices = await memo('devices', deviceKey, () =>
      deviceConnections(deviceInput, {
        surfaces: ground.surfaces,
        world,
        model,
        maxSlope,
        profile,
        walls: options.walls,
      }),
    );
    prepareReuse.devices = preparedDevices.reused;
    const devices = preparedDevices.value;
    boosts = devices.boosts;
    options.connections = [...(options.connections ?? []), ...devices.connections];
    diagnostics.devices = devices;
    if (
      walking.status !== 'complete' &&
      deviceInput.movingSupports?.length &&
      ground.build?.bounds &&
      ground.build.cellSize &&
      ground.build.cellHeight
    ) {
      progress({ phase: 'moving-supports', devices: deviceInput.movingSupports.length });
      const movingStart = performance.now();
      const baseProject = groundPlanner.project;
      const moving = await memo('moving', deviceKey, async () => {
        const added = await movingGround(deviceInput.movingSupports!, geometry, world, {
          build: {
            profile,
            maxSlope,
            stepUp: config.stepUp,
            stepDown: config.stepDown,
            cellSize: ground.build!.cellSize!,
            cellHeight: ground.build!.cellHeight!,
            bounds: ground.build!.bounds,
          },
          walls: options.walls,
          surfaces,
          speed: options.speed,
        });
        const combined = [...surfaces, ...added.surfaces];
        if (added.surfaces.length) {
          context.cache?.release('ground');
          groundPlanner = undefined;
        }
        const augmented = added.surfaces.length
          ? deviceConnections(deviceInput, {
              surfaces: combined,
              world: added.world,
              model,
              maxSlope,
              profile,
              walls: options.walls,
            })
          : devices;
        const knownIds = new Set(devices.connections.map((connection) => connection.id));
        return {
          ...added,
          additionalDevices: augmented.connections.filter(
            (connection) => !knownIds.has(connection.id),
          ),
          deviceOutcomes: augmented.outcomes,
          surfaces: combined,
          planner: added.surfaces.length
            ? createGroundPlanner(combined, {
                ...options,
                portals: [...(options.portals ?? []), ...added.portals],
                connections: [],
              })
            : groundPlanner,
        };
      });
      world = moving.value.world;
      surfaces = moving.value.surfaces;
      const annotationStart = performance.now();
      annotateMovingRoute = createMovingRouteAnnotator({
        supports: deviceInput.movingSupports,
        surfaces,
        baseSurfaces: ground.surfaces,
        baseProject,
        sourceFaces: moving.value.sourceFaces,
        tolerance: ground.build.cellHeight * 3,
      });
      timing.annotationPreparation = performance.now() - annotationStart;
      groundPlanner = moving.value.planner;
      options.portals = [...(options.portals ?? []), ...moving.value.portals];
      options.connections = [
        ...options.connections,
        ...moving.value.connections,
        ...moving.value.additionalDevices,
      ];
      diagnostics.movingSupports = {
        assumption: 'phase-free-swept-support',
        addedSurfaces: surfaces.length - ground.surfaces.length,
        connections: moving.value.connections.length,
        additionalDevices: moving.value.additionalDevices.length,
        deviceOutcomes: moving.value.deviceOutcomes,
        outcomes: moving.value.outcomes,
        builds: moving.value.builds,
      };
      timing.moving = performance.now() - movingStart;
      prepareReuse.moving = moving.reused;
    }
    if (!request.interaction) {
      goal = targetSupport(surfaces, request.target)?.position ?? goal;
    }
    let connected = options.connections.length
      ? groundPlanner!.plan([arrival], goal, {
          interaction: request.interaction,
          connections: options.connections,
        })
      : walking;
    // Preserve the raw search baseline before detour pruning changes its cost
    // and therefore the optional jump-discovery comparison and sampling budget.
    if (options.connections.length)
      initialGround = {
        planner: groundPlanner!,
        surfaces,
        arrival,
        goal,
        interaction: request.interaction,
        connections: [...options.connections],
        route: connected,
      };
    if (connected.status === 'complete' && groundPlanner) {
      const comparison = pruneGroundDetours(connected, groundPlanner, input.locomotion);
      connected = comparison.route;
      diagnostics.deviceDetours = {
        replacements: comparison.replacements,
        queries: comparison.queries,
      };
    }
    if (
      connected.status === 'complete' &&
      (knownRoute.status !== 'complete' || connected.cost < knownRoute.cost)
    ) {
      knownRoute = connected;
      knownConnections = options.connections;
    }
    timing.devices = performance.now() - deviceStart - (timing.moving ?? 0);
    if (connected.status === 'complete') {
      limits.maxCandidates = Math.min(limits.maxCandidates ?? 640, 640);
      if (walking.status !== 'complete' || connected.cost < walking.cost) {
        await emit(
          {
            status: 'candidate',
            route: connected,
            connections: options.connections,
            groundedTarget: connected.points.at(-1),
          },
          !(context.effort === 'devices'),
        );
      }
    }
  }
  const followingFallback = async () => {
    if (!deviceInput?.followingSupports?.length) {
      return null;
    }
    progress({ phase: 'following-supports', devices: deviceInput.followingSupports.length });
    const followingStart = performance.now();
    if (!ground.build?.bounds || !ground.build.cellSize || !ground.build.cellHeight) {
      diagnostics.followingSupports = { reason: 'bounded-ground-build-required' };
      return null;
    }
    const following = await planFollowingRoute(
      deviceInput.followingSupports,
      geometry,
      world,
      [arrival],
      goal,
      {
        surfaces,
        build: {
          profile,
          maxSlope,
          stepUp: config.stepUp,
          stepDown: config.stepDown,
          cellSize: ground.build.cellSize,
          cellHeight: ground.build.cellHeight,
          bounds: ground.build.bounds,
        },
        jump: {
          ...options,
          interaction: request.interaction,
          runAirSpeed,
          maxSlope,
          maxDrop,
          maxHorizontalDistance,
          ...limits,
          model,
        },
        onProgress: progress,
      },
    );
    diagnostics.followingSupports = following.diagnostics;
    diagnostics.truncated = diagnostics.truncated === true || following.diagnostics.truncated;
    timing.following = performance.now() - followingStart;
    return following.route.status === 'complete' ? following : null;
  };
  if (context.effort === 'devices') {
    if (knownRoute.status === 'complete') {
      await emit({
        status: 'candidate',
        route: knownRoute,
        connections: knownConnections,
        groundedTarget: knownRoute.points.at(-1),
      });
    } else {
      const following = await followingFallback();
      if (following) {
        await emit({
          status: 'candidate',
          route: following.route,
          connections: following.connections,
          supportBoxes: following.supportBoxes,
          groundedTarget:
            following.route.status === 'complete' ? following.route.points.at(-1) : undefined,
        });
      } else {
        await emit({ status: 'unavailable', reason: knownRoute.status });
      }
    }
    return;
  }
  if (
    ground.build?.cellSize !== undefined &&
    ground.build.cellHeight !== undefined &&
    ground.build.bounds
  ) {
    progress({ phase: 'goal-refinement' });
    const refineStart = performance.now();
    const refinementBuild = {
      profile,
      maxSlope,
      stepUp: config.stepUp,
      stepDown: config.stepDown,
      cellSize: ground.build.cellSize,
      cellHeight: ground.build.cellHeight,
      bounds: ground.build.bounds,
    };
    const preparedRefinement = await memo(
      'refinement',
      JSON.stringify([groundKey, goal, request.interaction, model, surfaces.length]),
      async () => {
        if (!groundPlanner) {
          throw new Error('missing coarse ground preparation');
        }
        const refined = await refineGoalGround(geometry, surfaces, {
          build: refinementBuild,
          goal,
          interaction: request.interaction,
          model,
          project: groundPlanner.project,
          queryTriangles: world.trianglesInBounds?.bind(world),
        });
        if (refined.surfaces.length) {
          const combined = [...surfaces, ...refined.surfaces];
          // Retain coarse preparation beside bounded target refinements. This
          // avoids rebuilding shared geometry as independent queries alternate;
          // binding and wall changes still invalidate the derived preparations.
          groundPlanner = undefined;
          context.cache?.release('moving');
          return {
            refined,
            surfaces: combined,
            planner: createGroundPlanner(combined, { ...options, connections: [] }),
          };
        }
        return { refined, surfaces, planner: groundPlanner };
      },
    );
    prepareReuse.refinement = preparedRefinement.reused;
    const { refined } = preparedRefinement.value;
    surfaces = preparedRefinement.value.surfaces;
    groundPlanner = preparedRefinement.value.planner;
    diagnostics.refinement = { bounds: refined.bounds, addedSurfaces: refined.surfaces.length };
    timing.refinement = performance.now() - refineStart;
  }
  if (movingTarget) {
    if (!request.interaction) {
      const mapped = targetSupport(surfaces, request.target);
      if (!mapped && !followingTarget) {
        await emit({ status: 'unavailable', reason: 'target-unmapped' });
        return;
      }
      goal = mapped?.position ?? goal;
    }
    candidates = groundPlanner!.project(goal, {
      maxVertical: 0.5,
      interaction: request.interaction,
    });
    if (!candidates.length && !request.interaction?.airborne && !followingTarget) {
      await emit({ status: 'unavailable', reason: 'target-region-unmapped' });
      return;
    }
  }
  registerCatalogSurfaces(
    surfaces,
    deviceInput?.movingSupports?.length || followingTarget ? null : ground.surfaces,
    ground.options.portals,
  );
  progress({ phase: 'jump-discovery', goalFaces: candidates.length });
  const searchStart = performance.now();
  const result = planJumpRoute(
    surfaces,
    world,
    [arrival],
    goal,
    {
      ...options,
      boosts,
      groundPlanner,
      interaction: request.interaction,
      runAirSpeed,
      maxSlope,
      maxDrop,
      maxHorizontalDistance,
      ...limits,
      maxShortcutCandidates: policy.maxShortcutCandidates,
      waypoints: request.waypoints,
      onProgress: progress,
      model,
    },
    initialGround,
  );
  timing.search = performance.now() - searchStart;
  Object.assign(diagnostics, result.diagnostics);
  let { route, connections } = result;
  if (
    knownRoute.status === 'complete' &&
    (route.status !== 'complete' || knownRoute.cost < route.cost)
  ) {
    route = knownRoute;
    connections = knownConnections;
  }
  if (route.status === 'complete' && groundPlanner) {
    const comparisonStart = performance.now();
    const comparison = pruneGroundDetours(route, groundPlanner, input.locomotion);
    route = comparison.route;
    diagnostics.groundDetours = {
      replacements: comparison.replacements,
      queries: comparison.queries,
    };
    timing.groundDetours = performance.now() - comparisonStart;
  }
  progress({ phase: 'route-search', connections: connections.length });
  if (route.status === 'complete') {
    await emit({ status: 'candidate', route, connections, groundedTarget: route.points.at(-1) });
  } else {
    const following = await followingFallback();
    if (following) {
      await emit({
        status: 'candidate',
        route: following.route,
        connections: following.connections,
        supportBoxes: following.supportBoxes,
        groundedTarget:
          following.route.status === 'complete' ? following.route.points.at(-1) : undefined,
      });
    } else {
      await emit({ status: 'unavailable', reason: route.status, connections });
    }
  }
};
