import assert from 'node:assert/strict';
import { test } from 'node:test';

import { circularSupport } from '#@/src/model/circular-support.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

function wheel(): PhysicalInput {
  return {
    ...physical,
    ground: { ...physical.ground, surfaces: [] },
    collision: { positions: [], indices: [] },
    movement: {
      ...physical.movement,
      runAirSpeed: 0,
      model: {
        ...physical.movement.model,
        maxJumpHeight: 0,
        maxHorizontalSpeed: 0,
        startHorizontalSpeed: 0,
      },
    },
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        circularSupport({
          id: 'wheel',
          level: 'test',
          model: 'rotor',
          center: [0, 5, 0],
          axis: [0, 0, 1],
          radius: 4,
          halfWidth: 0.5,
          speed: 2,
        }),
      ],
    },
  };
}

test('v2 rides a prepared circular rim without filling its interior', async () => {
  const input = wheel();
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const before = solver.preparationStats();
    const transfers = input.devices!.movingSupports![0].transfers!;
    const bottom = transfers[Math.floor(transfers.length / 2)].from;
    const start: [number, number, number] = [bottom[0], bottom[1] + 0.01, bottom[2]];
    const result = await solver.solve({
      starts: [{ id: 'p', position: start, cost: 0, state: 'available' }],
      goal: [0, 9.01, 0],
      interaction: { radius: 0.15, maxVertical: 0.02 },
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const rides = result.route.segments.filter((s) => s.traversal === 'moving-support');
    assert.ok(rides.length > 10);
    for (const segment of rides)
      for (const p of segment.points) {
        assert.ok(Math.abs(Math.hypot(p[0], p[1] - 5.01) - 4) < 0.006);
      }
    assert.ok(result.route.cost > 5 && result.route.cost < 7);
    const unsupported = await solver.solve({
      starts: [{ id: 'center', position: [0, 5, 0], cost: 0, state: 'available' }],
      goal: [0, 9.01, 0],
    });
    assert.notEqual(unsupported.route.status, 'complete');
    assert.deepEqual(solver.preparationStats(), before);
  } finally {
    await solver.close();
  }
});

test('v2 preserves external obstruction across the circular contact domain', async () => {
  const input = wheel();
  input.ground.options = {
    ...input.ground.options,
    walls: [{ min: [-5, 4, -2], max: [5, 6, 2], state: 'active' }],
  };
  const transfers = input.devices!.movingSupports![0].transfers!;
  const bottom = transfers[Math.floor(transfers.length / 2)].from;
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [
        {
          id: 'p',
          position: [bottom[0], bottom[1] + 0.01, bottom[2]],
          cost: 0,
          state: 'available',
        },
      ],
      goal: [0, 9.01, 0],
      interaction: { radius: 0.15, maxVertical: 0.02 },
    });
    assert.notEqual(result.route.status, 'complete');
  } finally {
    await solver.close();
  }
});
