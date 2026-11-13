import type { Wall, Vec3 } from '#@/src/geometry.ts';
import type { Bounds } from '#@/src/v1/geo/bounds.ts';

type Point2 = readonly number[];
type Profile = { radius: number; height: number };
interface Sphere {
  center: readonly number[];
  radius: number;
  margin: number;
  lower: number;
  upper: number;
}
interface WallRecord extends Bounds {
  margin: number;
  sphere?: Sphere;
  filled: boolean;
  ring?: Point2[];
}
type WallTree = Bounds &
  (
    | { entries: WallRecord[]; left?: never; right?: never }
    | { entries?: never; left: WallTree; right: WallTree }
  );
const segmentDistance = (a: Point2, b: Point2, c: Point2, d: Point2) => {
  const cross = (p: Point2, q: Point2, r: Point2) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const abC = cross(a, b, c),
    abD = cross(a, b, d),
    cdA = cross(c, d, a),
    cdB = cross(c, d, b);
  if (
    ((abC > 0 && abD < 0) || (abC < 0 && abD > 0)) &&
    ((cdA > 0 && cdB < 0) || (cdA < 0 && cdB > 0))
  )
    return 0;
  const toSegment = (p: Point2, q: Point2, r: Point2) => {
    const x = r[0] - q[0],
      z = r[1] - q[1],
      length = x * x + z * z;
    const t =
      length === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - q[0]) * x + (p[1] - q[1]) * z) / length));
    return Math.hypot(p[0] - q[0] - t * x, p[1] - q[1] - t * z);
  };
  return Math.min(toSegment(a, c, d), toSegment(b, c, d), toSegment(c, a, b), toSegment(d, a, b));
};
const insidePolygon = (point: Point2, ring: Point2[]) => {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a[1] > point[1] !== b[1] > point[1] &&
      point[0] < ((b[0] - a[0]) * (point[1] - a[1])) / (b[1] - a[1]) + a[0]
    )
      inside = !inside;
  }
  return inside;
};
const finitePoint = (point: unknown) =>
  Array.isArray(point) && point.length === 3 && point.every(Number.isFinite);
