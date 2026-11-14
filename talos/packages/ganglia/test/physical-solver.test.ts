import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sweepSupports } from '#@/src/model/supports.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import { prepareRouteSolver, gangliaV1Defaults, type PhysicalInput } from '#@/src/solver/index.ts';
import { groundPreparation, type GroundPlanner } from '#@/src/v1/route/ground.ts';
import { movementGeometry } from '#@/src/v1/route/movement-geometry.ts';
import { executeRoute } from '#@/src/v1/solver/physical/execution.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';
import {
  type PhysicalCache,
  type PhysicalResult,
  solvePhysicalRoute,
} from '#@/src/v1/solver/physical/solve.ts';

const input: PhysicalInput = {
  ground: {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
          [10, 0, 0],
        ],
      },
    ],
    options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
  },
  collision: { positions: [0, 0, 0, 0, 0, 10, 10, 0, 10, 10, 0, 0], indices: [0, 1, 2, 0, 2, 3] },
  movement: {
    model: {
      gravity: 10,
      fallingGravity: 10,
      maxJumpHeight: 1,
      maxFallingSpeed: 10,
      apexTime: 0,
      maxHorizontalSpeed: 2,
      startHorizontalSpeed: 2,
      airOverspeedDeceleration: 5,
      airAcceleration: 60,
      airDeceleration: 10,
    },
    maxSlope: 45,
    runAirSpeed: 1,
    stepUp: 0.4,
    stepDown: 0.6,
  },
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
};

test('physical vertical candidates preserve arrival ranges and the highest target support below', async () => {
  const surfaces = [0, 0.25, 3].map((height, index) => ({
    id: `floor-${index}`,
    vertices: input.ground.surfaces[0].vertices.map(([x, , z]): [number, number, number] => [
      x,
      height,
      z,
    ]),
  }));
  const snapshot = { ...input, ground: { ...input.ground, surfaces } };
  for (const [height, targetHeight] of [
    [0, 0],
    [0.25, 2],
  ]) {
    const results: PhysicalResult[] = [];
    await solvePhysicalRoute(
      snapshot,
      {
        arrival: {
          id: 'start',
          position: [1, 0.4, 1],
          groundRange: [height, height],
          state: 'available',
          cost: 0,
        },
        target: [9, targetHeight, 1],
        walls: [],
      },
      {
        effort: 'walking',
        emit(result) {
          results.push(result);
        },
      },
      gangliaV1Defaults,
    );
    const result = results.at(-1)!;
    assert.equal(result.route?.status, 'complete', JSON.stringify(result));
    assert.deepEqual(result.route.points[0], [1, height, 1]);
    assert.deepEqual(result.groundedTarget, [9, height, 1]);
  }
});
test('physical jump planning continues its raw ground solve without repeating the same query', async () => {
  const cache = createPhysicalCache();
  let calls = 0;
  const observed: PhysicalCache = {
    release: cache.release,
    async memo(slot, key, create) {
      const prepared = await cache.memo(slot, key, create);
      if (slot === 'ground' && !prepared.reused) {
        const planner = prepared.value as GroundPlanner,
          plan = planner.plan;
        planner.plan = (...args) => {
          calls++;
          return plan(...args);
        };
      }
      return prepared;
    },
  };
  const solver = await preparePhysicalSolver(
    input,
    { ...gangliaV1Defaults, maxCandidates: 1, maxShortcutCandidates: 0 },
    { cache: observed },
  );
  const query = {
    starts: [
      {
        id: 'start',
        state: 'available' as const,
        cost: 3,
        position: [1, 0, 1] as [number, number, number],
      },
    ],
    goal: [9, 0, 1] as [number, number, number],
    waypoints: [[5, 0, 1] as [number, number, number]],
  };
  try {
    const first = await solver.solve(query);
    assert.equal(first.route.status, 'complete');
    if (first.route.status === 'complete') {
      assert.equal(first.route.arrivalCost, 3);
      assert.deepEqual(first.route.points[0], [1, 0.005, 1]);
      assert.deepEqual(first.route.points.at(-1), [9, 0.005, 1]);
      assert.ok(first.route.cost > 3);
    }
    assert.equal(calls, 1);
    assert.deepEqual(await solver.solve(query), first);
    assert.equal(calls, 2);
  } finally {
    await solver.close();
  }
});

