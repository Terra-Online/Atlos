import type { CollisionWorld } from '#@/src/collision.ts';
import type { Vec3, Surface, Portal, Wall } from '#@/src/geometry.ts';
import { type Bounds, createBoundsIndex } from '#@/src/model/bounds.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { InteractionGoal, JumpModel } from '#@/src/movement.ts';
import type { GroundConnection } from '#@/src/route.ts';
import {
  type DirectedPortal,
  type SharedPortal,
  surfacePortals,
  directedPortals,
} from '#@/src/v1/geo/surfaces.ts';
import {
  arcEvidenceKey,
  discoveryEvidence,
  standingEvidenceKey,
  vec3Key,
  vec3PairKey,
} from '#@/src/v1/motion/evidence.ts';
import {
  createMotionVariants,
  jumpConnection,
  jumpDuration,
  jumpTravel,
  runOffConnection,
  type ApproachCache,
} from '#@/src/v1/motion/jumps.ts';
import { landingCandidates } from '#@/src/v1/motion/landings.ts';
import type { GroundPlanner } from '#@/src/v1/route/ground.ts';
import { movementGeometry } from '#@/src/v1/route/movement-geometry.ts';

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
interface EdgeState {
  generation?: { pairs: Generator<Pair>; pending: Candidate[]; cursor: number; done: boolean };
  search: { candidates: Candidate[]; cursor: number; tried: Set<string> };
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
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const horizontal = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[2] - b[2]);
const doubleColumn = <T extends Int32Array | Float64Array | Uint8Array>(
  column: T,
  Column: new (length: number) => T,
): T => {
  const grown = new Column(column.length * 2);
  grown.set(column);
  return grown;
};
export const exposedBoundaries = (
  surfaces: Surface[],
  portals: Portal[],
  sharedPortals?: SharedPortal[],
  preparedDirected?: DirectedPortal[],
): Boundary[] => {
  const surfaceCount = surfaces.length;
  const surfaceIndex = new Map<string, number>();
  const edgeOffset = new Int32Array(surfaceCount);
  let totalEdges = 0;
  for (let i = 0; i < surfaceCount; i++) {
    const surface = surfaces[i];
    surfaceIndex.set(surface.id, i);
    edgeOffset[i] = totalEdges;
    totalEdges += surface.vertices.length;
  }
  // ~90% of mesh edges are fully covered [0, 1] by shared portals. Track full
  // coverage in a compact bit-byte array and allocate range tuples only for
  // partially covered edges, avoiding millions of string keys and closures.
  const fullCovered = new Uint8Array(totalEdges);
  const partialCovered = new Map<number, [number, number][]>();
  const cover = (id: string, edge: number, start: Vec3, end: Vec3) => {
    const sIdx = surfaceIndex.get(id)!;
    const slot = edgeOffset[sIdx] + edge;
    if (fullCovered[slot]) return;
    const verts = surfaces[sIdx].vertices;
    const a = verts[edge];
    const b = verts[(edge + 1) % verts.length];
    const dx = b[0] - a[0],
      dy = b[1] - a[1],
      dz = b[2] - a[2];
    const squared = dx * dx + dy * dy + dz * dz;
    const first =
      ((start[0] - a[0]) * dx + (start[1] - a[1]) * dy + (start[2] - a[2]) * dz) / squared;
    const last = ((end[0] - a[0]) * dx + (end[1] - a[1]) * dy + (end[2] - a[2]) * dz) / squared;
    const lo = Math.max(0, Math.min(first, last));
    const hi = Math.min(1, Math.max(first, last));
    if (lo === 0 && hi === 1) {
      fullCovered[slot] = 1;
      partialCovered.delete(slot);
      return;
    }
    let ranges = partialCovered.get(slot);
    if (!ranges) {
      ranges = [];
      partialCovered.set(slot, ranges);
    }
    ranges.push([lo, hi]);
  };
  const shared = sharedPortals ?? surfacePortals(surfaces);
  for (let i = 0; i < shared.length; i++) {
    const portal = shared[i];
    cover(portal.from, portal.fromEdge, portal.start, portal.end);
    cover(portal.to, portal.toEdge, portal.start, portal.end);
  }
  const directed = preparedDirected ?? directedPortals(surfaces, portals);
  for (let i = 0; i < directed.length; i++) {
    const portal = directed[i];
    cover(portal.from, portal.fromEdge, portal.start, portal.end);
  }
  const boundaries: Boundary[] = [];
  for (let i = 0; i < surfaceCount; i++) {
    const surface = surfaces[i];
    const verts = surface.vertices;
    const n = verts.length;
    const baseSlot = edgeOffset[i];
    // Defer centroid computation until at least one edge is not fully covered.
    let hasCenter = false;
    let cx = 0,
      cy = 0,
      cz = 0;
    const emitGap = (edge: number, from: Vec3, to: Vec3, near: number, far: number) => {
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
      if (length <= 1e-4) return;
      if (!hasCenter) {
        hasCenter = true;
        for (let k = 0; k < n; k++) {
          const p = verts[k];
          cx += p[0];
          cy += p[1];
          cz += p[2];
        }
        cx /= n;
        cy /= n;
        cz /= n;
      }
      const inward: [number, number] = [-(b[2] - a[2]) / length, (b[0] - a[0]) / length];
      if (inward[0] * (cx - midpoint[0]) + inward[1] * (cz - midpoint[2]) < 0) {
        inward[0] *= -1;
        inward[1] *= -1;
      }
      const interiorX = cx - midpoint[0],
        interiorZ = cz - midpoint[2];
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
    };
    for (let edge = 0; edge < n; edge++) {
      const slot = baseSlot + edge;
      if (fullCovered[slot]) continue;
      const from = verts[edge];
      const to = verts[(edge + 1) % n];
      const ranges = partialCovered.get(slot);
      if (!ranges) {
        emitGap(edge, from, to, 0, 1);
        continue;
      }
      if (ranges.length > 1) ranges.sort((a, b) => a[0] - b[0]);
      let cursor = 0;
      for (let r = 0; r < ranges.length; r++) {
        const near = ranges[r][0],
          far = ranges[r][1];
        if (near > cursor) emitGap(edge, from, to, cursor, near);
        if (far > cursor) cursor = far;
      }
      if (cursor < 1) emitGap(edge, from, to, cursor, 1);
    }
  }
  return boundaries;
};
const horizontalGap = (a: Bounds, b: Bounds) =>
  Math.hypot(
    Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0),
    Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2], 0),
  );
