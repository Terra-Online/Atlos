import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface } from '#@/src/geometry.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

function floors(ranges: [number, number][]): PhysicalInput {
  const surfaces: Surface[] = ranges.map(([min, max], i) => ({
    id: `floor/${i}`,
    vertices: [
      [min, 0, 0],
      [min, 0, 2],
      [max, 0, 2],
      [max, 0, 0],
    ],
  }));
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[1], v[2], v[0], v[2], v[3]]);
  return {
    ...physical,
    ground: { ...physical.ground, surfaces },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
  };
}

test('v2 can jump over a known-empty tile but cannot jump through omitted coverage', async () => {
  const input = floors([
    [0, 2],
    [4, 6],
  ]);
  const query = {
    starts: [
      {
        id: 'player',
        position: [1, 0, 1] as [number, number, number],
        cost: 0,
        state: 'available' as const,
      },
    ],
    goal: [5, 0, 1] as [number, number, number],
  };
  for (const knownEmpty of [false, true]) {
    const solver = await prepareGangliaV2(
      gangliaV2Defaults,
      {
        ...input,
        ground: {
          ...input.ground,
          tiles: (knownEmpty ? [0, 1, 2] : [0, 2]).map((x) => ({ x, z: 0 })),
          build: {
            bounds: { min: [0, 0], max: [6, 2] },
            cellSize: 1,
            tileCells: 2,
          },
        },
      },
      [],
    );
    try {
      const result = await solver.solve(query);
      assert.equal(result.route.status, knownEmpty ? 'complete' : 'no-verified-route');
      if (result.route.status === 'complete') {
        assert.ok(result.route.segments.some((segment) => segment.mode === 'jump'));
      }
    } finally {
      await solver.close();
    }
  }
});

test('v2 sparse coverage includes the capsule footprint beyond its feet tile', async () => {
  const input = floors([[0, 4]]);
  const solver = await prepareGangliaV2(
    gangliaV2Defaults,
    {
      ...input,
      ground: {
        ...input.ground,
        tiles: [{ x: 0, z: 0 }],
        build: {
          bounds: { min: [0, 0], max: [4, 2] },
          cellSize: 1,
          tileCells: 2,
        },
      },
    },
    [],
  );
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [0.5, 0, 1], cost: 0, state: 'available' }],
      goal: [1.9, 0, 1],
    });
    assert.equal(result.route.status, 'no-verified-route');
  } finally {
    await solver.close();
  }
});
