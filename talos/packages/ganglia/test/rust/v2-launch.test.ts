import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { prepareGangliaV2 } from '#@/src/solver/ganglia-v2-rust.ts';
import { gangliaV2Defaults } from '#@/src/solver/ganglia-v2.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

function launchScene(free: boolean, aim: [number, number, number], upperY: number, upperX: number) {
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
        [upperX, upperY, -2],
        [upperX + 8, upperY, -2],
        [upperX + 8, upperY, 2],
        [upperX, upperY, 2],
      ],
    },
  ];
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[2], v[1], v[0], v[3], v[2]]);
  return {
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
          fixedLaunch: !free,
          freeLaunch: free,
          aim,
          height: 10,
          aimClearance: 1,
          speed: Number.NaN,
          overhead: Number.NaN,
          duration: null,
          boostMultiplier: 1,
        },
      ],
      ropes: [],
    },
  };
}

test('v2 prepares free launch landings with source height and bounded horizontal speed', async () => {
  const input = launchScene(true, [4, 8, 0], 8, 3);
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const before = solver.preparationStats();
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }],
      goal: [6, 8, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const launch = result.route.segments.find((s) => s.mode === 'launch');
    assert.ok(launch?.flight);
    assert.equal(launch.flight.model.maxJumpHeight, 10);
    assert.ok(launch.flight.model.maxHorizontalSpeed <= input.movement.runAirSpeed);
    assert.ok(launch.points.at(-1)![1] >= 8);
    assert.deepEqual(solver.preparationStats(), before);
  } finally {
    await solver.close();
  }
});

test('v2 attaches a collision-supported arrival on a launch pad omitted by navigation', async () => {
  const input = launchScene(false, [4, 8, 0], 8, 3);
  input.ground.surfaces = input.ground.surfaces.slice(1);
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const prepared = solver.preparationStats();
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-1, 0, 0], cost: 0, state: 'available' }],
      goal: [6, 8, 0],
    });
    assert.equal(result.route.status, 'complete');
    assert.deepEqual(solver.preparationStats(), prepared);
  } finally {
    await solver.close();
  }
});

test('v2 collects marked airborne goals during fixed and free launches', async () => {
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }],
    goal: [0.5, 7, 0],
    interaction: { radius: 0.7, airborne: true },
  };
  for (const free of [false, true]) {
    const input = launchScene(free, [6, 0, 0], 0, 3);
    const solver = await prepareGangliaV2(gangliaV2Defaults, input, [
      { position: query.goal, interaction: query.interaction! },
    ]);
    try {
      const result = await solver.solve(query);
      assert.equal(result.route.status, 'complete');
      if (result.route.status !== 'complete') continue;
      const terminal = result.route.segments.at(-1)!;
      assert.equal(terminal.mode, 'launch');
      assert.equal(terminal.connection, free ? 'launch/pad/terminal/0' : 'launch/pad');
      assert.ok(Math.hypot(...terminal.points.at(-1)!.map((v, i) => v - query.goal[i])) <= 0.7);
    } finally {
      await solver.close();
    }
  }
});

test('v2 continues a fixed launch past an airborne aim to supported ground', async () => {
  const input = launchScene(false, [10, 4, 0], 0, 11);
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }],
      goal: [15, 0, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const launch = result.route.segments.find((s) => s.mode === 'launch');
    assert.ok(launch?.flight);
    assert.ok(launch.flight.end[0] > 10);
    assert.ok(launch.flight.end[1] < 0.02);
  } finally {
    await solver.close();
  }
});

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