test('moving and refined preparations retain the graph consumed by action discovery', async () => {
  for (const outside of [false, true]) {
    const physical = structuredClone(input);
    const surfaces: typeof input.ground.surfaces = [
      {
        id: 'left',
        vertices: [
          [0, 0, 0],
          [0, 0, 10],
          [4, 0, 10],
          [4, 0, 0],
        ],
      },
      {
        id: 'right',
        vertices: [
          [6, 0, 0],
          [6, 0, 10],
          [10, 0, 10],
          [10, 0, 0],
        ],
      },
    ];
    physical.ground.surfaces = surfaces;
    physical.ground.build = {
      bounds: { min: [0, 0], max: [10, 10] },
      cellSize: 0.2,
      cellHeight: 0.05,
    };
    physical.ground.options.portals = [];
    physical.collision = {
      positions: surfaces.flatMap((surface) => surface.vertices.flat()),
      indices: surfaces.flatMap((_, i) => [
        i * 4,
        i * 4 + 1,
        i * 4 + 2,
        i * 4,
        i * 4 + 2,
        i * 4 + 3,
      ]),
    };
    const x = outside ? 20 : 4;
    physical.devices = {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'bridge',
          family: 'platform',
          level: 'fixture',
          model: 'fixture',
          assumption: 'phase-free-swept-support',
          ...sweepSupports(
            'bridge',
            [
              [
                [
                  [x, 0, 0],
                  [x, 0, 10],
                  [x + 2, 0, 10],
                  [x + 2, 0, 0],
                ],
              ],
            ],
            1,
          ),
        },
      ],
    };
    const cache = createPhysicalCache();
    let checked = 0;
    const observed: PhysicalCache = {
      ...cache,
      async memo(slot, key, create, scope) {
        const prepared = await cache.memo(slot, key, create, scope);
        if (slot === 'moving' || slot === 'refinement') {
          const value = prepared.value as {
            planner: GroundPlanner;
            surfaces: typeof surfaces;
            portals: typeof physical.ground.options.portals;
          };
          const ground = groundPreparation(value.planner)!;
          const geometry = movementGeometry(value.surfaces, {
            walls: physical.ground.options.walls,
            profile: physical.ground.options.profile,
            portals: value.portals,
            groundPlanner: value.planner,
          });
          assert.equal(
            geometry.graph,
            ground.routeBase.graph,
            'derived mesh and imported portals must reuse the prepared graph, including empty augmentation',
          );
          checked++;
        }
        return prepared;
      },
    };
    await solvePhysicalRoute(
      physical,
      {
        arrival: { id: 'start', state: 'available', cost: 0, position: [1, 0, 1] },
        target: [9, 0, 1],
        walls: [],
      },
      { cache: observed, emit() {} },
      { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    );
    assert.equal(checked, 2, 'both moving and refinement boundaries were exercised');
    cache.clear();
  }
});

test('physical solver returns fresh single and batch routes through the prepared seam', async () => {
  const solver = await prepareRouteSolver(gangliaV1Defaults, { kind: 'physical', input: input });
  const query = {
    starts: [
      {
        id: 'start',
        state: 'available' as const,
        cost: 0,
        position: [1, 0, 1] as [number, number, number],
      },
    ],
    goal: [9, 0, 1] as [number, number, number],
  };
  const single = await solver.solve(query);
  assert.equal(single.route.status, 'complete');
  assert.deepEqual(single.groundedTarget, [9, 0, 1]);
  const abort = new AbortController();
  await assert.rejects(
    solver.solve(query, {
      signal: abort.signal,
      onEvent(event) {
        if (event.type === 'candidate') abort.abort(new Error('query cancelled'));
      },
    }),
    /query cancelled/,
  );
  assert.equal((await solver.solve(query)).route.status, 'complete');
  const batch = await solver.solveBatch([query, query]);
  assert.deepEqual(batch[0], single);
  assert.deepEqual(batch[1], single);
  assert.equal(batch[0].route.status, 'complete');
  batch[0].route.points[0][0] = -100;
  assert.deepEqual(batch[1], single);
  assert.deepEqual(await solver.solve(query), single);
  await solver.close();
  await assert.rejects(solver.solve(query), /closed/);
});

