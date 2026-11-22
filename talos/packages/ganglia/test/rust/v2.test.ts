import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { prepareGangliaV2 } from '#@/src/solver/ganglia-v2-rust.ts';
import { gangliaV2Defaults } from '#@/src/solver/ganglia-v2.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

test('v2 returns independently verifiable routes, measures optimization, and keeps its backbone frozen', async () => {
  const solver = await prepareGangliaV2(gangliaV2Defaults, physical, []);
  const query = {
    starts: [
      {
        id: 'player',
        position: [-2, 0, 0] as [number, number, number],
        cost: 0,
        state: 'available' as const,
      },
    ],
    goal: [2, 0, 0] as [number, number, number],
  };
  try {
    const prepared = solver.preparationStats();
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    const stats = result.diagnostics.v2;
    assert.ok(stats);
    assert.ok(stats.rounds.length >= 3);
    assert.ok(stats.rounds.every((round) => round.elapsedMs >= 0 && round.attempts === 100));
    assert.deepEqual(solver.preparationStats(), prepared);
    await assert.rejects(solver.solve(query, { signal: AbortSignal.abort() }));
    assert.equal((await solver.solve(query)).route.status, 'complete');
  } finally {
    await solver.close();
  }
  await assert.rejects(solver.solve(query), /closed/);
});

test('v2 static jumps and airborne collection replay against the independent physical model', async () => {
  const surfaces: Surface[] = [0, 5].map((x, i) => ({
    id: `floor/${i}`,
    vertices: [
      [x, 0, 0],
      [x + 3, 0, 0],
      [x + 3, 0, 3],
      [x, 0, 3],
    ],
  }));
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[2], v[1], v[0], v[3], v[2]]);
  const gap = {
    ...physical,
    ground: { ...physical.ground, surfaces },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
  };
  const cases = [
    { input: gap, start: [1, 0, 1] as Vec3, goal: [7, 0, 1] as Vec3, interaction: undefined },
    {
      input: physical,
      start: [-2, 0, 0] as Vec3,
      goal: [0, 1.5, 0] as Vec3,
      interaction: { radius: 0.3, airborne: true },
    },
  ];
  for (const item of cases) {
    const query: RouteQuery = {
      starts: [{ id: 'player', position: item.start, cost: 0, state: 'available' }],
      goal: item.goal,
      interaction: item.interaction,
    };
    const solver = await prepareGangliaV2(
      gangliaV2Defaults,
      item.input,
      item.interaction ? [{ position: item.goal, interaction: item.interaction }] : [],
    );
    try {
      const result = await solver.solve(query);
      assert.equal(result.route.status, 'complete');
      if (result.route.status !== 'complete') continue;
      assert.ok(result.route.segments.some((segment) => segment.mode === 'jump'));
      const evaluation = createPhysicalVerifier(() => [
        createPhysicalWorld(item.input, 'complete'),
      ])(query, result.route);
      assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    } finally {
      await solver.close();
    }
  }
});

test('v2 keeps physical support snapping inside the query projection tolerance', async () => {
  const input = {
    ...physical,
    ground: { ...physical.ground, options: { ...physical.ground.options, maxVertical: 0.1 } },
    collision: {
      ...physical.collision,
      positions: Array.from(physical.collision.positions, (value, index) =>
        index % 3 === 1 ? value + 0.2 : value,
      ),
    },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-2, 0, 0], cost: 0, state: 'available' }],
      goal: [2, 0, 0],
    });
    assert.equal(result.route.status, 'no-verified-route');
  } finally {
    await solver.close();
  }
});

test('v2 never relies on later optimization to repair an earlier airborne-goal hit', async () => {
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }],
    goal: [0, 1, 0],
    interaction: { radius: 2, airborne: true },
  };
  const solver = await prepareGangliaV2(
    { ...gangliaV2Defaults, attemptsPerRound: 1, stagnantRounds: 1 },
    physical,
    [{ position: query.goal, interaction: query.interaction! }],
  );
  try {
    const result = await solver.solve(query);
    if (result.route.status === 'complete') {
      const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
        query,
        result.route,
      );
      assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    } else {
      assert.equal(
        result.diagnostics.v2.initialCost,
        null,
        'an invalid initial candidate must never enter optimization',
      );
      assert.deepEqual(result.diagnostics.v2.rounds, []);
    }
  } finally {
    await solver.close();
  }
});

test('v2 observes an abort during native optimization and can accept another query', async () => {
  const solver = await prepareGangliaV2(
    { ...gangliaV2Defaults, attemptsPerRound: 1_000_000 },
    physical,
    [],
  );
  const controller = new AbortController();
  const reason = new Error('cancel native optimization');
  const timer = setTimeout(() => controller.abort(reason), 10);
  try {
    await assert.rejects(
      solver.solve(
        {
          starts: [{ id: 'player', position: [-2, 0, 0], cost: 0, state: 'available' }],
          goal: [2, 0, 0],
        },
        { signal: controller.signal },
      ),
      (error) => error === reason,
    );
    const next = await solver.solve({ starts: [], goal: [2, 0, 0] });
    assert.equal(next.route.status, 'no-verified-route');
    assert.equal(next.diagnostics.truncated, false);
  } finally {
    clearTimeout(timer);
    await solver.close();
  }
});

