import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Surface } from '#@/src/geometry.ts';
import type { InteractionGoal, JumpModel, SpeedBoost } from '#@/src/movement.ts';
import type { GroundOptions, GroundArrival, GroundConnection, Route } from '#@/src/route.ts';
import { createGoalProjector, findGoalHit, markTerminalGoal } from '#@/src/v1/motion/goals.ts';
import {
  rememberCatalogAction,
  selectCatalogActions,
  noteActionCatalogResult,
} from '#@/src/v1/route/action-catalog.ts';
import { planAirborneGoal } from '#@/src/v1/route/airborne-goal.ts';
import { planBoostedRoute } from '#@/src/v1/route/boosted-route.ts';
import {
  type GroundPlanner,
  createGroundPlanner,
  groundPreparation,
} from '#@/src/v1/route/ground.ts';
import { movementGeometry } from '#@/src/v1/route/movement-geometry.ts';
import { findRouteShortcuts } from '#@/src/v1/route/route-shortcuts.ts';
import {
  type ShortcutDiagnostics,
  type FrontierDiagnostics,
  type ShortcutCache,
  findJumpFrontier,
  findJumpShortcuts,
} from '#@/src/v1/search/shortcuts.ts';
import { type DiscoveryDiagnostics, findJumpConnections } from '#@/src/v1/search/traversal.ts';

export interface JumpRouteOptions extends GroundOptions {
  boosts?: SpeedBoost[];
  /** Optimistic coarse direction samples. At most 128 finite positions. These only
   * guide action discovery; the final route need not visit them. */
  waypoints?: Vec3[];
  onProgress?: (progress: {
    phase: 'direction-search' | 'device-entry-search';
    completed: number;
    total: number;
    status?: Route['status'];
    connections?: number;
  }) => void;
  /** Optional prepared planner for these same immutable surfaces and ground options.
   * Query connections override its initial connection set. */
  groundPlanner?: GroundPlanner;
  interaction?: InteractionGoal;
  model: JumpModel;
  runAirSpeed: number;
  maxSlope: number;
  maxDrop: number;
  maxHorizontalDistance: number;
  sampleSpacing: number;
  maxCandidates: number;
  /** Optional broad improvement budget after reachability succeeds. Zero keeps the first
   * feasible route; omitted uses the remaining discovery budget. An incumbent-local
   * comparison may use up to 128 additional candidates from the overall remaining budget. */
  maxShortcutCandidates?: number;
  maxLinks: number;
}

export interface JumpDiagnostics {
  boosts?: {
    id: string;
    status: string;
    duration: number;
    multiplier: number;
    elapsed?: number;
    truncated?: boolean;
  }[];
  airborne?: FlightDiagnostics;
  strategy: 'surface-action-graph';
  groundStatus: Route['status'];
  baselineCost: number | null;
  selectedCost: number | null;
  truncated: boolean;
  unusedCandidates?: number;
  catalogSeedActions?: number;
  deviceImprovement?: JumpDiagnostics;
  searches: (DiscoveryDiagnostics | ShortcutDiagnostics | FrontierDiagnostics)[];
  /** Additional bounded entry queries after primary feasibility fails. */
  deviceApproaches?: {
    budgetPerGoal: number;
    goals: number;
    searches: {
      device: string;
      budget: number;
      status: Route['status'];
      discovery: JumpDiagnostics;
    }[];
  };
  directions?: {
    requestedGoals: number;
    regions: number;
    budgetPerGoal: number;
    remaining: number;
    searches: {
      point: Vec3;
      support?: Vec3;
      status: Route['status'];
      added: number;
      diagnostics?: JumpDiagnostics;
    }[];
  };
}

interface FlightDiagnostics {
  attempted: number;
  nominalHits: number;
  hits: number;
  approaches: number;
  truncated: boolean;
}