const boundsOf = (vertices: Vec3[]): Bounds => {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i];
    if (p[0] < minX) minX = p[0];
    if (p[1] < minY) minY = p[1];
    if (p[2] < minZ) minZ = p[2];
    if (p[0] > maxX) maxX = p[0];
    if (p[1] > maxY) maxY = p[1];
    if (p[2] > maxZ) maxZ = p[2];
  }
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] };
};
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
  const wb = world.bounds;
  if (
    wb &&
    (nav.position[0] - profile.radius < wb.min[0] ||
      nav.position[0] + profile.radius > wb.max[0] ||
      nav.position[2] - profile.radius < wb.min[1] ||
      nav.position[2] + profile.radius > wb.max[1])
  )
    return { reason: 'support' };
  const support = world.groundAt(nav.position, {
    maxUp: profile.radius,
    maxDown: profile.radius,
    maxSlope,
    radius: profile.radius,
  });
  if (!support) return { reason: 'support' };
  const position: Vec3 = [...support.position];
  // groundAt includes finite-face, edge and corner sphere support. Applying an
  // infinite-plane lift afterward can leave a takeoff floating above a ledge.
  position[1] += 0.005;
  // Real support corrects voxel and slope height. Bind the corrected foot to the
  // closest eligible navigation support, matching subsequent ground queries.
  if (Math.abs(position[1] - nav.position[1]) > Math.min(maxVertical, profile.radius))
    return { reason: 'projection' };
  if (
    wb &&
    (position[0] - profile.radius < wb.min[0] ||
      position[0] + profile.radius > wb.max[0] ||
      position[2] - profile.radius < wb.min[1] ||
      position[2] + profile.radius > wb.max[1])
  )
    return { reason: 'clearance' };
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
  const { topology, project } = geometry;
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
    // Cache deduplicated cross-component ground transfers once per shared
    // topology so repeated queries skip scanning all static graph edges.
    const groundTransfers: [number, number][] = [];
    const stride = topology.count;
    const seenTransfer = new Set<number>();
    for (let node = 0; node < topology.forward.length; node++) {
      const fromComp = topology.components[node];
      const outgoing = topology.forward[node];
      for (let i = 0; i < outgoing.length; i++) {
        const toComp = topology.components[outgoing[i]];
        if (fromComp === toComp) continue;
        const pairId = fromComp * stride + toComp;
        if (seenTransfer.has(pairId)) continue;
        seenTransfer.add(pairId);
        groundTransfers.push([fromComp, toComp]);
      }
    }
    return { regions, boundaries, queryRegions: createBoundsIndex(regions), groundTransfers };
  })();
  const { regions, boundaries, queryRegions, groundTransfers } = geometry.regions;
  const regionCount = regions.length;
  const sourceMask = new Uint8Array(regionCount);
  for (const node of reachable) sourceMask[topology.components[node]] = 1;
  diagnostics.boundaryEdges = boundaries.length;
  const endpointTolerance = Math.min(maxVertical, profile.radius);
  // A sprint jump can launch above the sustained air cap. Candidate bounds
  // retain that impulse and its existing decay before exact motion validation.
  const initialSpeed = Math.max(
    model.maxHorizontalSpeed,
    model.maxJumpHeight > 0 ? (model.startHorizontalSpeed ?? 0) : 0,
  );
  const travelAt = (duration: number) => jumpTravel(initialSpeed, duration, model);
  const jumpOptions = {
    ...model,
    mode: model.maxJumpHeight > 0 ? 'jump' : 'drop',
  } satisfies Parameters<typeof jumpDuration>[2];
  const reachAtDrop = (drop: number) => {
    const duration = jumpDuration(drop, 0, jumpOptions);
    return duration === null ? null : Math.min(maxHorizontalDistance, travelAt(duration));
  };
  const { gravity, fallingGravity, maxJumpHeight, maxFallingSpeed, apexTime, maxHorizontalSpeed } =
    jumpOptions;
  const jump = jumpOptions.mode === 'jump';
  const lift = jump ? maxJumpHeight : 0;
  let jumpBaseDuration = 0;
  if (jump) {
    jumpBaseDuration += Math.sqrt(2 * gravity * maxJumpHeight) / gravity;
    if (apexTime > 0) jumpBaseDuration += apexTime;
  }
  const terminalTime = maxFallingSpeed / fallingGravity;
  const terminalDistance = (maxFallingSpeed * terminalTime) / 2;
  // Match verticalDuration(drop, 0, jumpOptions), including each separately
  // rounded addition. Discovery already validated the model and mode.
  const durationAtDrop = (drop: number) => {
    const peak = drop + lift;
    if (!Number.isFinite(peak)) return NaN;
    if (peak < 0) return 0;
    let duration = jumpBaseDuration;
    const fallDistance = peak - 0;
    if (fallDistance > 0) {
      if (fallDistance <= terminalDistance) {
        duration += Math.sqrt((2 * fallDistance) / fallingGravity);
      } else {
        duration += terminalTime;
        duration += (fallDistance - terminalDistance) / maxFallingSpeed;
      }
    }
    return duration;
  };
  const expires = 'expireAfter' in model && model.expireAfter !== undefined;
  const overspeed = initialSpeed > maxHorizontalSpeed;
  const deceleration = model.airOverspeedDeceleration!;
  const brakingTime = overspeed ? (initialSpeed - maxHorizontalSpeed) / deceleration : 0;
  const fastReachAtDrop = (drop: number) => {
    const duration = durationAtDrop(drop);
    if (!Number.isFinite(duration)) return reachAtDrop(drop);
    if (duration <= 0) return null;
    if (expires) return Math.min(maxHorizontalDistance, travelAt(duration));
    if (!overspeed) return Math.min(maxHorizontalDistance, initialSpeed * duration);
    const braking = Math.min(duration, brakingTime);
    return Math.min(
      maxHorizontalDistance,
      initialSpeed * braking -
        (deceleration * braking * braking) / 2 +
        maxHorizontalSpeed * (duration - braking),
    );
  };
  // An artificial upper drop can overflow for extreme models even when all
  // actual region drops are finite. In that case check each actual pair.
  const cappedDuration = durationAtDrop(maxDrop);
  const cappedReach = Number.isFinite(cappedDuration) ? reachAtDrop(maxDrop) : undefined;
  // The accelerating descent and terminal-speed formulas can round in
  // opposite directions at the crossover. Include both sides in the bound.
  const maxDuration =
    maxDrop + lift > terminalDistance
      ? Math.max(
          cappedDuration,
          jumpBaseDuration + Math.sqrt((2 * terminalDistance) / fallingGravity),
        )
      : cappedDuration;
  const canDeferReach =
    !expires && cappedReach != null && cappedReach >= 0 && Number.isFinite(maxDuration);
  const variableBraking = jumpBaseDuration < brakingTime;
  const maxBraking = Math.min(maxDuration, brakingTime);
  // Once braking ends, its distance is constant and reach grows with coast
  // time. While still braking, rounding can break monotonicity. Bound that
  // phase by its largest launch term, before subtracting any braking loss.
  let reachBound = maxHorizontalDistance;
  if (canDeferReach) {
    const upperReach = maxDuration === cappedDuration ? cappedReach : travelAt(maxDuration);
    if (upperReach >= 0)
      reachBound = Math.min(
        maxHorizontalDistance,
        variableBraking ? Math.max(upperReach, initialSpeed * maxBraking) : upperReach,
      );
  }
  const queryHalfWidth = Math.min(maxHorizontalDistance, reachBound + 1e-6);
  let minReach = canDeferReach && jump && jumpBaseDuration > 0 ? reachAtDrop(-maxJumpHeight) : null;
  if (minReach !== null && variableBraking) {
    // Use the smallest launch term and largest braking loss. Coast only
    // adds distance for these bounds, even if the actual drop ends braking.
    const maxLoss = (deceleration * maxBraking * maxBraking) / 2;
    minReach = Math.min(minReach, initialSpeed * jumpBaseDuration - maxLoss);
  }
  // Costs order optimistic chains. Every airborne step still needs motion validation.
  const orderingSpeed = Math.max(1, maxHorizontalSpeed);
  let regionPairs = 0;
  const groundIncoming = new Array<number[] | undefined>(regionCount);
  const addGroundTransfer = (from: number, to: number) => {
    const entries = (groundIncoming[to] ??= []);
    if (entries.includes(from)) return;
    entries.push(from);
    regionPairs++;
  };
  for (const [from, to] of groundTransfers) addGroundTransfer(from, to);
  // Known actions must also join intermediate proposal regions. Source closure
  // alone cannot discover a jump into a ride followed by another jump out of it.
  // Keep their direction without merging the underlying ground components.
  if (intermediateActions)
    for (const [from, destinations] of extraForward)
      for (const to of destinations) {
        const source = topology.components[from],
          target = topology.components[to];
        if (source !== target) addGroundTransfer(source, target);
      }
  const airStart = new Int32Array(regionCount).fill(-1);
  const airEnd = new Int32Array(regionCount);
  const preparedIncoming = new Array<number[] | undefined>(regionCount);
  const edgeStates = new Map<number, EdgeState>();
  const initialCapacity = Math.min(65536, Math.max(1, regionCount * (regionCount - 1)));
  let edgeFrom = new Int32Array(initialCapacity);
  let edgeTo = new Int32Array(initialCapacity);
  let edgeCost = new Float64Array(initialCapacity);
  let edgeReach = new Float64Array(initialCapacity);
  let edgeClosed = new Uint8Array(initialCapacity);
  let edgeValidated = new Uint8Array(initialCapacity);
  let edgeCount = 0;
  const pairingAvailable = () =>
    diagnostics.neighbourChecks < diagnostics.limits.neighbourChecks &&
    diagnostics.pairChecks < diagnostics.limits.pairChecks;
  const generationAvailable = () =>
    diagnostics.seedChecks < diagnostics.limits.seedChecks && pairingAvailable();
  const dropBetween = (a: Region, b: Region) =>
    Math.min(maxDrop, a.max[1] - b.min[1] + 2 * endpointTolerance);
  const scanIncoming = (b: Region) => {
    const component = b.component;
    const ground = groundIncoming[component];
    airStart[component] = edgeCount;
    // Keep the original tree and hit order: tied chains can spend the search
    // budget on different candidates if boundary-less regions are removed before indexing.
    if (cappedReach !== null && b.boundaries.length)
      queryRegions.forEachBox(
        b.min[0] - queryHalfWidth,
        b.min[1] - maxJumpHeight - 2 * endpointTolerance,
        b.min[2] - queryHalfWidth,
        b.max[0] + queryHalfWidth,
        b.max[1] + maxDrop + 2 * endpointTolerance,
        b.max[2] + queryHalfWidth,
        (a) => {
          if (a === b || !a.boundaries.length) return;
          const drop = dropBetween(a, b);
          if (-drop > maxJumpHeight || a.min[1] - b.max[1] - 2 * endpointTolerance > maxDrop)
            return;
          const dx = Math.max(a.min[0] - b.max[0], b.min[0] - a.max[0], 0);
          const dz = Math.max(a.min[2] - b.max[2], b.min[2] - a.max[2], 0);
          if (dx > reachBound || dz > reachBound) return;
          const gap = dx === 0 && dz === 0 ? 0 : Math.hypot(dx, dz);
          if (!(gap <= reachBound) || ground?.includes(a.component)) return;

          let reach: number | null;
          if (cappedReach !== undefined && Object.is(drop, maxDrop)) {
            reach = cappedReach;
            if (reach === null || !(gap <= reach)) return;
          } else if (
            canDeferReach &&
            ((gap === 0 &&
              ((minReach !== null && minReach >= 0) ||
                (!jump && drop > 0 && (2 * drop) / fallingGravity > 0))) ||
              (minReach !== null && gap < minReach * (1 - 1e-12)))
          ) {
            // Seed admission uses the precise reach, so calculate it only if
            // the edge reaches pair generation.
            reach = NaN;
          } else {
            reach = fastReachAtDrop(drop);
            if (reach === null || !(gap <= reach)) return;
          }

          if (edgeCount === edgeFrom.length) {
            edgeFrom = doubleColumn(edgeFrom, Int32Array);
            edgeTo = doubleColumn(edgeTo, Int32Array);
            edgeCost = doubleColumn(edgeCost, Float64Array);
            edgeReach = doubleColumn(edgeReach, Float64Array);
            edgeClosed = doubleColumn(edgeClosed, Uint8Array);
            edgeValidated = doubleColumn(edgeValidated, Uint8Array);
          }
          edgeFrom[edgeCount] = a.component;
          edgeTo[edgeCount] = component;
          edgeCost[edgeCount] = 1 + gap / orderingSpeed;
          edgeReach[edgeCount] = reach;
          edgeCount++;
          regionPairs++;
        },
      );
    airEnd[component] = edgeCount;
    diagnostics.regionPairs = regionPairs;
  };
  const costs = new Float64Array(regionCount);
  const nextEdge = new Int32Array(regionCount);
  const nextDest = new Int32Array(regionCount);
  let heapComp = new Int32Array(Math.min(1024, regionCount));
  let heapCost = new Float64Array(heapComp.length);
  let heapSize = 0;
  const pushHeap = (component: number, cost: number) => {
    if (heapSize === heapComp.length) {
      heapComp = doubleColumn(heapComp, Int32Array);
      heapCost = doubleColumn(heapCost, Float64Array);
    }
    let index = heapSize++;
    while (index > 0) {
      const parent = (index - 1) >> 1;
      if (heapCost[parent] <= cost) break;
      heapComp[index] = heapComp[parent];
      heapCost[index] = heapCost[parent];
      index = parent;
    }
    heapComp[index] = component;
    heapCost[index] = cost;
  };
  const relax = (component: number, dest: number, edgeId: number, cost: number) => {
    if (cost >= costs[component]) return;
    costs[component] = cost;
    nextEdge[component] = edgeId;
    nextDest[component] = dest;
    pushHeap(component, cost);
  };
  const relaxAir = (edgeId: number, dest: number, travelled: number) => {
    if (edgeClosed[edgeId]) return;
    relax(edgeFrom[edgeId], dest, edgeId, travelled + edgeCost[edgeId]);
  };
  const findChain = (): number[] | null => {
    heapSize = 0;
    costs.fill(Infinity);
    // Every insertion overwrites its successor. Reset the target roots as
    // well: -2 terminates the chain, while -1 follows a ground transfer.
    for (const component of targetComponents) {
      costs[component] = 0;
      nextEdge[component] = -2;
      pushHeap(component, 0);
    }
    while (heapSize > 0) {
      const dest = heapComp[0];
      const travelled = heapCost[0];
      // Keep the same tie order as createMinHeap, including equal children.
      const lastComp = heapComp[--heapSize];
      const lastCost = heapCost[heapSize];
      if (heapSize > 0) {
        let index = 0;
        while (index * 2 + 1 < heapSize) {
          let child = index * 2 + 1;
          if (child + 1 < heapSize && heapCost[child + 1] < heapCost[child]) child++;
          if (heapCost[child] >= lastCost) break;
          heapComp[index] = heapComp[child];
          heapCost[index] = heapCost[child];
          index = child;
        }
        heapComp[index] = lastComp;
        heapCost[index] = lastCost;
      }

      if (travelled !== costs[dest]) continue;
      if (sourceMask[dest]) {
        const chain: number[] = [];
        for (let component = dest; nextEdge[component] !== -2; component = nextDest[component]) {
          const id = nextEdge[component];
          if (id >= 0) chain.push(id);
        }
        return chain;
      }
      const ground = groundIncoming[dest];
      if (ground) for (const component of ground) relax(component, dest, -1, travelled);
      if (generationAvailable()) {
        if (airStart[dest] === -1) scanIncoming(regions[dest]);
        for (let id = airStart[dest]; id < airEnd[dest]; id++) relaxAir(id, dest, travelled);
      } else {
        const prepared = preparedIncoming[dest];
        if (prepared) for (const id of prepared) relaxAir(id, dest, travelled);
      }
    }
    return null;
  };
  const cachedStanding = new Map<string, Standing | null>();
  const standing = (seed: Vec3, component: number): Standing | null => {
    const key = `${component}\0${vec3Key(seed)}`;
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
      const sampled = evidence.standing(standingEvidenceKey(nav.position, nav.surface), () =>
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
          key = vec3Key(point);
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
  const pairsFor = function* (edgeId: number, a: Region, b: Region): Generator<Pair> {
    if (diagnostics.seedChecks >= diagnostics.limits.seedChecks) {
      diagnostics.truncated = true;
      return;
    }
    let reach = edgeReach[edgeId];
    if (Number.isNaN(reach)) {
      reach = reachAtDrop(dropBetween(a, b))!;
      edgeReach[edgeId] = reach;
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
        jumpOptions,
      );
      if (duration === null) continue;
      const reach = Math.min(maxHorizontalDistance, travelAt(duration));
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
  const candidatesFor = (edgeId: number, state: EdgeState, a: Region, b: Region): Candidate[] => {
    const generation = (state.generation ??= {
      pairs: pairsFor(edgeId, a, b),
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
      const duration = jumpDuration(
        start[1] + endpointTolerance,
        end[1] - endpointTolerance,
        jumpOptions,
      );
      if (duration === null || span > travelAt(duration)) {
        diagnostics.rejected.range++;
        continue;
      }
      diagnostics.pairChecks++;
      const launch = start.map((value) => Math.floor(value / diversity)).join('/');
      const landingKey = end.map((value) => Math.floor(value / diversity)).join('/');
      const destinations = buckets.get(launch) ?? new Map<string, Candidate[]>();
      const bucket = destinations.get(landingKey) ?? [];
      const nominal = jumpDuration(start[1], end[1], jumpOptions);
      bucket.push({
        start,
        end,
        boundary,
        uncertain: nominal === null || span > travelAt(nominal),
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
  const approaches: ApproachCache = new Map();
  const motionVariants = createMotionVariants(
    model,
    world,
    profile,
    new Map(),
    approaches,
    () => false,
  );
  const motion = {
    ...model,
    profile,
    walls,
    wallCheck: blocked,
    sweep: world.sweepCapsule.bind(world),
    funnelWorld: world,
  };
  const validate = (edgeId: number): DiscoveredConnection | null | undefined => {
    const a = regions[edgeFrom[edgeId]],
      b = regions[edgeTo[edgeId]];
    let state = edgeStates.get(edgeId);
    if (!state) {
      state = { search: { candidates: [], cursor: 0, tried: new Set<string>() } };
      edgeStates.set(edgeId, state);
      (preparedIncoming[b.component] ??= []).push(edgeId);
    }
    const search = state.search,
      firstAttempt = diagnostics.attempted;
    if (search.cursor >= search.candidates.length) {
      search.candidates = candidatesFor(edgeId, state, a, b);
      search.cursor = 0;
    }
    while (search.cursor < search.candidates.length) {
      const candidate = search.candidates[search.cursor++];
      const start = standing(candidate.start, a.component),
        end = standing(candidate.end, b.component);
      if (!start || !end) continue;
      const key = vec3PairKey(start.position, end.position);
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
      if (duration === null || horizontal(start.position, end.position) > travelAt(duration)) {
        diagnostics.rejected.range++;
        continue;
      }
      function* controls(from: Vec3, to: Vec3) {
        const drop = from[1] - to[1];
        const span = horizontal(from, to);
        if (drop > profile.height && span > 0 && model.airAcceleration !== undefined) {
          // A steep ledge can admit a supported run followed by a braked fall.
          // Aim through the boundary towards the landing, allowing motion to
          // verify the real support loss independently of the baked edge.
          const approach = Math.min(span, 2 * profile.radius) / span;
          const exit: [number, number] = [
            from[0] + (to[0] - from[0]) * approach,
            from[2] + (to[2] - from[2]) * approach,
          ];
          // The non-steering control can march as far as the opposing contact.
          yield { mode: 'drop' as const, runOff: true };
          for (const control of motionVariants(from, to, exit)) {
            if (control.mode === 'drop' && control.exit) yield { ...control, runOff: true };
          }
        }
        if (model.maxJumpHeight > 0) yield { mode: 'jump' as const };
        if (drop >= 0) yield { mode: 'drop' as const };
      }
      for (const control of controls(start.position, end.position)) {
        if (diagnostics.attempted >= diagnostics.limits.arcAttempts) {
          diagnostics.truncated = true;
          return null;
        }
        diagnostics.attempted++;
        const arc = evidence.arc(arcEvidenceKey(start.position, end.position, control), () =>
          'runOff' in control
            ? runOffConnection(
                start.position,
                end.position,
                { ...motion, ...control, world, maxSlope },
                approaches,
                evidence.approach,
              )
            : jumpConnection(start.position, end.position, { ...motion, mode: control.mode }),
        );
        if (!arc) {
          diagnostics.rejected.motion++;
          continue;
        }
        return {
          id: `traversal/${a.component}/${b.component}`,
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
        edgeCost[edgeId] += 1;
        diagnostics.deferredPairs++;
        return undefined;
      }
    }
    const generation = state.generation!;
    if (generation.cursor < generation.pending.length || (!generation.done && pairingAvailable())) {
      edgeCost[edgeId] += 1;
      diagnostics.deferredPairs++;
      return undefined;
    }
    return null;
  };
  let goalFirst = false;
  while (
    connections.length < maxLinks &&
    diagnostics.regionSearches < (workLimits?.regionSearches ?? maxCandidates)
  ) {
    diagnostics.regionSearches++;
    const chain = findChain();
    if (!chain) break;
    let complete = true;
    // Deferral can select a different optimistic chain. Share the direction
    // across chains once motion validation starts. Earlier unsupported contacts
    // keep source-first admission; later zero-arc failures must also rotate so
    // one side cannot consume every remaining region search.
    for (let index = 0; index < chain.length; index++) {
      const edgeId = chain[goalFirst ? chain.length - 1 - index : index];
      if (edgeValidated[edgeId]) continue;
      const connection = validate(edgeId);
      diagnostics.pairBatches++;
      if (!connection) {
        if (connection === null) {
          edgeClosed[edgeId] = 1;
          diagnostics.validatedPairs++;
        }
        complete = false;
        if (diagnostics.attempted > 0) goalFirst = !goalFirst;
        break;
      }
      diagnostics.validatedPairs++;
      edgeValidated[edgeId] = 1;
      connections.push(connection);
      diagnostics.accepted++;
      if (connections.length >= maxLinks) break;
    }
    if (complete && chain.every((edgeId) => edgeValidated[edgeId])) {
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
