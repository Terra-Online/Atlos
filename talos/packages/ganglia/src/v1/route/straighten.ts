import type { Vec3, Surface } from '#@/src/geometry.ts';
import { createOrdinalBoundsIndex } from '#@/src/model/bounds.ts';
import { isSupportVertex, supportVertices } from '#@/src/model/support-snapshot.ts';
import { type WallChecker, createWallChecker } from '#@/src/model/walls.ts';
import type { GroundOptions } from '#@/src/route.ts';
import {
  type DirectedPortal,
  type SharedPortal,
  surfacePortals,
  directedPortals,
} from '#@/src/v1/geo/surfaces.ts';

interface Geometry {
  readonly vertCoords: Float64Array;
  readonly triVerts: Uint32Array;
  readonly triDet: Float64Array;
}
interface Adjacency {
  readonly adjOffset: Uint32Array;
  readonly adjTarget: Int32Array;
  readonly adjOpposite: Uint8Array;
  readonly adjPortal: Int32Array;
  readonly portalCoords: Float64Array;
}
interface Entry {
  triangle: number;
  fraction: number;
  previous: Entry | null;
}
interface Clip {
  near: number;
  far: number;
  first: Vec3;
  last: Vec3;
}
export interface GroundStraightener {
  (points: Vec3[]): Vec3[];
  trace(start: Vec3, end: Vec3): Vec3[] | null;
  mayConnect(start: Vec3, end: Vec3): boolean;
}
export interface GroundStraightenerMesh extends Geometry, Adjacency {
  readonly supporting: (point: Vec3) => number[];
  readonly groupsAt: (point: Vec3) => Set<number>;
}

