import type { CollisionWorld } from '#@/src/collision.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SceneInput,
} from '#@/src/solver/contract.ts';
import type { GangliaV1Config as SolverConfig } from '#@/src/solver/ganglia-v1.ts';
import { type GroundPlanner, createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { planJumpRoute, type JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';

export async function prepareSurfaceActionSolver(
  input: SceneInput,
  config: SolverConfig,
): Promise<PreparedRouteSolver<SolverConfig>> {
  const options = {
    ...input.movement,
    ...config,
    walls: input.walls,
    connections: input.connections,
    portals: input.portals,
    boosts: input.boosts,
  };
  let prepared: {
    surfaces: SceneInput['surfaces'];
    world: CollisionWorld;
    planner: GroundPlanner;
    options: JumpRouteOptions;
  } | null = {
    surfaces: input.surfaces,
    world: createCollisionWorld(input.collision, input.collisionOptions),
    planner: createGroundPlanner(input.surfaces, options),
    options,
  };
  const solve = (query: RouteQuery): RouteResult => {
    if (!prepared) throw new Error('Route solver is closed');
    return planJumpRoute(prepared.surfaces, prepared.world, query.starts, query.goal, {
      ...prepared.options,
      interaction: query.interaction,
      waypoints: query.waypoints,
      groundPlanner: prepared.planner,
    });
  };
  return {
    get config() {
      return config;
    },
    async solve(query, options) {
      options?.signal?.throwIfAborted();
      options?.onEvent?.({ type: 'progress', phase: 'search' });
      options?.signal?.throwIfAborted();
      const result = solve(query);
      if (result.route.status === 'complete')
        options?.onEvent?.({ type: 'candidate', result, optimizing: false });
      options?.signal?.throwIfAborted();
      return result;
    },
    async solveBatch(queries, options) {
      if (!prepared) throw new Error('Route solver is closed');
      // Serial execution belongs to this adapter, leaving replacements free to
      // schedule a whole batch without a caller-side loop.
      return queries.map((query) => {
        options?.signal?.throwIfAborted();
        return solve(query);
      });
    },
    async close() {
      prepared = null;
    },
  };
}