export type PlannerOptions = JumpRouteOptions & {
  endpointTolerance?: number;
  costBound?: number;
  boundGoal?: Vec3;
};
export interface JumpResult {
  route: Route;
  connections: GroundConnection[];
  diagnostics: JumpDiagnostics & { knownActionChains?: JumpDiagnostics };
}
/** A raw ground solve retained only while assembling this physical query. */
export interface InitialGroundProof {
  planner: GroundPlanner;
  surfaces: Surface[];
  arrival: GroundArrival;
  goal: Vec3;
  interaction?: InteractionGoal;
  connections: GroundConnection[];
  route: Route;
}
type Stage = 'direction' | 'relations' | 'entry' | 'final' | 'catalog';

/** Solve directed ground/jump/drop action combinations for arbitrary arrivals.
 * Geometry, collision, state, walls and body must belong to one immutable snapshot.
 * Discovery supplies supported, swept motion edges. The ground planner jointly
 * selects those edges and continuous ground transfers, then verifies its gait policy.
 * A feasible incumbent is retained unless a complete, timed alternative is faster.
 * Search limits constrain candidate coverage, not the number of actions in a route.
 */
function solveJumpRoute(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: PlannerOptions,
  shared: ShortcutCache,
  stage: Stage,
  initial?: Route,
): JumpResult {
  const { interaction, runAirSpeed, model } = options;
  if (!Number.isFinite(runAirSpeed) || runAirSpeed < 0 || runAirSpeed > model.maxHorizontalSpeed) {
    throw new Error('Invalid running air-speed limit');
  }
  if (
    options.maxShortcutCandidates !== undefined &&
    (!Number.isSafeInteger(options.maxShortcutCandidates) || options.maxShortcutCandidates < 0)
  ) {
    throw new Error('Invalid shortcut candidate limit');
  }
  const planner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  const diagnostics: JumpResult['diagnostics'] = {
    strategy: 'surface-action-graph',
    groundStatus: 'unmapped',
    baselineCost: null,
    selectedCost: null,
    truncated: false,
    searches: [],
  };
  let best =
      initial ??
      planner.plan(starts, goal, {
        interaction,
        endpointTolerance: options.endpointTolerance,
        connections: options.connections ?? [],
      }),
    bestConnections = options.connections ?? [];
  const partialConnections = new Map<string, GroundConnection>(
    bestConnections.map((edge) => [edge.id, edge]),
  );
  diagnostics.groundStatus = best.status;
  if (best.status === 'complete') diagnostics.baselineCost = best.cost;
  const ids = new Set<string>(bestConnections.map((connection) => connection.id));
  let serial = 0;
  let unspent = options.maxCandidates;
  const actions = new Map<string, GroundConnection>();
  const withGait = (
    connection: GroundConnection & { peakHorizontalSpeed?: number },
  ): GroundConnection => {
    let velocity = connection.peakHorizontalSpeed ?? 0;
    for (let index = 1; index < connection.points.length; index++) {
      const point = connection.points[index],
        previous = connection.points[index - 1];
      velocity = Math.max(
        velocity,
        Math.hypot(point[0] - previous[0], point[2] - previous[2]) /
          (connection.times[index] - connection.times[index - 1]),
      );
    }
    let id = connection.id;
    while (ids.has(id)) id = `jump-plan/${serial++}`;
    ids.add(id);
    return {
      ...connection,
      id,
      ...(velocity > runAirSpeed + 1e-7 ? { requiredGait: 'sprint' } : {}),
    };
  };
  const search = (discovery: {
    connections: GroundConnection[];
    diagnostics: JumpDiagnostics['searches'][number];
  }): GroundConnection[] => {
    diagnostics.searches.push(discovery.diagnostics);
    diagnostics.truncated ||= discovery.diagnostics.truncated;
    const additions = [];
    for (const connection of discovery.connections) {
      const { id, ...motion } = withGait(connection);
      const key = JSON.stringify(motion);
      if (actions.has(key)) continue;
      const action = { id, ...motion };
      actions.set(key, action);
      rememberCatalogAction(world, surfaces, options, action);
      additions.push(action);
    }
    return additions;
  };
  for (const arrival of starts) {
    if (arrival.state !== 'available' || (best.status === 'complete' && arrival.cost >= best.cost))
      continue;
    const known = new Map<string, GroundConnection>(
      (options.connections ?? []).map((edge) => [edge.id, edge]),
    );
    for (const action of actions.values()) known.set(action.id, action);
    let connections = [...known.values()];
    const initialConnections = connections.length;
    for (const connection of connections) ids.add(connection.id);
    let incumbent =
      starts.length === 1 && connections.length === (options.connections?.length ?? 0)
        ? best
        : planner.plan([arrival], goal, {
            interaction,
            endpointTolerance: options.endpointTolerance,
            connections,
          });
    const discoveryOptions = {
      ...options,
      groundPlanner: planner,
      from: arrival.position,
      to: goal,
      ...(Number.isFinite(options.costBound)
        ? { costBound: options.costBound! - arrival.cost }
        : {}),
    };
    let remaining = options.maxCandidates;
    // Cheap region-chain proposals cover simple transfers before broad frontiers.
    // The same bounded stage runs for every unresolved query.
    const proposalBudget =
      stage === 'relations' ? remaining : Math.min(128, Math.floor(remaining / 8));
    if (incumbent.status !== 'complete' && proposalBudget > 0) {
      const proposal = findJumpConnections(surfaces, world, discoveryOptions, {
        arcAttempts: proposalBudget * 2,
        regionSearches: proposalBudget,
      });
      connections.push(...search(proposal));
      remaining = stage === 'relations' ? 0 : remaining - proposalBudget;
      if (proposal.connections.length)
        incumbent = planner.plan([arrival], goal, {
          interaction,
          endpointTolerance: options.endpointTolerance,
          connections,
        });
    }
    const batches = [Math.min(128, remaining), Math.min(128, remaining)],
      spent = [0, 0];
    const exhausted = new Set<boolean>();
    // The cache owns one current endpoint/model binding. Sharing the owner also
    // preserves cursor invalidations when nested direction or entry queries change it.
    const cache = shared;
    cache.standing ??= new Map();
    cache.motions ??= new Map();
    cache.exits ??= new Map();
    cache.approaches ??= new Map();
    while (incumbent.status !== 'complete' && remaining > 0) {
      const maxLinks = options.maxLinks - connections.length + initialConnections;
      if (maxLinks <= 0) {
        diagnostics.truncated = true;
        break;
      }
      const side = exhausted.has(false) ? 1 : exhausted.has(true) ? 0 : Number(spent[1] < spent[0]);
      const reverse = side === 1;
      const discovery = findJumpFrontier(
        surfaces,
        world,
        {
          ...discoveryOptions,
          connections,
          maxCandidates: Math.min(batches[side], remaining),
          maxLinks,
          speed: options.locomotion?.sprintSpeed ?? options.speed,
        },
        cache,
        reverse,
      );
      const additions = search(discovery);
      // Directed frontiers grow from both ends. Balance charged work, so repeated
      // failures on one side cannot starve a productive chain on the other.
      // One shared budget permits arbitrary hop counts without a depth cap.
      const work = discovery.diagnostics;
      const charged = Math.max(
        1,
        Math.ceil(work.attempted / 2),
        Math.ceil(work.seedChecks / 16),
        Math.ceil(work.neighbourChecks / 64),
        Math.ceil(work.endpointChecks / 4),
      );
      remaining -= charged;
      spent[side] += charged;
      if (!additions.length) {
        if (work.reason === 'unmapped-endpoint') break;
        if (!work.truncated) {
          exhausted.add(reverse);
          if (exhausted.size === 2) break;
        }
        batches[side] = Math.min(options.maxCandidates, batches[side] * 2);
        continue;
      }
      exhausted.clear();
      batches[side] = Math.min(128, remaining);
      connections.push(...additions);
      incumbent = planner.plan([arrival], goal, {
        interaction,
        endpointTolerance: options.endpointTolerance,
        connections,
      });
    }
    if (incumbent.status !== 'complete') {
      unspent = 0;
      for (const connection of connections) partialConnections.set(connection.id, connection);
      continue;
    }
    if (best.status !== 'complete' || incumbent.cost < best.cost) {
      best = incumbent;
      bestConnections = connections;
    }
    const improvementBudget =
      stage === 'catalog'
        ? Math.min(128, remaining, options.maxShortcutCandidates ?? remaining)
        : Math.min(remaining, options.maxShortcutCandidates ?? remaining);
    if (improvementBudget <= 0) {
      unspent = Math.min(unspent, Math.max(0, remaining));
      continue;
    }
    const localBaseline = incumbent,
      localBaseConnections = connections;
    const localBudget =
      stage === 'catalog'
        ? Math.min(128, remaining - improvementBudget)
        : Math.min(128, Math.floor(improvementBudget / 4), remaining - improvementBudget);
    const refinementBudget =
      stage === 'catalog' ? 0 : Math.min(localBudget, remaining - improvementBudget - localBudget);
    unspent = Math.min(
      unspent,
      Math.max(0, remaining - improvementBudget - localBudget - refinementBudget),
    );
    // Reserve the broad comparison before refining its verified incumbent.
    const alternatives =
      improvementBudget > 0
        ? search(
            findJumpShortcuts(
              surfaces,
              world,
              {
                ...discoveryOptions,
                connections,
                maxCandidates: improvementBudget,
                baseline: incumbent,
                speed: options.locomotion?.sprintSpeed ?? options.speed,
              },
              cache,
            ),
          )
        : [];
    if (alternatives.length) {
      connections = [...connections, ...alternatives];
      const candidate = planner.plan([arrival], goal, {
        interaction,
        endpointTolerance: options.endpointTolerance,
        connections,
      });
      if (candidate.status === 'complete' && candidate.cost < incumbent.cost - 1e-7)
        incumbent = candidate;
      if (incumbent.cost < best.cost - 1e-7) {
        best = incumbent;
        bestConnections = connections;
      }
    }
    for (const [baseline, baseConnections, budget] of [
      [localBaseline, localBaseConnections, localBudget],
      [incumbent, connections, incumbent === localBaseline ? 0 : refinementBudget],
    ] as const) {
      if (budget <= 0) continue;
      const local = findRouteShortcuts(
        surfaces,
        world,
        {
          ...discoveryOptions,
          connections,
          maxCandidates: budget,
          baseline,
          speed: options.locomotion?.sprintSpeed ?? options.speed,
        },
        cache,
      );
      const additions = search(local);
      if (additions.length) {
        const localConnections = [...baseConnections, ...additions];
        const localRoute = planner.plan([arrival], goal, {
          interaction,
          endpointTolerance: options.endpointTolerance,
          connections: localConnections,
        });
        if (localRoute.status === 'complete' && localRoute.cost < best.cost - 1e-7) {
          best = localRoute;
          bestConnections = localConnections;
        }
        connections = [...connections, ...additions];
        // Without a separate broad overlay, both local comparisons contain the
        // same action objects in the same order. Keep the first physical proof.
        const candidate =
          localConnections.length === connections.length &&
          localConnections.every((connection, index) => connection === connections[index])
            ? localRoute
            : planner.plan([arrival], goal, {
                interaction,
                endpointTolerance: options.endpointTolerance,
                connections,
              });
        if (candidate.status === 'complete' && candidate.cost < incumbent.cost - 1e-7)
          incumbent = candidate;
        if (incumbent.cost < best.cost - 1e-7) {
          best = incumbent;
          bestConnections = connections;
        }
      }
    }
  }
  diagnostics.unusedCandidates = unspent;
  if (best.status === 'complete') diagnostics.selectedCost = best.cost;
  return {
    route: best,
    connections: best.status === 'complete' ? bestConnections : [...partialConnections.values()],
    diagnostics,
  };
}
/** Coarse waypoints guide bounded action discovery; they never grant passage or
 * constrain the final route to visit those points. Only the accumulated physically
 * validated actions enter the final, jointly timed start-to-goal query.
 */