const pointKey = (coords: Float64Array, offset: number) =>
  `${Math.round(coords[offset] * 10000)},${Math.round(coords[offset + 1] * 10000)},${Math.round(coords[offset + 2] * 10000)}`;
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(...a.map((value, axis) => value - b[axis]));
const finitePoint = (point: unknown) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const tolerance = 1e-7;
const weightsAt = (
  { vertCoords, triVerts, triDet }: Geometry,
  triangle: number,
  point: Vec3,
): Vec3 => {
  const offset = triangle * 3;
  const a = triVerts[offset] * 3,
    b = triVerts[offset + 1] * 3,
    c = triVerts[offset + 2] * 3;
  const ax = vertCoords[a],
    az = vertCoords[a + 2];
  const bx = vertCoords[b],
    bz = vertCoords[b + 2];
  const cx = vertCoords[c],
    cz = vertCoords[c + 2];
  const x = point[0] - ax,
    z = point[2] - az;
  const u = (x * (cz - az) - z * (cx - ax)) / triDet[triangle];
  const v = ((bx - ax) * z - (bz - az) * x) / triDet[triangle];
  return [1 - u - v, u, v];
};
const heightAt = (geometry: Geometry, triangle: number, point: Vec3) => {
  const { vertCoords, triVerts } = geometry;
  const offset = triangle * 3;
  const weights = weightsAt(geometry, triangle, point);
  let height = 0;
  for (let index = 0; index < 3; index++)
    height += weights[index] * vertCoords[triVerts[offset + index] * 3 + 1];
  return height;
};
const clipTriangle = (
  geometry: Geometry,
  triangle: number,
  start: Vec3,
  end: Vec3,
): Clip | null => {
  const first = weightsAt(geometry, triangle, start),
    last = weightsAt(geometry, triangle, end);
  let near = 0,
    far = 1;
  for (let index = 0; index < 3; index++) {
    const delta = last[index] - first[index];
    if (Math.abs(delta) < 1e-14) {
      if (first[index] < -tolerance) return null;
      continue;
    }
    const crossing = -first[index] / delta;
    if (delta > 0) near = Math.max(near, crossing);
    else far = Math.min(far, crossing);
  }
  if (near > far + tolerance || far < 0 || near > 1) return null;
  return { near: Math.max(0, near), far: Math.min(1, far), first, last };
};
const simplifyCollinear = (points: Vec3[]): Vec3[] => {
  const result: Vec3[] = [];
  for (const point of points) {
    if (result.length && distance(result.at(-1)!, point) < 1e-9) continue;
    while (result.length > 1) {
      const a = result.at(-2)!,
        b = result.at(-1)!;
      const lengthSquared = point.reduce((sum, value, axis) => sum + (value - a[axis]) ** 2, 0);
      if (lengthSquared === 0) break;
      const fraction =
        b.reduce((sum, value, axis) => sum + (value - a[axis]) * (point[axis] - a[axis]), 0) /
        lengthSquared;
      if (
        fraction < 0 ||
        fraction > 1 ||
        distance(
          b,
          a.map((value, axis) => value + fraction * (point[axis] - value)),
        ) > 1e-7
      )
        break;
      result.pop();
    }
    result.push([...point]);
  }
  return result;
};
// Build-only ownership tables stay outside the scope of the returned queries.
function buildMesh(
  surfaces: Surface[],
  portals: SharedPortal[],
  preparedDirected: DirectedPortal[] | undefined,
  importedPortals: GroundOptions['portals'],
) {
  const vertexOffset = new Uint32Array(surfaces.length + 1);
  for (let face = 0; face < surfaces.length; face++) {
    const source = supportVertices(surfaces[face]);
    if (!source) throw new Error('Invalid surface');
    vertexOffset[face + 1] = vertexOffset[face] + source.length;
  }

  const vertexCount = vertexOffset[surfaces.length];
  const triangleCapacity = vertexCount - 2 * surfaces.length;
  const vertCoords = new Float64Array(vertexCount * 3);
  const triVerts = new Uint32Array(triangleCapacity * 3);
  const triDet = new Float64Array(triangleCapacity);
  const triBoxes = new Float64Array(triangleCapacity * 6);
  const boundaryOwners = new Map<string, number>();
  // Each polygon boundary slot stores the owning triangle edge plus one.
  const boundaryEdges = new Uint32Array(vertexCount);
  const edgeOwners = new Map<string, { edge: number; from: string; to: string }[]>();
  const fanLinks = new Uint32Array(2 * (triangleCapacity - surfaces.length));
  let triangleCount = 0,
    fanLinkCount = 0;

  for (let face = 0; face < surfaces.length; face++) {
    const surface = surfaces[face];
    if (boundaryOwners.has(surface.id)) throw new Error('Invalid surface');
    const source = surface.vertices;
    const first = vertexOffset[face];
    const a = first * 3;
    for (let vertex = 0; vertex < source.length; vertex++) {
      const point = source[vertex];
      if (!isSupportVertex(point)) throw new Error('Invalid surface');
      vertCoords.set(point, a + vertex * 3);
    }
    if (
      surface.portals !== undefined &&
      (!Array.isArray(surface.portals) ||
        surface.portals.some(
          (index) => !Number.isInteger(index) || index < 0 || index >= source.length,
        ))
    )
      throw new Error('Invalid surface portals');
    // Keep the ID even when every fan triangle is degenerate.
    boundaryOwners.set(surface.id, face);

    for (let fan = 1; fan + 1 < source.length; fan++) {
      const b = a + fan * 3,
        c = b + 3;
      const determinant =
        (vertCoords[b] - vertCoords[a]) * (vertCoords[c + 2] - vertCoords[a + 2]) -
        (vertCoords[b + 2] - vertCoords[a + 2]) * (vertCoords[c] - vertCoords[a]);
      if (Math.abs(determinant) < 1e-12) continue;
      const triangle = triangleCount++;
      const offset = triangle * 3;
      triVerts[offset] = first;
      triVerts[offset + 1] = first + fan;
      triVerts[offset + 2] = first + fan + 1;
      triDet[triangle] = determinant;
      const box = triangle * 6;
      for (let axis = 0; axis < 3; axis++) {
        const av = vertCoords[a + axis],
          bv = vertCoords[b + axis],
          cv = vertCoords[c + axis];
        triBoxes[box + axis] = Math.min(av, bv, cv);
        triBoxes[box + axis + 3] = Math.max(av, bv, cv);
      }
      for (let edge = 0; edge < 3; edge++) {
        const polygonEdge =
          edge === 1 || (edge === 0 && fan === 1) || (edge === 2 && fan + 2 === source.length)
            ? edge === 0
              ? 0
              : fan + edge - 1
            : null;
        if (polygonEdge !== null) {
          boundaryEdges[first + polygonEdge] = offset + edge + 1;
          continue;
        }
        const from = pointKey(vertCoords, triVerts[offset + edge] * 3),
          to = pointKey(vertCoords, triVerts[offset + ((edge + 1) % 3)] * 3);
        if (from === to) continue;
        const edgeKey = from < to ? from + '/' + to : to + '/' + from;
        const owners = edgeOwners.get(edgeKey) ?? [];
        owners.push({ edge: offset + edge, from, to });
        edgeOwners.set(edgeKey, owners);
      }
    }
    for (const owners of edgeOwners.values()) {
      if (owners.length !== 2) continue;
      const [a, b] = owners;
      if (a.from !== b.to || a.to !== b.from || Math.floor(a.edge / 3) === Math.floor(b.edge / 3))
        continue;
      fanLinks[fanLinkCount++] = a.edge;
      fanLinks[fanLinkCount++] = b.edge;
    }
    edgeOwners.clear();
  }

  const adjOffset = new Uint32Array(triangleCount + 1);
  for (let index = 0; index < fanLinkCount; index++)
    adjOffset[Math.floor(fanLinks[index] / 3) + 1]++;

  const ownerEdge = (surface: string, edge: number) => {
    const face = boundaryOwners.get(surface);
    if (face === undefined || !Number.isInteger(edge) || edge < 0) return -1;
    const vertex = vertexOffset[face] + edge;
    return vertex < vertexOffset[face + 1] ? boundaryEdges[vertex] - 1 : -1;
  };
  const directed = preparedDirected ?? directedPortals(surfaces, importedPortals);
  const portalCapacity = portals.length + directed.length;
  const portalLinks = new Int32Array(portalCapacity * 2);
  const portalCoords = new Float64Array(portalCapacity * 4);
  let portalCount = 0;
  // Encode a directed target by complementing its edge so one staged record
  // represents either kind of portal while preserving insertion order.
  for (const [list, shared] of [
    [portals, true],
    [directed, false],
  ] as const) {
    for (const portal of list) {
      const from = ownerEdge(portal.from, portal.fromEdge);
      const to = ownerEdge(portal.to, portal.toEdge);
      if (from < 0 || to < 0) continue;
      adjOffset[Math.floor(from / 3) + 1]++;
      if (shared) adjOffset[Math.floor(to / 3) + 1]++;
      portalLinks[portalCount * 2] = from;
      portalLinks[portalCount * 2 + 1] = shared ? to : ~to;
      const offset = portalCount++ * 4;
      portalCoords[offset] = portal.start[0];
      portalCoords[offset + 1] = portal.start[2];
      portalCoords[offset + 2] = portal.end[0];
      portalCoords[offset + 3] = portal.end[2];
    }
  }

  for (let triangle = 0; triangle < triangleCount; triangle++)
    adjOffset[triangle + 1] += adjOffset[triangle];
  const edgeCount = adjOffset[triangleCount];
  const adjTarget = new Int32Array(edgeCount);
  const adjOpposite = new Uint8Array(edgeCount);
  const adjPortal = new Int32Array(edgeCount);
  const cursor = adjOffset.slice(0, triangleCount);
  const add = (from: number, to: number, portal: number) => {
    const slot = cursor[Math.floor(from / 3)]++;
    adjTarget[slot] = Math.floor(to / 3);
    adjOpposite[slot] = (from + 2) % 3;
    adjPortal[slot] = portal;
  };
  for (let index = 0; index < fanLinkCount; index += 2) {
    const a = fanLinks[index],
      b = fanLinks[index + 1];
    add(a, b, -1);
    add(b, a, -1);
  }
  for (let portal = 0; portal < portalCount; portal++) {
    const from = portalLinks[portal * 2],
      to = portalLinks[portal * 2 + 1];
    if (to < 0) add(from, ~to, portal);
    else {
      add(from, to, portal);
      add(to, from, portal);
    }
  }

  return {
    geometry: {
      vertCoords,
      triVerts:
        triangleCount === triangleCapacity ? triVerts : triVerts.slice(0, triangleCount * 3),
      triDet: triangleCount === triangleCapacity ? triDet : triDet.slice(0, triangleCount),
    },
    triBoxes: triangleCount === triangleCapacity ? triBoxes : triBoxes.slice(0, triangleCount * 6),
    adjacency: {
      adjOffset,
      adjTarget,
      adjOpposite,
      adjPortal,
      portalCoords:
        portalCount === portalCapacity ? portalCoords : portalCoords.slice(0, portalCount * 4),
    },
  };
}

