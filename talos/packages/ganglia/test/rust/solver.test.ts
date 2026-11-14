import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import { verifyRoute } from '#@/src/evaluation/route.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults, prepareRouteSolver } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

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
  positions: Float64Array.from(triangles.flat(2)),
  indices: Uint32Array.from({ length: triangles.length * 3 }, (_, i) => i),
};
const model = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 20,
  apexTime: 0.2,
  maxHorizontalSpeed: 6.5,
  startHorizontalSpeed: 6.5,
  airAcceleration: 10,
  airDeceleration: 10,
  airOverspeedDeceleration: 5,
};
const movement = {
  profile: { radius: 0.3, height: 1.7 },
  speed: 7,
  runAirSpeed: 6.5,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  model,
};
const config = {
  ...gangliaV1Defaults,
  algorithm: 'ganglia-v1-rust' as const,
  maxCandidates: 1200,
  maxShortcutCandidates: 64,
  maxLinks: 64,
};
const start = (position: Vec3, id = 'player', cost = 0) => ({
  id,
  position,
  state: 'available' as const,
  cost,
});
const input = { kind: 'surfaces' as const, input: { surfaces, collision, walls: [], movement } };
const physical: PhysicalInput = {
  ground: {
    surfaces,
    options: { profile: movement.profile, walls: [], speed: 7, maxVertical: 0.5 },
  },
  collision,
  movement: { model, maxSlope: 46, runAirSpeed: 6.5, stepUp: 0.5, stepDown: 0.5 },
  locomotion: { speed: 7, sprintSpeed: 7, sprintAcceleration: 10 },
};
const certify = (query: RouteQuery, route: Route, input = physical) => {
  const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
    query,
    route,
  );
  assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
};

test('Rust discovers a multihop route and emits replayable flight controls', async () => {
  const solver = await prepareRouteSolver(config, input);
  const query: RouteQuery = { starts: [start([2, 0, 0])], goal: [16, 0, 0] };
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    assert.equal(verifyRoute(query, result.route, { maxVertical: 0.5 }).valid, true);
    certify(query, result.route);
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.segments.filter((segment) => segment.mode === 'jump').length >= 2);
    for (const segment of result.route.segments.filter((segment) => segment.mode === 'jump'))
      assert.ok('flight' in segment, 'Native actions need controls for independent replay');
    const repeated = await solver.solveBatch([query, query]);
    assert.deepEqual(repeated[0], result);
    assert.deepEqual(repeated[1], result);
  } finally {
    await solver.close();
  }
});

test('Rust selects arrivals by full cost and honors ordered waypoints', async () => {
  const solver = await prepareRouteSolver({ ...config, maxCandidates: 0 }, input);
  const query: RouteQuery = {
    starts: [start([15, 0, 0], 'expensive', 100), start([16, 0, 0], 'cheap', 0)],
    waypoints: [
      [15, 0, 1],
      [17, 0, 1],
    ],
    goal: [16, 0, -1],
  };
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    assert.equal(verifyRoute(query, result.route, { maxVertical: 0.5 }).valid, true);
    certify(query, result.route);
    if (result.route.status === 'complete') assert.equal(result.route.start, 'cheap');
  } finally {
    await solver.close();
  }
  await assert.rejects(solver.solve(query), /closed/);
  await assert.rejects(solver.solveBatch([]), /closed/);
});

