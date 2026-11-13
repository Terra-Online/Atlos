import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createCollisionWorld,
  type CollisionOptions,
  type CollisionWorld,
} from '#@/src/collision.ts';
import type { Vec3 } from '#@/src/geometry.ts';

const profile = { radius: 0.35, height: 1.66 };
const support = { maxUp: 0.5, maxDown: 0.5, maxSlope: 46 };
const geometry = () => ({
  positions: [
    -10, 0, -10, 0, 0, 10, 10, 0, -10, 0, -10, -10, 0, 10, -10, 0, 10, 10, 0, -10, -10, 0, 10, 10,
    0, -10, 10,
  ],
  indices: [0, 1, 2, 3, 4, 5, 6, 7, 8],
});

test('exact query caches retain support, collisions and null results without mutable aliases', () => {
  const world = createCollisionWorld(geometry(), { queryCacheSize: 20 });
  const foot: Vec3 = [2, 0.1, 0];
  const expected = world.groundAt(foot, support);
  assert.ok(expected);
  const first = world.groundAt(foot, support);
  assert.ok(first);
  first.position.fill(123);
  first.normal.fill(321);
  first.triangle = 999;
  assert.deepEqual(world.groundAt(foot, support), expected);
  expected.position.fill(456);
  assert.deepEqual(world.groundAt(foot, support)!.position, [2, 0, 0]);
  const hit = world.sweepCapsule([-1, 0, 0], [1, 0, 0], profile);
  assert.ok(hit);
  const hitCopy = { ...hit };
  hit.triangle = 999;
  hit.distance = 999;
  const next = world.sweepCapsule([-1, 0, 0], [1, 0, 0], profile);
  assert.deepEqual(next, hitCopy);
  next.distance = -999;
  assert.deepEqual(world.sweepCapsule([-1, 0, 0], [1, 0, 0], profile), hitCopy);
  for (let index = 0; index < 2; index++) {
    assert.equal(world.groundAt([20, 0.1, 0], support), null);
    assert.equal(world.sweepCapsule([2, 2, 0], [3, 2, 0], profile), null);
  }
  assert.ok(world.queryCacheStats!.hits >= 5);
  const stats = world.queryCacheStats;
  stats!.hits = -1;
  assert.ok(world.queryCacheStats!.hits >= 5);
});

test('cache keys preserve every geometric input, query direction and signed zero', () => {
  const fresh = createCollisionWorld(geometry());
  const cached = createCollisionWorld(geometry(), { queryCacheSize: 500 });
  const supports: Parameters<CollisionWorld['groundAt']>[] = [];
  for (const x of [2, 0, -0])
    for (const field of ['maxUp', 'maxDown', 'maxSlope', 'radius']) {
      for (const value of field === 'maxSlope' ? [20, 46, 80] : [0, 0.2, 0.5]) {
        supports.push([[x, 0.1, 0], { ...support, [field]: value }]);
      }
    }
  const sweeps: Parameters<CollisionWorld['sweepCapsule']>[] = [];
  for (const start of [
    [-1, 0, 0],
    [1, 0, 0],
    [0, 2, 0],
    [-0, 2, 0],
  ] satisfies Vec3[]) {
    for (const end of [
      [1, 0, 0],
      [-1, 0, 0],
      [0, 2, 0],
      [-0, 2, 0],
    ] satisfies Vec3[]) {
      for (const body of [
        profile,
        { radius: 0.3, height: 1.66 },
        { radius: 0.35, height: 2 },
        { ...profile, inflation: 0.1 },
        { ...profile, inflation: 0 },
      ])
        sweeps.push([start, end, body]);
    }
  }
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const [point, options] of supports)
      assert.deepEqual(cached.groundAt(point, options), fresh.groundAt(point, options));
    for (const [start, end, body] of sweeps)
      assert.deepEqual(cached.sweepCapsule(start, end, body), fresh.sweepCapsule(start, end, body));
  }
  assert.ok(cached.queryCacheStats!.hits > 0);
  assert.deepEqual(fresh.queryCacheStats, { capacity: 0, entries: 0, hits: 0, misses: 0 });
});

