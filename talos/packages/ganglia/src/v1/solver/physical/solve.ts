import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import { physicalTileSpan } from '#@/src/model/coverage.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { SpeedBoost, InteractionGoal } from '#@/src/movement.ts';
import type { GroundArrival, GroundConnection, GroundOptions, Route } from '#@/src/route.ts';
import type { GangliaV1Config as SolverConfig } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { verticalProjectionCandidates } from '#@/src/v1/geo/support-projector.ts';
import { projectPoint } from '#@/src/v1/geo/surfaces.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
import { actionCatalogStats } from '#@/src/v1/route/action-catalog.ts';
import { registerCatalogSurfaces } from '#@/src/v1/route/action-catalog.ts';
import { pruneGroundDetours } from '#@/src/v1/route/ground-detours.ts';
import { createGroundPlanner, createOverlayGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type InitialGroundProof } from '#@/src/v1/route/jump-planner.ts';
import { narrowGoalSupports, refineGoalGround } from '#@/src/v1/solver/ground-refinement.ts';
import {
  createDeviceConnections,
  prepareDeviceConnections,
} from '#@/src/v1/solver/physical/devices.ts';
import { planFollowingRoute } from '#@/src/v1/solver/physical/following-route.ts';
import { prepareMovingDirect } from '#@/src/v1/solver/physical/moving-direct.ts';
import { movingGround } from '#@/src/v1/solver/physical/moving-ground.ts';
import {
  type SupportBox,
  createMovingRouteAnnotator,
} from '#@/src/v1/solver/physical/moving-route.ts';
import type { CacheScope, CacheStats } from '#@/src/v1/solver/physical/preparation.ts';
import {
  sourceContact as admitSourceContact,
  proveSourceContact,
} from '#@/src/v1/solver/physical/source-contact.ts';
type Devices = ReturnType<typeof prepareDeviceConnections> & {
  direct?: ReturnType<typeof prepareMovingDirect>;
};

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
    create: (reserve?: (surfaces: number) => void) => T | Promise<T>,
    scope?: CacheScope,
  ): Promise<{ value: T; reused: boolean }>;
  release(slot: 'ground' | 'moving'): void;
  begin?(generation: string): void;
  stats?(): CacheStats;
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
  checkpoint?: () => Promise<void>;
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
  const { collision, movement: config, devices: deviceInput } = input;
  let ground = input.ground;
  const started = performance.now();
  const progress = context.progress ?? (() => {});
  const generation = context.generation ?? '';
  context.cache?.begin?.(generation);
  let sourceKey: unknown;
  const groundView = (walls: Wall[]) =>
    JSON.stringify(sourceKey ? [generation, walls, sourceKey] : [generation, walls]);
  let groundKey = groundView(request.walls);
  const memo = async <T>(
    slot: Parameters<PhysicalCache['memo']>[0],
    key: string,
    create: (reserve?: (surfaces: number) => void) => T | Promise<T>,
    parent?: object,
  ) =>
    context.cache
      ? context.cache.memo(slot, key, create, { view: groundKey, ...(parent ? { parent } : {}) })
      : { value: await create(), reused: false };
  const profile = ground.options.profile;
  const options: GroundOptions & { walls: Wall[] } = {
    ...ground.options,
    maxVertical: 0.5,
    walls: [...ground.options.walls, ...request.walls],
    locomotion: input.locomotion,
  };
  const timing: Record<string, number> = {};
  const training = actionCatalogStats().phase === 'training';
  const limits = {
    maxCandidates: training
      ? (policy.preparation.catalogCandidates ?? policy.maxCandidates)
      : policy.maxCandidates,
    maxLinks: training ? (policy.preparation.catalogLinks ?? policy.maxLinks) : policy.maxLinks,
    sampleSpacing: policy.sampleSpacing,
  };
  const prepareReuse: Record<string, boolean> = {};
  const diagnostics: Record<string, unknown> = {
    prepareReuse,
    limits,
    timingMs: timing,
    truncated: false,
  };
  let directCandidate: PhysicalResult | undefined;
  let incumbent: PhysicalResult | undefined;
  let hasCompleteCandidate = false;
  let contact: Extract<ReturnType<typeof admitSourceContact>, { status: 'accepted' }> | undefined;
  const plannerFor = (surfaces: Surface[], settings: GroundOptions) =>
    createGroundPlanner(
      surfaces,
      contact && context.effort === 'walking' ? { ...settings, connections: [] } : settings,
    );
  const prepareTerrain = async (extent: { min: [number, number]; max: [number, number] }) => {
    const model = config.model;
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
      min: extent.min.map((v) => v - padding) as [number, number],
      max: extent.max.map((v) => v + padding) as [number, number],
    };
    const prepared = await memo('collision', JSON.stringify([generation, bounds]), () => {
      const geometry = { positions: collision.positions, indices: collision.indices };
      return { geometry, world: createCollisionWorld(geometry, { bounds }) };
    });
    return { ...prepared, scope: { bounds, padding, curveInflationMargin } };
  };
  let earlyCollision: Awaited<ReturnType<typeof prepareTerrain>> | undefined;
  let sourceCollisionMs = 0;
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
    if (contact && result.route?.status === 'complete') {
      const proved = proveSourceContact(result.route, contact);
      result =
        proved.status === 'complete'
          ? { ...result, route: proved, groundedTarget: proved.points.at(-1) }
          : {
              status: 'unavailable',
              reason: 'source-contact-unproved',
              connections: result.connections,
            };
    }
    if (
      directCandidate &&
      incumbent?.route?.status === 'complete' &&
      (result.route?.status !== 'complete' || result.route.cost >= incumbent.route.cost)
    )
      result = incumbent;
    if (collisionQueryStats) {
      diagnostics.collisionQueries = collisionQueryStats();
    }
    const annotationStart = performance.now();
    const supportBoxes = [
      ...(result.supportBoxes ?? []),
      ...(result !== directCandidate && result !== incumbent && result.route && annotateMovingRoute
        ? annotateMovingRoute(result.route, result.connections ?? [])
        : []),
    ];
    if (result.route && annotateMovingRoute) {
      timing.annotations = (timing.annotations ?? 0) + performance.now() - annotationStart;
    }
    timing.total = performance.now() - started;
    if (context.cache?.stats) diagnostics.prepareCache = context.cache.stats();
    const candidate = { ...result, ...(supportBoxes.length ? { supportBoxes } : {}) };
    if (candidate.route?.status === 'complete') hasCompleteCandidate = true;
    if (directCandidate && candidate.route?.status === 'complete') incumbent = candidate;
    await context.emit(candidate, optimizing, diagnostics);
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
  const projectArrival = (surfaces: Surface[]) => {
    let supportedStart: ReturnType<typeof projectPoint> = null;
    for (const surface of verticalProjectionCandidates(
      surfaces,
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
    return supportedStart;
  };
  const movingTarget = Boolean(
    deviceInput?.movingSupports?.length &&
    ground.build?.bounds &&
    ground.build.cellSize &&
    ground.build.cellHeight,
  );
  let supportedStart = projectArrival(ground.surfaces);
  const movingSources = new Set<number>();
  const directSources = new Set<number>();
  for (const [index, support] of (deviceInput?.movingSupports ?? []).entries()) {
    // Provider identity retains the original source even when a coarse static
    // face also projects beneath it. Direct planning still checks its contacts.
    if (support.id === request.arrival.id) directSources.add(index);
  }
  if (!supportedStart && movingTarget) {
    // Source contact faces only defer admission. Swept pose bounds do not prove
    // support; the existing clearance-baked moving preparation must confirm it.
    for (const [index, support] of deviceInput!.movingSupports!.entries()) {
      if (support.assumption !== 'phase-free-swept-support') continue;
      const start = projectArrival(support.surfaces);
      if (!start) continue;
      movingSources.add(index);
      directSources.add(index);
      if (
        !supportedStart ||
        Math.abs(start.position[1] - request.arrival.position[1]) <
          Math.abs(supportedStart.position[1] - request.arrival.position[1])
      )
        supportedStart = start;
    }
  }
  const movingArrival = movingSources.size > 0;
  progress({
    phase: 'source-admission',
    arrival: request.arrival,
    target: request.target,
    effort: context.effort ?? 'all',
    grounded: supportedStart?.position,
    movingSources: [...movingSources],
    directSources: [...directSources],
  });
  if (
    !supportedStart &&
    request.arrival.state === 'available' &&
    ground.build?.bounds &&
    ground.tiles
  ) {
    await context.checkpoint?.();
    const contactStart = performance.now();
    progress({ phase: 'source-contact' });
    const collisionStart = performance.now();
    earlyCollision = await prepareTerrain(ground.build.bounds);
    sourceCollisionMs = performance.now() - collisionStart;
    timing.collision = sourceCollisionMs;
    diagnostics.collisionScope = earlyCollision.scope;
    prepareReuse.collision = earlyCollision.reused;
    const walls = input.roundedWalls ? [...input.roundedWalls, ...request.walls] : options.walls;
    const admitted = admitSourceContact(input, request.arrival, range, earlyCollision.value, walls);
    diagnostics.sourceContact =
      admitted.status === 'accepted'
        ? {
            status: admitted.status,
            kind: admitted.kind,
            triangle: admitted.triangle,
            position: admitted.arrival.position,
          }
        : admitted;
    timing.sourceContact = performance.now() - contactStart;
    if (admitted.status === 'accepted') {
      contact = admitted;
      options.walls = walls;
      ground = { ...ground, surfaces: [...ground.surfaces, contact.surface] };
      supportedStart = { surface: contact.surface.id, position: contact.arrival.position };
      sourceKey = [request.arrival, contact.surface, context.effort ?? 'all'];
      groundKey = groundView(request.walls);
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
  if (!movingArrival)
    diagnostics.arrival = { requested: request.arrival.position, grounded: arrival.position };
  const target = request.interaction ? null : targetSupport(ground.surfaces, request.target);
  const followingTarget = Boolean(deviceInput?.followingSupports?.length);
  if (!request.interaction && !target && !movingTarget && !followingTarget) {
    await emit({ status: 'unavailable', reason: 'target-unmapped' });
    return;
  }
  let goal = target?.position ?? request.target;
  await context.checkpoint?.();
  progress({ phase: 'ground-search', surfaces: ground.surfaces.length });
  const groundStart = performance.now();
  let groundPlanner: ReturnType<typeof createGroundPlanner> | undefined;
  {
    const preparedGround = await memo('ground', groundKey, (reserve) => {
      reserve?.(ground.surfaces.length);
      return plannerFor(ground.surfaces, { ...options });
    });
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
  let walking: Route = movingArrival
    ? { status: 'unmapped' }
    : groundPlanner.plan([arrival], goal, {
        interaction: request.interaction,
      });
  if (walking.status !== 'complete' && !movingArrival) {
    const rounded = input.roundedWalls ?? options.walls;
    if (rounded.some((wall, index) => wall !== options.walls[index])) {
      // Refine conservative occupancy only after it fails to connect the query.
      // Unrelated refinements must not reorder a completed graph's bounded
      // shortcut discovery and displace previously covered action chains.
      options.walls = rounded;
      groundKey = groundView(rounded);
      groundPlanner = undefined;
      const prepared = await memo('ground', groundKey, (reserve) => {
        reserve?.(ground.surfaces.length);
        return plannerFor(ground.surfaces, { ...options });
      });
      groundPlanner = prepared.value;
      prepareReuse.roundGround = prepared.reused;
      walking = groundPlanner.plan([arrival], goal, { interaction: request.interaction });
      diagnostics.roundOccupancy = { refined: true, groundStatus: walking.status };
    }
  }
  let initialGround: InitialGroundProof | undefined = {
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
    await context.checkpoint?.();
    progress({ phase: 'ground-route', cost: walking.cost });
  }
  if (
    !movingArrival &&
    (context.effort === 'walking' || (context.effort === 'devices' && !deviceInput))
  ) {
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
  await context.checkpoint?.();
  progress({ phase: 'collision-index', triangles: collision.indices.length / 3 });
  const indexStart = performance.now();
  const preparedCollision =
    earlyCollision ??
    (await prepareTerrain({ min: minXZ as [number, number], max: maxXZ as [number, number] }));
  diagnostics.collisionScope = preparedCollision.scope;
  prepareReuse.collision = preparedCollision.reused;
  const { geometry } = preparedCollision.value;
  let world = contact?.world ?? preparedCollision.value.world;
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

  timing.collision = sourceCollisionMs + performance.now() - indexStart;
  let knownRoute = walking;
  let boosts: SpeedBoost[] = [];
  let knownConnections = options.connections ?? [];
  let terminalLaunches: GroundConnection[] | undefined;
  if (deviceInput) {
    await context.checkpoint?.();
    progress({ phase: 'device-links' });
    const deviceStart = performance.now();
    const deviceKey = JSON.stringify([groundKey, deviceInput]);
    const preparedDevices = await memo<Devices>('devices', deviceKey, () =>
      prepareDeviceConnections(deviceInput, {
        surfaces: ground.surfaces,
        world,
        model,
        maxSlope,
        runAirSpeed,
        profile,
        walls: options.walls,
        project: groundPlanner?.project,
      }),
    );
    prepareReuse.devices = preparedDevices.reused;
    const prepared = preparedDevices.value;
    const devices = prepared.facts;
    if (request.interaction?.airborne && (!context.effort || context.effort === 'all')) {
      terminalLaunches = prepared.terminalLaunches(goal, request.interaction);
      if (terminalLaunches.length) diagnostics.terminalLaunches = terminalLaunches.length;
    }
    if (directSources.size && context.effort !== 'walking') {
      await context.checkpoint?.();
      progress({ phase: 'moving-direct' });
      const directStart = performance.now();
      prepareReuse.direct = Boolean(prepared.direct);
      const direct = (prepared.direct ??= prepareMovingDirect(
        { ...input, collision: geometry },
        preparedCollision.value,
        options.walls,
        groundPlanner.project,
      ));
      timing.directPreparation = performance.now() - directStart;
      const searchStart = performance.now(),
        candidate = direct.plan(request, directSources);
      timing.directSearch = performance.now() - searchStart;
      diagnostics.directMoving = direct.diagnostics;
      if (candidate.route.status === 'complete') {
        const annotationStart = performance.now();
        const supportBoxes = direct.annotate(candidate.route, candidate.connections);
        timing.directAnnotations = performance.now() - annotationStart;
        directCandidate = {
          status: 'candidate',
          route: candidate.route,
          connections: candidate.connections,
          supportBoxes,
          groundedTarget: candidate.route.points.at(-1),
        };
        if (knownRoute.status !== 'complete' || candidate.route.cost < knownRoute.cost) {
          knownRoute = candidate.route;
          knownConnections = candidate.connections;
        }
        await emit(directCandidate, true);
      }
    }
    boosts = devices.boosts;
    options.connections = [...(options.connections ?? []), ...devices.connections];
    // The preparation also owns callable direct-search caches. Reports cross
    // worker boundaries and retain only the device facts and outcomes.
    diagnostics.devices = {
      connections: devices.connections,
      boosts: devices.boosts,
      outcomes: devices.outcomes,
      snapshot: devices.snapshot,
      motionValidation: devices.motionValidation,
    };
    if (
      walking.status !== 'complete' &&
      deviceInput.movingSupports?.length &&
      ground.build?.bounds &&
      ground.build.cellSize &&
      ground.build.cellHeight
    ) {
      await context.checkpoint?.();
      progress({ phase: 'moving-supports', devices: deviceInput.movingSupports.length });
      const movingStart = performance.now();
      const baseProject = groundPlanner.project;
      const moving = await memo('moving', deviceKey, async (reserve) => {
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
          baseProject,
          speed: options.speed,
          checkpoint: context.checkpoint,
        });
        const combined = added.surfaces.length ? [...surfaces, ...added.surfaces] : surfaces;
        const portals = added.portals.length
          ? [...(options.portals ?? []), ...added.portals]
          : options.portals;
        const basePlanner = groundPlanner;
        if (added.surfaces.length) {
          // The seed proof is reusable only with this exact planner and mesh.
          // Do not retain its replaced heavy graph through the full search.
          initialGround = undefined;
          groundPlanner = undefined;
        }
        reserve?.(combined.length);
        const movingOptions = {
          ...options,
          portals,
          connections: [],
        };
        const movingPlanner = added.surfaces.length
          ? basePlanner
            ? createOverlayGroundPlanner(
                basePlanner,
                combined,
                added.surfaces,
                [],
                movingOptions,
                undefined,
                added.portals,
              )
            : plannerFor(combined, movingOptions)
          : basePlanner;
        const augmented = added.surfaces.length
          ? createDeviceConnections(deviceInput, {
              surfaces: combined,
              world: added.world,
              model,
              maxSlope,
              runAirSpeed,
              profile,
              walls: options.walls,
              project: movingPlanner?.project,
            })
          : devices;
        const knownIds = new Set(devices.connections.map((connection) => connection.id));
        return {
          ...added,
          portals,
          additionalDevices: augmented.connections.filter(
            (connection) => !knownIds.has(connection.id),
          ),
          deviceOutcomes: augmented.outcomes,
          surfaces: combined,
          planner: movingPlanner,
        };
      });
      if (
        initialGround &&
        (initialGround.planner !== moving.value.planner ||
          initialGround.surfaces !== moving.value.surfaces)
      )
        initialGround = undefined;
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
      options.portals = moving.value.portals;
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
      if (movingArrival) {
        const mapped = projectArrival(
          surfaces.filter((surface) =>
            moving.value.sourceFaces
              .get(surface.id)
              ?.some((source) => movingSources.has(source.support)),
          ),
        );
        const hit =
          mapped &&
          world.groundAt(mapped.position, {
            maxUp: ground.build.cellHeight * 3,
            maxDown: ground.build.cellHeight * 3,
            maxSlope,
            radius: profile.radius,
          });
        const feet: Vec3 | null = hit && [hit.position[0], hit.position[1] + 0.01, hit.position[2]];
        if (
          !mapped ||
          !feet ||
          !hit ||
          hit.position[1] < range[0] ||
          hit.position[1] > range[1] ||
          createWallChecker(options.walls, profile)(feet, feet) ||
          world.sweepCapsule(feet, feet, profile)
        ) {
          await emit({ status: 'unavailable', reason: 'arrival-unmapped' });
          return;
        }
        arrival.position = mapped.position;
        diagnostics.arrival = { requested: request.arrival.position, grounded: arrival.position };
      }
    }
    if (!request.interaction) {
      goal = targetSupport(surfaces, request.target)?.position ?? goal;
    }
    if (movingArrival && context.effort === 'walking') {
      const route = groundPlanner!.plan([arrival], goal, { interaction: request.interaction });
      await emit(
        route.status === 'complete'
          ? { status: 'candidate', route, connections: [], groundedTarget: route.points.at(-1) }
          : { status: 'unavailable', reason: route.status },
      );
      return;
    }
    let connected =
      options.connections.length || movingArrival
        ? groundPlanner!.plan([arrival], goal, {
            interaction: request.interaction,
            connections: options.connections,
          })
        : walking;
    // Preserve the raw search baseline before detour pruning changes its cost
    // and therefore the optional jump-discovery comparison and sampling budget.
    if (options.connections.length || movingArrival)
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
    await context.checkpoint?.();
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
          groundPlanner,
          interaction: request.interaction,
          runAirSpeed,
          maxSlope,
          maxDrop,
          maxHorizontalDistance,
          ...limits,
          model,
        },
        onProgress: progress,
        checkpoint: context.checkpoint,
        firstFeasible: context.effort === 'devices',
        onCandidate: async (candidate) => {
          if (candidate.route.status === 'complete')
            await emit(
              {
                status: 'candidate',
                route: candidate.route,
                connections: candidate.connections,
                supportBoxes: candidate.supportBoxes,
                groundedTarget: candidate.route.points.at(-1),
              },
              true,
            );
        },
      },
    );
    diagnostics.followingSupports = following.diagnostics;
    if (
      following.diagnostics.outcomes.some(
        (entry) => entry.reason === 'original-body-outside-collision-scope',
      )
    )
      diagnostics.needsFollowingSourceCoverage = true;
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
    await context.checkpoint?.();
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
      async (reserve) => {
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
          // The shared planner budget decides whether coarse preparation can
          // remain resident beside this target refinement.
          initialGround = undefined;
          groundPlanner = undefined;
          reserve?.(combined.length);
          return {
            refined,
            surfaces: combined,
            portals: options.portals,
            planner: plannerFor(combined, { ...options, connections: [] }),
          };
        }
        reserve?.(surfaces.length);
        return { refined, surfaces, portals: options.portals, planner: groundPlanner };
      },
      surfaces,
    );
    prepareReuse.refinement = preparedRefinement.reused;
    const { refined } = preparedRefinement.value;
    if (
      initialGround &&
      (initialGround.planner !== preparedRefinement.value.planner ||
        initialGround.surfaces !== preparedRefinement.value.surfaces)
    )
      initialGround = undefined;
    surfaces = preparedRefinement.value.surfaces;
    groundPlanner = preparedRefinement.value.planner;
    options.portals = preparedRefinement.value.portals;
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
  await context.checkpoint?.();
  progress({ phase: 'jump-discovery', goalFaces: candidates.length });
  const runSearch = async (args: Parameters<typeof planJumpRoute>) => {
    const pending: Promise<void>[] = [];
    let emissionFailed = false,
      emissionError: unknown,
      searchFailed = false;
    args[4] = {
      ...args[4],
      onCandidate(candidate) {
        // Emit enters the prepared solver synchronously, before its first await.
        // Observe rejections immediately while the native search remains synchronous.
        pending.push(
          emit(
            {
              status: 'candidate',
              ...candidate,
              groundedTarget:
                candidate.route.status === 'complete' ? candidate.route.points.at(-1) : undefined,
            },
            true,
          ).catch((error: unknown) => {
            if (!emissionFailed) emissionError = error;
            emissionFailed = true;
          }),
        );
      },
    };
    const started = performance.now();
    try {
      const result = planJumpRoute(...args);
      return { result, searchMs: performance.now() - started };
    } catch (error) {
      searchFailed = true;
      throw error;
    } finally {
      await Promise.all(pending);
      if (!searchFailed && emissionFailed) throw emissionError;
    }
  };
  const { result, searchMs } = await runSearch([
    surfaces,
    world,
    [arrival],
    goal,
    {
      ...options,
      boosts,
      groundPlanner,
      interaction: request.interaction,
      terminalLaunches,
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
  ]);
  timing.search = searchMs;
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
  await context.checkpoint?.();
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
      if (
        !hasCompleteCandidate &&
        ground.build?.bounds &&
        ground.build.cellSize &&
        ground.build.cellHeight
      ) {
        await context.checkpoint?.();
        const fallbackStart = performance.now();
        progress({ phase: 'narrow-supports' });
        const physical = createPhysicalWorld(
          { ...input, collision: geometry, roundedWalls: options.walls },
          ground.tiles
            ? { bounds: ground.build.bounds, tiles: ground.tiles, tileSpan: physicalTileSpan }
            : 'complete',
          preparedCollision.value,
        );
        const added = narrowGoalSupports(geometry, surfaces, {
          build: {
            ...ground.build,
            cellSize: ground.build.cellSize,
            cellHeight: ground.build.cellHeight,
            profile,
            maxSlope,
            stepUp: config.stepUp,
            stepDown: config.stepDown,
          },
          goal,
          interaction: request.interaction,
          model,
          project: groundPlanner!.project,
          physical,
          maxCandidates: Math.min(256, limits.maxCandidates ?? 640),
          queryTriangles: preparedCollision.value.world.trianglesInBounds,
        });
        const fallbackDiagnostics: Record<string, unknown> = {
          charts: added.diagnostics,
          extraPasses: 0,
          perPassLimits: limits,
          truncated: added.diagnostics.truncated,
        };
        diagnostics.narrowSupportFallback = fallbackDiagnostics;
        if (added.surfaces.length) {
          const combined = [...surfaces, ...added.surfaces];
          const connections = [
            ...new Map(
              [...(options.connections ?? []), ...result.connections].map((c) => [c.id, c]),
            ).values(),
          ];
          const fallbackOptions = { ...options, connections };
          // Release local owners before reservation can evict the preceding
          // graph. Validated actions and immutable input geometry remain shared.
          initialGround = undefined;
          groundPlanner = undefined;
          const preparedFallback = await memo(
            'refinement',
            JSON.stringify([
              groundKey,
              'narrow-supports',
              goal,
              request.interaction,
              model,
              added.surfaces,
              connections,
            ]),
            (reserve) => {
              reserve?.(combined.length);
              return {
                surfaces: combined,
                planner: createGroundPlanner(combined, fallbackOptions),
              };
            },
            surfaces,
          );
          prepareReuse.narrowSupportFallback = preparedFallback.reused;
          fallbackDiagnostics.extraPasses = 1;
          // Missing source support changes the proposal geometry. Preserve the
          // failed pass and its validated actions; this is one charged extra
          // pass with the existing limits, rather than a larger search quota.
          const { result: fallback } = await runSearch([
            preparedFallback.value.surfaces,
            world,
            [arrival],
            goal,
            {
              ...fallbackOptions,
              boosts,
              groundPlanner: preparedFallback.value.planner,
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
          ]);
          fallbackDiagnostics.discovery = fallback.diagnostics;
          fallbackDiagnostics.truncated =
            added.diagnostics.truncated || fallback.diagnostics.truncated;
          const candidate = fallback.route;
          fallbackDiagnostics.status = candidate.status;
          timing.narrowSupportFallback = performance.now() - fallbackStart;
          diagnostics.truncated ||= Boolean(fallbackDiagnostics.truncated);
          await context.checkpoint?.();
          if (candidate.status === 'complete') {
            await emit({
              status: 'candidate',
              route: candidate,
              connections: fallback.connections,
              groundedTarget: candidate.points.at(-1),
            });
            return;
          }
        } else {
          timing.narrowSupportFallback = performance.now() - fallbackStart;
          diagnostics.truncated ||= added.diagnostics.truncated;
        }
      }
      await emit({ status: 'unavailable', reason: route.status, connections });
    }
  }
};
