import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Surface, Portal, Wall } from '#@/src/geometry.ts';
import { type Bounds, createBoundsIndex } from '#@/src/model/bounds.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { InteractionGoal, JumpModel } from '#@/src/movement.ts';
import type { GroundConnection } from '#@/src/route.ts';
import { type SharedPortal, surfacePortals, directedPortals } from '#@/src/v1/geo/surfaces.ts';
import { discoveryEvidence } from '#@/src/v1/motion/evidence.ts';
import { jumpConnection, jumpDuration } from '#@/src/v1/motion/jumps.ts';
import { landingCandidates } from '#@/src/v1/motion/landings.ts';
import type { GroundPlanner } from '#@/src/v1/route/ground.ts';
import { movementGeometry } from '#@/src/v1/route/movement-geometry.ts';
import { createMinHeap } from '#@/src/v1/search/heap.ts';

export interface DiscoveryOptions {
  profile: { radius: number; height: number };
  portals?: Portal[];
  walls: Wall[];
  from: Vec3;
  to: Vec3;
  interaction?: InteractionGoal;
  maxVertical: number;
  maxSlope: number;
  maxDrop: number;
  maxHorizontalDistance: number;
  sampleSpacing: number;
  maxCandidates: number;
  maxLinks: number;
  model: JumpModel;
  /** Existing validated directed actions participate in proposal reachability. */
  connections?: GroundConnection[];
  groundPlanner?: GroundPlanner;
}

export interface DiscoveryDiagnostics {
  reason: string;
  components: number;
  boundaryEdges: number;
  endpointChecks: number;
  standingEndpoints: number;
  neighbourChecks: number;
  pairChecks: number;
  candidatePairs: number;
  attempted: number;
  accepted: number;
  truncated: boolean;
  limits: {
    maxCandidates: number;
    maxLinks: number;
    arcAttempts: number;
    endpointChecks: number;
    neighbourChecks: number;
    pairChecks: number;
    seedChecks: number;
  };
  regionSearches: number;
  regionPairs: number;
  validatedPairs: number;
  pairBatches: number;
  deferredPairs: number;
  generationBatches: number;
  seedChecks: number;
  goalFaces: number;
  goalComponents: number;
  rejected: {
    projection: number;
    support: number;
    clearance: number;
    range: number;
    motion: number;
  };
  sourceEndpoints?: number;
  targetEndpoints?: number;
  sourceComponent?: number;
  targetComponent?: number;
  sourceCandidates?: number;
  directCandidates?: number;
  targetReached?: boolean;
}

export interface Boundary {
  surface: string;
  edge: number;
  a: Vec3;
  b: Vec3;
  midpoint: Vec3;
  length: number;
  inward: number[];
  interior: number[];
}
export interface Region extends Bounds {
  min: number[];
  max: number[];
  id: string;
  component: number;
  boundaries: (Boundary & Bounds)[];
  surfaces: Surface[];
}
interface Pair {
  start: Vec3;
  end: Vec3;
  boundary: boolean;
}
interface Candidate extends Pair {
  uncertain: boolean;
  score: number;
}
interface Transfer {
  key: string;
  a: Region;
  b: Region;
  ground: boolean;
  reach: number;
  closed: boolean;
  cost: number;
  generation?: { pairs: Generator<Pair>; pending: Candidate[]; cursor: number; done: boolean };
  search?: { candidates: Candidate[]; cursor: number; tried: Set<string> };
}
type Standing = { position: Vec3; surface: string; reason?: never };
type Rejection = {
  reason: 'support' | 'projection' | 'clearance';
  position?: never;
  surface?: never;
};
type DiscoveredConnection = GroundConnection & {
  fromSurface: string;
  toSurface: string;
  motionValidation: 'model-based';
};

export { groundComponents } from '#@/src/v1/reach/connectivity.ts';