test('one capacity bounds both query kinds and caches remain local to immutable world snapshots', () => {
  const input = geometry();
  const world = createCollisionWorld(input, { queryCacheSize: 2 });
  world.groundAt([2, 0.1, 0], support);
  world.sweepCapsule([2, 2, 0], [3, 2, 0], profile);
  world.groundAt([2, 0.1, 0], support);
  world.sweepCapsule([3, 2, 0], [4, 2, 0], profile);
  const before = world.queryCacheStats;
  assert.equal(before!.entries, 2);
  input.positions.fill(999);
  input.indices.fill(0);
  // The support entry was evicted. A fresh computation still uses copied geometry.
  assert.deepEqual(world.groundAt([2, 0.1, 0], support)!.position, [2, 0, 0]);
  assert.equal(world.queryCacheStats!.misses, before!.misses + 1);
  assert.equal(world.queryCacheStats!.entries, 2);
  const empty = createCollisionWorld({ positions: [], indices: [] }, { queryCacheSize: 2 });
  assert.equal(empty.groundAt([2, 0.1, 0], support), null);
  assert.equal(empty.sweepCapsule([-1, 0, 0], [1, 0, 0], profile), null);
});

test('cached worlds still validate parameters and complete footprints before lookup', () => {
  for (const queryCacheSize of [-1, 0.5, Infinity, NaN, null, '2']) {
    assert.throws(
      () =>
        createCollisionWorld(geometry(), { queryCacheSize } as unknown as Parameters<
          typeof createCollisionWorld
        >[1]),
      /cache size/,
    );
  }
  const requested: CollisionOptions | undefined = {
    bounds: { min: [-1, -1], max: [1, 1] },
    queryCacheSize: 4,
  };
  const world = createCollisionWorld({ positions: [], indices: [] }, requested);
  assert.equal(world.groundAt([1, 0, 1], support), null);
  assert.equal(world.sweepCapsule([1, 0, 1], [1, 0, 1], { radius: 0, height: 1 }), null);
  const before = world.queryCacheStats;
  requested.bounds!.min.fill(-100);
  requested.bounds!.max.fill(100);
  requested.queryCacheSize = 100;
  world.bounds!.min.fill(-100);
  world.bounds!.max.fill(100);
  assert.throws(
    () => world.groundAt([1, 0, 1], { ...support, radius: 1e-12 }),
    /indexed XZ bounds/,
  );
  assert.throws(
    () => world.sweepCapsule([1, 0, 1], [1, 0, 1], { radius: 0, height: 1, inflation: 1e-12 }),
    /indexed XZ bounds/,
  );
  assert.throws(() => world.groundAt([1, NaN, 1], support), /ground support query/);
  assert.throws(
    () => world.sweepCapsule([1, 0, 1], [1, 0, 1], { radius: 1, height: 1 }),
    /capsule sweep/,
  );
  assert.deepEqual(world.queryCacheStats, before);
});

test('indexed refinement rectangles retain original triangle order and all heights', () => {
  const positions: number[] = [],
    indices = [];
  for (let id = 0; id < 120; id++) {
    const x = (id % 12) - 6,
      z = Math.floor(id / 12) - 5,
      y = id % 7;
    const offset = positions.length / 3;
    positions.push(x, y, z, x + 1.2, y, z, x, y, z + 1.2);
    indices.push(offset, offset + 1, offset + 2);
  }
  const world = createCollisionWorld(
    { positions, indices },
    { bounds: { min: [-3, -3], max: [3, 3] } },
  );
  for (let i = 0; i < 40; i++) {
    const x = -3 + (i % 5),
      z = -3 + (i % 6);
    const rectangle: { min: [number, number]; max: [number, number] } = {
      min: [x, z],
      max: [Math.min(3, x + 1), Math.min(3, z + 1)],
    };
    const expected = [];
    for (let id = 0; id < indices.length / 3; id++) {
      const vertices = indices
        .slice(id * 3, id * 3 + 3)
        .map((index) => positions.slice(index * 3, index * 3 + 3));
      if (
        [0, 2].every(
          (axis, k) =>
            Math.min(...vertices.map((v) => v[axis])) <= rectangle.max[k] &&
            Math.max(...vertices.map((v) => v[axis])) >= rectangle.min[k],
        )
      )
        expected.push(id);
    }
    assert.deepEqual(world.trianglesInBounds!(rectangle), expected);
  }
  assert.throws(() => world.trianglesInBounds!({ min: [-4, 0], max: [1, 1] }), /scope|bounds/i);
  assert.throws(() => world.trianglesInBounds!({ min: [0, NaN], max: [1, 1] }), /rectangle/i);
  assert.throws(() => world.trianglesInBounds!({ min: [2, 0], max: [1, 1] }), /rectangle/i);
});
