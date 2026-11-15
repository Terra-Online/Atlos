import assert from 'node:assert/strict';
import { test } from 'node:test';

import { sweepSupports } from '#@/src/model/supports.ts';
import { prepareRouteSolver, gangliaV1Defaults, type PhysicalInput } from '#@/src/solver/index.ts';
import { groundPreparation, type GroundPlanner } from '#@/src/v1/route/ground.ts';
import { movementGeometry } from '#@/src/v1/route/movement-geometry.ts';
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
      // V1 returns navigation-space candidates; physical execution is evaluated separately.
      assert.deepEqual(first.route.points[0], query.starts[0].position);
      assert.deepEqual(first.route.points.at(-1), query.goal);
      assert.ok(first.route.cost > 3);
    }
    assert.equal(calls, 1);
    assert.deepEqual(await solver.solve(query), first);
    assert.equal(calls, 2);
  } finally {
    await solver.close();
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

test('ordinary planning keeps navigation proposals separate from independent physical acceptance', async () => {
  const physical = structuredClone(input);
  physical.ground.surfaces[0].vertices = physical.ground.surfaces[0].vertices.map(
    ([x, , z]): [number, number, number] => [x, 0.005, z],
  );
  physical.collision.positions = [
    ...physical.collision.positions,
    5,
    0,
    0,
    5,
    3,
    0,
    5,
    3,
    6,
    5,
    0,
    6,
  ];
  physical.collision.indices = [...physical.collision.indices, 4, 5, 6, 4, 6, 7];
  physical.ground.build = {
    bounds: { min: [0, 0], max: [10, 10] },
    cellSize: 0.1,
    cellHeight: 0.05,
  };
  const phases: unknown[] = [];
  const solver = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    {
      effort: 'walking',
      progress(progress) {
        phases.push(progress.phase);
      },
    },
  );
  const query = {
    starts: [
      {
        id: 'start',
        state: 'available' as const,
        cost: 0,
        position: [1, 0.005, 1] as [number, number, number],
      },
    ],
    goal: [9, 0.005, 1] as [number, number, number],
  };
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(Math.abs(result.route.length - 8) < 1e-9);
    assert.equal(phases.includes('physical-ground-repair'), false);
    assert.equal(phases.includes('local-ground-search'), false);
    const { createPhysicalWorld, createPhysicalVerifier } =
      await import('#@/src/evaluation/index.ts');
    const verified = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
      query,
      result.route,
    );
    assert.equal(verified.valid, false);
    assert.ok(verified.issues.some((issue) => issue.includes('Unsupported or obstructed walk')));
  } finally {
    await solver.close();
  }
});

test('physical solver observes event-loop cancellation at a stage boundary and remains reusable', async () => {
  const solver = await preparePhysicalSolver(input, gangliaV1Defaults);
  const controller = new AbortController();
  const query = {
    starts: [
      {
        id: 'start',
        position: [1, 0, 1] as [number, number, number],
        cost: 0,
        state: 'available' as const,
      },
    ],
    goal: [9, 0, 1] as [number, number, number],
  };
  let requested = false;
  try {
    await assert.rejects(
      solver.solve(query, {
        signal: controller.signal,
        onEvent(event) {
          if (event.type === 'progress' && !requested) {
            requested = true;
            setTimeout(() => controller.abort(), 0);
          }
        },
      }),
      /abort/i,
    );
    assert.equal(requested, true);
    assert.equal((await solver.solve(query)).route.status, 'complete');
  } finally {
    await solver.close();
  }
});