const finitePoint = (point: unknown) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((value, axis) => value - b[axis]));
const horizontal = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);
const boundaryKey = (surface: string, edge: number) => JSON.stringify([surface, edge]);
export const exposedBoundaries = (
  surfaces: Surface[],
  portals: Portal[],
  sharedPortals?: SharedPortal[],
): Boundary[] => {
  const covered = new Map<string, [number, number][]>();
  const byId = new Map<string, Surface>(surfaces.map((surface) => [surface.id, surface]));
  const cover = (id: string, edge: number, start: Vec3, end: Vec3) => {
    const surface = byId.get(id)!,
      a = surface.vertices[edge],
      b = surface.vertices[(edge + 1) % surface.vertices.length];
    const direction = b.map((value, axis) => value - a[axis]);
    const squared = direction.reduce((sum, value) => sum + value * value, 0);
    const fraction = (point: Vec3) =>
      point.reduce((sum, value, axis) => sum + (value - a[axis]) * direction[axis], 0) / squared;
    const first = fraction(start),
      last = fraction(end),
      key = boundaryKey(id, edge);
    const ranges = covered.get(key) ?? [];
    ranges.push([Math.max(0, Math.min(first, last)), Math.min(1, Math.max(first, last))]);
    covered.set(key, ranges);
  };
  for (const portal of sharedPortals ?? surfacePortals(surfaces)) {
    cover(portal.from, portal.fromEdge, portal.start, portal.end);
    cover(portal.to, portal.toEdge, portal.start, portal.end);
  }
  for (const portal of directedPortals(surfaces, portals)) {
    cover(portal.from, portal.fromEdge, portal.start, portal.end);
  }
  const boundaries: Boundary[] = [];
  for (const surface of surfaces) {
    const center = [0, 1, 2].map(
      (axis) =>
        surface.vertices.reduce((sum, point) => sum + point[axis], 0) / surface.vertices.length,
    );
    for (let edge = 0; edge < surface.vertices.length; edge++) {
      const from = surface.vertices[edge],
        to = surface.vertices[(edge + 1) % surface.vertices.length];
      const ranges = (covered.get(boundaryKey(surface.id, edge)) ?? []).sort((a, b) => a[0] - b[0]);
      const gaps = [];
      let cursor = 0;
      for (const [near, far] of ranges) {
        if (near > cursor) gaps.push([cursor, near]);
        cursor = Math.max(cursor, far);
      }
      if (cursor < 1) gaps.push([cursor, 1]);
      for (const [near, far] of gaps) {
        const a: Vec3 = [
          from[0] + near * (to[0] - from[0]),
          from[1] + near * (to[1] - from[1]),
          from[2] + near * (to[2] - from[2]),
        ];
        const b: Vec3 = [
          from[0] + far * (to[0] - from[0]),
          from[1] + far * (to[1] - from[1]),
          from[2] + far * (to[2] - from[2]),
        ];
        const midpoint: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
        const length = horizontal(a, b);
        if (length <= 1e-4) continue;
        const inward = [-(b[2] - a[2]) / length, (b[0] - a[0]) / length];
        if (inward[0] * (center[0] - midpoint[0]) + inward[1] * (center[2] - midpoint[2]) < 0) {
          inward[0] *= -1;
          inward[1] *= -1;
        }
        const interiorX = center[0] - midpoint[0],
          interiorZ = center[2] - midpoint[2];
        const interiorLength = Math.hypot(interiorX, interiorZ);
        boundaries.push({
          surface: surface.id,
          edge,
          a,
          b,
          midpoint,
          length,
          inward,
          // The centroid direction also samples diagonal pullbacks on narrow
          // triangles. The perpendicular normal remains the physical exit axis.
          interior: [interiorX / interiorLength, interiorZ / interiorLength],
        });
      }
    }
  }
  return boundaries;
};
const horizontalGap = (a: Bounds, b: Bounds) =>
  Math.hypot(
    ...[0, 2].map((axis) => Math.max(a.min[axis] - b.max[axis], b.min[axis] - a.max[axis], 0)),
  );
