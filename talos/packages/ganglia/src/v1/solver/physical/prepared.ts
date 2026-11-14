import { buildGroundSurfaces, buildGroundTiles } from '#@/src/build.ts';
import { verifyRoute } from '#@/src/evaluation/route.ts';
import { projectPoint } from '#@/src/model/support.ts';
import { createPhysicalWorld, type Coverage } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SolveOptions,
} from '#@/src/solver/contract.ts';
import type { GangliaV1Config as SolverConfig } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import type { CandidateQuery, EvaluateCandidate } from '#@/src/v1/route/candidate.ts';
import { validateWaypoints } from '#@/src/v1/route/jump-planner.ts';
import { executeRoute, type ExecutionFailure } from '#@/src/v1/solver/physical/execution.ts';
import { localGround } from '#@/src/v1/solver/physical/local-ground.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import {
  solvePhysicalRoute,
  type PhysicalCache,
  type PhysicalContext,
} from '#@/src/v1/solver/physical/solve.ts';
import { releaseSupportCaches } from '#@/src/v1/solver/physical/support-cache.ts';

function coverageOf(input: PhysicalInput): Coverage {
  const { build, tiles } = input.ground;
  if (tiles === undefined) return 'complete';
  if (!build?.bounds || !build.cellSize || !build.tileCells)
    throw new Error('Physical tile coverage requires build bounds and tile dimensions');
  return { bounds: build.bounds, tiles, tileSpan: build.cellSize * build.tileCells };
}

type Repair = {
  attempted: boolean;
  input?: PhysicalInput;
  elapsedMs?: number;
  omittedConnections?: number;
  pending?: Promise<void>;
};
async function rebuild(
  input: PhysicalInput,
): Promise<{ input: PhysicalInput; omittedConnections: number } | undefined> {
  const build = input.ground.build;
  if (
    !build?.bounds ||
    !build.cellSize ||
    !build.cellHeight ||
    (build.tileCells !== undefined && input.ground.tiles === undefined) ||
    input.ground.tiles?.length === 0 ||
    !input.collision.indices.length
  )
    return undefined;
  const options = {
    bounds: build.bounds,
    cellSize: build.cellSize,
    cellHeight: build.cellHeight,
    profile: input.ground.options.profile,
    maxSlope: input.movement.maxSlope,
    stepUp: input.movement.stepUp,
    stepDown: input.movement.stepDown,
  };
  const rebuilt = input.ground.tiles
    ? await buildGroundTiles(input.collision, {
        ...options,
        tileCells: build.tileCells!,
        tiles: input.ground.tiles,
      })
    : { surfaces: await buildGroundSurfaces(input.collision, options), portals: [] };
  const surfaces = rebuilt.surfaces.map((surface) => ({
    ...surface,
    id: 'physical-repair/' + surface.id,
  }));
  const portals = rebuilt.portals.map((portal) => ({
    ...portal,
    from: 'physical-repair/' + portal.from,
    to: 'physical-repair/' + portal.to,
  }));
  let omittedConnections = 0;
  const connections = input.ground.options.connections?.flatMap((connection) => {
    const attach = (position: import('#@/src/geometry.ts').Vec3) =>
      projectPoint(surfaces, position, { maxVertical: input.ground.options.maxVertical })?.surface;
    const fromSurface = connection.fromSurface ? attach(connection.points[0]) : undefined;
    const toSurface = connection.toSurface ? attach(connection.points.at(-1)!) : undefined;
    if ((connection.fromSurface && !fromSurface) || (connection.toSurface && !toSurface)) {
      omittedConnections++;
      return [];
    }
    return [{ ...connection, fromSurface, toSurface }];
  });
  return {
    input: {
      ...input,
      ground: {
        ...input.ground,
        surfaces,
        options: { ...input.ground.options, portals, connections },
      },
    },
    omittedConnections,
  };
}