test('moving source admission uses the clearance-baked support and reuses its preparation', async () => {
  const physical = structuredClone(input);
  physical.ground.build = {
    bounds: { min: [0, 0], max: [10, 10] },
    cellSize: 0.2,
    cellHeight: 0.05,
  };
  const surfaces = [5, 0].map((height, index) => ({
    id: `lift/${index}`,
    vertices: [
      [2, height, 2],
      [2, height, 8],
      [8, height, 8],
      [8, height, 2],
    ] as [number, number, number][],
  }));
  physical.devices = {
    devices: [],
    ropes: [],
    movingSupports: [
      {
        id: 'lift',
        family: 'platform',
        level: 'fixture',
        model: 'fixture',
        assumption: 'phase-free-swept-support',
        surfaces,
        transfers: [{ from: [5, 5, 5], to: [5, 0, 5], speed: 1 }],
      },
    ],
  };
  const cache = createPhysicalCache();
  let builds = 0;
  const observed: PhysicalCache = {
    ...cache,
    async memo(slot, key, create, scope) {
      const prepared = await cache.memo(slot, key, create, scope);
      if (slot === 'moving' && !prepared.reused) builds++;
      return prepared;
    },
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const results: PhysicalResult[] = [];
    await solvePhysicalRoute(
      physical,
      {
        arrival: { id: 'player', state: 'available', cost: 0, position: [5, 5, 5] },
        target: [6, 5, 5],
        interaction: { radius: 0.35, maxVertical: 0.2 },
        walls: [],
      },
      {
        cache: observed,
        effort: 'devices',
        emit(result) {
          results.push(result);
        },
      },
      { ...gangliaV1Defaults, maxCandidates: 0 },
    );
    const completed = results.find((r) => r.route?.status === 'complete');
    assert.ok(completed?.route?.status === 'complete', JSON.stringify(results));
    assert.equal(completed.route.points[0][0], 5);
    assert.equal(completed.route.points[0][2], 5);
    assert.ok(Math.abs(completed.route.points[0][1] - 5) < 0.5);
  }
  assert.equal(builds, 1);
  cache.clear();
  const blocked = structuredClone(physical);
  blocked.ground.options.walls = [{ min: [4, 5, 4], max: [6, 7, 6], state: 'active' }];
  const rejected: PhysicalResult[] = [];
  await solvePhysicalRoute(
    blocked,
    {
      arrival: { id: 'player', state: 'available', cost: 0, position: [5, 5, 5] },
      target: [6, 5, 5],
      interaction: { radius: 0.35, maxVertical: 0.2 },
      walls: [],
    },
    {
      effort: 'devices',
      emit(result) {
        rejected.push(result);
      },
    },
    { ...gangliaV1Defaults, maxCandidates: 0 },
  );
  assert.equal(rejected.at(-1)!.reason, 'arrival-unmapped');
  assert.equal(
    rejected.some((result) => result.route?.status === 'complete'),
    false,
  );
});

test('moving admission preserves static fast paths and rejects unavailable or unsupported origins', async () => {
  const physical = structuredClone(input);
  physical.ground.build = {
    bounds: { min: [0, 0], max: [10, 10] },
    cellSize: 0.2,
    cellHeight: 0.05,
  };
  physical.devices = {
    devices: [],
    ropes: [],
    movingSupports: [
      {
        id: 'lift',
        family: 'platform',
        level: 'fixture',
        model: 'fixture',
        assumption: 'phase-free-swept-support',
        surfaces: [
          {
            id: 'lift/0',
            vertices: [
              [2, 5, 2],
              [2, 5, 8],
              [8, 5, 8],
              [8, 5, 2],
            ],
          },
        ],
        poses: [{ min: [0, 0, 0], max: [10, 5, 10] }],
        transfers: [],
      },
    ],
  };
  for (const scenario of [
    { position: [1, 0, 1], state: 'available', reason: undefined },
    { position: [9, 5, 9], state: 'available', reason: 'arrival-unmapped' },
    { position: [5, 5, 5], state: 'locked', reason: 'arrival-unavailable' },
    { position: [5, 5, 5], state: 'available', absent: true, reason: 'arrival-unmapped' },
  ] as const) {
    const snapshot = scenario.absent ? { ...physical, devices: null } : physical;
    let moving = 0;
    const cache: PhysicalCache = {
      release() {},
      async memo(slot, _key, create) {
        if (slot === 'moving') moving++;
        return { value: await create(), reused: false };
      },
    };
    const results: PhysicalResult[] = [];
    await solvePhysicalRoute(
      snapshot,
      {
        arrival: { id: 'player', state: scenario.state, cost: 0, position: [...scenario.position] },
        target: [2, 0, 1],
        walls: [],
      },
      {
        cache,
        effort: 'walking',
        emit(result) {
          results.push(result);
        },
      },
      gangliaV1Defaults,
    );
    const result = results.at(-1)!;
    if (scenario.reason) assert.equal(result.reason, scenario.reason);
    else assert.equal(result.route?.status, 'complete');
    assert.equal(moving, 0);
  }
});