const boundsOf = (vertices: Vec3[]): Bounds => ({
  min: [0, 1, 2].map((axis) => Math.min(...vertices.map((point) => point[axis]))),
  max: [0, 1, 2].map((axis) => Math.max(...vertices.map((point) => point[axis]))),
});
export const interleave = <T>(lists: T[][], limit: number): T[] => {
  const result: T[] = [];
  let active = lists.map((entries) => ({ entries, cursor: 0 }));
  while (active.length && result.length < limit) {
    const pending = [];
    for (const group of active) {
      if (result.length >= limit) break;
      result.push(group.entries[group.cursor++]);
      if (group.cursor < group.entries.length) pending.push(group);
    }
    active = pending;
  }
  return result;
};
export const validateDiscovery = (world: CollisionWorld, options: DiscoveryOptions) => {
  const {
    profile,
    walls,
    from,
    to,
    maxVertical,
    maxSlope,
    maxDrop,
    maxHorizontalDistance,
    sampleSpacing,
    maxCandidates,
    maxLinks,
    model,
  } = options ?? {};
  if (
    !profile ||
    !finitePoint(from) ||
    !finitePoint(to) ||
    !Array.isArray(walls) ||
    !model ||
    typeof world?.groundAt !== 'function' ||
    typeof world?.sweepCapsule !== 'function' ||
    ![
      profile.radius,
      profile.height,
      maxVertical,
      maxSlope,
      maxDrop,
      maxHorizontalDistance,
      sampleSpacing,
      maxCandidates,
      maxLinks,
      model.gravity,
      model.fallingGravity,
      model.maxJumpHeight,
      model.maxFallingSpeed,
      model.apexTime,
      model.maxHorizontalSpeed,
    ].every(Number.isFinite) ||
    profile.radius <= 0 ||
    profile.height < profile.radius * 2 ||
    maxVertical < 0 ||
    maxSlope <= 0 ||
    maxSlope >= 90 ||
    maxDrop < 0 ||
    maxHorizontalDistance <= 0 ||
    sampleSpacing <= 0 ||
    !Number.isSafeInteger(maxCandidates) ||
    maxCandidates < 1 ||
    !Number.isSafeInteger(maxLinks) ||
    maxLinks < 1 ||
    model.gravity <= 0 ||
    model.fallingGravity <= 0 ||
    model.maxJumpHeight < 0 ||
    model.maxFallingSpeed <= 0 ||
    model.apexTime < 0 ||
    model.maxHorizontalSpeed < 0 ||
    ((model.airAcceleration !== undefined || model.airDeceleration !== undefined) &&
      (![model.airAcceleration, model.airDeceleration].every(Number.isFinite) ||
        model.airAcceleration! <= 0 ||
        model.airDeceleration! <= 0)) ||
    ((model.startHorizontalSpeed !== undefined || model.airOverspeedDeceleration !== undefined) &&
      (![model.startHorizontalSpeed, model.airOverspeedDeceleration].every(Number.isFinite) ||
        model.startHorizontalSpeed! < 0 ||
        model.airOverspeedDeceleration! <= 0))
  ) {
    throw new Error('Invalid traversal discovery options');
  }
};
export const standingFoot = (
  nav: { position: Vec3; surface?: string },
  world: CollisionWorld,
  {
    profile,
    maxVertical,
    maxSlope,
    blocked,
    project,
  }: Pick<DiscoveryOptions, 'profile' | 'maxVertical' | 'maxSlope'> & {
    blocked: ReturnType<typeof createWallChecker>;
    project: ReturnType<typeof movementGeometry>['project'];
  },
): Standing | Rejection => {
  const support = world.groundAt(nav.position, {
    maxUp: profile.radius,
    maxDown: profile.radius,
    maxSlope,
  });
  if (!support) return { reason: 'support' };
  const position: Vec3 = [...support.position];
  position[1] += profile.radius * (1 / support.normal[1] - 1) + 0.005;
  // Real support corrects voxel and slope height. Bind the corrected foot to the
  // closest eligible navigation support, matching subsequent ground queries.
  if (Math.abs(position[1] - nav.position[1]) > Math.min(maxVertical, profile.radius))
    return { reason: 'projection' };
  if (blocked(position, position) || world.sweepCapsule(position, position, profile) !== null)
    return { reason: 'clearance' };
  const mapped = project(position, { maxVertical: Math.min(maxVertical, profile.radius) })[0];
  if (!mapped) return { reason: 'projection' };
  return { position, surface: mapped.surface };
};
/** Discover directed jumps along optimistic region chains, validating local links lazily.
 * Ground, body, state and collision inputs must describe the same immutable snapshot.
 * Region bounds only order search. Every returned connection has supported feet,
 * stationary body clearance and a swept, wall-checked trajectory under the supplied model.
 * Optional interaction queries all eligible goal faces together and groups them by
 * directed ground component. Sampling limits remain explicit, so failure is inconclusive.
 */