/** Prepare reusable wall-independent triangulation, adjacency, spatial index,
 * and lazy weak-connectivity state for ground visibility queries.
 */
export function prepareGroundStraightenerMesh(
  surfaces: Surface[],
  sharedPortals?: SharedPortal[],
  preparedDirected?: DirectedPortal[],
  importedPortals: GroundOptions['portals'] = [],
): GroundStraightenerMesh {
  const { geometry, triBoxes, adjacency } = buildMesh(
    surfaces,
    sharedPortals ?? surfacePortals(surfaces),
    preparedDirected,
    importedPortals,
  );
  const { adjOffset, adjTarget } = adjacency;
  const count = geometry.triDet.length;
  const index = createOrdinalBoundsIndex(triBoxes, tolerance);
  const supporting = (point: Vec3): number[] => {
    const result: number[] = [];
    index.forEach({ min: point, max: point }, (triangle) => {
      if (
        weightsAt(geometry, triangle, point).every((weight) => weight >= -tolerance) &&
        Math.abs(heightAt(geometry, triangle, point) - point[1]) <= tolerance
      )
        result.push(triangle);
    });
    return result;
  };
  let components: Int32Array | undefined;
  const endpointComponents = new WeakMap<Vec3, { position: Vec3; groups: Set<number> }>();
  const componentRoot = (index: number): number => {
    while (components![index] !== index) {
      components![index] = components![components![index]];
      index = components![index];
    }
    return index;
  };
  const groupsAt = (point: Vec3): Set<number> => {
    if (!components) {
      components = new Int32Array(count);
      for (let triangle = 0; triangle < count; triangle++) components[triangle] = triangle;
      for (let triangle = 0; triangle < count; triangle++)
        for (let slot = adjOffset[triangle]; slot < adjOffset[triangle + 1]; slot++)
          components[componentRoot(adjTarget[slot])] = componentRoot(triangle);
    }
    const previous = endpointComponents.get(point);
    if (previous && previous.position.every((value, axis) => value === point[axis]))
      return previous.groups;
    // A point may lie on several overlapping supports. Keep every component
    // accepted by the same locator that trace uses, including masked faces.
    const groups = new Set(supporting(point).map(componentRoot));
    endpointComponents.set(point, { position: [...point], groups });
    return groups;
  };
  return { ...geometry, ...adjacency, supporting, groupsAt };
}

