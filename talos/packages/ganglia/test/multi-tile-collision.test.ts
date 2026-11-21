import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildCollisionTile,
  createCollisionWorld,
  createMultiTileCollisionWorld,
  createTileBvhCache,
} from '#@/src/collision.ts';
import type { CollisionGeometry, Vec3 } from '#@/src/geometry.ts';

const profile = { radius: 0.35, height: 1.66 };
const supportOptions = { maxUp: 1.5, maxDown: 2.5, maxSlope: 46 };

function makeTerrain(size = 40): CollisionGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z <= size; z++) {
    for (let x = 0; x <= size; x++) {
      const y = Math.sin(x * 0.25) * Math.cos(z * 0.25) * 1.2 + (x === 20 ? 1.5 : 0);
      positions.push(x, y, z);
    }
  }
  const stride = size + 1;
  for (let z = 0; z < size; z++) {
    for (let x = 0; x < size; x++) {
      const a = z * stride + x;
      const b = a + 1;
      const c = a + stride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }
  // Add a large sloped ramp crossing the seam at x=20, z=20.
  const base = positions.length / 3;
  positions.push(18, 2.0, 18, 22, 2.5, 22, 22, 2.0, 18);
  indices.push(base, base + 1, base + 2);
  return { positions, indices };
}

test('MultiTileCollisionWorld matches merged createCollisionWorld across seams and queries', () => {
  const geometry = makeTerrain(40);
  const windowBounds = { min: [0, 0] as [number, number], max: [40, 40] as [number, number] };
  const merged = createCollisionWorld(geometry, { bounds: windowBounds });

  // Partition into 4 tiles (2x2 of 20m x 20m).
  const tiles = [];
  for (let tz = 0; tz < 2; tz++) {
    for (let tx = 0; tx < 2; tx++) {
      tiles.push(
        buildCollisionTile(`t:${tx},${tz}`, geometry, {
          min: [tx * 20, tz * 20],
          max: [(tx + 1) * 20, (tz + 1) * 20],
        }),
      );
    }
  }
  const multi = createMultiTileCollisionWorld(tiles, { bounds: windowBounds });

  // Verify trianglesInBounds across tile seam (deduplicated & sorted).
  const rect = { min: [18.5, 18.5] as [number, number], max: [21.5, 21.5] as [number, number] };
  assert.deepEqual(multi.trianglesInBounds!(rect), merged.trianglesInBounds!(rect));

  let seed = 2026;
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };

  // Compare groundAt (point and sphere support), sweepCapsule, hasTrianglesInAabb, probeSphere.
  for (let i = 0; i < 150; i++) {
    // Bias half the queries right onto the x=20 / z=20 seams.
    const x = i % 2 === 0 ? 19 + rand() * 2 : 1 + rand() * 38;
    const z = i % 2 === 0 ? 19 + rand() * 2 : 1 + rand() * 38;
    const y = -0.5 + rand() * 4;
    const p: Vec3 = [x, y, z];

    const g1 = multi.groundAt(p, supportOptions);
    const g2 = merged.groundAt(p, supportOptions);
    assert.deepEqual(g1, g2);

    const gs1 = multi.groundAt(p, { ...supportOptions, radius: profile.radius });
    const gs2 = merged.groundAt(p, { ...supportOptions, radius: profile.radius });
    assert.deepEqual(gs1, gs2);

    const q: Vec3 = [
      Math.max(1, Math.min(39, x + (rand() - 0.5) * 4)),
      y + (rand() - 0.5) * 2,
      Math.max(1, Math.min(39, z + (rand() - 0.5) * 4)),
    ];
    const s1 = multi.sweepCapsule(p, q, profile);
    const s2 = merged.sweepCapsule(p, q, profile);
    assert.equal(s1 !== null, s2 !== null);

    assert.equal(
      multi.hasTrianglesInAabb!(
        Math.min(p[0], q[0]) - 0.5,
        Math.min(p[1], q[1]) - 0.5,
        Math.min(p[2], q[2]) - 0.5,
        Math.max(p[0], q[0]) + 0.5,
        Math.max(p[1], q[1]) + 2,
        Math.max(p[2], q[2]) + 0.5,
      ),
      merged.hasTrianglesInAabb!(
        Math.min(p[0], q[0]) - 0.5,
        Math.min(p[1], q[1]) - 0.5,
        Math.min(p[2], q[2]) - 0.5,
        Math.max(p[0], q[0]) + 0.5,
        Math.max(p[1], q[1]) + 2,
        Math.max(p[2], q[2]) + 0.5,
      ),
    );
    assert.equal(multi.probeSphere!(p, 0.35), merged.probeSphere!(p, 0.35));
  }

  // Scope guard enforces overall window bounds identically to createCollisionWorld.
  assert.throws(() => multi.groundAt([-0.1, 0, 10], supportOptions), /indexed XZ bounds/);
  assert.throws(() => multi.sweepCapsule([0.2, 0, 10], [0.2, 0, 10], profile), /indexed XZ bounds/);
});

test('createTileBvhCache reuses overlapping tiles across sliding windows and enforces byte budget', () => {
  const geometry = makeTerrain(40);
  let builds = 0;
  const tileFor = (tx: number, tz: number) =>
    cache.getOrBuild(`scene:${tx},${tz}`, () => {
      builds++;
      return buildCollisionTile(`scene:${tx},${tz}`, geometry, {
        min: [tx * 10, tz * 10],
        max: [(tx + 1) * 10, (tz + 1) * 10],
      });
    });

  // First test reuse with generous budget.
  const cache = createTileBvhCache({ maxBytes: 10 * 1024 * 1024 });
  const window1 = createMultiTileCollisionWorld([
    tileFor(0, 0),
    tileFor(1, 0),
    tileFor(0, 1),
    tileFor(1, 1),
  ]);
  assert.equal(builds, 4);
  // Slide window east by 1 tile: 2 tiles reused, only 2 new tiles built.
  const window2 = createMultiTileCollisionWorld([
    tileFor(1, 0),
    tileFor(2, 0),
    tileFor(1, 1),
    tileFor(2, 1),
  ]);
  assert.equal(builds, 6);
  assert.equal(cache.stats().hits, 2);
  assert.equal(cache.stats().misses, 6);
  assert.ok(window1.groundAt([15, 0, 15], supportOptions));
  assert.ok(window2.groundAt([15, 0, 15], supportOptions));

  // Verify LRU eviction under tight byte budget.
  const tight = createTileBvhCache({ maxBytes: 250_000 });
  for (let i = 0; i < 6; i++) {
    tight.set({
      key: `k${i}`,
      bounds: { min: [i * 10, 0], max: [(i + 1) * 10, 10] },
      world: createCollisionWorld({ positions: [], indices: [] }),
      estimatedBytes: 100_000,
    });
  }
  const stats = tight.stats();
  assert.ok(stats.bytes <= 250_000);
  assert.equal(stats.entries, 2);
  assert.equal(stats.evictions, 4);
  assert.equal(tight.get('k0'), undefined);
  assert.ok(tight.get('k5'));
});
