import type { Vec3, CollisionGeometry } from '#@/src/geometry.ts';
import { supportBounds } from '#@/src/model/supports.ts';
import type { PoseBounds } from '#@/src/solver/physical.ts';
type Point = [number, number];
export const vector = (component: (axis: number) => number): Vec3 => [
  component(0),
  component(1),
  component(2),
];
export const distance = (a: Vec3, b: Vec3) => Math.hypot(...a.map((v, axis) => v - b[axis]));
export const shifted = (point: Vec3, delta: Vec3): Vec3 =>
  vector((axis) => point[axis] + delta[axis]);
export const corners = ({ min, max }: PoseBounds): Vec3[] =>
  Array.from({ length: 8 }, (_, bits): Vec3 =>
    vector((axis) => (bits & (1 << axis) ? max : min)[axis]),
  );
export const flatCuboid = (body: Vec3[]) => {
  if (body.length !== 8) {
    return false;
  }
  const axes = [1, 2, 4].map((index) => vector((axis) => body[index][axis] - body[0][axis]));
  if (axes.some((axis) => Math.hypot(...axis) < 1e-5)) {
    return false;
  }
  for (let i = 0; i < 3; i++) {
    for (let j = i + 1; j < 3; j++) {
      if (
        Math.abs(axes[i].reduce((sum, v, axis) => sum + v * axes[j][axis], 0)) >
        Math.hypot(...axes[i]) * Math.hypot(...axes[j]) * 1e-5
      ) {
        return false;
      }
    }
  }
  if (
    body.some(
      (point, bits) =>
        distance(
          point,
          vector(
            (axis) =>
              body[0][axis] +
              axes.reduce((sum, basis, index) => sum + (bits & (1 << index) ? basis[axis] : 0), 0),
          ),
        ) > 1e-5,
    )
  ) {
    return false;
  }
  const bounds = supportBounds([body]);
  return (
    body.filter((point) => Math.abs(point[1] - bounds.max[1]) < 1e-5).length === 4 &&
    body.filter((point) => Math.abs(point[1] - bounds.min[1]) < 1e-5).length === 4
  );
};
export const footprintOf = (body: Vec3[], height: number) => {
  const roof = body.filter((p) => Math.abs(p[1] - height) < 1e-5);
  const center: Point = [
    roof.reduce((sum, p) => sum + p[0], 0) / 4,
    roof.reduce((sum, p) => sum + p[2], 0) / 4,
  ];
  roof.sort(
    (a, b) =>
      Math.atan2(a[2] - center[1], a[0] - center[0]) -
      Math.atan2(b[2] - center[1], b[0] - center[0]),
  );
  return roof.map((p): Point => [p[0], p[2]]);
};
export const roofContains = (body: Vec3[], point: Vec3) => {
  const roof = footprintOf(body, Math.max(...body.map((p) => p[1])));
  return roof.every((a, i) => side(a, roof[(i + 1) % roof.length], [point[0], point[2]]) >= -1e-6);
};
const area = (polygon: Point[]) =>
  Math.abs(
    polygon.reduce((sum, a, i) => {
      const b = polygon[(i + 1) % polygon.length];
      return sum + a[0] * b[1] - b[0] * a[1];
    }, 0),
  ) / 2;
