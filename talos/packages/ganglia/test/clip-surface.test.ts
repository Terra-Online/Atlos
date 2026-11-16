import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { clipSurface } from '#@/src/v1/geo/clip-surface.ts';
import { projectPoint, surfaceGraph } from '#@/src/v1/geo/surfaces.ts';

test('grid snapping preserves convex support and seam endpoints in clipped slivers', () => {
  for (const offset of [0, -1024.8, 2048.4])
    for (const reverse of [false, true]) {
      const vertices = [
        [-1, -1],
        [0.1, 1],
        [0.00005, 0],
      ].map(([x, z]) => [x, 0.2 * x + 0.3 * z, z]);
      const input: Vec3[] = (reverse ? [...vertices].reverse() : vertices).map(
        ([x, y, z]: readonly number[]) => [x + offset, y, z + offset],
      );
      const result = clipSurface(input, {
        min: [offset, offset - 2],
        max: [offset + 2, offset + 2],
      });
      assert.ok(result);
      const surface = { id: 'clipped', vertices: result };
      for (let index = 0; index < result.length; index++) {
        const a = result[index],
          b = result[(index + 1) % result.length];
        const midpoint: Vec3 = a.map((value, axis) => (value + b[axis]) / 2) as Vec3;
        assert.ok(
          projectPoint([surface], midpoint, { maxVertical: 1e-7 }),
          'every boundary must belong to supported ground',
        );
        assert.ok(
          Math.abs(midpoint[1] - (0.2 * (midpoint[0] - offset) + 0.3 * (midpoint[2] - offset))) <
            1e-8,
        );
      }
      const originalArea =
        (input[1][0] - input[0][0]) * (input[2][2] - input[0][2]) -
        (input[1][2] - input[0][2]) * (input[2][0] - input[0][0]);
      const area = result.reduce((sum, point, index) => {
        const next = result[(index + 1) % result.length];
        return (
          sum + (point[0] - offset) * (next[2] - offset) - (next[0] - offset) * (point[2] - offset)
        );
      }, 0);
      assert.equal(Math.sign(area), Math.sign(originalArea));
      assert.doesNotThrow(() => surfaceGraph([surface], { speed: 5 }));
    }
});