/** Bind a wall checker to a prebuilt wall-independent straightener mesh. */
export function createGroundStraightenerFromMesh(
  mesh: GroundStraightenerMesh,
  blocked: WallChecker,
): GroundStraightener {
  const { supporting, groupsAt, adjOffset, adjTarget, adjOpposite, adjPortal, portalCoords } = mesh;
  const trace = (start: Vec3, end: Vec3, supports: number[]): Vec3[] | null => {
    if (Math.hypot(end[0] - start[0], end[2] - start[2]) < 1e-10) {
      return distance(start, end) < tolerance ? [[...start], [...end]] : null;
    }
    const interpolate = (fraction: number): Vec3 => [
      start[0] + fraction * (end[0] - start[0]),
      start[1] + fraction * (end[1] - start[1]),
      start[2] + fraction * (end[2] - start[2]),
    ];
    const clips = new Map<number, Clip | null>();
    const clipped = (triangle: number) => {
      if (!clips.has(triangle)) clips.set(triangle, clipTriangle(mesh, triangle, start, end));
      return clips.get(triangle)!;
    };
    const reached = new Map<number, Entry>(),
      queue: Entry[] = [];
    for (const triangle of supports) {
      const interval = clipped(triangle);
      if (interval && interval.near <= tolerance) {
        const entry = { triangle, fraction: 0, previous: null };
        reached.set(triangle, entry);
        queue.push(entry);
      }
    }
    for (let head = 0; head < queue.length; head++) {
      const entry = queue[head],
        triangle = entry.triangle,
        interval = clipped(triangle)!;
      if (reached.get(triangle) !== entry) continue;
      if (
        interval.far >= 1 - tolerance &&
        Math.abs(heightAt(mesh, triangle, end) - end[1]) <= tolerance
      ) {
        const crossings: Vec3[] = [];
        for (let current = entry; current.previous; current = current.previous) {
          const point = interpolate(current.fraction);
          crossings.push(
            [point[0], heightAt(mesh, current.triangle, point), point[2]],
            [point[0], heightAt(mesh, current.previous.triangle, point), point[2]],
          );
        }
        const points = simplifyCollinear([[...start], ...crossings.reverse(), [...end]]);
        if (points.slice(1).some((point, index) => blocked(points[index], point))) return null;
        return points;
      }
      for (let slot = adjOffset[triangle]; slot < adjOffset[triangle + 1]; slot++) {
        const target = adjTarget[slot];
        const next = clipped(target);
        if (!next) continue;
        const opposite = adjOpposite[slot];
        const first = interval.first[opposite],
          delta = interval.last[opposite] - first;
        let fraction;
        if (Math.abs(delta) < 1e-14) {
          if (Math.abs(first) > tolerance) continue;
          fraction = Math.max(entry.fraction, interval.near, next.near);
        } else {
          fraction = -first / delta;
        }
        if (
          fraction < entry.fraction - tolerance ||
          fraction < next.near - tolerance ||
          fraction > Math.min(interval.far, next.far) + tolerance ||
          fraction > 1
        )
          continue;
        fraction = Math.max(0, fraction);
        const portal = adjPortal[slot];
        if (portal >= 0) {
          const point = interpolate(fraction);
          const offset = portal * 4;
          const sx = portalCoords[offset],
            sz = portalCoords[offset + 1];
          const dx = portalCoords[offset + 2] - sx,
            dz = portalCoords[offset + 3] - sz,
            lengthSquared = dx * dx + dz * dz;
          const t =
            lengthSquared < 1e-16
              ? 0
              : ((point[0] - sx) * dx + (point[2] - sz) * dz) / lengthSquared;
          if (
            t < -tolerance ||
            t > 1 + tolerance ||
            Math.hypot(point[0] - sx - t * dx, point[2] - sz - t * dz) > 1e-4
          )
            continue;
        }
        const previous = reached.get(target);
        if (previous && previous.fraction <= fraction + tolerance) continue;
        const reachedEntry: Entry = { triangle: target, fraction, previous: entry };
        reached.set(target, reachedEntry);
        queue.push(reachedEntry);
      }
    }
    return null;
  };
  const straighten = (points: Vec3[]): Vec3[] => {
    if (!Array.isArray(points) || !points.length || !points.every(finitePoint))
      throw new Error('Invalid ground path');
    const output: Vec3[] = [[...points[0]]],
      supportCache = new Map<number, number[]>(),
      lengths = [0];
    for (let index = 1; index < points.length; index++)
      lengths.push(lengths.at(-1)! + distance(points[index - 1], points[index]));
    const supports = (index: number) => {
      if (!supportCache.has(index)) supportCache.set(index, supporting(points[index]));
      return supportCache.get(index)!;
    };
    let anchor = 0;
    while (anchor + 1 < points.length) {
      let chosen = anchor + 1,
        shortcut: Vec3[] | null = null;
      // Search the whole remaining corridor. A detail-dense mesh can place a
      // visible turn beyond 128 vertices even when it is only a few metres away.
      const candidates = [points.length - 1];
      for (let end = points.length - 2; end > anchor + 1; end--) candidates.push(end);
      for (const candidate of candidates) {
        if (candidate <= anchor + 1) continue;
        const path = trace(points[anchor], points[candidate], supports(anchor));
        if (path) {
          const length = path
            .slice(1)
            .reduce((sum, point, index) => sum + distance(path[index], point), 0);
          if (length > lengths[candidate] - lengths[anchor] + 1e-6) continue;
          chosen = candidate;
          shortcut = path;
          break;
        }
      }
      if (shortcut) output.push(...shortcut.slice(1));
      else output.push([...points[chosen]]);
      anchor = chosen;
    }
    // Centre-based corridors leave corners away from the actual obstacle. Move
    // each planar bend toward its chord while checking both complete supported
    // legs. Height changes and disconnected input legs retain their old geometry.
    for (let pass = 0; pass < 2; pass++)
      for (let index = 1; index + 1 < output.length; index++) {
        const a = output[index - 1],
          corner = output[index],
          b = output[index + 1];
        if (Math.abs(a[1] - corner[1]) > tolerance || Math.abs(b[1] - corner[1]) > tolerance)
          continue;
        if (!trace(a, corner, supporting(a)) || !trace(corner, b, supporting(corner))) continue;
        const middle = a.map((value, axis) => (value + b[axis]) / 2);
        let low = 0,
          high = 1,
          chosen = corner;
        for (let step = 0; step < 10; step++) {
          const fraction = (low + high) / 2;
          const point: Vec3 = [
            corner[0] + fraction * (middle[0] - corner[0]),
            corner[1] + fraction * (middle[1] - corner[1]),
            corner[2] + fraction * (middle[2] - corner[2]),
          ];
          const left = trace(a, point, supporting(a)),
            right = trace(point, b, supporting(point));
          // A height excursion needs its reconstructed samples and cannot be
          // represented by replacing only this one planar vertex.
          if (left?.length === 2 && right?.length === 2) {
            low = fraction;
            chosen = point;
          } else high = fraction;
        }
        output[index] = chosen;
      }
    return simplifyCollinear(output);
  };
  // Unlike straightening an already verified run, a visibility query can reject
  // its endpoints. The same support and portal tracing serves both contracts.
  straighten.trace = (start: Vec3, end: Vec3) => {
    if (!finitePoint(start) || !finitePoint(end))
      throw new Error('Invalid ground visibility endpoints');
    return trace(start, end, supporting(start));
  };
  // Weak connectivity only rules out impossible traces. Passage direction and
  // complete wall clearance are still checked by trace itself.
  straighten.mayConnect = (start: Vec3, end: Vec3) => {
    if (!finitePoint(start) || !finitePoint(end))
      throw new Error('Invalid ground visibility endpoints');
    const from = groupsAt(start),
      to = groupsAt(end);
    for (const group of from) if (to.has(group)) return true;
    return false;
  };
  return straighten;
}

/** Prepare reusable ground visibility queries over convex, clearance-eroded surfaces.
 * Coordinates are world metres. Connectivity follows the same full, oppositely oriented
 * 3D portals as surfaceGraph. The caller must select one scene, state and body profile.
 * Input points must already form a verified, continuous walking run. Unsupported
 * shortcuts retain that input. Returned queries preserve the run's endpoints.
 * Height changes are reconstructed from triangulated support, never fitted as a spline.
 */
export function createGroundStraightener(
  surfaces: Surface[],
  { walls, profile, portals: imported = [] }: Pick<GroundOptions, 'walls' | 'profile' | 'portals'>,
  sharedPortals?: SharedPortal[],
  preparedBlocked?: WallChecker,
  preparedDirected?: DirectedPortal[],
): GroundStraightener {
  const blocked = preparedBlocked ?? createWallChecker(walls, profile);
  const mesh = prepareGroundStraightenerMesh(surfaces, sharedPortals, preparedDirected, imported);
  return createGroundStraightenerFromMesh(mesh, blocked);
}