test('Rust scene loading consumes raw facts without invoking the TS solver', async () => {
  let loads = 0;
  const query: RouteQuery = { starts: [start([15, 0, 0])], goal: [17, 0, 0] };
  const solver = await prepareRouteSolver(config, {
    kind: 'scene',
    scene: {
      scene: 'fixture',
      source: 'fixture-source',
      walls: [],
      navigation: { surfaces, options: { speed: 7, maxVertical: 0.5, profile: movement.profile } },
    },
    locomotion: physical.locomotion,
    resources: {
      query: async () => ({ status: 'ready' as const }),
      physical: async () => {
        loads++;
        return { input: physical, revision: 'fixture/1', coverage: 'complete' };
      },
      solve: async () => {
        throw new Error('TypeScript solving must not run');
      },
      ground: async () => {
        throw new Error('TypeScript ground preparation must not run');
      },
      key: () => 'fixture/1',
      route: () => ({}),
      wait: async () => {},
    },
  });
  try {
    const result = await solver.solve(query);
    assert.ok(loads > 0);
    assert.equal(result.route.status, 'complete');
    assert.equal(verifyRoute(query, result.route, { maxVertical: 0.5 }).valid, true);
    certify(query, result.route);
  } finally {
    await solver.close();
  }
});

test('Rust builds support from raw collision when physical ground is empty', async () => {
  const input = { ...physical, ground: { ...physical.ground, surfaces: [] } };
  const solver = await prepareRouteSolver(config, {
    kind: 'physical',
    input,
  });
  const query: RouteQuery = { starts: [start([15, 0, 0])], goal: [17, 0, 0] };
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    assert.equal(verifyRoute(query, result.route, { maxVertical: 0.5 }).valid, true);
    certify(query, result.route, input);
  } finally {
    await solver.close();
  }
});

test('Rust physical walking cannot bridge a raw gap hidden by navigation', async () => {
  const navigation: Surface = {
    id: 'approximate-floor',
    vertices: [
      [-2, 0, -1],
      [2, 0, -1],
      [2, 0, 1],
      [-2, 0, 1],
    ],
  };
  const floors: Vec3[][] = [
    [-2, -0.05],
    [0.05, 2],
  ].map(([a, b]) => [
    [a, 0, -1],
    [b, 0, -1],
    [b, 0, 1],
    [a, 0, 1],
  ]);
  const raw = floors.flatMap((v) => [
    [v[0], v[2], v[1]],
    [v[0], v[3], v[2]],
  ]);
  const input: PhysicalInput = {
    ...physical,
    ground: { ...physical.ground, surfaces: [navigation] },
    collision: {
      positions: raw.flat(2),
      indices: Array.from({ length: raw.length * 3 }, (_, i) => i),
    },
  };
  const configured = createPhysicalWorld(input, 'complete').configured();
  assert.ok(configured.standing([-1, 0.01, 0]));
  assert.ok(configured.standing([1, 0.01, 0]));
  assert.equal(configured.walkTrace([-1, 0.01, 0], [1, 0.01, 0]), null);
  const solver = await prepareRouteSolver(
    { ...config, maxCandidates: 0 },
    { kind: 'physical', input },
  );
  try {
    const result = await solver.solve({ starts: [start([-1, 0.01, 0])], goal: [1, 0.01, 0] });
    assert.notEqual(result.route.status, 'complete');
  } finally {
    await solver.close();
  }
});

test('Rust airborne collection is certified before a later collision', async () => {
  const points = [3, 0, -2, 3, 4, -2, 3, 4, 2, 3, 0, 2];
  const count = physical.collision.positions.length / 3;
  const input: PhysicalInput = {
    ...physical,
    collision: {
      positions: [...physical.collision.positions, ...points],
      indices: [
        ...physical.collision.indices,
        count,
        count + 1,
        count + 2,
        count,
        count + 2,
        count + 3,
      ],
    },
  };
  const query: RouteQuery = {
    starts: [start([1, 0, 0])],
    goal: [3, 1.9, 0],
    interaction: { airborne: true, radius: 0.7 },
  };
  const solver = await prepareRouteSolver(config, { kind: 'physical', input });
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    certify(query, result.route, input);
  } finally {
    await solver.close();
  }
});