test('v2 can use a collision-backed landmark omitted by navigation without forcing an edge', async () => {
  const surfaces: Surface[] = [0, 7].map((x, i) => ({
    id: `ledge/${i}`,
    vertices: [
      [x, 0, 0],
      [x + 3, 0, 0],
      [x + 3, 0, 3],
      [x, 0, 3],
    ],
  }));
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[2], v[1], v[0], v[3], v[2]]);
  const input = {
    ...physical,
    ground: { ...physical.ground, surfaces: [surfaces[0]] },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
  };
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [1, 0, 1.5], cost: 0, state: 'available' }],
    goal: [9.5, 1.8, 1.5],
    interaction: { radius: 0.2, airborne: true },
  };
  const marks = [{ position: query.goal, interaction: query.interaction! }];
  const omitted = await prepareGangliaV2(gangliaV2Defaults, input, marks);
  try {
    assert.equal((await omitted.solve(query)).route.status, 'no-verified-route');
  } finally {
    await omitted.close();
  }
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, marks, [[8.5, 0, 1.5]]);
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('v2 walking on a slope uses finite capsule support and independently replays', async () => {
  const incline = (point: Vec3): Vec3 => [point[0], 3 + point[0] * 0.5, point[2]];
  const input = {
    ...physical,
    ground: {
      ...physical.ground,
      surfaces: physical.ground.surfaces.map((surface) => ({
        ...surface,
        vertices: surface.vertices.map(incline),
      })),
    },
    collision: {
      ...physical.collision,
      positions: Array.from(physical.collision.positions, (value, index) =>
        index % 3 === 1 ? 3 + physical.collision.positions[index - 1] * 0.5 : value,
      ),
    },
  };
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-2, 2, 0], cost: 0, state: 'available' }],
    goal: [2, 4, 0],
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.segments.every((segment) => segment.mode === 'walk'));
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('v2 airborne terminal remains inside a world-coordinate interaction after serialization', async () => {
  const offset: Vec3 = [-103.11, 115.05985242311868, -534.38];
  const input = {
    ...physical,
    ground: {
      ...physical.ground,
      surfaces: physical.ground.surfaces.map((surface) => ({
        ...surface,
        vertices: surface.vertices.map(
          (point) => point.map((value, i) => value + offset[i]) as Vec3,
        ),
      })),
    },
    collision: {
      ...physical.collision,
      positions: Array.from(physical.collision.positions, (value, i) => value + offset[i % 3]),
    },
    movement: {
      ...physical.movement,
      runAirSpeed: 4.75,
      model: {
        gravity: 40,
        fallingGravity: 38,
        maxJumpHeight: 2.0999999046325684,
        maxFallingSpeed: 80,
        apexTime: 0.10000000149011612,
        maxHorizontalSpeed: 4.75,
        startHorizontalSpeed: 4.75,
        airAcceleration: 60,
        airDeceleration: 10,
        airOverspeedDeceleration: 5,
      },
    },
  };
  const query: RouteQuery = {
    starts: [{ id: 'player', position: offset, cost: 0, state: 'available' }],
    goal: [-104.05000305175781, 118.44999847412109, -533.6300048828125],
    interaction: { radius: 2.090000033378601, airborne: true },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, [
    { position: query.goal, interaction: query.interaction! },
  ]);
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('v2 rejects floating landmarks when only navigation support is available', async () => {
  const input = { ...physical, collision: { positions: [], indices: [] } };
  const query: RouteQuery = {
    starts: [{ id: 'player', position: [-1, 0, 0], cost: 0, state: 'available' }],
    goal: [0, 3.5, 0],
    interaction: { radius: 0.1, airborne: true },
  };
  const solver = await prepareGangliaV2(
    gangliaV2Defaults,
    input,
    [{ position: query.goal, interaction: query.interaction! }],
    [[0, 1.8, 0]],
  );
  try {
    assert.equal((await solver.solve(query)).route.status, 'no-verified-route');
  } finally {
    await solver.close();
  }
});

test('v2 keeps the entire body inside the prepared physical coverage', async () => {
  const input = {
    ...physical,
    ground: {
      ...physical.ground,
      build: { bounds: { min: [-5, -5] as [number, number], max: [5, 5] as [number, number] } },
    },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-2, 0, 4.9], cost: 0, state: 'available' }],
      goal: [2, 0, 4.9],
    });
    assert.equal(result.route.status, 'no-verified-route');
    assert.equal(
      (
        await solver.solve({
          starts: [{ id: 'player', position: [-2, 0, 4.5], cost: 0, state: 'available' }],
          goal: [2, 0, 4.5],
        })
      ).route.status,
      'complete',
    );
  } finally {
    await solver.close();
  }
});