function planDirectedRoute(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: PlannerOptions,
  shared: ShortcutCache,
  stage: Stage,
  initial?: Route,
): JumpResult {
  const { waypoints, onProgress, ...base } = options;
  validateWaypoints(waypoints);
  if (onProgress !== undefined && typeof onProgress !== 'function')
    throw new Error('Invalid route progress callback');
  if (!waypoints?.length)
    return solveJumpRoute(surfaces, world, starts, goal, base, shared, stage, initial);
  const planner = base.groundPlanner ?? createGroundPlanner(surfaces, base);
  const initialConnections = base.connections ?? [];
  initial ??= planner.plan(starts, goal, {
    interaction: base.interaction,
    endpointTolerance: base.endpointTolerance,
    connections: initialConnections,
  });
  if (initial.status === 'complete') {
    return solveJumpRoute(
      surfaces,
      world,
      starts,
      goal,
      { ...base, groundPlanner: planner },
      shared,
      'final',
      initial,
    );
  }
  const prepared = groundPreparation(planner);
  const project = prepared?.projectGoal ?? createGoalProjector(surfaces),
    searches: NonNullable<JumpDiagnostics['directions']>['searches'] = [];
  const topology =
    prepared && movementGeometry(surfaces, { ...base, groundPlanner: planner }).topology;
  const regions = new Set<string | number>(),
    directions = [];
  for (const point of waypoints) {
    const witness = project.closest(point, {
      maxVertical: base.maxVertical,
      interaction: { radius: base.maxHorizontalDistance, maxVertical: base.profile.height * 2 },
    });
    if (!witness) {
      searches.push({ point: [...point], status: 'unmapped', added: 0 });
      continue;
    }
    // Several coarse cells can describe the same mutually ground-reachable region.
    // Spend discovery on its interface once, not once per arbitrary cell centre.
    // Only directed, wall-filtered ground connectivity authorizes this grouping;
    // spatial proximity and one-way drops must not merge floors.
    const region = topology
      ? topology.components[topology.ids.get(witness.surface)!]
      : witness.surface;
    if (regions.has(region)) continue;
    regions.add(region);
    directions.push({ point, witness });
  }
  const budget = Math.floor(base.maxCandidates / (2 * Math.max(1, directions.length)));
  let connections = initialConnections,
    remaining = base.maxCandidates;
  let goalRoute: Route = initial,
    goalConnections = connections;
  for (const [index, { point, witness }] of directions.entries()) {
    if (budget < 1) break;
    onProgress?.({ phase: 'direction-search', completed: index, total: directions.length });
    const previous = connections.length;
    const result = solveJumpRoute(
      surfaces,
      world,
      starts,
      witness.position,
      {
        ...base,
        groundPlanner: planner,
        interaction: undefined,
        connections,
        maxCandidates: budget,
        maxShortcutCandidates: 0,
      },
      shared,
      'direction',
    );
    if (result.diagnostics.searches.length) remaining -= budget;
    connections = result.connections;
    searches.push({
      point: [...point],
      support: witness.position,
      status: result.route.status,
      added: connections.length - previous,
      diagnostics: result.diagnostics,
    });
    onProgress?.({
      phase: 'direction-search',
      completed: index + 1,
      total: directions.length,
      status: result.route.status,
      connections: connections.length,
    });
    if (connections.length - (base.connections?.length ?? 0) >= base.maxLinks) break;
    if (connections.length > previous) {
      goalRoute = planner.plan(starts, goal, {
        interaction: base.interaction,
        endpointTolerance: base.endpointTolerance,
        connections,
      });
      goalConnections = connections;
      if (goalRoute.status === 'complete') break;
    }
  }
  // The final phase starts from the same goal probe whenever the action list is
  // unchanged. Carry that result through this call, without a route-result cache.
  const unchanged =
    goalConnections.length === connections.length &&
    goalConnections.every((connection, index) => connection === connections[index]);
  const result = solveJumpRoute(
    surfaces,
    world,
    starts,
    goal,
    { ...base, groundPlanner: planner, connections, maxCandidates: remaining },
    shared,
    stage,
    unchanged ? goalRoute : undefined,
  );
  result.diagnostics.directions = {
    requestedGoals: waypoints.length,
    regions: directions.length,
    budgetPerGoal: budget,
    remaining,
    searches,
  };
  return result;
}
/** Preserve completed searches, then resolve causal entry approaches when known
 * actions can reach the goal from a still-inaccessible region. Each retained entry
 * gets an explicit bounded query. Only a complete joint final-goal solve is returned.
 */
