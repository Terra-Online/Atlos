import type { Vec3, Surface } from '#@/src/geometry.ts';
import { type GoalProjector, createGoalProjector } from '#@/src/model/goals.ts';
import type { InteractionGoal, Segment } from '#@/src/movement.ts';
import type {
  GroundArrival,
  GroundConnection,
  GroundOptions,
  Route,
  ResourceSearch,
} from '#@/src/route.ts';
import { createSupportProjector } from '#@/src/v1/geo/support-projector.ts';
import { type SharedPortal, surfaceGraph, surfacePortals } from '#@/src/v1/geo/surfaces.ts';
import { validateMotion } from '#@/src/v1/motion/motion.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import {
  type Graph,
  type Arrival,
  createRoutePlanner,
  prepareRoutePlanner,
} from '#@/src/v1/route/routes.ts';
import { type GroundStraightener, createGroundStraightener } from '#@/src/v1/route/straighten.ts';

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

interface Preparation {
  surfaces: Surface[];
  planWalkingGeometry(from: Vec3, to: Vec3): Route;
  portals: SharedPortal[];
  straighten: GroundStraightener;
  projectGoal: GoalProjector;
  projectSupport: ReturnType<typeof createSupportProjector>;
  byId: Map<string, Surface>;
  centers: Map<string, Vec3>;
  graph: Graph;
  routeBase: ReturnType<typeof prepareRoutePlanner>;
  constraintsSignature: string;
  searchSpeed: number;
  importedPortals?: GroundOptions['portals'];
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
/** Prepare shared topology and ground visibility once for repeated, independent queries.
 * A caller must rebuild the planner when scene state, geometry or constraints change.
 * Search selects a corridor; continuous ground tracing removes unnecessary graph turns.
 * This does not establish a globally shortest path across every possible corridor.
 */
export function createGroundPlanner(surfaces: Surface[], options: GroundOptions): GroundPlanner {
  const { speed, maxVertical, walls, profile, connections = [] } = options;
  // Compare action times at the fastest permitted ground gait. The existing
  // resource scheduler verifies the complete selected motion sequence afterwards.
  const searchSpeed = options.locomotion?.sprintSpeed ?? speed;
  const portals = surfacePortals(surfaces);
  const base = surfaceGraph(surfaces, { speed: searchSpeed, portals: options.portals }, portals);
  const routeBase = prepareRoutePlanner(base, { walls, profile });
  const blocked = routeBase.blocked!;
  const constraintsSignature = JSON.stringify([walls, profile]);
  let supportRoute: ReturnType<typeof createRoutePlanner> | undefined;
  const baseCenters = new Map<string, Vec3>(base.nodes.map((node) => [node.id, node.position]));
  const byId = new Map<string, Surface>(surfaces.map((surface) => [surface.id, surface]));
  const projectSupport = createSupportProjector(surfaces, byId);
  const straighten = createGroundStraightener(surfaces, options, portals);
  const projectGoal = createGoalProjector(surfaces);
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
    if (!targets.length) {
      visibility.clear();
      failedVisibility.clear();
      endpointKeys.clear();
      return { status: 'unmapped' };
    }
    const centers = baseCenters;
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
        supportRoute ??= createRoutePlanner(base, { walls: [], profile });
        candidate = supportRoute(graph, [arrival], targetIds);
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
    straighten,
    projectGoal,
    projectSupport,
    byId,
    centers: baseCenters,
    graph: base,
    routeBase,
    constraintsSignature,
    searchSpeed,
    importedPortals: options.portals,
  });
  return planner;
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
