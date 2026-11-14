import type { Vec3, Wall } from '#@/src/geometry.ts';
import type { LocomotionOptions } from '#@/src/movement.ts';
import type { GroundArrival, Route } from '#@/src/route.ts';
import type {
  PreparedRouteSolver,
  RouteQuery,
  RouteResult,
  SolveOptions,
} from '#@/src/solver/contract.ts';
import type { GangliaV1Config } from '#@/src/solver/ganglia-v1.ts';
import type {
  SceneTerminal,
  SceneResources,
  SceneNavigation,
  WindowJob,
} from '#@/src/solver/resources.ts';
import { validateWaypoints } from '#@/src/v1/route/jump-planner.ts';
import { createCandidatePlanner } from '#@/src/v1/search/candidate-planner.ts';
import { composeRoutes } from '#@/src/v1/solver/route-result.ts';
import { createWindowGroundCache, createWindowRoute } from '#@/src/v1/solver/window-route.ts';

type Complete = Extract<Route, { status: 'complete' }>;

function selectSceneTerminal(
  terminals: readonly SceneTerminal[],
  starts: GroundArrival[],
  speed: number,
): SceneTerminal | undefined {
  const estimate = (asset: SceneTerminal) =>
    asset.route.cost +
    Math.min(
      ...starts
        .filter((a) => a.state === 'available')
        .map((a) => a.cost + distance(a.position, asset.route.points[0]) / speed),
    );
  return [...terminals].sort((a, b) => estimate(a) - estimate(b))[0];
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
const contacts = (evidence: unknown[]): NonNullable<RouteResult['supportBoxes']> =>
  evidence.flatMap((item) => {
    if (
      !item ||
      typeof item !== 'object' ||
      !('supportBoxes' in item) ||
      !Array.isArray(item.supportBoxes)
    )
      return [];
    // Physical adapters return the solver's own display evidence, not arbitrary renderer data.
    return item.supportBoxes as NonNullable<RouteResult['supportBoxes']>;
  });

/** Full query orchestration. Only immutable input preparation may be shared between solves. */
export function prepareSceneRouteSolver<Source, Job extends WindowJob>(
  input: { scene: string; source: Source; walls: Wall[]; navigation: SceneNavigation },
  resources: SceneResources<Source, Job>,
  config: GangliaV1Config,
  locomotion: LocomotionOptions,
): PreparedRouteSolver<GangliaV1Config> {
  const { navigation, ...scene } = input;
  const planner = createCandidatePlanner(navigation);
  const groundCache = createWindowGroundCache();
  const maxAttempts = config.maxAttempts,
    concurrency = config.batchConcurrency;
  let closed = false;
  let closing: Promise<void> | undefined;
  const batches = new Set<Promise<readonly RouteResult[]>>();
  const active = new Set<Promise<RouteResult>>();
  const run = async (query: RouteQuery, options: SolveOptions): Promise<RouteResult> => {
    validateWaypoints(query.waypoints);
    const excludedEdges: (number | string)[] = [],
      excludedArrivals = new Set<string>();
    let lastReason: string | undefined;
    let partial: RouteResult | undefined,
      attempts = 0;
    let truncated = false;
    const stopped = (reason: string, limited = false): RouteResult =>
      partial
        ? {
            ...partial,
            reason,
            diagnostics: { truncated: truncated || limited, candidateAttempts: attempts },
          }
        : {
            route: { status: 'no-verified-route' },
            connections: [],
            reason,
            diagnostics: { truncated: truncated || limited, candidateAttempts: attempts },
          };
    const cancelled = () => options.signal?.aborted;
    const progress = (phase: 'search' | 'validate') =>
      options.onEvent?.({ type: 'progress', phase });
    try {
      const terminals = query.interaction?.airborne
        ? await resources.terminals?.(query)
        : undefined;
      const terminal = selectSceneTerminal(
        terminals ?? [],
        query.starts,
        locomotion.sprintSpeed ?? locomotion.speed,
      );
      const goal = terminal?.route.points[0] ?? query.goal;
      for (; attempts < maxAttempts;) {
        if (cancelled()) return stopped('aborted', true);
        const starts = query.starts.filter((a) => !excludedArrivals.has(a.id));
        if (!starts.length) return stopped(lastReason ?? 'no-available-arrival');
        attempts++;
        progress('search');
        if (cancelled()) return stopped('aborted', true);
        const proposal = planner.plan(starts, goal, { excludedEdges });
        if (cancelled()) return stopped('aborted', true);
        if (proposal.status !== 'candidate') return stopped('no-global-candidate');
        const arrival = proposal.arrival;
        const window = createWindowRoute(
          resources,
          {
            ...scene,
            arrival,
            target: goal,
            interaction: terminal ? undefined : query.interaction,
            walls: scene.walls,
            waypoints: query.waypoints,
            solverConfig: config,
          },
          proposal.points,
          {
            ...config,
            locomotion,
            transfers: proposal.path?.filter((edge) => edge.unresolved).map((edge) => edge.points),
          },
          groundCache,
        );
        const publish = (route: Complete, evidence: unknown[], isPartial: boolean): RouteResult => {
          const result: RouteResult = {
            route,
            connections: [],
            partial: isPartial,
            arrival,
            supportBoxes: contacts(evidence),
            diagnostics: {
              truncated:
                truncated ||
                Boolean(route.search?.truncated || route.locomotion?.search?.truncated),
              candidateAttempts: attempts,
            },
          };
          options.onEvent?.({ type: 'candidate', result, optimizing: isPartial });
          return result;
        };
        if (!partial) {
          if (terminal)
            partial = publish(terminal.route, [{ supportBoxes: terminal.supportBoxes }], true);
          else {
            while (!cancelled()) {
              const tail = await window.advanceTail();
              if ('diagnostics' in tail) truncated ||= tail.diagnostics.truncated;
              if (tail.status === 'partial') {
                if (tail.coversStart) {
                  const route = {
                    ...tail.route,
                    start: arrival.id,
                    arrivalCost: arrival.cost,
                    cost: tail.route.cost - tail.route.arrivalCost + arrival.cost,
                  };
                  return publish(route, tail.evidence, false);
                }
                partial = publish(tail.route, tail.evidence, true);
                break;
              }
              if (tail.status !== 'pending') break;
              progress('validate');
              await resources.wait(options.signal);
            }
          }
        }
        while (!cancelled()) {
          const result = await window.advance({ signal: options.signal });
          truncated ||= result.diagnostics.truncated;
          if (result.status === 'complete') {
            const route = terminal
              ? composeRoutes([result.route, terminal.route], locomotion)
              : result.route;
            if (route.status !== 'complete') return stopped('terminal-composition');
            return publish(
              route,
              [...result.evidence, ...(terminal ? [{ supportBoxes: terminal.supportBoxes }] : [])],
              false,
            );
          }
          if (result.status === 'pending') {
            progress('validate');
            await resources.wait(options.signal);
            continue;
          }
          if (cancelled()) return stopped('aborted', true);
          lastReason = result.reason;
          const edge = proposal.path?.find(
            (edge) =>
              edge.unresolved &&
              !excludedEdges.includes(edge.key ?? edge.index) &&
              edge.points.some((point) =>
                result.window.points.some((candidate) => distance(point, candidate) < 1e-5),
              ),
          );
          if (edge) excludedEdges.push(edge.key ?? edge.index);
          else excludedArrivals.add(arrival.id);
          if (attempts >= maxAttempts) return stopped(result.reason ?? 'candidate-budget', true);
          break;
        }
        if (cancelled()) return stopped('aborted', true);
      }
      return stopped('candidate-budget', true);
    } catch (error) {
      if (cancelled()) return stopped('aborted', true);
      if (partial) return stopped(error instanceof Error ? error.message : String(error), true);
      throw error;
    }
  };
  const submit = (query: RouteQuery, options: SolveOptions = {}) => {
    const task = run(query, options);
    active.add(task);
    void task.then(
      () => active.delete(task),
      () => active.delete(task),
    );
    return task;
  };
  return {
    get config() {
      return config;
    },
    solve(query, options) {
      return closed ? Promise.reject(new Error('Scene solver is closed')) : submit(query, options);
    },
    solveBatch(queries, options) {
      if (closed) return Promise.reject(new Error('Scene solver is closed'));
      const batch = (async () => {
        const results: RouteResult[] = new Array(queries.length);
        let next = 0;
        const lanes = Array.from({ length: Math.min(concurrency, queries.length) }, async () => {
          while (next < queries.length) {
            const index = next++;
            results[index] = await submit(queries[index], options);
          }
        });
        const settled = await Promise.allSettled(lanes);
        const failure = settled.find((value) => value.status === 'rejected');
        if (failure?.status === 'rejected') throw failure.reason;
        return results;
      })();
      batches.add(batch);
      void batch.then(
        () => batches.delete(batch),
        () => batches.delete(batch),
      );
      return batch;
    },
    close() {
      closing ??= (async () => {
        closed = true;
        await Promise.allSettled(batches);
        await Promise.allSettled(active);
        groundCache.clear();
        await resources.close?.();
      })();
      return closing;
    },
  };
}