function planBaseRoute(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: PlannerOptions,
  initial?: Route,
  catalogSeeds: GroundConnection[] = [],
): JumpResult {
  const shared: ShortcutCache = {};
  const goalPlanner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  const existing = new Set((options.connections ?? []).map((action) => action.id));
  const seeds = catalogSeeds.filter((action) => !existing.has(action.id));
  const directedOptions = seeds.length
    ? { ...options, connections: [...(options.connections ?? []), ...seeds] }
    : options;
  // A new action overlay requires a fresh original-start-to-goal resource proof.
  // Keep authored options unchanged: their entry-fallback gate is independent of seeds.
  if (seeds.length) initial = undefined;
  const airborneOnly =
    options.interaction?.airborne &&
    !goalPlanner.project(goal, {
      maxVertical: options.maxVertical,
      interaction: options.interaction,
    }).length;
  // An airborne event has no ground node. Discover its complete flight first,
  // then search the supported departure using the ordinary entry machinery.
  const result: JumpResult = airborneOnly
    ? {
        route: { status: 'unmapped' },
        connections: options.connections ?? [],
        diagnostics: {
          strategy: 'surface-action-graph',
          groundStatus: 'unmapped',
          baselineCost: null,
          selectedCost: null,
          truncated: false,
          searches: [],
        },
      }
    : planDirectedRoute(
        surfaces,
        world,
        starts,
        goal,
        { ...directedOptions, groundPlanner: goalPlanner },
        shared,
        'final',
        initial,
      );
  if (seeds.length) result.diagnostics.catalogSeedActions = seeds.length;
  if (options.interaction?.airborne && result.route.status !== 'complete') {
    const planner = goalPlanner;
    const airborne = planAirborneGoal(
      surfaces,
      world,
      starts,
      goal,
      { ...options, groundPlanner: planner, interaction: options.interaction },
      (position: Vec3, maxCost: number) =>
        planDirectedRoute(
          surfaces,
          world,
          starts,
          position,
          {
            ...options,
            groundPlanner: planner,
            interaction: undefined,
            endpointTolerance: Math.min(options.maxVertical, options.profile.radius),
            connections: result.connections,
            maxShortcutCandidates: options.activeBoost ? options.maxCandidates : 0,
            ...(Number.isFinite(maxCost) ? { costBound: maxCost, boundGoal: position } : {}),
          },
          shared,
          'entry',
        ),
    );
    result.diagnostics.airborne = airborne.diagnostics;
    result.diagnostics.truncated ||= airborne.diagnostics.truncated;
    if (airborne.route.status === 'complete')
      return {
        ...result,
        route: airborne.route,
        connections: airborne.connections,
        diagnostics: { ...result.diagnostics, selectedCost: airborne.route.cost },
      };
  }
  if (result.route.status === 'complete' || !options.connections?.length) return result;
  const planner = options.groundPlanner ?? createGroundPlanner(surfaces, options);
  // Failed discovery still contains physically validated actions. Entry searches
  // continue that pool and its geometry preparation within this immutable query.
  let known = result.connections;
  const probe = (position: Vec3, target: Vec3, interaction?: JumpRouteOptions['interaction']) =>
    planner.plan([{ id: '@device-entry', position, state: 'available', cost: 0 }], target, {
      interaction,
      endpointTolerance: options.endpointTolerance,
      connections: known,
    }).status === 'complete';
  // Screen entries lazily so an early complete route can be published without
  // first solving every pair of device approaches. Exact-coordinate duplicates
  // share the same fresh entry state; distinct positions retain their own trial.
  const sources = [
    ...new Map<string, GroundConnection>(
      known
        .filter((edge) => edge.state === 'open' && !edge.terminal)
        .map((edge) => [JSON.stringify(edge.points[0]), edge]),
    ).values(),
  ];
  let eligible = false;
  const geometry = movementGeometry(surfaces, { ...options, groundPlanner: planner });
  const regions = new Map<GroundConnection, string | number>(
    sources.map((edge) => {
      const support = geometry.projectSupport(
        edge.points[0],
        edge.endpointTolerance ?? 1e-6,
        edge.fromSurface,
      );
      const component =
        support && geometry.topology.components[geometry.topology.ids.get(support.surface)!];
      return [edge, component ?? edge.id];
    }),
  );
  const arrivals = starts.filter((start) => start.state === 'available');
  const scores = new Map(
    sources.map((edge) => [
      edge,
      Math.min(
        ...arrivals.map(
          (start) =>
            start.cost +
            Math.hypot(...edge.points[0].map((value, axis) => value - start.position[axis])) /
              options.speed,
        ),
      ),
    ]),
  );
  sources.sort((a, b) => scores.get(a)! - scores.get(b)!);
  const entryBudget = Math.min(
    options.maxCandidates,
    Math.max(128, Math.floor(options.maxCandidates / 8)),
  );
  let entryRemaining = options.maxCandidates;
  const attempts: NonNullable<JumpDiagnostics['deviceApproaches']> = {
    budgetPerGoal: entryBudget,
    goals: sources.length,
    searches: [],
  };
  const searchedRegions = new Set<string | number>();
  for (const [index, edge] of sources.entries()) {
    const region = regions.get(edge);
    // One entry discovery covers a mutually walk-reachable ground region. This
    // reuses the existing directed ground proof without solving every entry pair.
    if (region !== undefined && region !== null && searchedRegions.has(region)) continue;
    options.onProgress?.({ phase: 'device-entry-search', completed: index, total: sources.length });
    if (!probe(edge.points[0], goal, options.interaction)) {
      options.onProgress?.({
        phase: 'device-entry-search',
        completed: index + 1,
        total: sources.length,
        status: 'no-verified-route',
      });
      continue;
    }
    if (entryRemaining <= 0) {
      result.diagnostics.truncated = true;
      break;
    }
    eligible = true;
    if (region !== undefined && region !== null) searchedRegions.add(region);
    const budget = Math.min(entryBudget, entryRemaining);
    const trial = planDirectedRoute(
      surfaces,
      world,
      starts,
      edge.points[0],
      {
        ...options,
        groundPlanner: planner,
        connections: known,
        interaction: undefined,
        waypoints: undefined,
        maxShortcutCandidates: 0,
        maxCandidates: budget,
      },
      shared,
      'entry',
    );
    entryRemaining -= budget;
    result.diagnostics.truncated ||= trial.diagnostics.truncated;
    known = trial.connections;
    const route = planner.plan(starts, goal, {
      interaction: options.interaction,
      connections: trial.connections,
    });
    attempts.searches.push({
      device: edge.id,
      budget,
      status: route.status,
      discovery: trial.diagnostics,
    });
    options.onProgress?.({
      phase: 'device-entry-search',
      completed: index + 1,
      total: sources.length,
      status: route.status,
    });
    if (route.status === 'complete') {
      const improvement = solveJumpRoute(
        surfaces,
        world,
        starts,
        goal,
        {
          ...options,
          groundPlanner: planner,
          connections: trial.connections,
          maxCandidates: trial.diagnostics.unusedCandidates ?? 0,
        },
        shared,
        'final',
        route,
      );
      return {
        ...result,
        route: improvement.route,
        connections: improvement.connections,
        diagnostics: {
          ...result.diagnostics,
          selectedCost: improvement.route.status === 'complete' ? improvement.route.cost : null,
          deviceApproaches: attempts,
          deviceImprovement: improvement.diagnostics,
        },
      };
    }
  }
  if (!eligible) {
    // New action chains supplement an unresolved primary query. Earlier feasible
    // searches keep their original discovery and shortcut budgets.
    const continuation = solveJumpRoute(
      surfaces,
      world,
      starts,
      goal,
      {
        ...options,
        groundPlanner: planner,
        connections: known,
        maxCandidates: Math.min(128, options.maxCandidates),
        maxShortcutCandidates: 0,
      },
      shared,
      'relations',
    );
    return {
      ...continuation,
      diagnostics: {
        ...result.diagnostics,
        selectedCost: continuation.diagnostics.selectedCost,
        knownActionChains: continuation.diagnostics,
      },
    };
  }
  result.connections = known;
  result.diagnostics.deviceApproaches = attempts;
  return result;
}
/** Sampling limits can leave valid routes undiscovered; completion does not establish global optimality. */
export function planJumpRoute(
  surfaces: Surface[],
  world: CollisionWorld,
  starts: GroundArrival[],
  goal: Vec3,
  options: JumpRouteOptions,
  initial?: InitialGroundProof,
): JumpResult {
  const { actions: selected, seeds } = selectCatalogActions(world, surfaces, starts, goal, options);
  if (selected.length) {
    const connections = [...(options.connections ?? []), ...selected];
    const route = options.groundPlanner!.plan(starts, goal, {
      interaction: options.interaction,
      connections,
    });
    noteActionCatalogResult(route.status === 'complete');
    if (route.status === 'complete') {
      // A reused feasible chain may miss a better departure near a fresh start.
      // Compare new action regions and refine its selected incumbent with bounded work.
      const arrival = starts.find((start) => start.id === route.start)!;
      const result = solveJumpRoute(
        surfaces,
        world,
        [arrival],
        goal,
        { ...options, connections },
        {},
        'catalog',
        route,
      );
      result.diagnostics.truncated ||= Boolean(
        route.search?.truncated || route.locomotion?.search?.truncated,
      );
      return result;
    }
  }
  const connections = options.connections ?? [];
  const unchanged =
    initial !== undefined &&
    initial.planner === options.groundPlanner &&
    initial.surfaces === surfaces &&
    starts.length === 1 &&
    initial.arrival === starts[0] &&
    initial.goal === goal &&
    initial.interaction === options.interaction &&
    initial.connections.length === connections.length &&
    initial.connections.every((connection, index) => connection === connections[index]);
  const result = planBaseRoute(
    surfaces,
    world,
    starts,
    goal,
    options,
    unchanged ? initial.route : undefined,
    seeds,
  );
  const best = options.boosts?.length
    ? planBoostedRoute(surfaces, world, starts, goal, options, result, planBaseRoute)
    : result;
  if (options.interaction?.airborne && best.route.status === 'complete' && !best.route.goalHit) {
    const point = best.route.points.at(-1)!;
    if (findGoalHit([point, point], goal, options.interaction))
      best.route = markTerminalGoal(best.route);
  }
  return best;
}

export function validateWaypoints(waypoints: unknown): asserts waypoints is Vec3[] | undefined {
  if (
    waypoints !== undefined &&
    (!Array.isArray(waypoints) ||
      waypoints.length > 128 ||
      waypoints.some(
        (point) => !Array.isArray(point) || point.length !== 3 || !point.every(Number.isFinite),
      ))
  ) {
    throw new Error('Invalid coarse waypoints');
  }
}
