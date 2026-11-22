import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { prepareGangliaV2 } from '#@/src/solver/ganglia-v2-rust.ts';
import { gangliaV2Defaults } from '#@/src/solver/ganglia-v2.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

test('v2 climbs an authored fixed launch with independently replayable device controls', async () => {
  const surfaces: Surface[] = [
    {
      id: 'lower',
      vertices: [
        [-5, 0, -2],
        [0, 0, -2],
        [0, 0, 2],
        [-5, 0, 2],
      ],
    },
    {
      id: 'upper',
      vertices: [
        [3, 8, -2],
        [8, 8, -2],
        [8, 8, 2],
        [3, 8, 2],
      ],
    },
  ];
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[2], v[1], v[0], v[3], v[2]]);
  const input = {
    ...physical,
    ground: { ...physical.ground, surfaces },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
    devices: {
      devices: [
        {
          id: 'pad',
          kind: 'launch',
          position: [-1, 0, 0] as [number, number, number],
          goal: { position: [-1, 0, 0] as [number, number, number], interaction: { radius: 0.4 } },
          seeds: [[-1, 0, 0] as [number, number, number]],
          unitScale: true,
          resolved: true,
          fixedLaunch: true,
          aim: [4, 8, 0],
          height: 0.1,
          aimClearance: 0.5,
          speed: Number.NaN,
          overhead: Number.NaN,
          duration: null,
          boostMultiplier: 1,
        },
      ],
      ropes: [],
    },
  };
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-3, 0, 0], state: 'available', cost: 0 }],
    goal: [6, 8, 0],
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const launch = result.route.segments.find((segment) => segment.mode === 'launch');
    assert.ok(launch?.flight);
    assert.equal(launch.connection, 'launch/pad');
    assert.ok(
      Math.abs(
        launch.flight.model.maxJumpHeight - (launch.flight.end[1] + 0.5 - launch.flight.start[1]),
      ) < 1e-10,
    );
    const verify = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')]);
    const evaluation = verify(query, result.route);
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});