test('physical solver distinguishes mapped but disconnected ground from unmapped endpoints', async () => {
  const solver = await prepareRouteSolver(gangliaV1Defaults, {
    kind: 'physical',
    input: {
      ...input,
      ground: {
        ...input.ground,
        surfaces: [
          ...input.ground.surfaces,
          {
            id: 'island',
            vertices: [
              [20, 0, 0],
              [20, 0, 10],
              [30, 0, 10],
              [30, 0, 0],
            ],
          },
        ],
      },
    },
  });
  const result = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [25, 0, 1],
  });
  assert.equal(result.route.status, 'no-verified-route');
  const unmapped = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [100, 0, 1],
  });
  assert.equal(unmapped.route.status, 'unmapped');
  await solver.close();
});

test('physical solver retains incomplete placement coverage at the prepared seam', async () => {
  const surfaces: typeof input.ground.surfaces = [
    ...input.ground.surfaces,
    {
      id: 'upper',
      vertices: [
        [6, 2.5, 6],
        [6, 2.5, 9],
        [9, 2.5, 9],
        [9, 2.5, 6],
      ],
    },
  ];
  const collision = {
    positions: surfaces.flatMap((s) => s.vertices.flat()),
    indices: surfaces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]),
  };
  const solver = await prepareRouteSolver(
    { ...gangliaV1Defaults, maxCandidates: 1 },
    {
      kind: 'physical',
      input: {
        ...input,
        collision,
        ground: {
          ...input.ground,
          surfaces,
          build: { bounds: { min: [0, 0], max: [10, 10] }, cellSize: 0.25, cellHeight: 0.1 },
        },
        devices: {
          devices: [],
          ropes: [],
          followingSupports: [
            {
              id: 'box',
              level: 'fixture',
              model: 'box',
              spawn: [4, 0, 4],
              bodies: [
                Array.from({ length: 8 }, (_, bits): [number, number, number] => [
                  4 + (bits & 1 ? 0.8 : -0.8),
                  bits & 2 ? 1.2 : 0,
                  4 + (bits & 4 ? 0.8 : -0.8),
                ]),
              ],
              geometryKind: 'box',
              initialState: 0,
              maxDistance: 65,
              assumption: 'placement-within-activity-range',
            },
          ],
        },
      },
    },
  );
  const result = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [8, 2.5, 8],
  });
  assert.equal(result.diagnostics.truncated, true);
  await solver.close();
});

function obstructedNavigation(): PhysicalInput {
  const value = structuredClone(input);
  const offset = value.collision.positions.length / 3;
  value.collision.positions = [...value.collision.positions, 5, 0, 0, 5, 3, 0, 5, 3, 6, 5, 0, 6];
  value.collision.indices = [
    ...value.collision.indices,
    offset,
    offset + 1,
    offset + 2,
    offset,
    offset + 2,
    offset + 3,
  ];
  value.ground.build = { bounds: { min: [0, 0], max: [10, 10] }, cellSize: 0.1, cellHeight: 0.05 };
  return value;
}
const obstacleQuery = {
  starts: [
    {
      id: 'start',
      state: 'available' as const,
      cost: 0,
      position: [1, 0, 1] as [number, number, number],
    },
  ],
  goal: [9, 0, 1] as [number, number, number],
};

