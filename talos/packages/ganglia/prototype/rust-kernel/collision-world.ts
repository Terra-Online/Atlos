import { CollisionIndex } from '#@/prototype/rust-kernel/collision-binding.ts';
import type { CollisionWorld } from '#@/src/collision.ts';
import { createTypeScriptCollisionWorld } from '#@/src/model/collision.ts';

type Factory = typeof createTypeScriptCollisionWorld;
const point = (value: unknown) =>
  Array.isArray(value) && value.length === 3 && value.every(Number.isFinite);

export const createRustCollisionWorld: Factory = (geometry, options) => {
  // Exact-query memoization is an independent TS experiment. Keep its FIFO and
  // clone semantics in that implementation rather than duplicating them here.
  if (options?.queryCacheSize !== undefined && options.queryCacheSize !== 0)
    return createTypeScriptCollisionWorld(geometry, options);
  if (
    !geometry?.positions ||
    !geometry.indices ||
    geometry.positions.length % 3 ||
    geometry.indices.length % 3
  )
    throw new Error('Invalid collision geometry');
  for (const value of geometry.positions)
    if (!Number.isFinite(value)) throw new Error('Non-finite collision vertex');
  for (const index of geometry.indices)
    if (!Number.isInteger(index) || index < 0 || index >= geometry.positions.length / 3)
      throw new Error('Invalid collision index');
  const scope = options?.bounds;
  if (
    scope !== undefined &&
    (!scope ||
      !Array.isArray(scope.min) ||
      !Array.isArray(scope.max) ||
      scope.min.length !== 2 ||
      scope.max.length !== 2 ||
      ![...scope.min, ...scope.max].every(Number.isFinite) ||
      scope.min.some((value, axis) => value > scope.max[axis]))
  )
    throw new Error('Invalid collision XZ bounds');
  const index = new CollisionIndex(
    Float64Array.from(geometry.positions),
    Uint32Array.from(geometry.indices),
    Float64Array.from(scope ? [...scope.min, ...scope.max] : []),
  );
  return {
    bounds: scope ? { min: [...scope.min], max: [...scope.max] } : null,
    queryCacheStats: { capacity: 0, entries: 0, hits: 0, misses: 0 },
    groundAt(position, settings) {
      if (!point(position)) throw new Error('Invalid ground support query');
      const { maxUp, maxDown, maxSlope, radius = 0 } = settings ?? {};
      const hit = index.groundAt(
        Float64Array.from(position),
        maxUp,
        maxDown,
        maxSlope,
        radius,
        Math.cos((maxSlope * Math.PI) / 180),
      );
      return hit.length
        ? {
            position: [position[0], hit[1], position[2]],
            triangle: hit[0],
            normal: [hit[2], hit[3], hit[4]],
          }
        : null;
    },
    sweepCapsule(start, end, profile) {
      if (!point(start) || !point(end)) throw new Error('Invalid capsule sweep');
      const { radius, height, inflation = 0 } = profile ?? {};
      const hit = index.sweepCapsule(
        Float64Array.from(start),
        Float64Array.from(end),
        radius,
        height,
        inflation,
      );
      return hit.length ? { triangle: hit[0], distance: hit[1] } : null;
    },
    trianglesInBounds(rectangle) {
      if (
        !rectangle ||
        !Array.isArray(rectangle.min) ||
        !Array.isArray(rectangle.max) ||
        rectangle.min.length !== 2 ||
        rectangle.max.length !== 2 ||
        ![...rectangle.min, ...rectangle.max].every(Number.isFinite)
      )
        throw new Error('Invalid collision triangle rectangle');
      return Array.from(
        index.trianglesInBounds(Float64Array.from([...rectangle.min, ...rectangle.max])),
      );
    },
  } satisfies CollisionWorld;
};