test('Rust whole-route sprint and dash schedule passes independent resource replay', async () => {
  const input: PhysicalInput = {
    ...physical,
    locomotion: {
      speed: 4,
      sprintSpeed: 6,
      sprintAcceleration: 10,
      dash: { speed: 10, duration: 0.3, cooldown: 0.8, cost: 2 },
      stamina: {
        capacity: 10,
        initial: 10,
        activationCost: 1,
        sprintDrain: 2,
        recoveryRate: 1,
        recoveryDelay: 1,
        reserve: 1,
      },
    },
  };
  const query: RouteQuery = { starts: [start([0.5, 0, 0])], goal: [3.5, 0, 0] };
  const solver = await prepareRouteSolver(
    { ...config, maxCandidates: 0 },
    { kind: 'physical', input },
  );
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    certify(query, result.route, input);
    if (result.route.status === 'complete') assert.ok((result.route.locomotion?.dashes ?? 0) > 0);
  } finally {
    await solver.close();
  }
});

test('Rust releases a suspended query after aborted IO and closes resources once', async () => {
  const controller = new AbortController();
  const cancelled = new Error('fixture IO cancelled');
  let queued = true;
  let waits = 0;
  let closes = 0;
  const query: RouteQuery = { starts: [start([15, 0, 0])], goal: [17, 0, 0] };
  const solver = await prepareRouteSolver(
    { ...config, maxCandidates: 0 },
    {
      kind: 'scene',
      scene: {
        scene: 'fixture',
        source: 'fixture-source',
        walls: [],
        navigation: {
          surfaces,
          options: { speed: 7, maxVertical: 0.5, profile: movement.profile },
        },
      },
      locomotion: physical.locomotion,
      resources: {
        query: async () => ({ status: queued ? ('building' as const) : ('ready' as const) }),
        physical: async () => ({
          input: physical,
          revision: 'fixture/1',
          coverage: 'complete' as const,
        }),
        wait: async (signal) => {
          waits++;
          assert.equal(signal, controller.signal);
          controller.abort(cancelled);
          signal?.throwIfAborted();
        },
        close: async () => {
          closes++;
        },
        solve: async () => {
          throw new Error('TypeScript solving must not run');
        },
        ground: async () => {
          throw new Error('TypeScript ground preparation must not run');
        },
        key: () => 'fixture/1',
        route: () => ({}),
      },
    },
  );
  try {
    await assert.rejects(
      solver.solve(query, { signal: controller.signal }),
      (error) => error === cancelled,
    );
    assert.equal(waits, 1);
    queued = false;
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    certify(query, result.route);
  } finally {
    await Promise.all([solver.close(), solver.close()]);
  }
  assert.equal(closes, 1);
});

test('Rust resends snapshots after a failed search evicts a resident world', async () => {
  let revision = 0;
  const solver = await prepareRouteSolver(config, {
    kind: 'scene',
    scene: {
      scene: 'fixture',
      source: 'fixture-source',
      walls: [],
      navigation: {
        surfaces,
        options: { speed: 7, maxVertical: 0.5, profile: movement.profile },
      },
    },
    locomotion: physical.locomotion,
    resources: {
      query: async () => ({ status: 'ready' as const }),
      physical: async () => ({
        input: physical,
        revision: `resident/${revision}`,
        coverage: 'complete' as const,
      }),
      wait: async () => {},
      solve: async () => {
        throw new Error('TypeScript solving must not run');
      },
      ground: async () => {
        throw new Error('TypeScript ground preparation must not run');
      },
      key: () => `resident/${revision}`,
      route: () => ({}),
    },
  });
  const query: RouteQuery = { starts: [start([2, 0, 0])], goal: [16, 0, 0] };
  try {
    for (revision = 0; revision < 4; revision++) {
      assert.equal((await solver.solve(query)).route.status, 'complete');
    }
    // The fifth world enters the native LRU before final-goal projection rejects an invalid interaction.
    await assert.rejects(solver.solve({ ...query, interaction: { radius: -1 } }), /interaction/i);
    revision = 0;
    const recovered = await solver.solve(query);
    assert.equal(recovered.route.status, 'complete');
    certify(query, recovered.route);
  } finally {
    await solver.close();
  }
});