test('execution rejects a radius-lifted walking witness that lost continuous support', () => {
  const physical = structuredClone(input);
  const surfaces: typeof physical.ground.surfaces = [
    {
      id: 'lower',
      vertices: [
        [-5, 0, -5],
        [-5, 0, 5],
        [5, 0, 5],
        [5, 0, -5],
      ],
    },
    {
      id: 'step',
      vertices: [
        [-4, 0.2, -4],
        [-4, 0.2, 4],
        [0, 0.2, 4],
        [0, 0.2, -4],
      ],
    },
  ];
  physical.ground.surfaces = surfaces;
  physical.ground.options.profile = { radius: 0.35, height: 1.66 };
  physical.ground.build = { cellHeight: 0.05 };
  physical.collision = {
    positions: surfaces.flatMap((surface) => surface.vertices.flat()),
    indices: surfaces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]),
  };
  const snapshot = createPhysicalWorld(physical, 'complete');
  const points: [number, number, number][] = [
    [0.175, 0.1, 0],
    [0.1, 0.1, 0],
  ];
  const trace = snapshot.configured().walkTrace(points[0], points[1]);
  assert.ok(trace, 'the navigation chord has support before the capsule-height correction');
  assert.equal(snapshot.configured().walkTrace(trace.at(-1)!, trace.at(-1)!), null);
  let rejection: unknown;
  const route = executeRoute(
    {
      status: 'complete',
      start: 'start',
      arrivalCost: 0,
      cost: 0.075,
      length: 0.075,
      points,
      segments: [{ mode: 'walk', points, times: [0, 0.075] }],
    },
    {
      starts: [{ id: 'start', state: 'available', cost: 0, position: points[0] }],
      goal: points[1],
    },
    snapshot,
    (failure) => {
      rejection = failure;
    },
  );
  assert.equal(route.status, 'no-verified-route');
  assert.equal((rejection as { reason: string }).reason, 'walk-unproved');
});

test('a bounded physical walking alternative reuses execution and continues quality search before rebuilding', async () => {
  const physical = obstructedNavigation();
  const cache = createPhysicalCache();
  const phases: unknown[] = [];
  let executionBuilds = 0;
  const observed: PhysicalCache = {
    ...cache,
    async memo(slot, key, create, scope) {
      const prepared = await cache.memo(slot, key, create, scope);
      if (slot === 'execution' && !prepared.reused) executionBuilds++;
      return prepared;
    },
  };
  const solver = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    {
      cache: observed,
      progress(progress) {
        phases.push(progress.phase);
      },
    },
  );
  try {
    const result = await solver.solve(obstacleQuery);
    assert.equal(result.route.status, 'complete', JSON.stringify(result));
    const { createPhysicalVerifier } = await import('#@/src/evaluation/index.ts');
    const verified = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
      obstacleQuery,
      result.route,
    );
    assert.equal(verified.valid, true, JSON.stringify(verified));
    assert.equal(phases.filter((phase) => phase === 'local-ground-search').length, 1);
    assert.equal(phases.includes('physical-ground-repair'), false);
    assert.equal(
      phases.includes('jump-discovery'),
      true,
      'the local incumbent retains normal subsequent improvements',
    );
    assert.equal(executionBuilds, 1, 'reuse the snapshot that rejected the navigation candidate');
  } finally {
    await solver.close();
    cache.clear();
  }
});

test('a waypoint query skips local walking and repairs rejected navigation once', async () => {
  const physical = obstructedNavigation(),
    before = structuredClone(physical);
  let repairs = 0;
  const published: string[] = [];
  const solver = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    {
      progress(p) {
        if (p.phase === 'physical-ground-repair') repairs++;
      },
      observe(result) {
        published.push(result.route.status);
      },
    },
  );
  const query = { ...obstacleQuery, waypoints: [obstacleQuery.starts[0].position] };
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete', JSON.stringify(result));
    const { createPhysicalWorld, createPhysicalVerifier } =
      await import('#@/src/evaluation/index.ts');
    const verified = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
      query,
      result.route,
    );
    assert.equal(verified.valid, true, JSON.stringify(verified));
    assert.equal(repairs, 1);
    assert.ok(published.length > 0 && published.every((status) => status === 'complete'));
    assert.deepEqual((await solver.solve(query)).route, result.route);
    assert.equal(repairs, 1, 'reuse repaired geometry, not a cached query answer');
    assert.deepEqual(physical, before);
  } finally {
    await solver.close();
  }
});

