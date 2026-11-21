import type { Vec3, Surface, Portal } from '#@/src/geometry.ts';
import { type Bounds, createBoundsIndex } from '#@/src/model/bounds.ts';
import { projectPoint } from '#@/src/model/support.ts';
import type { Graph, Edge, Node } from '#@/src/v1/route/routes.ts';

export interface SharedPortal {
  from: string;
  to: string;
  fromEdge: number;
  toEdge: number;
  start: Vec3;
  end: Vec3;
}
export interface DirectedPortal extends SharedPortal {
  points: [Vec3, Vec3];
  exitStart: Vec3;
  exitEnd: Vec3;
}
interface Owner {
  surface: string;
  edge: number;
  from: string;
  to: string;
}
interface Group extends Bounds {
  id: number;
  a: Vec3;
  b: Vec3;
  owners: Owner[];
  blocked: boolean;
}
interface Interval {
  near: number;
  far: number;
  opposite: boolean;
  start: Vec3;
  end: Vec3;
}

const portalTolerance = 1e-4;
const vertexKey = (point: readonly number[]) =>
  `${Math.round(point[0] * 10000)},${Math.round(point[1] * 10000)},${Math.round(point[2] * 10000)}`;
const distance = (a: readonly number[], b: readonly number[]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const onSegment = (point: readonly number[], a: readonly number[], b: readonly number[]) => {
  const dx = b[0] - a[0],
    dy = b[1] - a[1],
    dz = b[2] - a[2];
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  if (lengthSquared === 0) return distance(point, a) <= portalTolerance;
  const t =
    ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy + (point[2] - a[2]) * dz) / lengthSquared;
  return (
    t >= -1e-8 &&
    t <= 1 + 1e-8 &&
    Math.hypot(
      point[0] - (a[0] + t * dx),
      point[1] - (a[1] + t * dy),
      point[2] - (a[2] + t * dz),
    ) <= portalTolerance
  );
};
const boundaryEdge = (surface: Surface, point: Vec3, interval: Vec3[] = [point]) =>
  surface.vertices.findIndex((a, index) =>
    [point, ...interval].every((value) =>
      onSegment(value, a, surface.vertices[(index + 1) % surface.vertices.length]),
    ),
  );
/** Validate imported directed passages once under the same boundary contract used
 * by graph search, ground tracing and exposed-boundary discovery. Old point-only
 * transfers retain their exact crossing location.
 */
export function directedPortals(
  surfaces: Surface[],
  portals: Portal[] = [],
  surfaceById?: ReadonlyMap<string, Surface>,
): DirectedPortal[] {
  if (!Array.isArray(portals)) throw new Error('Invalid imported portals');
  if (portals.length === 0) return [];
  let byId = surfaceById;
  if (!byId) {
    const map = new Map<string, Surface>();
    for (let i = 0; i < surfaces.length; i++) map.set(surfaces[i].id, surfaces[i]);
    byId = map;
  }
  const horizontal = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0] - b[0], a[2] - b[2]);
  return portals.map((portal) => {
    const from = byId.get(portal.from),
      to = byId.get(portal.to),
      points = portal.points;
    const valid = (surface: Surface, point: Vec3) =>
      Array.isArray(point) &&
      point.length === 3 &&
      point.every(Number.isFinite) &&
      projectPoint([surface], point, { maxVertical: portalTolerance }) &&
      boundaryEdge(surface, point) >= 0;
    if (
      !from ||
      !to ||
      from === to ||
      !Array.isArray(points) ||
      points.length !== 2 ||
      !valid(from, points[0]) ||
      !valid(to, points[1]) ||
      horizontal(points[0], points[1]) > portalTolerance
    ) {
      throw new Error('Invalid imported portal');
    }
    const entry = portal.entry ?? [points[0], points[0]],
      exit = portal.exit ?? [points[1], points[1]];
    if (
      (portal.entry === undefined) !== (portal.exit === undefined) ||
      !Array.isArray(entry) ||
      entry.length !== 2 ||
      !Array.isArray(exit) ||
      exit.length !== 2 ||
      entry.some((point) => !valid(from, point)) ||
      exit.some((point) => !valid(to, point)) ||
      entry.some((point, index) => horizontal(point, exit[index]) > portalTolerance) ||
      (portal.entry && horizontal(entry[0], entry[1]) <= portalTolerance)
    )
      throw new Error('Invalid imported portal interval');
    const fromEdge = boundaryEdge(from, points[0], entry),
      toEdge = boundaryEdge(to, points[1], exit);
    if (fromEdge < 0 || toEdge < 0) throw new Error('Invalid imported portal interval boundary');
    // Every interval and its representative must lie on one authored edge per side.
    for (const [surface, edge, interval, point] of [
      [from, fromEdge, entry, points[0]],
      [to, toEdge, exit, points[1]],
    ] as const) {
      const a = surface.vertices[edge],
        b = surface.vertices[(edge + 1) % surface.vertices.length];
      if (
        interval.some((value) => !onSegment(value, a, b)) ||
        !onSegment(point, interval[0], interval[1])
      ) {
        throw new Error('Invalid imported portal interval');
      }
    }
    return {
      from: portal.from,
      to: portal.to,
      points,
      fromEdge,
      toEdge,
      start: entry[0],
      end: entry[1],
      exitStart: exit[0],
      exitEnd: exit[1],
    };
  });
}
const sharedInterval = (a: Group, b: Group): Interval | null => {
  const ax = a.a[0],
    ay = a.a[1],
    az = a.a[2];
  const dx = a.b[0] - ax,
    dy = a.b[1] - ay,
    dz = a.b[2] - az;
  const lengthSquared = dx * dx + dy * dy + dz * dz;
  const ba = b.a,
    bb = b.b;
  const first = ((ba[0] - ax) * dx + (ba[1] - ay) * dy + (ba[2] - az) * dz) / lengthSquared;
  const last = ((bb[0] - ax) * dx + (bb[1] - ay) * dy + (bb[2] - az) * dz) / lengthSquared;
  if (
    Math.hypot(ba[0] - (ax + first * dx), ba[1] - (ay + first * dy), ba[2] - (az + first * dz)) >
      portalTolerance ||
    Math.hypot(bb[0] - (ax + last * dx), bb[1] - (ay + last * dy), bb[2] - (az + last * dz)) >
      portalTolerance
  )
    return null;
  const near = Math.max(0, Math.min(first, last)),
    far = Math.min(1, Math.max(first, last));
  if ((far - near) * Math.sqrt(lengthSquared) <= portalTolerance) return null;
  return {
    near,
    far,
    opposite: last < first,
    start: [ax + near * dx, ay + near * dy, az + near * dz],
    end: [ax + far * dx, ay + far * dy, az + far * dz],
  };
};

