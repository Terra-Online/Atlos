import type { Vec3 } from '#@/src/geometry.ts';

type Interval = [number, number];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a: Vec3, b: Vec3): Vec3 => a.map((x, i) => x - b[i]) as Vec3;
const clip = (range: Interval, first: number, last: number) => {
  if (first < 0 && last < 0) range[1] = -1;
  else if (first < 0) range[0] = Math.max(range[0], first / (first - last));
  else if (last < 0) range[1] = Math.min(range[1], first / (first - last));
};
const intersect = (a: Interval, b: Interval): Interval => [
  Math.max(a[0], b[0]),
  Math.min(a[1], b[1]),
];
const nonempty = (range: Interval) => range[0] <= range[1];
const ball = (offset: Vec3, velocity: Vec3, radius: number): Interval => {
  const a = dot(velocity, velocity),
    b = dot(offset, velocity),
    c = dot(offset, offset) - radius * radius;
  if (a === 0) return c <= 0 ? [0, 1] : [1, 0];
  const discriminant = b * b - a * c;
  if (discriminant < 0) return [1, 0];
  const root = Math.sqrt(discriminant);
  return intersect([0, 1], [(-b - root) / a, (-b + root) / a]);
};
// A finite segment's radius neighbourhood is its cylinder plus two end balls.
const tube = (a: Vec3, b: Vec3, p: Vec3, q: Vec3, radius: number): Interval[] => {
  const direction = sub(q, p),
    velocity = sub(b, a),
    offset = sub(a, p),
    squared = dot(direction, direction);
  const caps = [ball(offset, velocity, radius), ball(sub(a, q), velocity, radius)];
  if (squared) {
    const first = dot(offset, direction) / squared,
      change = dot(velocity, direction) / squared;
    const range = ball(
      offset.map((v, i) => v - first * direction[i]) as Vec3,
      velocity.map((v, i) => v - change * direction[i]) as Vec3,
      radius,
    );
    clip(range, first, first + change);
    clip(range, 1 - first, 1 - first - change);
    caps.push(range);
  }
  return caps.filter(nonempty);
};

/** Continuous candidate support from a finite walkable triangle. Capsule feet
 * can be supported by its face, edges or vertices. Intersect the exact horizontal
 * radius footprint with a 3D contact envelope, then let standing/collision prove
 * the actual supported height. Projection tolerance expands only that height
 * envelope, never the horizontal reach across a missing support interval. */
export function supportIntervals(
  a: Vec3,
  b: Vec3,
  vertices: Vec3[],
  normal: Vec3,
  radius: number,
  tolerance: number,
): Interval[] {
  const [p, q, r] = vertices,
    u = sub(q, p),
    v = sub(r, p);
  const determinant = u[0] * v[2] - u[2] * v[0];
  if (Math.abs(determinant) < 1e-12) return [];
  const weights = (point: Vec3) => {
    const x = point[0] - p[0],
      z = point[2] - p[2];
    const beta = (x * v[2] - z * v[0]) / determinant,
      gamma = (u[0] * z - u[2] * x) / determinant;
    return [1 - beta - gamma, beta, gamma];
  };
  const face = (first: Vec3, last: Vec3): Interval => {
    const start = weights(first),
      end = weights(last),
      range: Interval = [0, 1];
    for (let i = 0; i < 3; i++) clip(range, start[i] + 1e-9, end[i] + 1e-9);
    return range;
  };
  const flat = (point: Vec3): Vec3 => [point[0], 0, point[2]];
  const footprint = [face(a, b)];
  const centers = [a, b].map((point) => [point[0], point[1] + radius, point[2]] as Vec3);
  const norm = Math.hypot(...normal),
    unit = normal.map((x) => x / norm) as Vec3;
  const distances = centers.map((point) => dot(sub(point, p), unit));
  const projected = centers.map(
    (point, j) => point.map((x, i) => x - distances[j] * unit[i]) as Vec3,
  );
  const plane = face(projected[0], projected[1]);
  clip(plane, distances[0], distances[1]);
  clip(plane, radius + tolerance - distances[0], radius + tolerance - distances[1]);
  const contact = [plane];
  for (let i = 0; i < 3; i++) {
    const start = vertices[i],
      end = vertices[(i + 1) % 3];
    footprint.push(...tube(flat(a), flat(b), flat(start), flat(end), radius));
    contact.push(...tube(centers[0], centers[1], start, end, radius + tolerance));
  }
  return footprint
    .filter(nonempty)
    .flatMap((horizontal) =>
      contact.map((spatial) => intersect(horizontal, spatial)).filter(nonempty),
    );
}