test('unaccepted walking cannot consume the optional-improvement budget or become a reported incumbent', async () => {
  const physical = obstructedNavigation();
  delete physical.ground.build;
  const budgets: number[] = [];
  const solver = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 700, maxShortcutCandidates: 0 },
    {
      observe(_result, _optimizing, diagnostics) {
        const d = diagnostics as { limits?: { maxCandidates: number } };
        if (d.limits) budgets.push(d.limits.maxCandidates);
      },
    },
  );
  try {
    const result = await solver.solve({
      ...obstacleQuery,
      waypoints: [obstacleQuery.starts[0].position],
    });
    assert.notEqual(result.route.status, 'complete');
    assert.ok(budgets.length > 0);
    assert.ok(budgets.every((b) => b === 700));
  } finally {
    await solver.close();
  }
});

test('explicit sparse tile holes cannot be repaired into walkable empty space', async () => {
  const physical = structuredClone(input);
  physical.ground.build = {
    bounds: { min: [0, 0], max: [10, 10] },
    cellSize: 0.1,
    cellHeight: 0.05,
    tileCells: 20,
  };
  physical.ground.tiles = [
    { x: 0, z: 0 },
    { x: 4, z: 0 },
  ];
  let repairs = 0;
  const solver = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    {
      progress(p) {
        if (p.phase === 'physical-ground-repair') repairs++;
      },
    },
  );
  try {
    const result = await solver.solve(obstacleQuery);
    assert.notEqual(result.route.status, 'complete');
    assert.equal(result.diagnostics.truncated, true);
    assert.equal(repairs, 0);
  } finally {
    await solver.close();
  }
});

test('an airborne interaction reached by supported walking retains its first goal event', async () => {
  const query = {
    ...obstacleQuery,
    goal: [8, 0.5, 1] as [number, number, number],
    interaction: { radius: 1.5, airborne: true },
  };
  const solver = await preparePhysicalSolver(input, {
    ...gangliaV1Defaults,
    maxCandidates: 0,
    maxShortcutCandidates: 0,
  });
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.goalHit);
    assert.ok(result.route.segments.every((s) => s.mode === 'walk'));
    const { createPhysicalWorld, createPhysicalVerifier } =
      await import('#@/src/evaluation/index.ts');
    const verified = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(verified.valid, true, JSON.stringify(verified));
  } finally {
    await solver.close();
  }
});

test('repair rebinds authored endpoint ownership while preserving its physical trajectory', async () => {
  const physical = obstructedNavigation();
  physical.ground.options.connections = [
    {
      id: 'around-wall',
      mode: 'rope',
      state: 'open',
      fromSurface: 'floor',
      toSurface: 'floor',
      endpointTolerance: 0.2,
      points: [
        [1, 0.005, 1],
        [1, 0.005, 8],
        [9, 0.005, 8],
        [9, 0.005, 1],
      ],
      times: [0, 2, 3, 5],
    },
  ];
  const solver = await preparePhysicalSolver(physical, {
    ...gangliaV1Defaults,
    maxCandidates: 0,
    maxShortcutCandidates: 0,
  });
  try {
    const result = await solver.solve(obstacleQuery);
    assert.equal(result.route.status, 'complete', JSON.stringify(result));
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.segments.some((s) => s.connection === 'around-wall'));
    const { createPhysicalWorld, createPhysicalVerifier } =
      await import('#@/src/evaluation/index.ts');
    const verified = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
      obstacleQuery,
      result.route,
    );
    assert.equal(verified.valid, true, JSON.stringify(verified));
  } finally {
    await solver.close();
  }
});
