import assert from 'node:assert/strict';
import { test } from 'node:test';

import { gangliaV2Defaults, prepareGangliaV2 } from '#@/src/solver/ganglia-v2-rust.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

test('v2 reaches an interaction on prepared collision-only bridge contacts', async () => {
  const input = {
    ...physical,
    ground: { ...physical.ground, surfaces: [] },
    collision: {
      positions: [-4, 0, -1, -4, 0, 1, -2, 0, 1, -2, 0, -1, 2, 0, -1, 2, 0, 1, 4, 0, 1, 4, 0, -1],
      indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    },
  };
  const solver = await prepareGangliaV2(
    gangliaV2Defaults,
    input,
    [],
    [
      [-2.2, 0.005, 0],
      [2.2, 0.005, 0],
    ],
  );
  try {
    const { route } = await solver.solve({
      starts: [{ id: 'player', position: [-3, 0.005, 0], cost: 0, state: 'available' }],
      goal: [3, 0.005, 0],
      interaction: { radius: 0.2, maxVertical: 0.2 },
    });
    assert.equal(route.status, 'complete');
    if (route.status !== 'complete') return;
    assert.ok(route.segments.some((segment) => segment.mode === 'jump'));
    assert.ok(Math.hypot(...route.points.at(-1)!.map((v, i) => v - [3, 0.005, 0][i])) <= 0.2);
    const below = await solver.solve({
      starts: [{ id: 'player', position: [-3, 0.005, 0], cost: 0, state: 'available' }],
      goal: [3, -0.4, 0],
      interaction: { radius: 0.2, maxVertical: 0.2 },
    });
    assert.equal(below.route.status, 'no-verified-route');
  } finally {
    await solver.close();
  }
});