const validateProfile = (profile: Profile) => {
  if (
    !profile ||
    !Number.isFinite(profile.radius) ||
    profile.radius < 0 ||
    !Number.isFinite(profile.height) ||
    profile.height <= 0
  )
    throw new Error('Invalid wall query');
};
// A translating upright capsule sweeps a vertical segment across its feet path.
// Distance to that swept parallelogram is piecewise quadratic in path time.
const touchesSphere = (start: Vec3, end: Vec3, sphere: Sphere, inflation: number) => {
  const delta = end.map((v, i) => v - start[i]);
  const relative = sphere.center.map((v, i) => v - start[i]);
  const radius = sphere.radius + sphere.margin + inflation;
  const cuts = [0, 1];
  if (delta[1] !== 0)
    for (const height of [sphere.lower, sphere.upper]) {
      const time = (relative[1] - height) / delta[1];
      if (time > 0 && time < 1) cuts.push(time);
    }
  cuts.sort((a, b) => a - b);
  for (let i = 1; i < cuts.length; i++) {
    const low = cuts[i - 1],
      high = cuts[i],
      middle = (low + high) / 2;
    const height = relative[1] - middle * delta[1];
    const vertical =
      height < sphere.lower ? sphere.lower : height > sphere.upper ? sphere.upper : null;
    const squared = delta[0] ** 2 + delta[2] ** 2 + (vertical === null ? 0 : delta[1] ** 2);
    const dot =
      relative[0] * delta[0] +
      relative[2] * delta[2] +
      (vertical === null ? 0 : (relative[1] - vertical) * delta[1]);
    const time = squared === 0 ? low : Math.max(low, Math.min(high, dot / squared));
    const y = relative[1] - time * delta[1];
    const gapY = Math.max(sphere.lower - y, y - sphere.upper, 0);
    if (
      (relative[0] - time * delta[0]) ** 2 + gapY ** 2 + (relative[2] - time * delta[2]) ** 2 <=
      radius ** 2
    )
      return true;
  }
  return false;
};
const wallRecord = (
  wall: Wall,
  radius: number,
  height: number,
  snapshot: boolean,
): WallRecord | null => {
  if (
    !wall ||
    !finitePoint(wall.min) ||
    !finitePoint(wall.max) ||
    wall.min.some((v, i) => v > wall.max[i]) ||
    !['active', 'inactive', 'unknown'].includes(wall.state) ||
    !Number.isFinite(wall.padding ?? 0) ||
    (wall.padding ?? 0) < 0
  )
    throw new Error('Invalid wall');
  if (
    wall.points !== undefined &&
    (!Array.isArray(wall.points) ||
      wall.points.length < 2 ||
      wall.points.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
  )
    throw new Error('Invalid wall polyline');
  if (
    wall.polygon !== undefined &&
    (!Array.isArray(wall.polygon) ||
      wall.polygon.length < 3 ||
      wall.points !== undefined ||
      wall.polygon.some((p) => !Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite)))
  )
    throw new Error('Invalid wall polygon');
  if (
    wall.sphere !== undefined &&
    (!finitePoint(wall.sphere?.center) ||
      !Number.isFinite(wall.sphere.radius) ||
      wall.sphere.radius <= 0 ||
      wall.points !== undefined ||
      wall.polygon !== undefined)
  )
    throw new Error('Invalid wall sphere');
  if (wall.state === 'inactive') return null;
  const margin = radius + (wall.padding ?? 0);
  const min = wall.min.map((v, i) => v - (i === 1 ? height : margin));
  const max = wall.max.map((v, i) => v + (i === 1 ? 0 : margin));
  const points = wall.polygon ?? wall.points;
  for (const p of points ?? []) {
    min[0] = Math.min(min[0], p[0] - margin);
    min[2] = Math.min(min[2], p[1] - margin);
    max[0] = Math.max(max[0], p[0] + margin);
    max[2] = Math.max(max[2], p[1] + margin);
  }
  let sphere;
  if (wall.sphere) {
    const center = snapshot ? [...wall.sphere.center] : wall.sphere.center;
    const r = wall.sphere.radius;
    // A profile shorter than its diameter has no capsule spine. Retain a
    // conservative full-height segment for that legacy wall-query input.
    const lower = height >= radius * 2 ? radius : 0;
    const upper = height >= radius * 2 ? height - radius : height;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], center[axis] - r - margin - (axis === 1 ? upper : 0));
      max[axis] = Math.max(max[axis], center[axis] + r + margin - (axis === 1 ? lower : 0));
    }
    sphere = { center, radius: r, margin, lower, upper };
  }
  return {
    min,
    max,
    margin,
    sphere,
    filled: wall.polygon !== undefined,
    ring: snapshot && points ? points.map((p) => [...p]) : points,
  };
};
const segmentTouchesBounds = (
  start: Vec3,
  end: Vec3,
  min: readonly number[],
  max: readonly number[],
  inflation = 0,
) => {
  let near = 0,
    far = 1;
  for (let axis = 0; axis < 3; axis++) {
    const delta = end[axis] - start[axis];
    if (Math.abs(delta) < 1e-12) {
      if (start[axis] < min[axis] - inflation || start[axis] > max[axis] + inflation) return false;
    } else {
      const a = (min[axis] - inflation - start[axis]) / delta,
        b = (max[axis] + inflation - start[axis]) / delta;
      near = Math.max(near, Math.min(a, b));
      far = Math.min(far, Math.max(a, b));
      if (near > far) return false;
    }
  }
  return near <= far;
};
const touchesWall = (
  start: Vec3,
  end: Vec3,
  { min, max, margin, ring, filled, sphere }: WallRecord,
  inflation = 0,
) => {
  if (!segmentTouchesBounds(start, end, min, max, inflation)) return false;
  if (sphere) return touchesSphere(start, end, sphere, inflation);
  if (!ring) return true;
  // Clip to vertical overlap before comparing XZ distances. A lower/upper walkway
  // may pass the same wall footprint without intersecting its collision height.
  let low = 0,
    high = 1;
  const dy = end[1] - start[1];
  if (Math.abs(dy) >= 1e-12) {
    const a = (min[1] - inflation - start[1]) / dy,
      b = (max[1] + inflation - start[1]) / dy;
    low = Math.max(0, Math.min(a, b));
    high = Math.min(1, Math.max(a, b));
  }
  const a = [start[0] + low * (end[0] - start[0]), start[2] + low * (end[2] - start[2])];
  const b = [start[0] + high * (end[0] - start[0]), start[2] + high * (end[2] - start[2])];
  if (filled && (insidePolygon(a, ring) || insidePolygon(b, ring))) return true;
  for (let i = 1; i < ring.length; i++) {
    if (segmentDistance(a, b, ring[i - 1], ring[i]) <= margin + inflation + 1e-9) return true;
  }
  return filled && segmentDistance(a, b, ring.at(-1)!, ring[0]) <= margin + inflation + 1e-9;
};
/** Snapshot and validate exclusions for repeated feet-segment queries with one body.
 * Expanded 3D bounds include padding and all authored polyline/polygon vertices.
 * Optional spheres retain their round occupied volume, including initial overlap.
 * Unknown state blocks. Later caller mutations require a new checker. Every wall,
 * including inactive records, is validated before any query can return a hit.
 * Optional query inflation expands the indexed body uniformly for curved sweeps.
 */