const side = (a: Point, b: Point, p: Point) =>
  (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const clip = (polygon: Point[], a: Point, b: Point, inside: boolean): Point[] => {
  const result: Point[] = [];
  for (const [i, p] of polygon.entries()) {
    const q = polygon[(i + 1) % polygon.length];
    const from = side(a, b, p),
      to = side(a, b, q);
    const keepP = inside ? from >= 0 : from <= 0;
    const keepQ = inside ? to >= 0 : to <= 0;
    if (keepP) {
      result.push(p);
    }
    if (keepP !== keepQ) {
      const t = from / (from - to);
      result.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
    }
  }
  return result;
};
export const trianglesOf = (
  geometry: CollisionGeometry,
  selected = Array.from({ length: geometry.indices.length / 3 }, (_, i) => i),
) =>
  selected.map((i) =>
    [0, 1, 2].map((j): Vec3 => {
      const vertex = geometry.indices[i * 3 + j];
      return [
        geometry.positions[vertex * 3],
        geometry.positions[vertex * 3 + 1],
        geometry.positions[vertex * 3 + 2],
      ];
    }),
  );

// polygon subtraction proves coverage of the complete footprint, including holes smaller
// than a sampling interval. duplicate and overlapping source triangles cannot add coverage twice.
export const flatSupport = (footprint: Point[], height: number, triangles: Vec3[][]) => {
  let uncovered = [footprint];
  for (const triangle of triangles) {
    if (triangle.some((p) => Math.abs(p[1] - height) > 1e-5)) {
      continue;
    }
    const ring = triangle.map((p): Point => [p[0], p[2]]);
    // upward faces are clockwise in XZ; clipping uses the opposite winding.
    if (side(ring[0], ring[1], ring[2]) >= -1e-9) {
      continue;
    }
    ring.reverse();
    const next: Point[][] = [];
    for (const polygon of uncovered) {
      let remainder = polygon;
      for (let i = 0; i < 3 && remainder.length; i++) {
        const outside = clip(remainder, ring[i], ring[(i + 1) % 3], false);
        if (area(outside) > 1e-9) {
          next.push(outside);
        }
        remainder = clip(remainder, ring[i], ring[(i + 1) % 3], true);
      }
    }
    uncovered = next;
    if (!uncovered.length) {
      return true;
    }
    if (uncovered.length > 256) {
      return false;
    }
  }
  return false;
};
export const overlaps = (a: PoseBounds, b: PoseBounds) =>
  a.min.every((v, axis) => v <= b.max[axis] && a.max[axis] >= b.min[axis]);
export const blockedBody = (bounds: PoseBounds, floor: number, triangles: Vec3[][]) =>
  triangles.some((triangle) => {
    const other = supportBounds([triangle]);
    return other.max[1] > floor + 1e-5 && overlaps(bounds, other);
  });
export const onBoxFace = (triangle: Vec3[], body: Vec3[]) => {
  const axes = [1, 2, 4].map((index) => vector((axis) => body[index][axis] - body[0][axis]));
  const coordinates = triangle.map((point) =>
    axes.map((basis) => {
      const squared = basis.reduce((sum, value) => sum + value * value, 0);
      return (
        basis.reduce((sum, value, axis) => sum + value * (point[axis] - body[0][axis]), 0) / squared
      );
    }),
  );
  return (
    coordinates.every((point) => point.every((value) => value >= -1e-5 && value <= 1 + 1e-5)) &&
    axes.some(
      (_, axis) =>
        coordinates.every((point) => Math.abs(point[axis]) < 1e-5) ||
        coordinates.every((point) => Math.abs(point[axis] - 1) < 1e-5),
    )
  );
};

export const joinedGeometry = (terrain: CollisionGeometry, bodies: Vec3[][]): CollisionGeometry => {
  const positions = Array.from(terrain.positions),
    indices = Array.from(terrain.indices);
  for (const body of bodies) {
    const base = positions.length / 3;
    positions.push(...body.flat());
    const center = vector((axis) => body.reduce((sum, point) => sum + point[axis] / 8, 0));
    for (const face of [
      [0, 4, 6, 2],
      [1, 3, 7, 5],
      [0, 1, 5, 4],
      [2, 6, 7, 3],
      [0, 2, 3, 1],
      [4, 5, 7, 6],
    ]) {
      const [a, b, c] = face.map((i) => body[i]);
      const u = b.map((v, axis) => v - a[axis]),
        v = c.map((value, axis) => value - a[axis]);
      const normal = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      if (normal.reduce((sum, value, axis) => sum + value * (a[axis] - center[axis]), 0) < 0) {
        face.reverse();
      }
      indices.push(
        base + face[0],
        base + face[1],
        base + face[2],
        base + face[0],
        base + face[2],
        base + face[3],
      );
    }
  }
  return { positions, indices };
};
