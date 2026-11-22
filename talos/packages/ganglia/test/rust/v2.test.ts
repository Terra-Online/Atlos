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
