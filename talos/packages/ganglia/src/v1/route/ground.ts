import type { Vec3, Surface, Wall } from '#@/src/geometry.ts';
import { type GoalProjector, createGoalProjector, findGoalHit } from '#@/src/model/goals.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { InteractionGoal, Segment } from '#@/src/movement.ts';
import type {
  GroundArrival,
  GroundConnection,
  GroundOptions,
  Route,
  ResourceSearch,
} from '#@/src/route.ts';
import {
  createSupportProjector,
  verticalProjectionCandidates,
} from '#@/src/v1/geo/support-projector.ts';
import {
  type DirectedPortal,
  type SharedPortal,
  directedPortals,
  projectPoint,
  surfaceGraph,
  surfacePortals,
} from '#@/src/v1/geo/surfaces.ts';
import { validateMotion } from '#@/src/v1/motion/motion.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import {
  type Graph,
  type Arrival,
  prepareOverlayRoutePlanner,
  prepareRoutePlanner,
} from '#@/src/v1/route/routes.ts';
import { type GroundStraightener, createGroundStraightener } from '#@/src/v1/route/straighten.ts';

export type LookupMap<K, V> = Pick<ReadonlyMap<K, V>, 'get' | 'has'>;

export interface GroundQueryOptions {
  interaction?: InteractionGoal;
  endpointTolerance?: number;
  connections?: GroundConnection[];
}

export interface GroundPlanner {
  /** Reuse this snapshot's floor/interaction projector. Projection alone does not
   * establish body clearance, wall state or reachability. */
  project: GoalProjector;
  plan(starts: GroundArrival[], goal: Vec3, query?: GroundQueryOptions): Route;
}

interface OverlayMeta {
  basePlanner: GroundPlanner;
  basePrep: Preparation;
  extraSurfaces: Surface[];
  extraPortals: SharedPortal[];
}

interface Preparation {
  surfaces: Surface[];
  planWalkingGeometry(from: Vec3, to: Vec3): Route;
  portals: SharedPortal[];
  directed: DirectedPortal[];
  straighten: GroundStraightener;
  projectGoal: GoalProjector;
  projectSupport: ReturnType<typeof createSupportProjector>;
  byId: LookupMap<string, Surface>;
  centers: LookupMap<string, Vec3>;
  graph: Graph;
  routeBase: ReturnType<typeof prepareRoutePlanner>;
  getUnwalledRouteBase(): ReturnType<typeof prepareRoutePlanner>;
  walls: Wall[];
  profile: GroundOptions['profile'];
  constraintsSignature: string;
  searchSpeed: number;
  peakSpeed: number;
  importedPortals?: GroundOptions['portals'];
  overlay?: OverlayMeta;
}
interface Projection {
  surface: string;
  position: Vec3;
  support?: Vec3;
}
interface Endpoint {
  id: string;
  position: Vec3;
  support: Vec3;
  key: string;
}

const preparations = new WeakMap<GroundPlanner, Preparation>();
/** Internal immutable preparation shared with action discovery for the same planner. */
export const groundPreparation = (planner?: GroundPlanner): Preparation | undefined =>
  preparations.get(planner!);

// Wall-independent topology base cached weakly by immutable Surface[] owner.
// Switching walls (e.g. raw -> roundedWalls in solve.ts) or creating a second
// planner on the same snapshot reuses portals, surfaceGraph, byId, and
// projectGoal without recomputing surfacePortals or BoundsIndex from scratch.
interface SurfaceWeakComponents {
  indexById: Map<string, number>;
  parent: Int32Array;
}
interface GroundTopologyEntry {
  length: number;
  portals: SharedPortal[];
  byId: Map<string, Surface>;
  projectGoal: GoalProjector;
  graph?: {
    searchSpeed: number;
    importedPortals: GroundOptions['portals'];
    importedLength: number;
    directed: DirectedPortal[];
    base: Graph;
    baseCenters: Map<string, Vec3>;
    unwalledRouteBase?: ReturnType<typeof prepareRoutePlanner>;
    weakComponents?: SurfaceWeakComponents;
  };
}
const topologyCache = new WeakMap<Surface[], GroundTopologyEntry>();

/** Release cached wall-independent topology when a surface array retires. */
export const releaseGroundTopologyCache = (surfaces: Surface[]) => topologyCache.delete(surfaces);

const findWeakRoot = (parent: Int32Array, index: number): number => {
  while (parent[index] !== index) {
    parent[index] = parent[parent[index]];
    index = parent[index];
  }
  return index;
};

