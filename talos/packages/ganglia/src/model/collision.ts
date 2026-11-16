import type { CollisionOptions, Capsule, CollisionWorld } from '#@/src/collision.ts';
import type { CollisionGeometry, Vec3 } from '#@/src/geometry.ts';

type Triangle = readonly (readonly number[])[];
type GroundHit = ReturnType<CollisionWorld['groundAt']>;
type SweepHit = ReturnType<CollisionWorld['sweepCapsule']>;
type Hit = GroundHit | SweepHit;
type CachedHit = { kind: 'ground'; result: GroundHit } | { kind: 'sweep'; result: SweepHit };
type Compare = (a: number, b: number) => number;
type Tree = { box: number[] } & (
  | { start: number; end: number; left?: never; right?: never }
  | { left: Tree; right: Tree; start?: never; end?: never }
);
const sub = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[0] - b[0],
  a[1] - b[1],
  a[2] - b[2],
];
const dot = (a: readonly number[], b: readonly number[]) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: readonly number[], b: readonly number[]): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const mix = (a: readonly number[], b: readonly number[], t: number): Vec3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
const squared = (a: readonly number[], b: readonly number[]) => {
  const x = a[0] - b[0],
    y = a[1] - b[1],
    z = a[2] - b[2];
  return x * x + y * y + z * z;
};
const pointSegment = (p: readonly number[], a: readonly number[], b: readonly number[]) => {
  const d = sub(b, a),
    length = dot(d, d);
  return squared(p, mix(a, b, length ? Math.max(0, Math.min(1, dot(sub(p, a), d) / length)) : 0));
};
const segmentSegment = (
  a: readonly number[],
  b: readonly number[],
  c: readonly number[],
  d: readonly number[],
) => {
  let best = Math.min(
    pointSegment(a, c, d),
    pointSegment(b, c, d),
    pointSegment(c, a, b),
    pointSegment(d, a, b),
  );
  const u = sub(b, a),
    v = sub(d, c),
    w = sub(c, a),
    n = cross(u, v),
    denom = dot(n, n);
  if (denom > 0) {
    const s = dot(cross(w, v), n) / denom,
      t = dot(cross(w, u), n) / denom;
    if (s >= 0 && s <= 1 && t >= 0 && t <= 1)
      best = Math.min(best, squared(mix(a, b, s), mix(c, d, t)));
  }
  return best;
};
const inside = (p: readonly number[], triangle: Triangle, n: readonly number[]) => {
  for (let i = 0; i < 3; i++) {
    const a = triangle[i];
    if (!(dot(cross(sub(triangle[(i + 1) % 3], a), sub(p, a)), n) >= 0)) return false;
  }
  return true;
};
const pointTriangle = (p: readonly number[], triangle: Triangle, n: readonly number[]) => {
  const area = dot(n, n);
  if (area > 0) {
    const distance = dot(sub(p, triangle[0]), n) / area;
    const projected = p.map((v, i) => v - n[i] * distance);
    if (inside(projected, triangle, n)) return squared(p, projected);
  }
  return Math.min(
    pointSegment(p, triangle[0], triangle[1]),
    pointSegment(p, triangle[1], triangle[2]),
    pointSegment(p, triangle[2], triangle[0]),
  );
};
const segmentTriangle = (a: readonly number[], b: readonly number[], triangle: Triangle) => {
  const n = cross(sub(triangle[1], triangle[0]), sub(triangle[2], triangle[0]));
  const da = dot(sub(a, triangle[0]), n),
    db = dot(sub(b, triangle[0]), n);
  if (da !== db) {
    const t = da / (da - db);
    if (t >= 0 && t <= 1 && inside(mix(a, b, t), triangle, n)) return 0;
  }
  return Math.min(
    pointTriangle(a, triangle, n),
    pointTriangle(b, triangle, n),
    segmentSegment(a, b, triangle[0], triangle[1]),
    segmentSegment(a, b, triangle[1], triangle[2]),
    segmentSegment(a, b, triangle[2], triangle[0]),
  );
};
const triangleTriangle = (a: Triangle, b: Triangle) =>
  Math.min(
    segmentTriangle(a[0], a[1], b),
    segmentTriangle(a[1], a[2], b),
    segmentTriangle(a[2], a[0], b),
    segmentTriangle(b[0], b[1], a),
    segmentTriangle(b[1], b[2], a),
    segmentTriangle(b[2], b[0], a),
  );
const overlaps = (a: ArrayLike<number>, b: ArrayLike<number>) =>
  a[0] <= b[3] && a[3] >= b[0] && a[1] <= b[4] && a[4] >= b[1] && a[2] <= b[5] && a[5] >= b[2];