/** Internal shared portal construction for graph search and ground ray traversal.
 * Split boundaries connect only over their collinear 3D overlap. Author-supplied
 * portal masks remain authoritative, and point contacts or positive gaps do not join.
 */
export function surfacePortals(surfaces: Surface[]): SharedPortal[] {
  const groups = new Map<string, Group>(),
    ids = new Set<string>();
  // Scratch array reused across surfaces to avoid per-surface array allocations
  // on 260k-400k ground polygon meshes.
  const keys: (string | undefined)[] = [];
  for (let s = 0; s < surfaces.length; s++) {
    const surface = surfaces[s];
    const verts = surface.vertices;
    if (
      typeof surface.id !== 'string' ||
      ids.has(surface.id) ||
      !Array.isArray(verts) ||
      verts.length < 3
    )
      throw new Error('Invalid surface');
    for (let i = 0; i < verts.length; i++) {
      const point = verts[i];
      if (
        !Array.isArray(point) ||
        point.length !== 3 ||
        !Number.isFinite(point[0]) ||
        !Number.isFinite(point[1]) ||
        !Number.isFinite(point[2])
      )
        throw new Error('Invalid surface');
    }
    const mask = surface.portals;
    if (mask !== undefined) {
      if (!Array.isArray(mask)) throw new Error('Invalid surface portals');
      for (let i = 0; i < mask.length; i++) {
        const index = mask[i];
        if (!Number.isInteger(index) || index < 0 || index >= verts.length)
          throw new Error('Invalid surface portals');
      }
    }
    ids.add(surface.id);
    keys.length = 0;
    const vertCount = verts.length;
    for (let edge = 0; edge < vertCount; edge++) {
      if (mask && !mask.includes(edge)) continue;
      const next = edge + 1 === vertCount ? 0 : edge + 1;
      const a = verts[edge],
        b = verts[next];
      const from = (keys[edge] ??= vertexKey(a));
      const to = (keys[next] ??= vertexKey(b));
      if (from === to) throw new Error('Degenerate surface edge');
      const key = from < to ? from + '/' + to : to + '/' + from;
      let group = groups.get(key);
      if (!group) {
        const ax = a[0],
          ay = a[1],
          az = a[2],
          bx = b[0],
          by = b[1],
          bz = b[2];
        group = {
          id: groups.size,
          a,
          b,
          owners: [],
          blocked: false,
          min: [ax < bx ? ax : bx, ay < by ? ay : by, az < bz ? az : bz],
          max: [ax > bx ? ax : bx, ay > by ? ay : by, az > bz ? az : bz],
        };
        groups.set(key, group);
      }
      group.owners.push({ surface: surface.id, edge, from, to });
    }
  }
  const entries: Group[] = [],
    singles: Group[] = [];
  for (const group of groups.values()) {
    entries.push(group);
    if (group.owners.length === 1) singles.push(group);
  }
  const candidates: (Interval & { a: Group; b: Group })[] = [],
    intervals = new Map<number, (Interval & { other: Group })[]>();
  // Full shared edges already have exact partners. Only unmatched boundaries need
  // spatial queries, including checks against full edges for ambiguous overlap.
  if (singles.length) {
    const query = createBoundsIndex(entries);
    for (let i = 0; i < singles.length; i++) {
      const a = singles[i];
      const aSurface = a.owners[0].surface;
      let overlaps: (Interval & { other: Group })[] | undefined;
      query.forEachBox(
        a.min[0] - portalTolerance,
        a.min[1] - portalTolerance,
        a.min[2] - portalTolerance,
        a.max[0] + portalTolerance,
        a.max[1] + portalTolerance,
        a.max[2] + portalTolerance,
        (b) => {
          if (a === b || aSurface === b.owners[0].surface) return;
          const interval = sharedInterval(a, b);
          if (!interval) return;
          (overlaps ??= []).push({ ...interval, other: b });
          if (b.owners.length > 1) {
            a.blocked = true;
            b.blocked = true;
          } else if (a.id < b.id && interval.opposite) {
            candidates.push({ a, b, ...interval });
          }
        },
      );
      if (overlaps && overlaps.length > 1) intervals.set(a.id, overlaps);
    }
    for (let i = 0; i < singles.length; i++) {
      const a = singles[i];
      const overlaps = intervals.get(a.id);
      if (!overlaps) continue;
      overlaps.sort((x, y) => x.near - y.near);
      const length = distance(a.a, a.b);
      for (let index = 1; index < overlaps.length; index++) {
        for (let previous = index - 1; previous >= 0; previous--) {
          if ((overlaps[previous].far - overlaps[index].near) * length <= portalTolerance) continue;
          // More than two polygons cover this boundary interval. Keeping the
          // original component is safer than choosing an overlapping state mesh.
          a.blocked = true;
          overlaps[index].other.blocked = true;
          overlaps[previous].other.blocked = true;
        }
      }
    }
  }
  const portals: SharedPortal[] = [];
  const add = (a: Owner, b: Owner, start: Vec3, end: Vec3) =>
    portals.push({ from: a.surface, fromEdge: a.edge, to: b.surface, toEdge: b.edge, start, end });
  for (let i = 0; i < entries.length; i++) {
    const group = entries[i];
    if (group.blocked || group.owners.length !== 2) continue;
    const [a, b] = group.owners;
    if (a.surface !== b.surface && a.from === b.to && a.to === b.from) add(a, b, group.a, group.b);
  }
  for (let i = 0; i < candidates.length; i++) {
    const candidate = candidates[i];
    if (!candidate.a.blocked && !candidate.b.blocked) {
      add(candidate.a.owners[0], candidate.b.owners[0], candidate.start, candidate.end);
    }
  }
  return portals;
}
/** Build a conservative graph of convex navigation polygons selected for one scene,
 * state and agent. Full or split collinear 3D portals connect over their shared
 * interval. No gap, stair, off-mesh or proximity links are inferred.
 */
