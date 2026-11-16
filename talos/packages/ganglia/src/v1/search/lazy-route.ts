import type { Route } from '#@/src/route.ts';
import {
  type Graph,
  type Edge,
  type Arrival,
  createUpdatingRoutePlanner,
} from '#@/src/v1/route/routes.ts';

export interface LazyPlanOptions {
  validate: (edge: Edge, index: number) => Promise<Edge | null>;
  maxValidations?: number;
  signal?: AbortSignal;
}
export interface LazyPlanResult {
  status: 'complete' | 'incomplete' | 'unmapped' | 'no-verified-route';
  reason?: 'aborted' | 'validation-budget';
  route?: Extract<Route, { status: 'complete' }>;
  validation: { attempted: number; pending: number };
}

/** Validate only edges selected by optimistic shortest-path searches. Costs are
 * seconds and unknown costs must be lower bounds. The caller must keep nodes and input edges immutable. Only unknown-edge
 * records and validated replacements are owned here; resume by calling plan again.
 */
export function createLazyRoutePlanner(graph: Graph) {
  const unknown = new Map<Edge, { original: Edge; index: number }>();
  const optimistic = graph.edges.map((edge, index) => {
    if (edge.state !== 'unknown') return edge;
    const candidate: Edge = { ...edge, state: 'open' };
    unknown.set(candidate, { original: edge, index });
    return candidate;
  });
  const planner = createUpdatingRoutePlanner({ nodes: graph.nodes, edges: optimistic });
  let running = false;
  return {
    async plan(
      starts: Arrival[],
      goal: string | string[],
      { validate, maxValidations = Infinity, signal }: LazyPlanOptions,
    ): Promise<LazyPlanResult> {
      if (running) throw new Error('Lazy planner already running');
      if (
        typeof validate !== 'function' ||
        !(maxValidations === Infinity || (Number.isInteger(maxValidations) && maxValidations >= 0))
      )
        throw new Error('Invalid lazy validation options');
      running = true;
      let attempted = 0;
      const result = (
        status: LazyPlanResult['status'],
        extra: Pick<LazyPlanResult, 'reason' | 'route'> = {},
      ): LazyPlanResult => ({
        status,
        ...extra,
        validation: {
          attempted,
          pending: unknown.size,
        },
      });
      try {
        while (true) {
          if (signal?.aborted) return result('incomplete', { reason: 'aborted' });
          const { route: candidate, path } = planner.plan(starts, goal);
          if (candidate.status !== 'complete') return result(candidate.status);
          const pending = path.find((edge) => unknown.has(edge));
          if (!pending) return result('complete', { route: candidate });
          if (attempted >= maxValidations)
            return result('incomplete', { reason: 'validation-budget' });
          const { original, index } = unknown.get(pending)!;
          attempted++;
          const verified = await validate(structuredClone(original), index);
          // Cancellation or a thrown validator leaves the edge unknown for retry.
          if (signal?.aborted) return result('incomplete', { reason: 'aborted' });
          if (verified === null) {
            planner.replace(pending, { ...original, state: 'closed' });
          } else {
            if (
              !verified ||
              verified.state !== 'open' ||
              verified.from !== original.from ||
              verified.to !== original.to ||
              !Number.isFinite(verified.cost) ||
              verified.cost < original.cost
            ) {
              throw new Error('Invalid validated edge or optimistic cost lower bound');
            }
            // Reuse the normal graph contract before committing a cache update.
            planner.replace(pending, structuredClone(verified));
          }
          unknown.delete(pending);
        }
      } finally {
        running = false;
      }
    },
  };
}