const point = (p: unknown) => Array.isArray(p) && p.length === 3 && p.every(Number.isFinite);
// Highest bottom-sphere support on the triangle, including its edges and corners.
// The edge objective is concave, so its stationary point or a segment endpoint
// gives the exact maximum. This avoids directional ray sampling at a ledge.
const sphereSupport = (
  position: readonly number[],
  face: Triangle,
  normal: readonly number[],
  radius: number,
) => {
  const contact = [position[0] - radius * normal[0], 0, position[2] - radius * normal[2]];
  const planeHeight =
    face[0][1] -
    (normal[0] * (position[0] - face[0][0]) + normal[2] * (position[2] - face[0][2])) / normal[1];
  contact[1] = planeHeight + radius / normal[1] - radius * normal[1];
  let best = inside(contact, face, normal) ? planeHeight + radius * (1 / normal[1] - 1) : -Infinity;
  for (let index = 0; index < 3; index++) {
    const a = face[index],
      b = face[(index + 1) % 3];
    const dx = b[0] - a[0],
      dz = b[2] - a[2],
      dy = b[1] - a[1];
    const lengthSquared = dx * dx + dz * dz;
    if (lengthSquared === 0) continue;
    const x = position[0] - a[0],
      z = position[2] - a[2];
    const projection = (x * dx + z * dz) / lengthSquared;
    const perpendicularSquared = (x - projection * dx) ** 2 + (z - projection * dz) ** 2;
    const reachSquared = radius * radius - perpendicularSquared;
    if (reachSquared < 0) continue;
    const fraction = Math.max(
      0,
      Math.min(
        1,
        projection + dy * Math.sqrt(reachSquared / (lengthSquared * (lengthSquared + dy * dy))),
      ),
    );
    const horizontalSquared = (x - fraction * dx) ** 2 + (z - fraction * dz) ** 2;
    if (horizontalSquared <= radius * radius)
      best = Math.max(
        best,
        a[1] + fraction * dy + Math.sqrt(radius * radius - horizontalSquared) - radius,
      );
  }
  return best;
};
/** Index a snapshot of world-space triangle surfaces. No layer, state or coverage
 * inference is performed. Triangles are double-sided thin surfaces, not solid volumes.
 * A capsule contained wholly inside a closed mesh therefore needs a separate initial
 * occupancy check. Callers must start from a verified free standing position.
 * Optional XZ bounds retain all intersecting triangles at every height. Queries
 * outside that scope throw rather than treating unindexed space as clear.
 */
