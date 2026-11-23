import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createGoalProjector, type GoalProjector } from '#@/src/model/goals.ts';
import type { JumpModel, LocomotionOptions } from '#@/src/movement.ts';
import type { GroundArrival, Route } from '#@/src/route.ts';
import { checkpoint } from '#@/src/solver/checkpoint.ts';
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
import { clearActionCatalog } from '#@/src/v1/route/action-catalog.ts';
import { validateWaypoints } from '#@/src/v1/route/jump-planner.ts';
import { createCandidatePlanner } from '#@/src/v1/search/candidate-planner.ts';
import { composeRoutes, admitAuthoredStart } from '#@/src/v1/solver/route-result.ts';
import {
  createAirbornePrepCache,
  discoverAirborneEntries,
  loadAirborneWindow,
  type AirborneWindow,
  type Entry,
} from '#@/src/v1/solver/scene/airborne.ts';
import { createQueryBudget } from '#@/src/v1/solver/scene/budget.ts';
import { discoverRopeTerminal } from '#@/src/v1/solver/scene/rope-terminal.ts';
import { createWindowGroundCache, createWindowRoute } from '#@/src/v1/solver/window-route.ts';

type Complete = Extract<Route, { status: 'complete' }>;

function selectSceneTerminal<T extends SceneTerminal>(
  terminals: readonly T[],
  starts: GroundArrival[],
  speed: number,
): T | undefined {
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

// Track open scene solvers so closing the last solver deterministically
// releases action-catalog proof banks without clobbering concurrent solvers.
let openSceneSolvers = 0;

/** Full query orchestration. Only immutable input preparation may be shared between solves. */
export function prepareSceneRouteSolver<Source, Job extends WindowJob>(
  input: { scene: string; source: Source; walls: Wall[]; navigation: SceneNavigation },
  resources: SceneResources<Source, Job>,
  config: GangliaV1Config,
  locomotion: LocomotionOptions,
): PreparedRouteSolver<GangliaV1Config> {
  openSceneSolvers++;
  const { navigation, ...scene } = input;
  const planner = createCandidatePlanner(navigation);
  let projectGoal: GoalProjector | undefined;
  const groundCache = createWindowGroundCache();
  const maxAttempts = config.maxAttempts,
    concurrency = config.batchConcurrency;
  let transport: ReturnType<NonNullable<typeof resources.movingTransfers>> | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  const batches = new Set<Promise<readonly RouteResult[]>>();
  const active = new Set<Promise<RouteResult>>();
  const runLeg = async (query: RouteQuery, options: SolveOptions): Promise<RouteResult> => {
    validateWaypoints(query.waypoints);
    const excludedEdges: (number | string)[] = [],
      excludedArrivals = new Set<string>();
    let lastReason: string | undefined;
    let incumbent: RouteResult | undefined;
    let partial: RouteResult | undefined;
    const budget = createQueryBudget(maxAttempts);
    let truncated = false;
    const stopped = (reason: string, limited = false): RouteResult =>
      incumbent || partial
        ? {
            ...(incumbent ?? partial!),
            reason,
            diagnostics: {
              ...(incumbent ?? partial)?.diagnostics,
              truncated: truncated || limited || Boolean(incumbent?.diagnostics.truncated),
              candidateAttempts: budget.reportedAttempts,
            },
          }
        : {
            route: { status: 'no-verified-route' },
            connections: [],
            reason,
            diagnostics: {
              truncated: truncated || limited,
              candidateAttempts: budget.reportedAttempts,
            },
          };
    const cancelled = () => options.signal?.aborted;
    const progress = (phase: 'search' | 'validate') =>
      options.onEvent?.({ type: 'progress', phase });
    // Query-scoped cache prevents retaining a second copy of large snapshot
    // indices across queries or while solvePhysicalRoute holds its own cache.
    const airbornePrepCache = createAirbornePrepCache();
    let goalWindow: Promise<AirborneWindow<Job> | undefined> | undefined;
    try {
      const terminals = query.interaction?.airborne
        ? await resources.terminals?.(query)
        : undefined;
      let terminal = selectSceneTerminal(
        terminals ?? [],
        query.starts,
        locomotion.sprintSpeed ?? locomotion.speed,
      );
      const loadGoalWindow = () =>
        (goalWindow ??= loadAirborneWindow(scene, resources, config, query, options));
      if (!terminal && query.interaction?.airborne && resources.physical) {
        const found = await discoverRopeTerminal(
          scene,
          navigation,
          (projectGoal ??= createGoalProjector(navigation.surfaces)),
          resources,
          config,
          query,
          options,
          loadGoalWindow,
          airbornePrepCache,
        );
        if (found) {
          options.onEvent?.({ type: 'candidate', result: found, optimizing: false });
          return found;
        }
      }
      let goal = terminal?.route.points[0] ?? query.goal;
      let bind: ((route: Complete) => boolean) | undefined;
      let discoveryTried = false;
      let entries: Entry[] = [];
      const discover = async () => {
        if (incumbent || (terminal && !bind) || !query.interaction?.airborne) return false;
        if (!discoveryTried) {
          discoveryTried = true;
          try {
            entries = await discoverAirborneEntries(
              scene,
              resources,
              config,
              query,
              options,
              loadGoalWindow,
              airbornePrepCache,
            );
          } finally {
            goalWindow = undefined;
            airbornePrepCache.clear();
          }
        }
        // Entry proximity alone can favor a roof that the original arrivals
        // cannot approach. Rank current entry proposals through the scene graph;
        // the ordinary window search still owns complete physical admission.
        const ranked = entries
          .map((entry) => {
            const approach = planner.plan(query.starts, entry.route.points[0]);
            return {
              entry,
              score: approach.status === 'candidate' ? approach.score + entry.route.cost : Infinity,
            };
          })
          .sort((a, b) => a.score - b.score);
        const selected = ranked.find((candidate) => Number.isFinite(candidate.score))?.entry;
        if (!selected) return false;
        entries = entries.filter((entry) => entry.id !== selected.id);
        terminal = selected;
        bind = selected.bind;
        truncated = true;
        goal = terminal.route.points[0];
        partial = undefined;
        excludedEdges.length = 0;
        excludedArrivals.clear();
        return true;
      };
      const estimate = (arrival: GroundArrival) =>
        arrival.cost +
        distance(arrival.position, query.goal) / Math.max(locomotion.speed, locomotion.sprintSpeed);
      let triedTransport = false,
        triedBoundaryGuide = false;
      candidates: while (budget.canAttemptOrdinary()) {
        if (cancelled()) return stopped('aborted', true);
        let starts = query.starts.filter(
          (a) => a.state === 'available' && !excludedArrivals.has(a.id),
        );
        if (incumbent?.route.status === 'complete') {
          const cost = incumbent.route.cost;
          // This is an exploration heuristic, not a physical lower bound: devices
          // and boosts can beat straight-line sprint estimates. Keep truncation explicit.
          const promising = starts.filter((a) => estimate(a) < cost);
          truncated ||= promising.length < starts.length;
          starts = promising.sort((a, b) => estimate(a) - estimate(b)).slice(0, 1);
        }
        if (!starts.length)
          return stopped(
            incumbent ? 'anchor-comparison-complete' : (lastReason ?? 'no-available-arrival'),
          );
        await checkpoint(options.signal);
        progress('search');
        if (cancelled()) return stopped('aborted', true);
        const facilities =
          !triedTransport &&
          budget.canAttemptGuide() &&
          !terminal &&
          query.interaction &&
          resources.movingTransfers
            ? planner.moving(
                starts,
                goal,
                query.interaction,
                await (transport ??= resources.movingTransfers().catch((error) => {
                  transport = undefined;
                  throw error;
                })),
              )
            : undefined;
        triedTransport = true;
        const jumpModel: JumpModel | undefined =
          !facilities &&
          !terminal &&
          !triedBoundaryGuide &&
          budget.canAttemptGuide() &&
          !query.interaction?.airborne
            ? resources.jumpModel
            : undefined;
        triedBoundaryGuide ||= Boolean(jumpModel);
        const proposal =
          facilities ??
          planner.plan(starts, goal, {
            excludedEdges,
            interaction: terminal ? undefined : query.interaction,
            jumpModel,
          });
        await checkpoint(options.signal);
        if (cancelled()) return stopped('aborted', true);
        if (proposal.status !== 'candidate') {
          if (jumpModel) continue;
          if (await discover()) {
            budget.recordAttempt('ordinary');
            continue;
          }
          if (!incumbent) return stopped('no-global-candidate');
          budget.recordAttempt('ordinary');
          excludedArrivals.add(starts[0].id);
          continue;
        }
        const boundaryGuide = Boolean(
          jumpModel && proposal.unresolved.some((edge) => edge.key?.startsWith('["transfer",')),
        );
        const isGuide = Boolean(facilities || boundaryGuide);
        budget.recordAttempt(isGuide ? 'guide' : 'ordinary');
        const arrival = proposal.arrival;
        const transfers = proposal.path
          ?.filter((edge) => edge.unresolved)
          .map((edge) => edge.points);
        const proposalKey = JSON.stringify([
          terminal?.id ?? null,
          arrival.id,
          Boolean(facilities),
          proposal.points,
          transfers ?? null,
        ]);
        const handleWindowFailure = async (
          reason: string | undefined,
          windowPoints: Vec3[],
        ): Promise<'continue' | 'break' | RouteResult> => {
          if (cancelled()) return stopped('aborted', true);
          budget.recordFailedProposal(proposalKey, windowPoints);
          lastReason = reason;
          if (isGuide) {
            // Guide attempts use their own bounded budget slot and do not
            // consume ordinary candidate attempts when their window misses.
            partial = undefined;
            return 'break';
          }
          if (await discover()) return 'continue';
          const edge = proposal.path?.find(
            (edge) =>
              edge.unresolved &&
              !excludedEdges.includes(edge.key ?? edge.index) &&
              edge.points.some((point) =>
                windowPoints.some((candidate) => distance(point, candidate) < 1e-5),
              ),
          );
          if (edge) excludedEdges.push(edge.key ?? edge.index);
          else excludedArrivals.add(arrival.id);
          if (!budget.canAttemptOrdinary()) return stopped(reason ?? 'candidate-budget', true);
          return 'break';
        };
        if (budget.hasFailedProposal(proposalKey)) {
          const action = await handleWindowFailure(
            lastReason,
            budget.failedProposalPoints(proposalKey) as Vec3[],
          );
          if (action === 'continue') continue candidates;
          if (action === 'break') continue candidates;
          return action;
        }
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
            transportGuide: Boolean(facilities),
            transfers,
          },
          groundCache,
          budget.nogoods,
        );
        const publish = (route: Complete, evidence: unknown[], isPartial: boolean): RouteResult => {
          if (!isPartial)
            route = admitAuthoredStart(
              route,
              arrival,
              navigation.options.maxVertical,
              locomotion,
              evidence,
            );
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
              candidateAttempts: budget.reportedAttempts,
              ...(boundaryGuide && {
                candidateGuide: 'source-boundaries',
              }),
            },
          };
          if (!isPartial) {
            if (incumbent?.route.status === 'complete' && route.cost >= incumbent.route.cost)
              return incumbent;
            incumbent = result;
          }
          if (!isPartial || !incumbent)
            options.onEvent?.({
              type: 'candidate',
              result,
              optimizing: isPartial || query.starts.length > 1,
            });
          return result;
        };
        let tailExhaustedRoot: { reason?: string; window: { points: Vec3[] } } | undefined;
        if (!partial && !incumbent) {
          if (terminal)
            partial = publish(terminal.route, [{ supportBoxes: terminal.supportBoxes }], true);
          else {
            while (!cancelled()) {
              const tail = await window.advanceTail({ signal: options.signal });
              if ('diagnostics' in tail) truncated ||= tail.diagnostics.truncated;
              if (tail.status === 'partial') {
                if (tail.coversStart) {
                  const route = {
                    ...tail.route,
                    start: arrival.id,
                    arrivalCost: arrival.cost,
                    cost: tail.route.cost - tail.route.arrivalCost + arrival.cost,
                  };
                  publish(route, tail.evidence, false);
                  excludedArrivals.add(arrival.id);
                  partial = undefined;
                  continue candidates;
                }
                partial = publish(tail.route, tail.evidence, true);
                break;
              }
              if (tail.status !== 'pending') {
                if (await discover()) continue candidates;
                // When advanceTail covered the entire start->goal single window
                // and exhausted every stage/expansion/split, reuse that failure
                // directly instead of running window.advance() a second time.
                if (
                  tail.status === 'incomplete' &&
                  tail.coversStart &&
                  'window' in tail &&
                  tail.window
                ) {
                  tailExhaustedRoot = tail;
                }
                break;
              }
              progress('validate');
              await resources.wait(options.signal);
            }
          }
        }
        if (tailExhaustedRoot) {
          const action = await handleWindowFailure(
            tailExhaustedRoot.reason,
            tailExhaustedRoot.window.points,
          );
          if (action === 'continue') continue candidates;
          if (action === 'break') continue candidates;
          return action;
        }
        let lastPreviewPiece: Complete | undefined;
        while (!cancelled()) {
          const result = await window.advance({ signal: options.signal });
          truncated ||= result.diagnostics.truncated;
          if (result.status === 'complete') {
            const route = terminal
              ? composeRoutes([result.route, terminal.route], locomotion)
              : result.route;
            if (route.status !== 'complete') return stopped('terminal-composition');
            if (bind && !bind(route)) {
              excludedArrivals.add(arrival.id);
              continue candidates;
            }
            publish(
              route,
              [...result.evidence, ...(terminal ? [{ supportBoxes: terminal.supportBoxes }] : [])],
              false,
            );
            excludedArrivals.add(arrival.id);
            partial = undefined;
            continue candidates;
          }
          if (result.status === 'pending') {
            const piece = result.pieces.at(-1);
            if (options.onPreview && !incumbent && piece && piece !== lastPreviewPiece) {
              lastPreviewPiece = piece;
              options.onPreview(result.pieces.flatMap((part) => part.segments));
            }
            progress('validate');
            await resources.wait(options.signal);
            continue;
          }
          const action = await handleWindowFailure(result.reason, result.window.points);
          if (action === 'continue') continue candidates;
          if (action === 'break') break;
          return action;
        }
        if (cancelled()) return stopped('aborted', true);
      }
      return stopped('candidate-budget', true);
    } catch (error) {
      if (cancelled()) return stopped('aborted', true);
      if (incumbent || partial)
        return stopped(error instanceof Error ? error.message : String(error), true);
      throw error;
    } finally {
      goalWindow = undefined;
      airbornePrepCache.clear();
    }
  };
  const submit = (query: RouteQuery, options: SolveOptions = {}) => {
    const task = runLeg(query, options);
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
        projectGoal = undefined;
        groundCache.clear();
        if (--openSceneSolvers === 0) clearActionCatalog();
        await resources.close?.();
      })();
      return closing;
    },
  };
}
