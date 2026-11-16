import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface } from '#@/src/geometry.ts';
import type { GroundConnection } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { prepareRouteSolver, gangliaV1Defaults } from '#@/src/solver/index.ts';

const surfaces: Surface[] = [0, 7, 14].map((x, i) => ({
  id: `floor/${i}`,
  vertices: [
    [x, 0, -2],
    [x + 4, 0, -2],
    [x + 4, 0, 2],
    [x, 0, 2],
  ],
}));
const triangles = surfaces.flatMap(({ vertices: v }) => [
  [v[0], v[2], v[1]],
  [v[0], v[3], v[2]],
]);
const collision = {
  positions: triangles.flat(2),
  indices: Array.from({ length: triangles.length * 3 }, (_, i) => i),
};
const options = {
  profile: { radius: 0.3, height: 1.7 },
  walls: [],
  speed: 7,
  runAirSpeed: 6.5,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 600,
  maxShortcutCandidates: 0,
  maxLinks: 32,
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 6.5,
  },
};
const policy = { ...gangliaV1Defaults, maxCandidates: 600, maxShortcutCandidates: 0, maxLinks: 32 };
const query: RouteQuery = {
  starts: [{ id: 'player', position: [2, 0, 0], state: 'available', cost: 0 }],
  goal: [16, 0, 0],
};

test('supplied traversal semantics survive solving without interpreting connection identifiers', async () => {
  const connection: GroundConnection = {
    id: 'opaque',
    mode: 'rope',
    traversal: 'moving-support',
    state: 'open',
    points: [
      [2, 0, 0],
      [9, 0, 0],
    ],
    times: [0, 1],
  };
  const solver = await prepareRouteSolver(
    { ...policy, maxCandidates: 0 },
    {
      kind: 'surfaces',
      input: {
        surfaces,
        collision,
        walls: [],
        connections: [connection],
        movement: options,
      },
    },
  );
  try {
    const result = await solver.solve({ ...query, goal: [9, 0, 0] });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete')
      assert.equal(
        result.route.segments.find((segment) => segment.connection === 'opaque')?.traversal,
        'moving-support',
      );
  } finally {
    await solver.close();
  }
});

test('a same-scene batch preserves order, budgets and independent search state', async () => {
  const queries: readonly RouteQuery[] = [
    query,
    { starts: [{ ...query.starts[0], position: query.goal }], goal: query.starts[0].position },
    { ...query, goal: [102, 0, 0] },
    query,
  ];
  const expected = [];
  for (const item of queries) {
    const isolated = await prepareRouteSolver(policy, {
      kind: 'surfaces',
      input: {
        surfaces,
        collision,
        walls: options.walls,
        movement: options,
      },
    });
    try {
      expected.push(await isolated.solve(item));
    } finally {
      await isolated.close();
    }
  }
  assert.deepEqual(
    expected.map((r) => r.route.status),
    ['complete', 'complete', 'unmapped', 'complete'],
  );
  assert.equal(expected[0].route.status, 'complete');
  assert.equal(expected[0].route.segments.filter((segment) => segment.mode === 'jump').length, 2);
  const solver = await prepareRouteSolver(policy, {
    kind: 'surfaces',
    input: {
      surfaces,
      collision,
      walls: options.walls,
      movement: options,
    },
  });
  try {
    assert.deepEqual(await solver.solveBatch(queries), expected);
    assert.deepEqual(await solver.solveBatch([]), []);
    assert.deepEqual(await solver.solve(query), expected[0]);
  } finally {
    await solver.close();
  }
  await solver.close();
  await assert.rejects(solver.solve(query), /closed/);
  await assert.rejects(solver.solveBatch(queries), /closed/);
});

test('factory snapshots a fixed policy and separate solvers can run different budgets', async () => {
  const config = { ...policy };
  const input = { surfaces, collision, walls: [], movement: options };
  await assert.rejects(
    prepareRouteSolver({ ...config, maxCandidates: -1 }, { kind: 'surfaces', input }),
    /search budget/,
  );
  const solver = await prepareRouteSolver(config, { kind: 'surfaces', input });
  config.maxCandidates = 0;
  const limited = await prepareRouteSolver(config, { kind: 'surfaces', input });
  try {
    assert.equal(solver.config.algorithm, 'ganglia-v1');
    assert.equal(solver.config.maxCandidates, 600);
    assert.equal(limited.config.maxCandidates, 0);
    assert.equal((await limited.solve(query)).route.status, 'no-verified-route');
    assert.deepEqual(
      (await solver.solveBatch([query, query])).map((r) => r.route.status),
      ['complete', 'complete'],
    );
    assert.equal((await limited.solve(query)).route.status, 'no-verified-route');
  } finally {
    await Promise.all([solver.close(), limited.close()]);
  }
});