export function createTypeScriptCollisionWorld(
  geometry: CollisionGeometry,
  options?: CollisionOptions,
): CollisionWorld {
  if (
    !geometry?.positions ||
    !geometry.indices ||
    geometry.positions.length % 3 ||
    geometry.indices.length % 3
  )
    throw new Error('Invalid collision geometry');
  for (const v of geometry.positions)
    if (!Number.isFinite(v)) throw new Error('Non-finite collision vertex');
  for (const i of geometry.indices)
    if (!Number.isInteger(i) || i < 0 || i >= geometry.positions.length / 3)
      throw new Error('Invalid collision index');
  const queryCacheSize = options?.queryCacheSize === undefined ? 0 : options.queryCacheSize;
  if (!Number.isSafeInteger(queryCacheSize) || queryCacheSize < 0)
    throw new Error('Invalid collision query cache size');
  // One bounded FIFO serves both methods for this immutable geometry/scope.
  // Default-off avoids key allocation for cold worlds or mostly unique sweeps.
  const queryCache = queryCacheSize ? new Map<string, CachedHit>() : null;
  let cacheHits = 0,
    cacheMisses = 0;
  const queryKey = (kind: string, values: number[]) =>
    kind + values.map((value) => (Object.is(value, -0) ? '-0' : String(value))).join(',');
  function copyResult(result: GroundHit): GroundHit;
  function copyResult(result: SweepHit): SweepHit;
  function copyResult(result: Hit): Hit {
    if (result === null) return null;
    if ('position' in result)
      return {
        position: [...result.position],
        triangle: result.triangle,
        normal: [...result.normal],
      };
    return { ...result };
  }
  const remember = (key: string, entry: CachedHit) => {
    if (queryCache!.size >= queryCacheSize) queryCache!.delete(queryCache!.keys().next().value!);
    if (entry.kind === 'ground') entry.result = copyResult(entry.result);
    else entry.result = copyResult(entry.result);
    queryCache!.set(key, entry);
  };
  let scope: number[] | null = null;
  if (options?.bounds !== undefined) {
    const requested = options.bounds;
    if (
      !requested ||
      !Array.isArray(requested.min) ||
      !Array.isArray(requested.max) ||
      requested.min.length !== 2 ||
      requested.max.length !== 2 ||
      ![...requested.min, ...requested.max].every(Number.isFinite) ||
      requested.min.some((value, axis) => value > requested.max[axis])
    ) {
      throw new Error('Invalid collision XZ bounds');
    }
    scope = [...requested.min, ...requested.max];
  }
  // Inspect source coordinates directly before allocating retained triangle snapshots.
  // A triangle with outside vertices can still cross the indexed rectangle.
  const retained: number[] | null = scope ? [] : null;
  if (scope) {
    const source = geometry.positions;
    for (let offset: number = 0; offset < geometry.indices.length; offset += 3) {
      const a = geometry.indices[offset] * 3;
      const b = geometry.indices[offset + 1] * 3;
      const c = geometry.indices[offset + 2] * 3;
      const minX = Math.min(source[a], source[b], source[c]);
      const maxX = Math.max(source[a], source[b], source[c]);
      const minZ = Math.min(source[a + 2], source[b + 2], source[c + 2]);
      const maxZ = Math.max(source[a + 2], source[b + 2], source[c + 2]);
      if (maxX >= scope[0] && minX <= scope[2] && maxZ >= scope[1] && minZ <= scope[3]) {
        retained!.push(offset / 3);
      }
    }
  }
  const originalIds = retained ? Uint32Array.from(retained) : null;
  const count = originalIds ? originalIds.length : geometry.indices.length / 3;
  const positions = Float64Array.from(geometry.positions);
  const indices = new Uint32Array(count * 3);
  for (let id = 0; id < count; id++) {
    const sourceOffset = (originalIds ? originalIds[id] : id) * 3;
    indices[id * 3] = geometry.indices[sourceOffset];
    indices[id * 3 + 1] = geometry.indices[sourceOffset + 1];
    indices[id * 3 + 2] = geometry.indices[sourceOffset + 2];
  }
  const order = Uint32Array.from({ length: count }, (_, index) => index);
  const bounds = new Float64Array(count * 6);
  const vertex = (index: number): Vec3 => [
    positions[index * 3],
    positions[index * 3 + 1],
    positions[index * 3 + 2],
  ];
  const triangle = (id: number): Triangle =>
    [0, 1, 2].map((index) => vertex(indices[id * 3 + index]));
  for (let id = 0; id < count; id++) {
    for (let axis = 0; axis < 3; axis++) {
      const a = positions[indices[id * 3] * 3 + axis];
      const b = positions[indices[id * 3 + 1] * 3 + axis];
      const c = positions[indices[id * 3 + 2] * 3 + axis];
      bounds[id * 6 + axis] = Math.min(a, b, c);
      bounds[id * 6 + axis + 3] = Math.max(a, b, c);
    }
  }
  const requireScope = (box: number[]) => {
    if (
      scope &&
      (box[0] < scope[0] || box[2] < scope[1] || box[3] > scope[2] || box[5] > scope[3])
    ) {
      throw new Error('Collision query exceeds indexed XZ bounds');
    }
  };
  const select = (start: number, end: number, middle: number, compare: Compare) => {
    // Bound partition work on adversarial layouts. The fallback sorts only the
    // remaining selection interval, whose outside members are already decided.
    let budget = 2 * (end - start);
    while (end - start > 16) {
      if ((budget -= end - start) < 0) {
        order.subarray(start, end).sort(compare);
        return;
      }
      let a = order[start],
        b = order[(start + end) >>> 1],
        c = order[end - 1];
      if (compare(a, b) > 0) {
        const value = a;
        a = b;
        b = value;
      }
      if (compare(b, c) > 0) {
        const value = b;
        b = c;
        c = value;
      }
      const pivot = compare(a, b) > 0 ? a : b;
      let lower = start,
        upper = end - 1;
      while (lower <= upper) {
        while (compare(order[lower], pivot) < 0) lower++;
        while (compare(order[upper], pivot) > 0) upper--;
        if (lower <= upper) {
          const value = order[lower];
          order[lower++] = order[upper];
          order[upper--] = value;
        }
      }
      if (middle <= upper) end = upper + 1;
      else if (middle >= lower) start = lower;
      else return;
    }
    order.subarray(start, end).sort(compare);
  };
  const build = (start: number, end: number, parentOrder?: Compare): Tree => {
    const box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let j = start; j < end; j++)
      for (let i = 0; i < 3; i++) {
        box[i] = Math.min(box[i], bounds[order[j] * 6 + i]);
        box[i + 3] = Math.max(box[i + 3], bounds[order[j] * 6 + i + 3]);
      }
    if (end - start <= 8) {
      // Internal nodes need only exact median membership. Leaves restore their
      // parent's sorted order so tied supports and first collision IDs stay exact.
      if (parentOrder) order.subarray(start, end).sort(parentOrder);
      return { box, start, end };
    }
    let axis = 0;
    for (let i = 1; i < 3; i++) if (box[i + 3] - box[i] > box[axis + 3] - box[axis]) axis = i;
    const compare = (a: number, b: number) =>
      bounds[a * 6 + axis] +
        bounds[a * 6 + axis + 3] -
        (bounds[b * 6 + axis] + bounds[b * 6 + axis + 3]) || a - b;
    const middle = (start + end) >>> 1;
    select(start, end, middle, compare);
    return { box, left: build(start, middle, compare), right: build(middle, end, compare) };
  };
  const root = count ? build(0, count) : null;
  return {
    bounds: scope ? { min: [scope[0], scope[1]], max: [scope[2], scope[3]] } : null,
    get queryCacheStats() {
      return {
        capacity: queryCacheSize,
        entries: queryCache?.size ?? 0,
        hits: cacheHits,
        misses: cacheMisses,
      };
    },
    /** Original input triangle IDs overlapping an inclusive XZ rectangle, in
     * input order. This reuses the obstacle index for local geometry preparation.
     */
    trianglesInBounds(rectangle: NonNullable<CollisionOptions['bounds']>): number[] {
      if (
        !rectangle ||
        !Array.isArray(rectangle.min) ||
        !Array.isArray(rectangle.max) ||
        rectangle.min.length !== 2 ||
        rectangle.max.length !== 2 ||
        ![...rectangle.min, ...rectangle.max].every(Number.isFinite) ||
        rectangle.min.some((value, axis) => value > rectangle.max[axis])
      ) {
        throw new Error('Invalid collision triangle rectangle');
      }
      const box = [
        rectangle.min[0],
        -Infinity,
        rectangle.min[1],
        rectangle.max[0],
        Infinity,
        rectangle.max[1],
      ];
      requireScope(box);
      const result = [],
        stack = root ? [root] : [];
      while (stack.length) {
        const node = stack.pop()!;
        if (!overlaps(box, node.box)) continue;
        if (node.left) {
          stack.push(node.left, node.right);
          continue;
        }
        for (let index = node.start; index < node.end; index++) {
          const id = order[index];
          if (overlaps(box, bounds.subarray(id * 6, id * 6 + 6)))
            result.push(originalIds ? originalIds[id] : id);
        }
      }
      return result.sort((a, b) => a - b);
    },
    /** Find upward support at exactly the supplied XZ position. Slope is in degrees.
     * Height limits are explicit and independent. This establishes triangle support
     * only; callers still verify standing capsule clearance and active world coverage.
     */
    groundAt(position: Vec3, options: Parameters<CollisionWorld['groundAt']>[1]): GroundHit {
      const { maxUp, maxDown, maxSlope, radius = 0 } = options ?? {};
      if (
        !point(position) ||
        ![maxUp, maxDown, maxSlope, radius].every(Number.isFinite) ||
        maxUp < 0 ||
        maxDown < 0 ||
        maxSlope <= 0 ||
        maxSlope >= 90 ||
        radius < 0
      )
        throw new Error('Invalid ground support query');
      const box = [
        position[0] - radius,
        position[1] - maxDown - radius,
        position[2] - radius,
        position[0] + radius,
        position[1] + maxUp + radius,
        position[2] + radius,
      ];
      if (!box.every(Number.isFinite)) throw new Error('Non-finite ground support bounds');
      requireScope(box);
      let key = null;
      if (queryCache) {
        key = queryKey('ground/', [...position, maxUp, maxDown, maxSlope, radius]);
        const found = queryCache.get(key);
        if (found?.kind === 'ground') {
          cacheHits++;
          return copyResult(found.result);
        }
        cacheMisses++;
      }
      const minimumUp = Math.cos((maxSlope * Math.PI) / 180),
        stack = root ? [root] : [];
      let best: GroundHit = null,
        bestOffset = Infinity;
      while (stack.length) {
        const node = stack.pop()!;
        if (!overlaps(box, node.box)) continue;
        if (node.left) {
          stack.push(node.left, node.right);
          continue;
        }
        for (let index = node.start; index < node.end; index++) {
          const id = order[index];
          if (!overlaps(box, bounds.subarray(id * 6, id * 6 + 6))) continue;
          const face = triangle(id),
            ab = sub(face[1], face[0]),
            ac = sub(face[2], face[0]);
          const normal = cross(ab, ac),
            length = Math.hypot(...normal);
          if (!Number.isFinite(length)) throw new Error('Non-finite ground support normal');
          if (length === 0 || normal[1] <= 0 || normal[1] / length < minimumUp) continue;
          const unitNormal: Vec3 = [normal[0] / length, normal[1] / length, normal[2] / length];
          const x = position[0] - face[0][0],
            z = position[2] - face[0][2],
            determinant = -normal[1];
          const u = (x * ac[2] - z * ac[0]) / determinant,
            v = (ab[0] * z - ab[2] * x) / determinant;
          // Only a numerical barycentric tolerance is allowed; the query never
          // searches neighbouring XZ positions or snaps across a missing floor.
          if (radius === 0 && (u < -1e-10 || v < -1e-10 || u + v > 1 + 1e-10)) continue;
          const height =
            radius > 0
              ? sphereSupport(position, face, unitNormal, radius)
              : face[0][1] + u * ab[1] + v * ac[1];
          if (height === -Infinity) continue;
          if (!Number.isFinite(height)) throw new Error('Non-finite ground support height');
          if (height < position[1] - maxDown || height > position[1] + maxUp) continue;
          const offset = Math.abs(height - position[1]);
          if (
            (radius > 0 && (!best || height > best!.position[1])) ||
            (radius === 0 &&
              (offset < bestOffset || (offset === bestOffset && height > best!.position[1])))
          ) {
            bestOffset = offset;
            best = {
              position: [position[0], height, position[2]],
              triangle: originalIds ? originalIds[id] : id,
              normal: unitNormal,
            };
          }
        }
      }
      if (key !== null) remember(key, { kind: 'ground', result: best });
      return best;
    },
    /** Continuous straight translation of an upright capsule, given feet positions.
     * Its axis sweeps a parallelogram; distance to that entire surface, not discrete
     * positions along the path, decides collision. Inflation bounds interpolation
     * error for curved paths and enlarges the capsule in every direction.
     * Returns any touching triangle, NOT the earliest impact or a landing proof.
     */
    sweepCapsule(start: Vec3, end: Vec3, profile: Capsule): SweepHit {
      const { radius, height, inflation = 0 } = profile ?? {};
      if (
        !point(start) ||
        !point(end) ||
        ![radius, height, inflation].every(Number.isFinite) ||
        radius < 0 ||
        height <= 0 ||
        height < 2 * radius ||
        inflation < 0
      )
        throw new Error('Invalid capsule sweep');
      const r = radius + inflation;
      const box = [
        Math.min(start[0], end[0]) - r,
        Math.min(start[1], end[1]) - inflation,
        Math.min(start[2], end[2]) - r,
        Math.max(start[0], end[0]) + r,
        Math.max(start[1], end[1]) + height + inflation,
        Math.max(start[2], end[2]) + r,
      ];
      if (!box.every(Number.isFinite)) throw new Error('Non-finite capsule bounds');
      requireScope(box);
      let key = null;
      if (queryCache) {
        key = queryKey('sweep/', [...start, ...end, radius, height, inflation]);
        const found = queryCache.get(key);
        if (found?.kind === 'sweep') {
          cacheHits++;
          return copyResult(found.result);
        }
        cacheMisses++;
      }
      const a = [start[0], start[1] + radius, start[2]],
        b = [start[0], start[1] + height - radius, start[2]];
      const c = [end[0], end[1] + radius, end[2]],
        d = [end[0], end[1] + height - radius, end[2]];
      const stack = root ? [root] : [];
      while (stack.length) {
        const node = stack.pop()!;
        if (!overlaps(box, node.box)) continue;
        if (node.left) {
          stack.push(node.left, node.right);
          continue;
        }
        for (let i = node.start; i < node.end; i++) {
          const id = order[i];
          if (!overlaps(box, bounds.subarray(id * 6, id * 6 + 6))) continue;
          const face = triangle(id),
            distance = Math.min(
              triangleTriangle([a, b, d], face),
              triangleTriangle([a, d, c], face),
            );
          if (!Number.isFinite(distance)) throw new Error('Non-finite collision distance');
          if (distance <= r * r) {
            const result = {
              triangle: originalIds ? originalIds[id] : id,
              distance: Math.sqrt(distance),
            };
            if (key !== null) remember(key, { kind: 'sweep', result });
            return result;
          }
        }
      }
      if (key !== null) remember(key, { kind: 'sweep', result: null });
      return null;
    },
  };
}

export { createTypeScriptCollisionWorld as createCollisionWorld };