export function findJumpConnections(
  surfaces: Surface[],
  world: CollisionWorld,
  options: DiscoveryOptions,
  workLimits?: { arcAttempts?: number; regionSearches?: number },
  intermediateActions = true,
): { connections: DiscoveredConnection[]; diagnostics: DiscoveryDiagnostics } {
  const {
    profile,
    walls,
    from,
    to,
    interaction,
    maxVertical,
    maxSlope,
    maxDrop,
    maxHorizontalDistance,
    sampleSpacing,
    maxCandidates,
    maxLinks,
    model,
  } = options ?? {};
  validateDiscovery(world, options);
  const blocked = createWallChecker(walls, profile);
  const { evidence } = discoveryEvidence(world, surfaces, options);
  const diagnostics: DiscoveryDiagnostics &
    Required<
      Pick<
        DiscoveryDiagnostics,
        'sourceEndpoints' | 'targetEndpoints' | 'sourceCandidates' | 'directCandidates'
      >
    > = {
    reason: 'searched',
    components: 0,
    boundaryEdges: 0,
    endpointChecks: 0,
    standingEndpoints: 0,
    neighbourChecks: 0,
    pairChecks: 0,
    candidatePairs: 0,
    attempted: 0,
    accepted: 0,
    truncated: false,
    regionSearches: 0,
    regionPairs: 0,
    validatedPairs: 0,
    pairBatches: 0,
    deferredPairs: 0,
    generationBatches: 0,
    seedChecks: 0,
    goalFaces: 0,
    goalComponents: 0,
    sourceEndpoints: 0,
    targetEndpoints: 0,
    sourceCandidates: 0,
    directCandidates: 0,
    limits: {
      maxCandidates,
      maxLinks,
      arcAttempts: Math.min(maxCandidates * 2, workLimits?.arcAttempts ?? Infinity),
      endpointChecks: maxCandidates * 32,
      neighbourChecks: maxCandidates * 512,
      pairChecks: maxCandidates * 64,
      seedChecks: maxCandidates * 64,
    },
    rejected: { projection: 0, support: 0, clearance: 0, range: 0, motion: 0 },
  };
  const connections: DiscoveredConnection[] = [];
  const geometry = movementGeometry(surfaces, options);
  const { graph, topology, project } = geometry;
  diagnostics.components = topology.count;
  const componentOf = (surface: string) => topology.components[topology.ids.get(surface)!];
  const source = project(from, { maxVertical })[0];
  const targets = project(to, { maxVertical, interaction }).filter(
    (target) => !blocked(target.position, target.position),
  );
  if (!source || !targets.length || blocked(source.position, source.position)) {
    diagnostics.reason = 'unmapped-endpoint';
    return { connections, diagnostics };
  }
  const sourceComponent = componentOf(source.surface);
  const targetComponents = new Set<number>(targets.map((target) => componentOf(target.surface)));
  const { byId, projectSupport } = geometry;
  const extraForward = new Map<number, number[]>();
  for (const connection of options.connections ?? []) {
    if (connection.state !== 'open') continue;
    const a = connection.fromSurface === undefined ? surfaces : [byId.get(connection.fromSurface)];
    const b = connection.toSurface === undefined ? surfaces : [byId.get(connection.toSurface)];
    if (!a[0] || !b[0]) throw new Error('Invalid movement support surface');
    const from = projectSupport(connection.points[0], maxVertical, connection.fromSurface);
    const to = projectSupport(connection.points.at(-1)!, maxVertical, connection.toSurface);
    if (
      !from ||
      !to ||
      connection.points.slice(1).some((point, index) => blocked(connection.points[index], point))
    )
      continue;
    const id = topology.ids.get(from.surface)!,
      entries = extraForward.get(id) ?? [];
    entries.push(topology.ids.get(to.surface)!);
    extraForward.set(id, entries);
  }
  // Proposals start anywhere already reachable without a new airborne action.
  // Ground transfers have zero proposal cost, so distance to the original arrival
  // is not an admissible heuristic: directed stairs can put a reachable floor far
  // from that arrival, starving a short box chain behind an unrelated cliff.
  const reachable = new Set<number>([topology.ids.get(source.surface)!]),
    queue = [...reachable];
  for (let head = 0; head < queue.length; head++)
    for (const entries of [topology.forward[queue[head]], extraForward.get(queue[head]) ?? []])
      for (const next of entries) {
        if (reachable.has(next)) continue;
        reachable.add(next);
        queue.push(next);
      }
  const sourceComponents = new Set<number>(
    [...reachable].map((index) => topology.components[index]),
  );
  diagnostics.sourceComponent = sourceComponent;
  diagnostics.targetComponent = componentOf(targets[0].surface);
  diagnostics.goalFaces = targets.length;
  diagnostics.goalComponents = targetComponents.size;
  if (targets.some((target) => reachable.has(topology.ids.get(target.surface)!))) {
    diagnostics.reason = options.connections?.length ? 'known-connected' : 'ground-connected';
    diagnostics.targetReached = true;
    return { connections, diagnostics };
  }
  geometry.regions ??= (() => {
    const regions = Array.from({ length: topology.count }, (_, component): Region => ({
      id: String(component),
      component,
      min: [Infinity, Infinity, Infinity],
      max: [-Infinity, -Infinity, -Infinity],
      boundaries: [],
      surfaces: [],
    }));
    for (const surface of surfaces) {
      const region = regions[componentOf(surface.id)];
      region.surfaces.push(surface);
      for (const point of surface.vertices)
        for (let axis = 0; axis < 3; axis++) {
          region.min[axis] = Math.min(region.min[axis], point[axis]);
          region.max[axis] = Math.max(region.max[axis], point[axis]);
        }
    }
    const boundaries = geometry.boundaries;
    for (const boundary of boundaries) {
      const bounded = Object.assign(boundary, boundsOf([boundary.a, boundary.b]));
      regions[componentOf(boundary.surface)].boundaries.push(bounded);
    }
    return { regions, boundaries, queryRegions: createBoundsIndex(regions) };
  })();
  const { regions, boundaries, queryRegions } = geometry.regions;
  diagnostics.boundaryEdges = boundaries.length;
  const endpointTolerance = Math.min(maxVertical, profile.radius);
  const transfers = new Map<string, Transfer>(),
    groundIncoming = new Map<string, Set<Transfer>>();
  const transfer = (a: Region, b: Region, ground: boolean, reach: number): Transfer => {
    const key = `${a.id}/${b.id}`;
    if (transfers.has(key)) return transfers.get(key)!;
    const gap = horizontalGap(a, b);
    // This optimistic ordering favours short chains; it is never a travel-time
    // proof or a grant of access through the overlapping region bounds.
    const entry = {
      key,
      a,
      b,
      ground,
      reach,
      closed: false,
      cost: ground ? 0 : 1 + gap / Math.max(1, model.maxHorizontalSpeed),
    };
    transfers.set(key, entry);
    return entry;
  };
  for (const edge of graph.edges) {
    const a = regions[componentOf(edge.from)],
      b = regions[componentOf(edge.to)];
    if (a === b) continue;
    const entries = groundIncoming.get(b.id) ?? new Set<Transfer>();
    entries.add(transfer(a, b, true, 0));
    groundIncoming.set(b.id, entries);
  }
  // Known actions must also join intermediate proposal regions. Source closure
  // alone cannot discover a jump into a ride followed by another jump out of it.
  // Keep their direction without merging the underlying ground components.
  if (intermediateActions)
    for (const [from, destinations] of extraForward)
      for (const to of destinations) {
        const a = regions[topology.components[from]],
          b = regions[topology.components[to]];
        if (a === b) continue;
        const entries = groundIncoming.get(b.id) ?? new Set<Transfer>();
        entries.add(transfer(a, b, true, 0));
        groundIncoming.set(b.id, entries);
      }
  const incoming = new Map<string, Transfer[]>(),
    preparedIncoming = new Map<string, Transfer[]>();
  const pairingAvailable = () =>
    diagnostics.neighbourChecks < diagnostics.limits.neighbourChecks &&
    diagnostics.pairChecks < diagnostics.limits.pairChecks;
  const generationAvailable = () =>
    diagnostics.seedChecks < diagnostics.limits.seedChecks && pairingAvailable();
  const neighbours = (b: Region): Transfer[] => {
    if (!generationAvailable())
      return [...(groundIncoming.get(b.id) ?? []), ...(preparedIncoming.get(b.id) ?? [])];
    if (incoming.has(b.id)) return incoming.get(b.id)!;
    const entries = [...(groundIncoming.get(b.id) ?? [])];
    const bounds = {
      min: [
        b.min[0] - maxHorizontalDistance,
        b.min[1] - model.maxJumpHeight - 2 * endpointTolerance,
        b.min[2] - maxHorizontalDistance,
      ],
      max: [
        b.max[0] + maxHorizontalDistance,
        b.max[1] + maxDrop + 2 * endpointTolerance,
        b.max[2] + maxHorizontalDistance,
      ],
    };
    for (const a of queryRegions(bounds)) {
      if (a === b || !a.boundaries.length || !b.boundaries.length) continue;
      const drop = Math.min(maxDrop, a.max[1] - b.min[1] + 2 * endpointTolerance);
      if (-drop > model.maxJumpHeight || a.min[1] - b.max[1] - 2 * endpointTolerance > maxDrop)
        continue;
      const duration = jumpDuration(drop, 0, {
        ...model,
        mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
      });
      const reach =
        duration === null
          ? 0
          : Math.min(maxHorizontalDistance, duration * model.maxHorizontalSpeed);
      if (duration !== null && horizontalGap(a, b) <= reach)
        entries.push(transfer(a, b, false, reach));
    }
    incoming.set(b.id, entries);
    diagnostics.regionPairs = transfers.size;
    return entries;
  };
  const findChain = (): Transfer[] | null => {
    const pending = createMinHeap<{ region: Region; travelled: number; cost: number }>(),
      costs = new Map<string, number>(),
      next = new Map<string, Transfer>();
    for (const component of targetComponents) {
      const region = regions[component];
      costs.set(region.id, 0);
      pending.push({ region, travelled: 0, cost: 0 });
    }
    while (pending.size) {
      const { region, travelled } = pending.pop()!;
      if (travelled !== costs.get(region.id)) continue;
      if (sourceComponents.has(region.component)) {
        const chain = [];
        for (let entry = next.get(region.id); entry; entry = next.get(entry.b.id))
          chain.push(entry);
        return chain;
      }
      for (const entry of neighbours(region)) {
        if (entry.closed) continue;
        const cost = travelled + entry.cost;
        if (cost >= (costs.get(entry.a.id) ?? Infinity)) continue;
        costs.set(entry.a.id, cost);
        next.set(entry.a.id, entry);
        pending.push({ region: entry.a, travelled: cost, cost });
      }
    }
    return null;
  };
  const cachedStanding = new Map<string, Standing | null>();
  const standing = (seed: Vec3, component: number): Standing | null => {
    const key = JSON.stringify([component, seed]);
    if (cachedStanding.has(key)) return cachedStanding.get(key)!;
    if (diagnostics.endpointChecks >= diagnostics.limits.endpointChecks) {
      diagnostics.truncated = true;
      return null;
    }
    diagnostics.endpointChecks++;
    let result: Standing | null = null;
    const nav = project(seed, { maxVertical })[0];
    if (!nav || componentOf(nav.surface) !== component) diagnostics.rejected.projection++;
    else {
      const sampled = evidence.standing(JSON.stringify([nav.position, nav.surface]), () =>
        standingFoot(nav, world, { profile, maxVertical, maxSlope, blocked, project }),
      );
      if (sampled.reason) diagnostics.rejected[sampled.reason]++;
      else if (componentOf(sampled.surface) !== component) diagnostics.rejected.projection++;
      else {
        result = sampled;
        diagnostics.standingEndpoints++;
        if (component === sourceComponent) diagnostics.sourceEndpoints++;
        if (targetComponents.has(component)) diagnostics.targetEndpoints++;
      }
    }
    cachedStanding.set(key, result);
    return result;
  };
  const insets = [
    ...new Set<number>([
      0,
      profile.radius * 0.25,
      profile.radius * 0.5,
      profile.radius,
      0.5,
      1,
      1.5,
      2,
      2.5,
      3,
    ]),
  ].sort((a, b) => a - b);
  const seedsFor = (
    region: Region,
    other: Region,
    takeoff: boolean,
    reach: number,
    limit: number,
  ): Vec3[] => {
    const seeds: Vec3[] = [],
      seen = new Set<string>();
    const center = other.min.map((value, axis) => (value + other.max[axis]) / 2);
    const edges = region.boundaries
      .filter(
        (boundary) =>
          horizontalGap(boundary, other) <= reach + insets.at(-1)! &&
          (takeoff
            ? boundary.max[1] + model.maxJumpHeight + endpointTolerance >= other.min[1] &&
              boundary.min[1] - maxDrop - endpointTolerance <= other.max[1]
            : boundary.min[1] <= other.max[1] + model.maxJumpHeight + endpointTolerance &&
              boundary.max[1] >= other.min[1] - maxDrop - endpointTolerance),
      )
      .sort(
        (a, b) =>
          horizontalGap(a, other) - horizontalGap(b, other) ||
          distance(a.midpoint, takeoff ? to : from) - distance(b.midpoint, takeoff ? to : from),
      );
    // Interleave boundary witnesses so one densely sampled edge cannot consume
    // the region pair's entire endpoint allowance before other ledges are seen.
    const stream = function* (boundary: Region['boundaries'][number]): Generator<Vec3> {
      const samples = Math.max(1, Math.ceil(boundary.length / sampleSpacing));
      const dx = boundary.b[0] - boundary.a[0],
        dz = boundary.b[2] - boundary.a[2];
      const nearest = Math.max(
        0,
        Math.min(
          1,
          ((center[0] - boundary.a[0]) * dx + (center[2] - boundary.a[2]) * dz) /
            (dx * dx + dz * dz),
        ),
      );
      const fractions = function* (count: number) {
        yield nearest;
        yield 0.5;
        for (let index = 0; index < count; index++) yield (index + 0.5) / count;
      };
      const emitted = new Set();
      for (const refinement of new Set([Math.min(4, samples), Math.min(16, samples), samples])) {
        for (const fraction of fractions(refinement)) {
          if (emitted.has(fraction)) continue;
          emitted.add(fraction);
          for (const inset of insets) {
            const point: Vec3 = [
              boundary.a[0] + fraction * (boundary.b[0] - boundary.a[0]),
              boundary.a[1] + fraction * (boundary.b[1] - boundary.a[1]),
              boundary.a[2] + fraction * (boundary.b[2] - boundary.a[2]),
            ];
            point[0] += boundary.interior[0] * inset;
            point[2] += boundary.interior[1] * inset;
            yield point;
          }
        }
      }
    };
    let generated = 0,
      active = edges.map(stream);
    while (active.length) {
      const pending = [];
      for (const iterator of active) {
        if (generated >= limit || diagnostics.seedChecks >= diagnostics.limits.seedChecks) {
          diagnostics.truncated = true;
          return seeds;
        }
        const next = iterator.next();
        if (next.done) continue;
        pending.push(iterator);
        generated++;
        diagnostics.seedChecks++;
        const point = next.value,
          key = JSON.stringify(point);
        if (seen.has(key)) continue;
        seen.add(key);
        const nav = project(point, { maxVertical })[0];
        if (nav && componentOf(nav.surface) === region.component) seeds.push(nav.position);
      }
      active = pending;
    }
    return seeds;
  };
  const spreadSeeds = (seeds: Vec3[]) => {
    const cells = new Map<string, Vec3[]>();
    for (const seed of seeds) {
      const key = seed.map((value) => Math.floor(value / (profile.radius * 2))).join('/');
      const group = cells.get(key) ?? [];
      group.push(seed);
      cells.set(key, group);
    }
    return interleave([...cells.values()], seeds.length);
  };
  const pairsFor = function* ({ a, b, reach }: Transfer): Generator<Pair> {
    if (diagnostics.seedChecks >= diagnostics.limits.seedChecks) {
      diagnostics.truncated = true;
      return;
    }
    const available = diagnostics.limits.seedChecks - diagnostics.seedChecks;
    const endpointBudget = Math.min(4096, Math.max(64, maxCandidates * 2));
    const takeoffs = spreadSeeds(
      seedsFor(a, b, true, reach, Math.min(endpointBudget, Math.floor(available / 2))),
    );
    const landings = spreadSeeds(
      seedsFor(
        b,
        a,
        false,
        reach,
        Math.min(endpointBudget, diagnostics.limits.seedChecks - diagnostics.seedChecks),
      ),
    );
    const queryLandings = createBoundsIndex(
      landings.map((point) => ({ min: point, max: point, point })),
    );
    const queryFaces = createBoundsIndex(
      b.surfaces.map((surface) => ({ surface, ...boundsOf(surface.vertices) })),
    );
    let active: ({ start: Vec3 } & (
      | { boundary: true; landings: Generator<{ min: Vec3; max: Vec3; point: Vec3 }> }
      | { boundary: false; landings: Generator<{ surface: Surface } & Bounds> }
    ))[] = [];
    for (const start of takeoffs) {
      const duration = jumpDuration(
        start[1] + endpointTolerance,
        Math.max(b.min[1] - endpointTolerance, start[1] + endpointTolerance - maxDrop),
        { ...model, mode: model.maxJumpHeight > 0 ? 'jump' : 'drop' },
      );
      if (duration === null) continue;
      const reach = Math.min(maxHorizontalDistance, duration * model.maxHorizontalSpeed);
      const bounds = {
        min: [start[0] - reach, start[1] - maxDrop - 2 * endpointTolerance, start[2] - reach],
        max: [
          start[0] + reach,
          start[1] + model.maxJumpHeight + 2 * endpointTolerance,
          start[2] + reach,
        ],
      };
      if (!queryLandings.empty)
        active.push({ start, boundary: true, landings: queryLandings.nearest(bounds, to) });
      if (!queryFaces.empty)
        active.push({ start, boundary: false, landings: queryFaces.nearest(bounds, to) });
    }
    while (active.length) {
      const pending = [];
      for (const query of active) {
        let exhausted = false;
        for (let count = 0; count < 8; count++) {
          if (query.boundary) {
            const landing = query.landings.next();
            if (landing.done) {
              exhausted = true;
              break;
            }
            yield { start: query.start, end: landing.value.point, boundary: true };
          } else {
            const landing = query.landings.next();
            if (landing.done) {
              exhausted = true;
              break;
            }
            for (const point of landingCandidates(
              landing.value.surface,
              query.start,
              to,
              model,
              profile.radius,
            )) {
              yield { start: query.start, end: point.position, boundary: false };
            }
          }
        }
        if (!exhausted) pending.push(query);
      }
      active = pending;
    }
  };
  const candidatesFor = (entry: Transfer): Candidate[] => {
    const { a, b } = entry;
    const generation = (entry.generation ??= {
      pairs: pairsFor(entry),
      pending: [],
      cursor: 0,
      done: false,
    });
    const nextBatch = () => {
      const candidates = generation.pending.slice(
        generation.cursor,
        generation.cursor + maxCandidates,
      );
      generation.cursor += candidates.length;
      diagnostics.candidatePairs += candidates.length;
      if (a.component === sourceComponent) {
        diagnostics.sourceCandidates += candidates.length;
        if (targetComponents.has(b.component)) diagnostics.directCandidates += candidates.length;
      }
      return candidates;
    };
    if (generation.cursor < generation.pending.length) return nextBatch();
    if (generation.done || !pairingAvailable()) return [];
    diagnostics.generationBatches++;
    const previousPairs = diagnostics.pairChecks,
      previousNeighbours = diagnostics.neighbourChecks;
    const buckets = new Map<string, Map<string, Candidate[]>>(),
      diversity = profile.radius * 2;
    const compare = (a: Candidate, b: Candidate) =>
      Number(b.boundary) - Number(a.boundary) ||
      Number(a.uncertain) - Number(b.uncertain) ||
      a.score - b.score;
    while (
      pairingAvailable() &&
      diagnostics.pairChecks - previousPairs < maxCandidates * 4 &&
      diagnostics.neighbourChecks - previousNeighbours < maxCandidates * 32
    ) {
      const pair = generation.pairs.next();
      if (pair.done) {
        generation.done = true;
        break;
      }
      const { start, end, boundary } = pair.value;
      diagnostics.neighbourChecks++;
      const drop = start[1] - end[1],
        span = horizontal(start, end);
      if (
        -drop > model.maxJumpHeight + 2 * endpointTolerance ||
        drop > maxDrop + 2 * endpointTolerance ||
        span > maxHorizontalDistance
      ) {
        diagnostics.rejected.range++;
        continue;
      }
      const duration = jumpDuration(start[1] + endpointTolerance, end[1] - endpointTolerance, {
        ...model,
        mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
      });
      if (duration === null || span > duration * model.maxHorizontalSpeed) {
        diagnostics.rejected.range++;
        continue;
      }
      diagnostics.pairChecks++;
      const launch = start.map((value) => Math.floor(value / diversity)).join('/');
      const landingKey = end.map((value) => Math.floor(value / diversity)).join('/');
      const destinations = buckets.get(launch) ?? new Map<string, Candidate[]>();
      const bucket = destinations.get(landingKey) ?? [];
      const nominal = jumpDuration(start[1], end[1], {
        ...model,
        mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
      });
      bucket.push({
        start,
        end,
        boundary,
        uncertain: nominal === null || span > nominal * model.maxHorizontalSpeed,
        score:
          (nominal ?? duration) +
          (distance(from, start) + distance(end, to)) / Math.max(1, model.maxHorizontalSpeed),
      });
      destinations.set(landingKey, bucket);
      buckets.set(launch, destinations);
    }
    // Visit each body-scale launch region before its second landing sample.
    // Within one launch region, retain spatially diverse landings and then fine
    // offsets. This includes railing pullbacks without losing narrow platforms.
    const launches = [...buckets.values()]
      .map((destinations) => {
        const lists = [...destinations.values()]
          .map((list) => list.sort(compare))
          .sort((a, b) => compare(a[0], b[0]));
        return interleave(lists, diagnostics.pairChecks - previousPairs);
      })
      .sort((a, b) => compare(a[0], b[0]));
    generation.pending = interleave(launches, diagnostics.pairChecks - previousPairs);
    generation.cursor = 0;
    if (!generation.done) diagnostics.truncated = true;
    return nextBatch();
  };
  const validate = (entry: Transfer): DiscoveredConnection | null | undefined => {
    const { a, b } = entry;
    if (!entry.search) {
      entry.search = { candidates: [], cursor: 0, tried: new Set<string>() };
      const entries = preparedIncoming.get(b.id) ?? [];
      entries.push(entry);
      preparedIncoming.set(b.id, entries);
    }
    const search = entry.search,
      firstAttempt = diagnostics.attempted;
    if (search.cursor >= search.candidates.length) {
      search.candidates = candidatesFor(entry);
      search.cursor = 0;
    }
    while (search.cursor < search.candidates.length) {
      const candidate = search.candidates[search.cursor++];
      const start = standing(candidate.start, a.component),
        end = standing(candidate.end, b.component);
      if (!start || !end) continue;
      const key = JSON.stringify([start.position, end.position]);
      if (search.tried.has(key)) continue;
      search.tried.add(key);
      // Support correction may change heights enough to invalidate a raw pair.
      if (
        start.position[1] - end.position[1] > maxDrop ||
        horizontal(start.position, end.position) > maxHorizontalDistance
      )
        continue;
      const duration = jumpDuration(start.position[1], end.position[1], {
        ...model,
        mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
      });
      if (
        duration === null ||
        horizontal(start.position, end.position) > duration * model.maxHorizontalSpeed
      ) {
        diagnostics.rejected.range++;
        continue;
      }
      for (const mode of ['jump', 'drop'] as const) {
        if (mode === 'jump' && model.maxJumpHeight === 0) continue;
        if (mode === 'drop' && end.position[1] > start.position[1]) continue;
        if (diagnostics.attempted >= diagnostics.limits.arcAttempts) {
          diagnostics.truncated = true;
          return null;
        }
        diagnostics.attempted++;
        const arc = evidence.arc(JSON.stringify([start.position, end.position, { mode }]), () =>
          jumpConnection(start.position, end.position, {
            ...model,
            profile,
            walls,
            mode,
            sweep: (from, to, body) => world.sweepCapsule(from, to, body),
          }),
        );
        if (!arc) {
          diagnostics.rejected.motion++;
          continue;
        }
        return {
          id: `traversal/${a.id}/${b.id}`,
          ...arc,
          state: 'open',
          endpointTolerance,
          fromSurface: start.surface,
          toSurface: end.surface,
        };
      }
      // A difficult optimistic shortcut must not exhaust the query before a
      // nearby multi-hop chain is tried. Deferred batches retain their cursor
      // and remain searchable; this is scheduling, not an extra coverage limit.
      if (diagnostics.attempted - firstAttempt >= 32 && search.cursor < search.candidates.length) {
        entry.cost += 1;
        diagnostics.deferredPairs++;
        return undefined;
      }
    }
    const generation = entry.generation!;
    if (generation.cursor < generation.pending.length || (!generation.done && pairingAvailable())) {
      entry.cost += 1;
      diagnostics.deferredPairs++;
      return undefined;
    }
    return null;
  };
  const validated = new Set<string>();
  while (
    connections.length < maxLinks &&
    diagnostics.regionSearches < (workLimits?.regionSearches ?? maxCandidates)
  ) {
    diagnostics.regionSearches++;
    const chain = findChain();
    if (!chain) break;
    let complete = true;
    for (const entry of chain) {
      if (entry.ground || validated.has(entry.key)) continue;
      const connection = validate(entry);
      diagnostics.pairBatches++;
      if (!connection) {
        if (connection === null) {
          entry.closed = true;
          diagnostics.validatedPairs++;
        }
        complete = false;
        break;
      }
      diagnostics.validatedPairs++;
      validated.add(entry.key);
      connections.push(connection);
      diagnostics.accepted++;
      if (connections.length >= maxLinks) break;
    }
    if (complete && chain.every((entry) => entry.ground || validated.has(entry.key))) {
      diagnostics.targetReached = true;
      break;
    }
    if (
      diagnostics.attempted >= diagnostics.limits.arcAttempts ||
      diagnostics.endpointChecks >= diagnostics.limits.endpointChecks
    ) {
      diagnostics.truncated = true;
      break;
    }
  }
  if (
    diagnostics.regionSearches >= (workLimits?.regionSearches ?? maxCandidates) &&
    !diagnostics.targetReached
  )
    diagnostics.truncated = true;
  diagnostics.targetReached ??= false;
  if (connections.length >= maxLinks && !diagnostics.targetReached) diagnostics.truncated = true;
  return { connections, diagnostics };
}
