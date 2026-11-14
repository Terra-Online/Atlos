import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SolveOptions,
} from '#@/src/solver/contract.ts';
import type { GangliaV1Config as SolverConfig } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { validateWaypoints } from '#@/src/v1/route/jump-planner.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import {
  solvePhysicalRoute,
  type PhysicalCache,
  type PhysicalContext,
} from '#@/src/v1/solver/physical/solve.ts';
import { releaseSupportCaches } from '#@/src/v1/solver/physical/support-cache.ts';

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
  const solve = async (query: RouteQuery, options: SolveOptions = {}): Promise<RouteResult> => {
    if (!scene || !cache) throw new Error('Route solver is closed');
    options.signal?.throwIfAborted();
    validateWaypoints(query.waypoints);
    const fixed = scene;
    const preparation = cache;
    let best: RouteResult = {
      route: { status: 'unmapped' },
      connections: [],
      diagnostics: { truncated: false },
    };
    let truncated = false;
    for (const [index, arrival] of query.starts.entries()) {
      await solvePhysicalRoute(
        fixed,
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
              ...(typeof progress.completed === 'number' ? { completed: progress.completed } : {}),
              ...(typeof progress.total === 'number' ? { total: progress.total } : {}),
            });
            options.signal?.throwIfAborted();
          },
          async emit(result, optimizing, diagnostics) {
            truncated ||= diagnostics.truncated === true;
            const route = result.route;
            if (
              best.route.status !== 'complete' &&
              result.reason &&
              (result.reason === 'no-verified-route' || best.route.status === 'unmapped')
            )
              best = {
                route: {
                  status: result.reason === 'no-verified-route' ? 'no-verified-route' : 'unmapped',
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
              diagnostics,
            );
          },
        },
        config,
      );
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
        ownedCache.clear();
        releaseSupportCaches(scene.ground.surfaces);
      }
      scene = null;
      cache = null;
    },
  };
}