export async function preparePhysicalSolver(
  input: PhysicalInput,
  config: SolverConfig,
  context: Omit<PhysicalContext, 'emit'> & {
    observe?: (
      result: RouteResult,
      optimizing: boolean,
      diagnostics: unknown,
    ) => void | Promise<void>;
  } = {},
): Promise<PreparedRouteSolver<SolverConfig>> {
  let scene: PhysicalInput | null = input;
  const ownedCache = context.cache ? undefined : createPhysicalCache();
  let cache: PhysicalCache | null = context.cache ?? ownedCache!;
  let ownedRepair: Repair | undefined;
  const solve = async (query: RouteQuery, options: SolveOptions = {}): Promise<RouteResult> => {
    if (!scene || !cache) throw new Error('Route solver is closed');
    options.signal?.throwIfAborted();
    validateWaypoints(query.waypoints);
    const queryStarted = performance.now();
    const fixed = scene;
    const preparation = cache;
    preparation.begin?.(context.generation ?? '');
    const repair = (
      await preparation.memo(
        'repair',
        context.generation ?? '',
        () => ({ attempted: false }) as Repair,
      )
    ).value;
    if (ownedCache) ownedRepair = repair;
    if (repair.pending) await repair.pending;
    options.signal?.throwIfAborted();
    let best: RouteResult = {
      route: { status: 'unmapped' },
      connections: [],
      diagnostics: { truncated: false },
    };
    let execution: ReturnType<typeof createPhysicalWorld> | undefined;
    let truncated = Boolean(repair.omittedConnections);
    const accepted = new WeakMap<
      object,
      Map<string, { route: Route; rejection?: ExecutionFailure }>
    >();
    let repairRequested = false;
    let localAttempted = false;
    let activeInput = repair.input ?? fixed;
    const completedTiming: Record<string, number> = {};
    let passTiming: Record<string, number> = {};
    let lastDiagnostics: Record<string, unknown> = {};
    let repairMs = 0;
    const reportDiagnostics = (diagnostics: Record<string, unknown>) => {
      const timingMs = { ...completedTiming };
      for (const [key, value] of Object.entries(passTiming))
        if (key !== 'total') timingMs[key] = (timingMs[key] ?? 0) + value;
      return {
        ...diagnostics,
        truncated,
        timingMs: { ...timingMs, groundRepair: repairMs, total: performance.now() - queryStarted },
      };
    };
    const prepareEvaluator = async (): Promise<EvaluateCandidate> => {
      execution ??= (
        await preparation.memo(
          'execution',
          JSON.stringify([context.generation, fixed.ground.options.walls]),
          () => createPhysicalWorld(fixed, coverageOf(fixed)),
        )
      ).value;
      return evaluate;
    };
    const evaluate = (candidate: Route, localQuery: CandidateQuery) => {
      const key = JSON.stringify(localQuery);
      let checked = accepted.get(candidate)?.get(key);
      if (!checked) {
        let rejection: ExecutionFailure | undefined;
        let route = executeRoute(candidate, localQuery, execution!, (failure) => {
          rejection = failure;
        });
        truncated ||= Boolean(
          route.search?.truncated ||
          (route.status === 'complete' && route.locomotion?.search?.truncated),
        );
        if (
          route.status === 'complete' &&
          !verifyRoute(localQuery, route, { maxVertical: fixed.ground.options.maxVertical }).valid
        ) {
          route = { status: 'no-verified-route' };
          rejection = { reason: 'goal-unproved' };
        }
        checked = { route, ...(rejection ? { rejection } : {}) };
        const results = accepted.get(candidate) ?? new Map();
        results.set(key, checked);
        accepted.set(candidate, results);
        if (route.status === 'complete') {
          const executed = accepted.get(route) ?? new Map();
          executed.set(key, checked);
          accepted.set(route, executed);
        }
      }
      const canRepair =
        checked.rejection?.reason === 'walk-unproved' &&
        !repair.attempted &&
        best.route.status !== 'complete' &&
        !!fixed.ground.build?.bounds &&
        !!fixed.ground.build.cellSize &&
        !!fixed.ground.build.cellHeight;
      if (checked.route.status === 'complete') repairRequested = false;
      else repairRequested ||= canRepair;
      return { ...checked, repair: canRepair };
    };
    for (const [index, arrival] of query.starts.entries()) {
      for (let attempt = 0; attempt < 2; attempt++) {
        repairRequested = false;
        passTiming = {};
        await solvePhysicalRoute(
          activeInput,
          {
            arrival,
            target: query.goal,
            interaction: query.interaction,
            walls: [],
            waypoints: query.waypoints,
          },
          {
            ...context,
            cache: preparation,
            groundRevision: activeInput === fixed ? undefined : 'physical-repair',
            prepareEvaluator,
            async localGround(arrival) {
              // This bounded alternative owns no answer cache or placement
              // state, and cannot skip an ordered waypoint or a repaired input.
              // Preserve authored-action repair: a feasible walk can still hide
              // a cheaper action behind the rejected navigation edge.
              if (
                localAttempted ||
                activeInput !== fixed ||
                query.waypoints?.length ||
                fixed.ground.options.connections?.length
              )
                return;
              localAttempted = true;
              await prepareEvaluator();
              return localGround(
                execution!,
                { ...query, starts: [arrival] },
                {
                  maxExpanded: 2048,
                  signal: options.signal,
                },
              );
            },
            async accept(candidate) {
              await prepareEvaluator();
              return evaluate(candidate, query);
            },
            progress(progress) {
              options.signal?.throwIfAborted();
              context.progress?.(progress);
              const phase =
                progress.phase === 'goal-refinement'
                  ? 'refine'
                  : progress.phase === 'collision-index' || progress.phase === 'moving-supports'
                    ? 'prepare'
                    : progress.phase === 'route-search'
                      ? 'validate'
                      : 'search';
              options.onEvent?.({
                type: 'progress',
                phase,
                ...(typeof progress.completed === 'number'
                  ? { completed: progress.completed }
                  : {}),
                ...(typeof progress.total === 'number' ? { total: progress.total } : {}),
              });
              options.signal?.throwIfAborted();
            },
            async emit(result, optimizing, diagnostics) {
              truncated ||= diagnostics.truncated === true;
              lastDiagnostics = diagnostics;
              passTiming = diagnostics.timingMs as Record<string, number>;
              const route = result.route;
              // A repair request is internal continuation, not a terminal
              // unavailable result that a polling host may stop waiting for.
              if (repairRequested && route?.status !== 'complete') return;
              if (
                best.route.status !== 'complete' &&
                result.reason &&
                (result.reason === 'no-verified-route' || best.route.status === 'unmapped')
              )
                best = {
                  route: {
                    status:
                      result.reason === 'no-verified-route' ? 'no-verified-route' : 'unmapped',
                  },
                  reason: result.reason,
                  connections: result.connections ?? [],
                  diagnostics: { truncated },
                };
              if (
                route?.status === 'complete' &&
                (best.route.status !== 'complete' || route.cost < best.route.cost)
              )
                best = {
                  route,
                  connections: result.connections ?? [],
                  diagnostics: { truncated },
                  groundedTarget: result.groundedTarget,
                  supportBoxes: result.supportBoxes,
                };
              if (route?.status === 'complete')
                options.onEvent?.({
                  type: 'candidate',
                  result: { ...best, diagnostics: { truncated } },
                  optimizing: optimizing || index < query.starts.length - 1,
                });
              options.signal?.throwIfAborted();
              await context.observe?.(
                { ...best, diagnostics: { truncated } },
                optimizing || index < query.starts.length - 1,
                reportDiagnostics(diagnostics),
              );
            },
          },
          config,
        );
        for (const [key, value] of Object.entries(passTiming))
          if (key !== 'total') completedTiming[key] = (completedTiming[key] ?? 0) + value;
        passTiming = {};
        if (!repairRequested || best.route.status === 'complete') break;
        repair.attempted = true;
        const started = performance.now();
        options.signal?.throwIfAborted();
        options.onEvent?.({ type: 'progress', phase: 'refine' });
        // The rejected coarse graph cannot contribute to this repair. Retire it
        // before native bake allocation, rather than retaining both generations
        // until the replacement mesh has already been built.
        preparation.release('ground');
        repair.pending = rebuild(fixed)
          .then((value) => {
            repair.input = value?.input;
            repair.omittedConnections = value?.omittedConnections;
            repair.elapsedMs = performance.now() - started;
          })
          .catch((error) => {
            repair.attempted = false;
            throw error;
          })
          .finally(() => {
            repair.pending = undefined;
          });
        await repair.pending;
        repairMs += repair.elapsedMs ?? 0;
        truncated ||= Boolean(repair.omittedConnections);
        options.signal?.throwIfAborted();
        context.progress?.({
          phase: 'physical-ground-repair',
          elapsedMs: repair.elapsedMs,
          surfaces: repair.input?.ground.surfaces.length ?? 0,
          omittedConnections: repair.omittedConnections ?? 0,
        });
        if (!repair.input?.ground.surfaces.length) {
          truncated = true;
          best = {
            ...best,
            route: { status: 'no-verified-route' },
            reason: 'physical-ground-repair-unavailable',
          };
          await context.observe?.(
            { ...best, diagnostics: { truncated } },
            index < query.starts.length - 1,
            reportDiagnostics({ ...lastDiagnostics, truncated }),
          );
          break;
        }
        activeInput = repair.input;
      }
    }
    return { ...best, diagnostics: { truncated } };
  };
  return {
    get config() {
      return config;
    },
    solve,
    async solveBatch(queries, options) {
      if (!scene) throw new Error('Route solver is closed');
      const results: RouteResult[] = [];
      // Scheduling belongs to this adapter; callers submit the whole workload.
      for (const query of queries) results.push(await solve(query, options));
      return results;
    },
    async close() {
      if (ownedCache && scene) {
        if (ownedRepair?.input) releaseSupportCaches(ownedRepair.input.ground.surfaces);
        ownedCache.clear();
        releaseSupportCaches(scene.ground.surfaces);
      }
      scene = null;
      cache = null;
    },
  };
}
