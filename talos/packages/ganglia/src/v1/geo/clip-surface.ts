import type { BuildOptions } from '#@/src/build.ts';
import type { Vec3 } from '#@/src/geometry.ts';
export const tolerance = 1e-4;
const cross = (a: Vec3, b: Vec3, c: Vec3) =>
  (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
function convexHull(vertices: Vec3[]): Vec3[] {
  const sorted = [...vertices].sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  if (sorted.length < 3) return [];
  const hull: Vec3[] = [];
  for (const point of sorted) {
    while (hull.length > 1 && cross(hull.at(-2)!, hull.at(-1)!, point) <= tolerance * tolerance)
      hull.pop();
    hull.push(point);
  }
  const lower = hull.length;
  for (let index = sorted.length - 2; index >= 0; index--) {
    const point = sorted[index];
    while (hull.length > lower && cross(hull.at(-2)!, hull.at(-1)!, point) <= tolerance * tolerance)
      hull.pop();
    hull.push(point);
  }
  hull.pop();
  return hull;
}
export function clipSurface(
  vertices: Vec3[],
  bounds: NonNullable<BuildOptions['bounds']>,
): Vec3[] | null {
  const [a, b, c] = vertices;
  const determinant = (b[0] - a[0]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[0] - a[0]);
  if (Math.abs(determinant) <= tolerance * tolerance) return null;
  const riseX = ((b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1])) / determinant;
  const riseZ = ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) / determinant;
  let clipped = vertices;
  for (const [axis, boundary, keepAbove] of [
    [0, bounds.min[0], true],
    [0, bounds.max[0], false],
    [2, bounds.min[1], true],
    [2, bounds.max[1], false],
  ] as const) {
    const output: Vec3[] = [];
    for (let i = 0; i < clipped.length; i++) {
      const from = clipped[i],
        to = clipped[(i + 1) % clipped.length];
      const fromInside = keepAbove ? from[axis] >= boundary : from[axis] <= boundary;
      const toInside = keepAbove ? to[axis] >= boundary : to[axis] <= boundary;
      if (fromInside) output.push(from);
      if (fromInside !== toInside) {
        const ratio = (boundary - from[axis]) / (to[axis] - from[axis]);
        const point = [
          from[0] + ratio * (to[0] - from[0]),
          from[1] + ratio * (to[1] - from[1]),
          from[2] + ratio * (to[2] - from[2]),
        ] satisfies Vec3;
        point[axis] = boundary;
        output.push(point);
      }
    }
    clipped = output;
  }
  // Recast returns Float32 world coordinates. A vertex just inside a core plane
  // must share that exact grid plane with its clipped neighbors. Preserve the
  // original detail triangle's height while correcting the horizontal rounding.
  clipped = clipped.map((point) => {
    const x =
      Math.abs(point[0] - bounds.min[0]) <= tolerance
        ? bounds.min[0]
        : Math.abs(point[0] - bounds.max[0]) <= tolerance
          ? bounds.max[0]
          : point[0];
    const z =
      Math.abs(point[2] - bounds.min[1]) <= tolerance
        ? bounds.min[1]
        : Math.abs(point[2] - bounds.max[1]) <= tolerance
          ? bounds.max[1]
          : point[2];
    return [x, a[1] + riseX * (x - a[0]) + riseZ * (z - a[2]), z];
  });
  // Snapping can fold a sub-millimetre sliver back along a core boundary.
  // Only these clipped triangle vertices are canonicalized, preserving the
  // original support plane and winding without bridging unrelated surfaces.
  const key = (point: Vec3) => point.map((value) => Math.round(value * 10000)).join('/');
  const points = convexHull(clipped).filter(
    (point, index, hull) => key(point) !== key(hull[(index + hull.length - 1) % hull.length]),
  );
  if (determinant < 0) points.reverse();
  const origin = points[0];
  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length];
    return (
      sum +
      (point[0] - origin[0]) * (next[2] - origin[2]) -
      (next[0] - origin[0]) * (point[2] - origin[2])
    );
  }, 0);
  return points.length >= 3 && Math.abs(area) > tolerance * tolerance ? points : null;
}