test('direct provider rides preserve resources, annotations and exact arrival gates', async () => {
  const [
    { prepareMovingDirect },
    { createPhysicalWorld, createPhysicalVerifier },
    { createCollisionWorld },
    { createGoalProjector },
  ] = await Promise.all([
    import('#@/src/v1/solver/physical/moving-direct.ts'),
    import('#@/src/evaluation/index.ts'),
    import('#@/src/model/collision.ts'),
    import('#@/src/model/goals.ts'),
  ]);
  const physical = structuredClone(input);
  physical.ground.build = {
    bounds: { min: [0, 0], max: [10, 10] },
    cellHeight: 0.05,
    cellSize: 0.2,
  };
  const body = (height: number): [number, number, number][] =>
    Array.from({ length: 8 }, (_, bits) => [
      bits & 1 ? 8 : 2,
      bits & 2 ? height : height - 0.5,
      bits & 4 ? 8 : 2,
    ]);
  physical.devices = {
    devices: [],
    ropes: [],
    movingSupports: [
      {
        id: 'lift',
        family: 'platform',
        level: 'fixture',
        model: 'fixture',
        assumption: 'phase-free-swept-support',
        ...sweepSupports('lift', [[body(5)], [body(7)]], 1),
      },
    ],
  };
  physical.locomotion = {
    ...physical.locomotion,
    stamina: {
      capacity: 8,
      initial: 8,
      activationCost: 1,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
    dash: { speed: 3, duration: 0.3, cooldown: 0.8, cost: 1 },
  };
  const create = (scene: PhysicalInput, walls = scene.ground.options.walls) =>
    prepareMovingDirect(
      scene,
      { geometry: scene.collision, world: createCollisionWorld(scene.collision) },
      walls,
      createGoalProjector(scene.ground.surfaces),
    );
  const request = {
    arrival: {
      id: 'player',
      state: 'available' as const,
      cost: 0,
      position: [5, 5, 5] as [number, number, number],
    },
    target: [5, 7, 5] as [number, number, number],
    interaction: { radius: 0.35, maxVertical: 0.2 },
    walls: [],
  };
  const direct = create(physical),
    result = direct.plan(request);
  assert.ok(result.route.status === 'complete');
  assert.equal(result.route.cost, 2);
  assert.deepEqual(
    result.route.segments.map((s) => s.mode),
    ['rope'],
  );
  assert.equal(result.route.schedule?.length, 1);
  assert.equal(result.route.locomotion?.dashes, 0);
  assert.equal(
    createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
      { starts: [request.arrival], goal: request.target, interaction: request.interaction },
      result.route,
    ).valid,
    true,
  );
  assert.ok(direct.annotate(result.route, result.connections).length >= 2);
  const airborne = { ...request, interaction: { radius: 0.5, airborne: true } };
  const airborneReplay = createPhysicalVerifier(() => [createPhysicalWorld(physical, 'complete')])(
    { starts: [request.arrival], goal: request.target, interaction: airborne.interaction },
    result.route,
  );
  assert.equal(airborneReplay.valid, false);
  assert.match(
    airborneReplay.issues.join(),
    /Airborne collection must stop at the first goal event/,
  );
  assert.equal(direct.plan(airborne).route.status, 'unmapped');

  const reverse = direct.plan({
    ...request,
    arrival: { ...request.arrival, position: [5, 7, 5] },
    target: [5, 5, 5],
  });
  assert.ok(reverse.route.status === 'complete');
  assert.equal(reverse.route.segments[0].connection, 'moving-ride/lift/0/reverse');
  const nativeInput = structuredClone(physical);
  const bound = {
    ...result.connections[0],
    id: 'bound-ride',
    points: [
      [5.2, 5.01, 5],
      [5.2, 7.01, 5],
    ] as [number, number, number][],
    times: [0, 1],
  };
  nativeInput.ground.options.connections = [bound];
  const competing = await preparePhysicalSolver(
    nativeInput,
    { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    { effort: 'devices' },
  );
  const cheaper = await competing.solve({
    starts: [request.arrival],
    goal: request.target,
    interaction: request.interaction,
  });
  assert.ok(cheaper.route.status === 'complete');
  assert.ok(
    cheaper.route.cost < result.route.cost,
    'the native device stage may improve the first direct candidate',
  );
  assert.ok(cheaper.route.segments.some((segment) => segment.connection === bound.id));
  await competing.close();
  const staged = structuredClone(physical);
  staged.devices!.movingSupports![0] = {
    ...staged.devices!.movingSupports![0],
    ...sweepSupports('lift', [[body(5)], [body(5.4)], [body(7)]], 1),
  };
  const stages = create(staged);
  const first = stages.plan(request, new Set([0]));
  assert.ok(first.route.status === 'complete');
  assert.equal(first.route.cost, 2);
  assert.equal(first.route.segments[0].connection, 'moving-ride/lift/0');
  const tie = stages.plan(
    { ...request, arrival: { ...request.arrival, position: [5, 5.21, 5] } },
    new Set([0]),
  );
  assert.ok(tie.route.status === 'complete');
  assert.equal(tie.route.segments[0].connection, 'moving-ride/lift/0');
  assert.notEqual(stages.plan(request, new Set([1])).route.status, 'complete');
  const cache = createPhysicalCache();
  let collisionBuilds = 0,
    movingBuilds = 0;
  const observed: PhysicalCache = {
    ...cache,
    async memo(slot, key, create, scope) {
      const prepared = await cache.memo(slot, key, create, scope);
      if (!prepared.reused && slot === 'collision') collisionBuilds++;
      if (!prepared.reused && slot === 'moving') movingBuilds++;
      return prepared;
    },
  };
  const reused: unknown[] = [];
  const solver = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 0 },
    {
      cache: observed,
      effort: 'devices',
      observe(_r, _o, d) {
        reused.push((d as { prepareReuse: { direct?: boolean } }).prepareReuse.direct);
      },
    },
  );
  const query = {
    starts: [request.arrival],
    goal: request.target,
    interaction: request.interaction,
  };
  for (let attempt = 0; attempt < 2; attempt++) {
    const candidate = await solver.solve(query);
    assert.equal(candidate.route.status, 'complete');
    assert.equal(candidate.route.status === 'complete' && candidate.route.cost, 2);
  }
  assert.equal(reused[0], false);
  assert.equal(reused.at(-1), true);
  assert.equal(collisionBuilds, 1);
  assert.equal(movingBuilds, 1);
  await solver.close();
  cache.clear();
  const walkingOnly = await preparePhysicalSolver(
    physical,
    { ...gangliaV1Defaults, maxCandidates: 0 },
    { effort: 'walking' },
  );
  assert.notEqual((await walkingOnly.solve(query)).route.status, 'complete');
  await walkingOnly.close();
  const allPhases: unknown[] = [];
  const all = await preparePhysicalSolver(
    physical,
    {
      ...gangliaV1Defaults,
      maxCandidates: 0,
      maxShortcutCandidates: 0,
    },
    { progress: (event) => allPhases.push(event.phase) },
  );
  const improved = await all.solve(query);
  assert.ok(improved.route.status === 'complete');
  assert.equal(improved.route.cost, 2);
  assert.ok(
    !allPhases.includes('narrow-supports'),
    'a direct incumbent bypasses missing-support fallback',
  );
  await all.close();
  const { createWindowRoute } = await import('#@/src/v1/solver/window-route.ts');
  type Job = { status: 'ready'; result?: import('#@/src/solver/contract.ts').RouteResult };
  const windowCache = createPhysicalCache(),
    hintCounts: number[] = [],
    steps: number[] = [];
  const window = createWindowRoute<import('#@/src/solver/resources.ts').WindowRequest, Job>(
    {
      query: async () => ({ status: 'ready' }),
      key: () => 'moving-fixture',
      ground: async () => physical.ground,
      route: (job) => job.result ?? {},
      async solve(job, local, _start, work, options) {
        hintCounts.push(local.waypoints?.length ?? 0);
        steps.push(work.step);
        const solver = await preparePhysicalSolver(
          physical,
          { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
          {
            cache: windowCache,
            effort: work.step === 0 ? 'walking' : work.step === 1 ? 'devices' : 'all',
          },
        );
        try {
          return {
            ...job,
            result: await solver.solve(
              {
                starts: [local.arrival],
                goal: local.target,
                interaction: local.interaction,
                waypoints: local.waypoints,
              },
              { signal: options?.signal },
            ),
          };
        } finally {
          await solver.close();
        }
      },
    },
    { scene: 'fixture', source: {}, ...request },
    [request.arrival.position, [5, 6, 5], request.target],
    { tileSpan: 38.4, gridSpan: 32, maxTiles: 16, margin: 8, locomotion: physical.locomotion },
  );
  let windowResult = await window.advance();
  for (let i = 0; i < 10 && windowResult.status === 'pending'; i++)
    windowResult = await window.advance();
  assert.equal(windowResult.status, 'complete');
  assert.ok(
    hintCounts.every((count) => count > 0),
    'window-generated discovery hints remain nonempty',
  );
  assert.ok(steps.includes(1), 'the devices stage reaches the direct provider graph');
  if (windowResult.status === 'complete')
    assert.deepEqual(
      windowResult.route.segments.map((s) => s.mode),
      ['rope'],
    );
  windowCache.clear();

  assert.notEqual(
    direct.plan({ ...request, arrival: { ...request.arrival, state: 'locked' } }).route.status,
    'complete',
  );
  assert.notEqual(
    direct.plan({ ...request, arrival: { ...request.arrival, position: [5.1, 5, 5] } }).route
      .status,
    'complete',
  );
  assert.notEqual(direct.plan({ ...request, target: [9, 7, 5] }).route.status, 'complete');
  assert.notEqual(
    create(physical, [{ min: [4, 5, 4], max: [6, 8, 6], state: 'active' }]).plan(request).route
      .status,
    'complete',
  );
  const blocked = structuredClone(physical);
  blocked.devices!.followingSupports = [
    {
      id: 'box',
      level: 'fixture',
      model: 'fixture',
      spawn: [5, 4.5, 5],
      bodies: [body(8)],
      geometryKind: 'box',
      maxDistance: 5,
      initialState: 0,
      assumption: 'placement-within-activity-range',
    },
  ];
  assert.notEqual(create(blocked).plan(request).route.status, 'complete');
  const unknown = structuredClone(physical);
  unknown.devices!.movingSupports![0].transfers.forEach((t) => (t.speed = null));
  assert.notEqual(create(unknown).plan(request).route.status, 'complete');
  const tilted = structuredClone(physical);
  const deck = tilted.devices!.movingSupports![0];
  deck.family = 'seesaw';
  deck.surfaces = [
    {
      id: 'tilted-deck',
      vertices: [
        [2, 5, 2],
        [2, 5, 8],
        [8, 7, 8],
        [8, 7, 2],
      ],
    },
  ];
  deck.surfacePoses = [[{ body: 0, fromPose: 0, toPose: 0 }]];
  deck.transfers = [];
  const slopeRequest = {
    ...request,
    arrival: { ...request.arrival, position: [3, 5 + 1 / 3, 4] as [number, number, number] },
    target: [7, 5 + 5 / 3, 4] as [number, number, number],
  };
  const slope = create(tilted).plan(slopeRequest);
  assert.ok(slope.route.status === 'complete');
  assert.ok(slope.route.segments.every((segment) => segment.mode === 'walk'));
  assert.equal(
    createPhysicalVerifier(() => [createPhysicalWorld(tilted, 'complete')])(
      {
        starts: [slopeRequest.arrival],
        goal: slopeRequest.target,
        interaction: slopeRequest.interaction,
      },
      slope.route,
    ).valid,
    true,
  );
  assert.notEqual(
    create(tilted, [{ min: [4, 4, 3], max: [6, 9, 5], state: 'active' }]).plan(slopeRequest).route
      .status,
    'complete',
  );
  deck.surfacePoses = [[{ body: 0, fromPose: 0, toPose: 1 }]];
  assert.notEqual(create(tilted).plan(slopeRequest).route.status, 'complete');
  const circular = structuredClone(physical);
  circular.devices!.movingSupports![0].circular = {
    center: [5, 6, 5],
    axis: [0, 0, 1],
    radius: 1,
    halfWidth: 0.2,
    sagitta: 0.01,
  };
  assert.notEqual(create(circular).plan(request).route.status, 'complete');
});