export function surfaceGraph(
  surfaces: Surface[],
  { speed, portals: importedPortals = [] }: { speed: number; portals?: Portal[] },
  sharedPortals?: SharedPortal[],
  preparedDirected?: DirectedPortal[],
  surfaceById?: ReadonlyMap<string, Surface>,
): Graph {
  if (!Number.isFinite(speed) || speed <= 0) throw new Error('Invalid walking speed');
  const portals = sharedPortals ?? surfacePortals(surfaces);
  const nodes: Node[] = new Array<Node>(surfaces.length);
  const positions = new Map<string, Vec3>();
  for (let i = 0; i < surfaces.length; i++) {
    const surface = surfaces[i];
    const verts = surface.vertices;
    const n = verts.length;
    let sx = 0,
      sy = 0,
      sz = 0;
    for (let j = 0; j < n; j++) {
      const point = verts[j];
      sx += point[0];
      sy += point[1];
      sz += point[2];
    }
    const position: Vec3 = [sx / n, sy / n, sz / n];
    nodes[i] = { id: surface.id, position };
    positions.set(surface.id, position);
  }
  const edges: Edge[] = [];
  for (let i = 0; i < portals.length; i++) {
    const portal = portals[i];
    const a = positions.get(portal.from)!,
      b = positions.get(portal.to)!;
    const midpoint: Vec3 = [
      (portal.start[0] + portal.end[0]) / 2,
      (portal.start[1] + portal.end[1]) / 2,
      (portal.start[2] + portal.end[2]) / 2,
    ];
    const cost = (distance(a, midpoint) + distance(b, midpoint)) / speed;
    edges.push({ from: portal.from, to: portal.to, cost, state: 'open', points: [a, midpoint, b] });
    edges.push({ from: portal.to, to: portal.from, cost, state: 'open', points: [b, midpoint, a] });
  }
  const directed = preparedDirected ?? directedPortals(surfaces, importedPortals, surfaceById);
  for (const portal of directed) {
    const points = portal.points;
    // An imported transfer is directed. Its authoring/state and climb authorization
    // belong to the importer; the runtime never supplies the reverse step implicitly.
    const corridor: Vec3[] = [
      positions.get(portal.from)!,
      ...points.map((point): Vec3 => [...point]),
      positions.get(portal.to)!,
    ];
    const cost =
      corridor.slice(1).reduce((sum, point, index) => sum + distance(corridor[index], point), 0) /
      speed;
    edges.push({ from: portal.from, to: portal.to, cost, state: 'open', points: corridor });
  }
  return { nodes, edges };
}
export { projectPoint } from '#@/src/model/support.ts';