export function createWallChecker(walls: Wall[], profile: Profile) {
  validateProfile(profile);
  const records: WallRecord[] = [];
  for (const wall of walls) {
    const record = wallRecord(wall, profile.radius, profile.height, true);
    if (record) records.push(record);
  }
  const build = (entries: WallRecord[]): WallTree => {
    const min = [Infinity, Infinity, Infinity],
      max = [-Infinity, -Infinity, -Infinity];
    for (const entry of entries)
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], entry.min[axis]);
        max[axis] = Math.max(max[axis], entry.max[axis]);
      }
    if (entries.length <= 8) return { min, max, entries };
    const spans = max.map((value, axis) => value - min[axis]);
    const axis = spans.indexOf(Math.max(...spans));
    entries.sort((a, b) => a.min[axis] + a.max[axis] - b.min[axis] - b.max[axis]);
    const middle = Math.floor(entries.length / 2);
    return { min, max, left: build(entries.slice(0, middle)), right: build(entries.slice(middle)) };
  };
  const root = records.length ? build(records) : null;
  return (start: Vec3, end: Vec3, inflation = 0) => {
    if (!finitePoint(start) || !finitePoint(end) || !Number.isFinite(inflation) || inflation < 0)
      throw new Error('Invalid wall query');
    const stack = root ? [root] : [];
    while (stack.length) {
      const node = stack.pop()!;
      if (!segmentTouchesBounds(start, end, node.min, node.max, inflation)) continue;
      if (node.entries) {
        for (const record of node.entries)
          if (touchesWall(start, end, record, inflation)) return true;
      } else stack.push(node.left, node.right);
    }
    return false;
  };
}
/** Segment against conservative air-wall volumes, expanded by player radius/height.
 * Feet positions are expected. Unknown state blocks just like an active wall.
 * Optional XZ polylines narrow the box test. Without them, bounds conservatively block.
 * This test covers vertical air walls, not arbitrary scene collision geometry.
 */
export function blockedByWalls(start: Vec3, end: Vec3, walls: Wall[], profile: Profile) {
  validateProfile(profile);
  if (!finitePoint(start) || !finitePoint(end)) throw new Error('Invalid wall query');
  let hit = false;
  for (const wall of walls) {
    const record = wallRecord(wall, profile.radius, profile.height, false);
    if (!hit && record && touchesWall(start, end, record)) hit = true;
  }
  return hit;
}