function buildSurfaceWeakComponents(
  surfaces: Surface[],
  portals: SharedPortal[],
  directed: DirectedPortal[],
): SurfaceWeakComponents {
  const n = surfaces.length;
  const indexById = new Map<string, number>();
  const parent = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    indexById.set(surfaces[i].id, i);
    parent[i] = i;
  }
  for (let i = 0; i < portals.length; i++) {
    const a = indexById.get(portals[i].from);
    const b = indexById.get(portals[i].to);
    if (a !== undefined && b !== undefined) {
      const ra = findWeakRoot(parent, a);
      const rb = findWeakRoot(parent, b);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  for (let i = 0; i < directed.length; i++) {
    const a = indexById.get(directed[i].from);
    const b = indexById.get(directed[i].to);
    if (a !== undefined && b !== undefined) {
      const ra = findWeakRoot(parent, a);
      const rb = findWeakRoot(parent, b);
      if (ra !== rb) parent[rb] = ra;
    }
  }
  return { indexById, parent };
}

function groundTopologyFor(
  surfaces: Surface[],
  searchSpeed: number,
  importedPortals: GroundOptions['portals'],
) {
  let entry = topologyCache.get(surfaces);
  if (!entry || entry.length !== surfaces.length) {
    const portals = surfacePortals(surfaces);
    const byId = new Map<string, Surface>();
    for (let i = 0; i < surfaces.length; i++) byId.set(surfaces[i].id, surfaces[i]);
    const projectGoal = createGoalProjector(surfaces);
    entry = { length: surfaces.length, portals, byId, projectGoal };
    topologyCache.set(surfaces, entry);
  }
  const importedLength = importedPortals?.length ?? 0;
  if (
    !entry.graph ||
    entry.graph.searchSpeed !== searchSpeed ||
    entry.graph.importedPortals !== importedPortals ||
    entry.graph.importedLength !== importedLength
  ) {
    const directed = directedPortals(surfaces, importedPortals, entry.byId);
    const base = surfaceGraph(
      surfaces,
      { speed: searchSpeed, portals: importedPortals },
      entry.portals,
      directed,
      entry.byId,
    );
    const baseCenters = new Map<string, Vec3>();
    for (let i = 0; i < base.nodes.length; i++) {
      const node = base.nodes[i];
      baseCenters.set(node.id, node.position);
    }
    entry.graph = { searchSpeed, importedPortals, importedLength, directed, base, baseCenters };
  }
  const graphEntry = entry.graph;
  return {
    portals: entry.portals,
    byId: entry.byId,
    projectGoal: entry.projectGoal,
    directed: graphEntry.directed,
    base: graphEntry.base,
    baseCenters: graphEntry.baseCenters,
    getUnwalledRouteBase(profile: GroundOptions['profile']) {
      return (graphEntry.unwalledRouteBase ??= prepareRoutePlanner(graphEntry.base, {
        walls: [],
        profile,
      }));
    },
    getWeakComponents() {
      return (graphEntry.weakComponents ??= buildSurfaceWeakComponents(
        surfaces,
        entry!.portals,
        graphEntry.directed,
      ));
    },
  };
}
/** Ground endpoints retain their projected positions. Each connector lies within its
 * convex source polygon; only the importer may select admissible surfaces/state.
 * Directed connections must already have grounded endpoints and validated trajectories.
 * Teleport entry costs are seconds, and unknown availability never grants access.
 */
export function planGroundRoute(
  surfaces: Surface[],
  starts: GroundArrival[],
  goal: Vec3,
  options: GroundOptions,
): Route {
  return createGroundPlanner(surfaces, options).plan(starts, goal);
}
/**
 * Combine an already-indexed static GoalProjector with a small temporary surface
 * overlay so per-layout queries never re-index the full static surface set.
 */
export const combineGoalProjectors = (
  base: GoalProjector,
  overlay: GoalProjector,
): GoalProjector => {
  const combined: GoalProjector = (target, options) => {
    const a = base(target, options);
    const b = overlay(target, options);
    if (!b.length) return a;
    if (!a.length) return b;
    if (options.interaction === undefined) return a[0].distance <= b[0].distance ? a : b;
    // Preserve [...base, ...overlay] order on equal distance ties.
    const merged: typeof a = [];
    let i = 0,
      j = 0;
    while (i < a.length && j < b.length) {
      merged.push(a[i].distance <= b[j].distance ? a[i++] : b[j++]);
    }
    while (i < a.length) merged.push(a[i++]);
    while (j < b.length) merged.push(b[j++]);
    return merged;
  };
  combined.closest = (target, options) => {
    const a = base.closest(target, options);
    const b = overlay.closest(target, options);
    if (!a) return b;
    if (!b) return a;
    return a.distance <= b.distance ? a : b;
  };
  return combined;
};

const overlayLookup = <K, V>(base: LookupMap<K, V>, own: ReadonlyMap<K, V>): LookupMap<K, V> => ({
  has: (key: K) => own.has(key) || base.has(key),
  get: (key: K) => own.get(key) ?? base.get(key),
});

const finiteVec3 = (point: unknown): point is Vec3 =>
  Array.isArray(point) &&
  point.length === 3 &&
  Number.isFinite(point[0]) &&
  Number.isFinite(point[1]) &&
  Number.isFinite(point[2]);

interface PlannerParts {
  surfaces: Surface[];
  options: GroundOptions;
  searchSpeed: number;
  peakSpeed: number;
  portals: SharedPortal[];
  directed: DirectedPortal[];
  byId: LookupMap<string, Surface>;
  centers: LookupMap<string, Vec3>;
  projectGoal: GoalProjector;
  projectSupport: ReturnType<typeof createSupportProjector>;
  graph: Graph;
  routeBase: ReturnType<typeof prepareRoutePlanner>;
  getUnwalledRouteBase: () => ReturnType<typeof prepareRoutePlanner>;
  straighten: GroundStraightener;
  constraintsSignature: string;
  overlay?: OverlayMeta;
}

function assembleGroundPlanner(parts: PlannerParts): GroundPlanner {
  const {
    surfaces,
    options,
    searchSpeed,
    peakSpeed,
    portals,
    directed,
    byId,
    centers,
    projectGoal,
    projectSupport,
    graph: baseGraph,
    routeBase,
    getUnwalledRouteBase,
    straighten,
    constraintsSignature,
    overlay,
  } = parts;
  const { speed, maxVertical, walls, profile, connections = [] } = options;
  const blocked = routeBase.blocked!;
  const visibility = new Map<string, Map<string, Vec3[]>>();
  const failedVisibility = new Map<string, Set<string>>();
  let endpointKeys = new Map<string, string>();
  const planRoute = (
    starts: GroundArrival[],
    goal: Vec3,
    query: GroundQueryOptions = {},
    mode: 'timed' | 'geometry' = 'timed',
  ): Route => {
    // Transfers depend on support coordinates within this immutable planner.
    // Keep fixed device transfers when action discovery changes its target.
    const graph: Graph = { nodes: [], edges: [] };
    let targets: Projection[] = projectGoal(goal, {
      maxVertical,
      interaction: query.interaction,
    });
    if (query.endpointTolerance !== undefined) {
      const tolerance = query.endpointTolerance;
      if (
        !Number.isFinite(tolerance) ||
        tolerance < 0 ||
        tolerance > Math.min(maxVertical, profile.radius) ||
        query.interaction
      ) {
        throw new Error('Invalid goal endpoint tolerance');
      }
      const support = projectSupport(goal, tolerance);
      targets = support ? [{ ...support, support: support.position, position: goal }] : [];
    }
    if (!targets.length && (!query.interaction || query.interaction.airborne)) {
      visibility.clear();
      failedVisibility.clear();
      endpointKeys.clear();
      return { status: 'unmapped' };
    }
    const endpoints = new Map<string, Endpoint[]>();
    const currentKeys = new Map<string, string>();
    let serial = 0;
    const unique = () => {
      let id;
      do {
        id = `@endpoint/${serial++}`;
      } while (centers.has(id));
      return id;
    };
    const connect = (from: string, to: string, a: Vec3, b: Vec3) =>
      graph.edges.push({
        from,
        to,
        state: 'open',
        points: [a, b],
        cost: Math.hypot(...a.map((v, i) => v - b[i])) / searchSpeed,
      });
    const endpoint = (projected: Projection) => {
      const id = unique();
      graph.nodes.push({ id, position: projected.position });
      const center = centers.get(projected.surface)!;
      connect(projected.surface, id, center, projected.position);
      connect(id, projected.surface, projected.position, center);
      // Same-face transfers must not detour through the polygon centre, including
      // walking from an arrival to a rope or between two movement devices.
      const peers = endpoints.get(projected.surface) ?? [];
      for (const peer of peers) {
        connect(id, peer.id, projected.position, peer.position);
        connect(peer.id, id, peer.position, projected.position);
      }
      const support = projected.support ?? projected.position;
      // Recheck caller-owned coordinates on every plan, sharing one string per
      // live support point across all directional failure sets and query extensions.
      const serialized = JSON.stringify(support);
      const key = currentKeys.get(serialized) ?? endpointKeys.get(serialized) ?? serialized;
      currentKeys.set(key, key);
      peers.push({ id, position: projected.position, support, key });
      endpoints.set(projected.surface, peers);
      return id;
    };
    const targetIds = targets.map(endpoint);
    const goals = new Set<string>(targetIds);
    const arrivals: Arrival[] = [],
      ids = new Set<string>();
    for (const start of starts) {
      if (
        typeof start.id !== 'string' ||
        ids.has(start.id) ||
        !Number.isFinite(start.cost) ||
        start.cost < 0 ||
        !['available', 'locked', 'unknown'].includes(start.state)
      )
        throw new Error('Invalid arrival');
      ids.add(start.id);
      const projected = projectGoal(start.position, { maxVertical })[0];
      if (!projected || start.state !== 'available') continue;
      arrivals.push({
        id: start.id,
        node: endpoint(projected),
        cost: start.cost,
        state: start.state,
      });
    }
    const connectionIds = new Set<string>();
    for (const connection of query.connections ?? connections) {
      const { id, mode, points, times, state, requiredGait } = connection;
      if (
        typeof id !== 'string' ||
        !id ||
        connectionIds.has(id) ||
        mode === undefined ||
        (mode as string) === 'walk' ||
        !['open', 'closed', 'unknown'].includes(state) ||
        !Array.isArray(points) ||
        points.length < 2 ||
        points.some((p) => !Array.isArray(p) || p.length !== 3 || !p.every(Number.isFinite)) ||
        !Array.isArray(times)
      ) {
        throw new Error('Invalid ground connection');
      }
      connectionIds.add(id);
      const cost = times.at(-1)!;
      validateMotion({ mode, points, times, cost, connection: id, requiredGait });
      if (
        state !== 'open' ||
        connection.terminal ||
        (connection.requiredBoost !== undefined && connection.requiredBoost !== options.activeBoost)
      )
        continue;
      // Gait-dependent trajectories need an explicit resource policy to prove
      // their entry condition. Other supplied connections remain usable.
      if (requiredGait !== undefined && !options.locomotion) continue;
      // Endpoints default to exact support. Any explicit collision-support allowance
      // stays within body radius and the caller's floor-projection limit.
      const tolerance = connection.endpointTolerance ?? 1e-6;
      if (
        !Number.isFinite(tolerance) ||
        tolerance < 0 ||
        tolerance > Math.max(1e-6, Math.min(maxVertical, profile.radius))
      ) {
        throw new Error('Invalid movement endpoint tolerance');
      }
      for (const surface of [connection.fromSurface, connection.toSurface]) {
        if (surface !== undefined && !byId.has(surface))
          throw new Error('Invalid movement support surface');
      }
      const fromProjection = projectSupport(points[0], tolerance, connection.fromSurface);
      const toProjection = projectSupport(points.at(-1)!, tolerance, connection.toSurface);
      // Explicit collision-validated standing feet may sit above the navigation
      // support plane (rounded capsule support on slopes, or voxel-height error).
      const from = fromProjection && {
        ...fromProjection,
        position: points[0],
        support: fromProjection.position,
      };
      const to = toProjection && {
        ...toProjection,
        position: points.at(-1)!,
        support: toProjection.position,
      };
      if (!from || !to) continue;
      const fromId = endpoint(from),
        toId = endpoint(to);
      // A fully executed supported action can already satisfy an ordinary
      // interaction. Do not add a walk back to its navigation-height projection.
      if (
        query.interaction &&
        !query.interaction.airborne &&
        findGoalHit([to.position, to.position], goal, query.interaction)
      ) {
        targetIds.push(toId);
        goals.add(toId);
      }
      graph.edges.push({
        from: fromId,
        to: toId,
        state,
        cost,
        mode,
        points,
        times,
        connection: id,
        ...(connection.flight ? { flight: connection.flight } : {}),
        ...(requiredGait === undefined ? {} : { requiredGait }),
        ...(connection.traversal === undefined ? {} : { traversal: connection.traversal }),
      });
    }
    if (!targetIds.length) {
      visibility.clear();
      failedVisibility.clear();
      endpointKeys.clear();
      return { status: 'unmapped' };
    }
    // Transfer proofs belong only to the live endpoints. Growing action overlays
    // need no pair scan; removed or moved endpoints discard both directions.
    let discarded = false;
    for (const key of endpointKeys.keys())
      if (!currentKeys.has(key)) {
        discarded = true;
        break;
      }
    if (discarded)
      for (const cache of [visibility, failedVisibility]) {
        for (const [from, targets] of cache) {
          if (!currentKeys.has(from)) {
            cache.delete(from);
            continue;
          }
          for (const to of targets.keys()) if (!currentKeys.has(to)) targets.delete(to);
          if (!targets.size) cache.delete(from);
        }
      }
    endpointKeys = currentKeys;
    // Action decisions use continuous, supported ground transfers whenever the
    // endpoints see each other. Dense triangulation must not make an otherwise
    // cheap walk to a takeoff appear longer than a different jump sequence.
    const groups = [...endpoints.values()];
    for (let a = 0; a < groups.length; a++)
      for (let b = a + 1; b < groups.length; b++) {
        for (const left of groups[a])
          for (const right of groups[b]) {
            if (connectionIds.size && !straighten.mayConnect(left.support, right.support)) continue;
            for (const [from, to] of [
              [left, right],
              [right, left],
            ]) {
              if (goals.has(from.id) && goals.has(to.id)) continue;
              if (failedVisibility.get(from.key)?.has(to.key)) continue;
              const traced =
                visibility.get(from.key)?.get(to.key) ?? straighten.trace(from.support, to.support);
              if (!traced) {
                const failed = failedVisibility.get(from.key) ?? new Set<string>();
                failed.add(to.key);
                failedVisibility.set(from.key, failed);
                continue;
              }
              const visible = visibility.get(from.key) ?? new Map<string, Vec3[]>();
              visible.set(to.key, traced);
              visibility.set(from.key, visible);
              const points = [from.position, ...traced.slice(1, -1), to.position];
              const cost =
                points
                  .slice(1)
                  .reduce((sum, point, index) => sum + distance(points[index], point), 0) /
                searchSpeed;
              graph.edges.push({ from: from.id, to: to.id, points, cost, state: 'open' });
            }
          }
      }
    // Compare actual continuous lengths and movement times for each available origin.
    // Centre-corridor costs alone can rank nearby teleport arrivals incorrectly.
    let best: Extract<Route, { status: 'complete' }> | null = null,
      search: ResourceSearch | undefined;
    for (const arrival of arrivals) {
      if (best && arrival.cost >= best.cost) continue;
      let candidate = routeBase.plan(graph, [arrival], targetIds);
      if (candidate.status !== 'complete' && walls.some((wall) => wall.state !== 'inactive')) {
        // A blocked polygon centre can disconnect the representative graph even
        // when its support corridor admits a clear continuous path. Try that
        // corridor, then validate every reconstructed segment against all walls.
        candidate = getUnwalledRouteBase().plan(graph, [arrival], targetIds);
      }
      if (candidate.status !== 'complete') continue;
      const continuous = straightenRoute(candidate, straighten, speed);
      if (
        blocked(continuous.points[0], continuous.points[0]) ||
        continuous.points.slice(1).some((point, index) => blocked(continuous.points[index], point))
      )
        continue;
      // A detour comparison needs continuous geometry for a splice into an
      // existing route. Its resource state belongs to that complete route.
      if (mode === 'geometry') return continuous;
      let timed = options.locomotion
        ? retimeGroundRoute(continuous, options.locomotion)
        : continuous;
      if (timed.status !== 'complete' && options.locomotion) {
        // An infeasible fastest corridor must not hide a slower resource-feasible
        // alternative. Retain the searched schedule if smoothing removes recovery.
        const resource = routeBase.plan(graph, [arrival], targetIds, options.locomotion);
        search = {
          ...resource.search!,
          expanded: (search?.expanded ?? 0) + resource.search!.expanded,
          truncated: Boolean(search?.truncated || resource.search!.truncated),
        };
        if (resource.status === 'complete') {
          const smoothed = straightenRoute(resource, straighten, speed);
          const retimed = retimeGroundRoute(smoothed, options.locomotion);
          timed =
            retimed.status === 'complete' && retimed.cost < resource.cost ? retimed : resource;
          timed = { ...timed, search: resource.search };
        } else timed = resource;
      }
      if (timed.status !== 'complete') continue;
      if (!best || timed.cost < best.cost) best = timed;
    }
    const result: Route = best ?? { status: arrivals.length ? 'no-verified-route' : 'unmapped' };
    return search ? { ...result, search } : result;
  };
  const planner: GroundPlanner = {
    project: projectGoal,
    plan: (starts, goal, query) => planRoute(starts, goal, query),
  };
  preparations.set(planner, {
    planWalkingGeometry: (from, to) =>
      planRoute(
        [{ id: '@detour', position: from, state: 'available', cost: 0 }],
        to,
        { connections: [] },
        'geometry',
      ),
    surfaces,
    portals,
    directed,
    straighten,
    projectGoal,
    projectSupport,
    byId,
    centers,
    graph: baseGraph,
    routeBase,
    getUnwalledRouteBase,
    walls,
    profile,
    constraintsSignature,
    searchSpeed,
    peakSpeed,
    importedPortals: options.portals,
    overlay,
  });
  return planner;
}

/** Prepare shared topology and ground visibility once for repeated, independent queries.
 * A caller must rebuild the planner when scene state, geometry or constraints change.
 * Search selects a corridor; continuous ground tracing removes unnecessary graph turns.
 * This does not establish a globally shortest path across every possible corridor.
 */
export function createGroundPlanner(surfaces: Surface[], options: GroundOptions): GroundPlanner {
  const { speed, walls, profile } = options;
  // Compare action times at the fastest permitted ground gait. The existing
  // resource scheduler verifies the complete selected motion sequence afterwards.
  const searchSpeed = options.locomotion?.sprintSpeed ?? speed;
  const peakSpeed = Math.max(
    speed,
    options.locomotion?.speed ?? speed,
    options.locomotion?.sprintSpeed ?? speed,
    options.locomotion?.dash?.speed ?? 0,
  );
  const {
    portals,
    byId,
    projectGoal,
    directed,
    base,
    baseCenters,
    getUnwalledRouteBase,
    getWeakComponents,
  } = groundTopologyFor(surfaces, searchSpeed, options.portals);
  const routeBase = prepareRoutePlanner(base, { walls, profile });
  const blocked = routeBase.blocked!;
  const constraintsSignature = JSON.stringify([walls, profile]);
  const projectSupport = createSupportProjector(surfaces, byId);
  // Build the triangle straightener lazily on first connected trace/straighten
  // call so planners whose endpoints lie on disconnected walkable components
  // never spend seconds indexing 260k-409k support triangles.
  const surfaceSnapshot = surfaces.slice();
  const importedPortalsSnapshot = options.portals?.slice();
  // Exact necessary condition for straighten.trace/mayConnect: triangle
  // adjacency only traverses intra-surface edges, shared portals, and directed
  // portals. Querying verticalProjectionCandidates within 1e-6 covers every
  // overlapping triangle admitted by straighten.supporting (1e-7 tolerance).
  const surfacesMayConnect = (start: Vec3, end: Vec3): boolean => {
    if (surfaces.length !== surfaceSnapshot.length) return true;
    if (Math.hypot(end[0] - start[0], end[2] - start[2]) < 1e-10 && distance(start, end) < 1e-7)
      return true;
    const { indexById, parent } = getWeakComponents();
    const fromFaces = verticalProjectionCandidates(surfaces, start, 1e-6, 1e-6);
    if (!fromFaces.length) return false;
    const toFaces = verticalProjectionCandidates(surfaces, end, 1e-6, 1e-6);
    if (!toFaces.length) return false;
    if (fromFaces.length === 1 && toFaces.length === 1) {
      const a = indexById.get(fromFaces[0].id);
      const b = indexById.get(toFaces[0].id);
      return (
        a !== undefined && b !== undefined && findWeakRoot(parent, a) === findWeakRoot(parent, b)
      );
    }
    const fromRoots = new Set<number>();
    for (let i = 0; i < fromFaces.length; i++) {
      const idx = indexById.get(fromFaces[i].id);
      if (idx !== undefined) fromRoots.add(findWeakRoot(parent, idx));
    }
    for (let i = 0; i < toFaces.length; i++) {
      const idx = indexById.get(toFaces[i].id);
      if (idx !== undefined && fromRoots.has(findWeakRoot(parent, idx))) return true;
    }
    return false;
  };
  let realStraightener: GroundStraightener | undefined;
  const getStraightener = () => {
    realStraightener ??= createGroundStraightener(
      surfaceSnapshot,
      { walls, profile, portals: importedPortalsSnapshot },
      portals,
      blocked,
      directed,
    );
    return realStraightener;
  };
  const straighten: GroundStraightener = Object.assign(
    (points: Vec3[]) => getStraightener()(points),
    {
      trace: (start: Vec3, end: Vec3) => {
        if (!finiteVec3(start) || !finiteVec3(end))
          throw new Error('Invalid ground visibility endpoints');
        if (!realStraightener && !surfacesMayConnect(start, end)) return null;
        return getStraightener().trace(start, end);
      },
      mayConnect: (start: Vec3, end: Vec3) => {
        if (!finiteVec3(start) || !finiteVec3(end))
          throw new Error('Invalid ground visibility endpoints');
        if (!realStraightener && !surfacesMayConnect(start, end)) return false;
        return getStraightener().mayConnect(start, end);
      },
    },
  );
  return assembleGroundPlanner({
    surfaces,
    options,
    searchSpeed,
    peakSpeed,
    portals,
    directed,
    byId,
    centers: baseCenters,
    projectGoal,
    projectSupport,
    graph: base,
    routeBase,
    getUnwalledRouteBase: () => getUnwalledRouteBase(profile),
    straighten,
    constraintsSignature,
  });
}

/**
 * Zero-rebuild overlay GroundPlanner for temporary box layouts (Phase 3 / B1).
 * Layers a tiny set of roof surfaces + box walls onto an existing static
 * GroundPlanner in O(|extraSurfaces| + |affectedStaticSurfaces|) instead of
 * rebuilding surfacePortals, surfaceGraph, GoalProjector, SupportProjector,
 * and 600k-edge wall filtering from scratch per candidate layout.
 *
 * Automatically falls back to full createGroundPlanner if any roof edge shares
 * or blocks a static portal within portalTolerance (e.g. a box placed flush
 * against a static ledge).
 */
export function createOverlayGroundPlanner(
  basePlanner: GroundPlanner,
  layoutSurfaces: Surface[],
  extraSurfaces: Surface[],
  extraWalls: Wall[],
  options: GroundOptions,
  preparedExtraBlocked?: ReturnType<typeof createWallChecker>,
): GroundPlanner {
  const basePrep = groundPreparation(basePlanner);
  const searchSpeed = options.locomotion?.sprintSpeed ?? options.speed;
  const peakSpeed = Math.max(
    options.speed,
    options.locomotion?.speed ?? options.speed,
    options.locomotion?.sprintSpeed ?? options.speed,
    options.locomotion?.dash?.speed ?? 0,
  );
  if (
    !basePrep ||
    basePrep.surfaces.length + extraSurfaces.length !== layoutSurfaces.length ||
    basePrep.searchSpeed !== searchSpeed ||
    basePrep.importedPortals !== options.portals ||
    basePrep.profile.radius !== options.profile.radius ||
    basePrep.profile.height !== options.profile.height
  ) {
    return createGroundPlanner(layoutSurfaces, options);
  }
  const extraById = new Map<string, Surface>();
  for (let i = 0; i < extraSurfaces.length; i++) {
    const s = extraSurfaces[i];
    if (basePrep.byId.has(s.id) || extraById.has(s.id)) {
      return createGroundPlanner(layoutSurfaces, options);
    }
    extraById.set(s.id, s);
  }

  // Validate extraSurfaces and build roof-to-roof portals in O(|extraSurfaces|).
  const roofPortals = surfacePortals(extraSurfaces);

  // Verify no roof edge can join or block any static portal within 1e-4.
  const nearbyStatic = new Set<Surface>();
  for (let i = 0; i < extraSurfaces.length; i++) {
    const verts = extraSurfaces[i].vertices;
    let minX = Infinity,
      minY = Infinity,
      minZ = Infinity,
      maxX = -Infinity,
      maxY = -Infinity,
      maxZ = -Infinity;
    for (let j = 0; j < verts.length; j++) {
      const p = verts[j];
      if (p[0] < minX) minX = p[0];
      if (p[1] < minY) minY = p[1];
      if (p[2] < minZ) minZ = p[2];
      if (p[0] > maxX) maxX = p[0];
      if (p[1] > maxY) maxY = p[1];
      if (p[2] > maxZ) maxZ = p[2];
    }
    const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const halfY = (maxY - minY) / 2 + 1e-3;
    const halfXZ = Math.max(maxX - minX, maxZ - minZ) / 2 + 1e-3;
    const candidates = verticalProjectionCandidates(basePrep.surfaces, center, halfY, halfXZ);
    for (let j = 0; j < candidates.length; j++) {
      const face = candidates[j];
      const fv = face.vertices;
      let fMinX = Infinity,
        fMinY = Infinity,
        fMinZ = Infinity,
        fMaxX = -Infinity,
        fMaxY = -Infinity,
        fMaxZ = -Infinity;
      for (let k = 0; k < fv.length; k++) {
        const p = fv[k];
        if (p[0] < fMinX) fMinX = p[0];
        if (p[1] < fMinY) fMinY = p[1];
        if (p[2] < fMinZ) fMinZ = p[2];
        if (p[0] > fMaxX) fMaxX = p[0];
        if (p[1] > fMaxY) fMaxY = p[1];
        if (p[2] > fMaxZ) fMaxZ = p[2];
      }
      if (
        fMaxX >= minX - 2e-4 &&
        fMinX <= maxX + 2e-4 &&
        fMaxY >= minY - 2e-4 &&
        fMinY <= maxY + 2e-4 &&
        fMaxZ >= minZ - 2e-4 &&
        fMinZ <= maxZ + 2e-4
      ) {
        nearbyStatic.add(face);
      }
    }
  }
  if (nearbyStatic.size > 0) {
    const localStatic = [...nearbyStatic];
    const staticPortals = surfacePortals(localStatic);
    const mergedPortals = surfacePortals([...localStatic, ...extraSurfaces]);
    if (mergedPortals.length !== staticPortals.length + roofPortals.length) {
      // Rare flush-contact case where a roof edge joins or splits a static portal.
      return createGroundPlanner(layoutSurfaces, options);
    }
  }

  const extraGraph = surfaceGraph(
    extraSurfaces,
    { speed: searchSpeed },
    roofPortals,
    [],
    extraById,
  );
  const extraCenters = new Map<string, Vec3>();
  for (let i = 0; i < extraGraph.nodes.length; i++) {
    extraCenters.set(extraGraph.nodes[i].id, extraGraph.nodes[i].position);
  }
  const byId = overlayLookup(basePrep.byId, extraById);
  const centers = overlayLookup(basePrep.centers, extraCenters);
  const extraBlocked = preparedExtraBlocked ?? createWallChecker(extraWalls, options.profile);

  // Collect every static surface whose outgoing edges could possibly touch extraWalls.
  const affectedFromIds = new Set<string>();
  const { profile } = options;
  const pad = 1e-3;
  for (let i = 0; i < extraWalls.length; i++) {
    const wall = extraWalls[i];
    if (wall.state === 'inactive') continue;
    const margin = profile.radius + (wall.padding ?? 0);
    let minX = wall.min[0] - margin;
    let minY = wall.min[1] - profile.height;
    let minZ = wall.min[2] - margin;
    let maxX = wall.max[0] + margin;
    let maxY = wall.max[1];
    let maxZ = wall.max[2] + margin;
    const ring = wall.polygon ?? wall.points;
    if (ring) {
      for (let j = 0; j < ring.length; j++) {
        const p = ring[j];
        if (p[0] - margin < minX) minX = p[0] - margin;
        if (p[0] + margin > maxX) maxX = p[0] + margin;
        if (p[1] - margin < minZ) minZ = p[1] - margin;
        if (p[1] + margin > maxZ) maxZ = p[1] + margin;
      }
    }
    if (wall.sphere) {
      const c = wall.sphere.center;
      const r = wall.sphere.radius;
      const lower = profile.height >= profile.radius * 2 ? profile.radius : 0;
      const upper =
        profile.height >= profile.radius * 2 ? profile.height - profile.radius : profile.height;
      minX = Math.min(minX, c[0] - r - margin);
      maxX = Math.max(maxX, c[0] + r + margin);
      minY = Math.min(minY, c[1] - r - margin - upper);
      maxY = Math.max(maxY, c[1] + r + margin - lower);
      minZ = Math.min(minZ, c[2] - r - margin);
      maxZ = Math.max(maxZ, c[2] + r + margin);
    }
    const center: Vec3 = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
    const halfY = (maxY - minY) / 2 + pad;
    const halfXZ = Math.max(maxX - minX, maxZ - minZ) / 2 + pad;
    const near = verticalProjectionCandidates(basePrep.surfaces, center, halfY, halfXZ);
    for (let j = 0; j < near.length; j++) {
      const id = near[j].id;
      affectedFromIds.add(id);
      const out = basePrep.routeBase.forward.get(id);
      if (out) {
        for (let k = 0; k < out.length; k++) affectedFromIds.add(out[k].to);
      }
    }
  }
  if (basePrep.directed.length && affectedFromIds.size) {
    for (let i = 0; i < basePrep.directed.length; i++) {
      if (affectedFromIds.has(basePrep.directed[i].to)) {
        affectedFromIds.add(basePrep.directed[i].from);
      }
    }
  }

  const routeBase = prepareOverlayRoutePlanner(
    basePrep.routeBase,
    basePrep.centers,
    extraGraph,
    affectedFromIds,
    extraBlocked,
  );
  const combinedBlocked = routeBase.blocked!;

  const roofGoalProjector = createGoalProjector(extraSurfaces);
  const projectGoal = combineGoalProjectors(basePrep.projectGoal, roofGoalProjector);

  // Overlay support projector: preserves [...baseSurfaces, ...extraSurfaces] input order.
  const supportMemo = new Map<string, ReturnType<typeof projectPoint>>();
  const projectSupport = (
    position: Vec3,
    maxVertical: number,
    surface?: string,
  ): ReturnType<typeof projectPoint> => {
    const key = `${Object.is(position[0], -0) ? '-0' : position[0]},${Object.is(position[1], -0) ? '-0' : position[1]},${Object.is(position[2], -0) ? '-0' : position[2]}|${maxVertical}|${surface ?? ''}`;
    if (supportMemo.has(key)) return supportMemo.get(key)!;
    let result: ReturnType<typeof projectPoint>;
    if (surface !== undefined) {
      const face = byId.get(surface);
      result = face ? projectPoint([face], position, { maxVertical }) : null;
    } else {
      const baseCandidates = verticalProjectionCandidates(basePrep.surfaces, position, maxVertical);
      result = projectPoint(
        extraSurfaces.length ? [...baseCandidates, ...extraSurfaces] : baseCandidates,
        position,
        { maxVertical },
      );
    }
    if (supportMemo.size >= 2048) supportMemo.delete(supportMemo.keys().next().value!);
    supportMemo.set(key, result);
    return result;
  };

  // Overlay straightener: static traces delegate to basePrep.straighten and
  // verify extraBlocked on every segment; roof traces use a tiny O(|roofs|)
  // straightener; cross static<->roof traces are impossible (no bridge portals).
  let roofStraightener: GroundStraightener | undefined;
  const getRoofStraightener = () =>
    (roofStraightener ??= createGroundStraightener(
      extraSurfaces,
      { walls: options.walls, profile },
      roofPortals,
      combinedBlocked,
      [],
    ));
  const onRoof = (point: Vec3) =>
    extraSurfaces.length > 0 && projectPoint(extraSurfaces, point, { maxVertical: 1e-6 }) !== null;
  const segmentClearExtra = (pts: Vec3[]) => {
    for (let i = 1; i < pts.length; i++) {
      if (extraBlocked(pts[i - 1], pts[i])) return false;
    }
    return true;
  };
  const overlayTrace = (start: Vec3, end: Vec3): Vec3[] | null => {
    if (!finiteVec3(start) || !finiteVec3(end))
      throw new Error('Invalid ground visibility endpoints');
    const sRoof = onRoof(start);
    const eRoof = onRoof(end);
    if (sRoof && eRoof) return getRoofStraightener().trace(start, end);
    if (sRoof !== eRoof) return null;
    const traced = basePrep.straighten.trace(start, end);
    if (!traced) return null;
    return segmentClearExtra(traced) ? traced : null;
  };
  const overlayMayConnect = (start: Vec3, end: Vec3): boolean => {
    if (!finiteVec3(start) || !finiteVec3(end))
      throw new Error('Invalid ground visibility endpoints');
    const sRoof = onRoof(start);
    const eRoof = onRoof(end);
    if (sRoof && eRoof) return getRoofStraightener().mayConnect(start, end);
    if (sRoof !== eRoof) return false;
    return basePrep.straighten.mayConnect(start, end);
  };
  const straighten: GroundStraightener = Object.assign(
    (points: Vec3[]): Vec3[] => {
      if (!Array.isArray(points) || !points.length || !points.every(finiteVec3))
        throw new Error('Invalid ground path');
      if (onRoof(points[0])) return getRoofStraightener()(points);
      const baseOut = basePrep.straighten(points);
      if (segmentClearExtra(baseOut)) return baseOut;
      // Straightening on the static mesh cut through an overlaid box wall;
      // greedily shortcut using overlayTrace which enforces extraBlocked.
      const output: Vec3[] = [[...points[0]]];
      const lengths = [0];
      for (let i = 1; i < points.length; i++) {
        lengths.push(lengths[i - 1] + distance(points[i - 1], points[i]));
      }
      let anchor = 0;
      while (anchor + 1 < points.length) {
        let chosen = anchor + 1;
        let shortcut: Vec3[] | null = null;
        for (let end = points.length - 1; end > anchor + 1; end--) {
          const path = overlayTrace(points[anchor], points[end]);
          if (path) {
            let len = 0;
            for (let k = 1; k < path.length; k++) len += distance(path[k - 1], path[k]);
            if (len > lengths[end] - lengths[anchor] + 1e-6) continue;
            chosen = end;
            shortcut = path;
            break;
          }
        }
        if (shortcut) {
          for (let k = 1; k < shortcut.length; k++) output.push(shortcut[k]);
        } else {
          output.push([...points[chosen]]);
        }
        anchor = chosen;
      }
      // Match createGroundStraightener's 2-pass planar corner tightening so
      // detours hugging an overlaid box wall achieve identical continuous cost.
      const tol = 1e-7;
      for (let pass = 0; pass < 2; pass++) {
        for (let index = 1; index + 1 < output.length; index++) {
          const a = output[index - 1],
            corner = output[index],
            b = output[index + 1];
          if (Math.abs(a[1] - corner[1]) > tol || Math.abs(b[1] - corner[1]) > tol) continue;
          if (!overlayTrace(a, corner) || !overlayTrace(corner, b)) continue;
          const midX = (a[0] + b[0]) / 2,
            midY = (a[1] + b[1]) / 2,
            midZ = (a[2] + b[2]) / 2;
          let low = 0,
            high = 1,
            chosen = corner;
          for (let step = 0; step < 10; step++) {
            const fraction = (low + high) / 2;
            const point: Vec3 = [
              corner[0] + fraction * (midX - corner[0]),
              corner[1] + fraction * (midY - corner[1]),
              corner[2] + fraction * (midZ - corner[2]),
            ];
            const left = overlayTrace(a, point),
              right = overlayTrace(point, b);
            if (left?.length === 2 && right?.length === 2) {
              low = fraction;
              chosen = point;
            } else high = fraction;
          }
          output[index] = chosen;
        }
      }
      const simplified: Vec3[] = [];
      for (let i = 0; i < output.length; i++) {
        const pt = output[i];
        if (simplified.length && distance(simplified[simplified.length - 1], pt) < 1e-9) continue;
        while (simplified.length > 1) {
          const a = simplified[simplified.length - 2],
            b = simplified[simplified.length - 1];
          const dx = pt[0] - a[0],
            dy = pt[1] - a[1],
            dz = pt[2] - a[2];
          const lenSq = dx * dx + dy * dy + dz * dz;
          if (lenSq === 0) break;
          const frac = ((b[0] - a[0]) * dx + (b[1] - a[1]) * dy + (b[2] - a[2]) * dz) / lenSq;
          if (
            frac < 0 ||
            frac > 1 ||
            Math.hypot(
              b[0] - (a[0] + frac * dx),
              b[1] - (a[1] + frac * dy),
              b[2] - (a[2] + frac * dz),
            ) > tol
          )
            break;
          simplified.pop();
        }
        simplified.push([...pt]);
      }
      return simplified;
    },
    { trace: overlayTrace, mayConnect: overlayMayConnect },
  );

  let unwalledOverlay: ReturnType<typeof prepareRoutePlanner> | undefined;
  const getUnwalledRouteBase = () =>
    (unwalledOverlay ??= prepareOverlayRoutePlanner(
      basePrep.getUnwalledRouteBase(),
      basePrep.centers,
      extraGraph,
      [],
      null,
    ));

  let lazyNodes: Graph['nodes'] | undefined;
  let lazyEdges: Graph['edges'] | undefined;
  const overlayBaseGraph: Graph = {
    get nodes() {
      return (lazyNodes ??= extraGraph.nodes.length
        ? [...basePrep.graph.nodes, ...extraGraph.nodes]
        : basePrep.graph.nodes);
    },
    get edges() {
      return (lazyEdges ??= extraGraph.edges.length
        ? [...basePrep.graph.edges, ...extraGraph.edges]
        : basePrep.graph.edges);
    },
  };

  const portals = roofPortals.length ? [...basePrep.portals, ...roofPortals] : basePrep.portals;
  const constraintsSignature = JSON.stringify([options.walls, profile]);

  return assembleGroundPlanner({
    surfaces: layoutSurfaces,
    options,
    searchSpeed,
    peakSpeed,
    portals,
    directed: basePrep.directed,
    byId,
    centers,
    projectGoal,
    projectSupport,
    graph: overlayBaseGraph,
    routeBase,
    getUnwalledRouteBase,
    straighten,
    constraintsSignature,
    overlay: {
      basePlanner,
      basePrep,
      extraSurfaces,
      extraPortals: roofPortals,
    },
  });
}
const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, i) => v - b[i]));
function straightenRoute(
  route: Extract<Route, { status: 'complete' }>,
  straighten: GroundStraightener,
  speed: number,
): Extract<Route, { status: 'complete' }> {
  const segments: Segment[] = [];
  let pending: Vec3[] = [];
  const flush = () => {
    if (!pending.length) return;
    const points = straighten(pending);
    pending = [];
    if (points.length < 2) return;
    const times = [0];
    for (let i = 1; i < points.length; i++)
      times.push(times[i - 1] + distance(points[i - 1], points[i]) / speed);
    segments.push({ mode: 'walk', points, times });
  };
  for (const segment of route.segments) {
    if (segment.mode !== 'walk') {
      flush();
      segments.push(segment);
      continue;
    }
    if (!pending.length) pending.push(segment.points[0]);
    for (const point of segment.points.slice(1)) {
      if (distance(pending.at(-1)!, point) > 1e-9) pending.push(point);
    }
  }
  flush();
  const points: Vec3[] = [[...route.points[0]]];
  for (const segment of segments)
    for (const point of segment.points.slice(1)) {
      if (distance(points.at(-1)!, point) > 1e-9) points.push([...point]);
    }
  return {
    ...route,
    points,
    segments,
    cost: route.arrivalCost + segments.reduce((sum, segment) => sum + segment.times.at(-1)!, 0),
    length: points.slice(1).reduce((sum, point, i) => sum + distance(points[i], point), 0),
  };
}
