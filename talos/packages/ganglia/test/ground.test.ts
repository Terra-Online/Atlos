import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Portal, Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { createWallChecker } from '#@/src/model/walls.ts';
import type { GroundArrival, GroundConnection, GroundOptions } from '#@/src/route.ts';
import { surfaceGraph } from '#@/src/v1/geo/surfaces.ts';
import { createGroundPlanner, planGroundRoute, groundPreparation } from '#@/src/v1/route/ground.ts';
import { prepareRoutePlanner, route } from '#@/src/v1/route/routes.ts';
const surfaces: Surface[] = [
  {
    id: 'a',
    vertices: [
      [0, 0, 0],
      [2, 0, 0],
      [2, 0, 2],
      [0, 0, 2],
    ],
  },
  {
    id: 'b',
    vertices: [
      [2, 0, 0],
      [4, 0, 0],
      [4, 0, 2],
      [2, 0, 2],
    ],
  },
  {
    id: 'island',
    vertices: [
      [5, 0, 0],
      [6, 0, 0],
      [6, 0, 2],
      [5, 0, 2],
    ],
  },
];
const options = { speed: 1, maxVertical: 0.5, walls: [], profile: { radius: 0.4, height: 2 } };
test('compares grounded teleport arrivals and preserves the actual endpoints', () => {
  const result = planGroundRoute(
    surfaces,
    [
      { id: 'near-island', position: [5.1, 0, 1], cost: 0, state: 'available' },
      { id: 'locked', position: [3.5, 0, 1], cost: 0, state: 'locked' },
      { id: 'base', position: [0.2, 0.1, 1], cost: 2, state: 'available' },
    ],
    [3.8, 0.1, 1],
    options,
  );
  assert.ok(result.status === 'complete');
  assert.equal(result.start, 'base');
  assert.deepEqual(result.points[0], [0.2, 0, 1]);
  assert.deepEqual(result.points.at(-1), [3.8, 0, 1]);
  assert.ok(Math.abs(result.cost - 5.6) < 1e-8);
  assert.equal(planGroundRoute(surfaces, [], [4.5, 0, 1], options).status, 'unmapped');
});
test('same-polygon shortcuts and stationary paths still obey wall exclusions', () => {
  const wall: Wall = { min: [0.9, -1, 0], max: [1.1, 3, 2], state: 'unknown' };
  const start: GroundArrival = { id: 'player', position: [0.2, 0, 1], cost: 0, state: 'available' };
  const result = planGroundRoute(surfaces, [start], [1.8, 0, 1], options);
  assert.ok(result.status === 'complete');
  assert.deepEqual(result.points, [
    [0.2, 0, 1],
    [1.8, 0, 1],
  ]);
  assert.equal(
    planGroundRoute(surfaces, [start], [1.8, 0, 1], { ...options, walls: [wall] }).status,
    'no-verified-route',
  );
  assert.equal(
    route({ nodes: [{ id: 'a', position: [1, 0, 1] }], edges: [] }, 'a', 'a', {
      walls: [wall],
      profile: options.profile,
    }).status,
    'no-verified-route',
  );
});

test('continuous support corridors can bypass blocked graph centres while retaining exclusions', () => {
  const rectangle = (
    id: string,
    left: number,
    right: number,
    near: number,
    far: number,
  ): Surface => ({
    id,
    vertices: [
      [left, 0, near],
      [right, 0, near],
      [right, 0, far],
      [left, 0, far],
    ],
  });
  const ground: Surface[] = [
    rectangle('entry', 0, 4, 0, 2),
    rectangle('turn', 4, 6, 0, 2),
    rectangle('exit', 4, 6, 2, 6),
  ];
  const starts: GroundArrival[] = [
    { id: 'player', position: [0.5, 0, 0.5], cost: 0, state: 'available' },
  ];
  const constraints: GroundOptions = {
    ...options,
    profile: { radius: 0.1, height: 2 },
    walls: [{ min: [1.8, -1, 0.9], max: [2.2, 3, 1.1], state: 'unknown' }],
  };
  const result = planGroundRoute(ground, starts, [5.5, 0, 5.5], constraints);
  assert.ok(result.status === 'complete');
  assert.ok(result.points.some((point) => point[0] >= 4 && point[2] <= 2));
  assert.equal(
    planGroundRoute(ground, starts, [5.5, 0, 5.5], {
      ...constraints,
      walls: [{ min: [1.8, -1, -1], max: [2.2, 3, 3], state: 'unknown' }],
    }).status,
    'no-verified-route',
  );
});

test('prepared action queries preserve explicit support faces across overlapping navigation', () => {
  const floor = (
    id: string,
    left: number,
    right: number,
    height: number,
    portals?: number[],
  ): Surface => ({
    id,
    portals,
    vertices: [
      [left, height, 0],
      [right, height, 0],
      [right, height, 2],
      [left, height, 2],
    ],
  });
  const scene: Surface[] = [
    floor('shadow', 2, 4, 0.3, []),
    floor('source', 0, 4, 0),
    floor('target', 7, 11, 4),
  ];
  const planner = createGroundPlanner(scene, options);
  const starts: GroundArrival[] = [
    { id: 'player', position: [1, 0, 1], state: 'available', cost: 0 },
  ];
  const connection: GroundConnection = {
    id: 'jump',
    mode: 'jump',
    state: 'open',
    points: [
      [3, 0.305, 1],
      [8, 4, 1],
    ],
    times: [0, 1],
    endpointTolerance: 0.35,
    fromSurface: 'source',
    toSurface: 'target',
  };
  assert.equal(planner.plan(starts, [10, 4, 1], { connections: [connection] }).status, 'complete');
  assert.notEqual(planner.plan(starts, [10, 4, 1], { connections: [] }).status, 'complete');
  const { fromSurface, toSurface, ...unbound } = connection;
  assert.notEqual(planner.plan(starts, [10, 4, 1], { connections: [unbound] }).status, 'complete');
  assert.throws(
    () =>
      planner.plan(starts, [10, 4, 1], {
        connections: [{ ...connection, toSurface: 'missing' }],
      }),
    /support surface/,
  );
});

test('prepared queries straighten arbitrary endpoints and apply continuous sprint timing', async () => {
  const { createGroundPlanner } = await import('#@/src/solver/host.ts');
  const planner = createGroundPlanner(surfaces, {
    ...options,
    locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 4 },
  });
  for (const z of [0.2, 0.7, 1.5]) {
    const start: GroundArrival = {
      id: 'player',
      position: [0.2, 0, z],
      cost: 0,
      state: 'available',
    };
    const result = planner.plan([start], [3.8, 0, z]);
    assert.ok(result.status === 'complete');
    assert.ok(result.points.every((p) => Math.abs(p[2] - z) < 1e-7));
    assert.ok(Math.abs(result.length - 3.6) < 1e-7);
    assert.ok(result.cost < 3.6);
    assert.equal(result.segments[0].gait, 'sprint');
    const stationary = planner.plan([start], start.position);
    assert.ok(stationary.status === 'complete');
    assert.equal(stationary.cost, 0);
    assert.deepEqual(stationary.points, [start.position]);
  }
});

test('interaction queries end on reachable standing ground within an explicit volume', async () => {
  const { createGroundPlanner } = await import('#@/src/solver/host.ts');
  const planner = createGroundPlanner(
    [
      {
        id: 'floor',
        vertices: [
          [0, 0, 0],
          [4, 0, 0],
          [4, 0, 4],
          [0, 0, 4],
        ],
      },
      {
        id: 'platform',
        vertices: [
          [1, 1, 1],
          [2, 1, 1],
          [2, 1, 2],
          [1, 1, 2],
        ],
      },
    ],
    options,
  );
  const starts: GroundArrival[] = [
    { id: 'player', position: [0.5, 0, 0.5], cost: 0, state: 'available' },
  ];
  assert.equal(planner.plan(starts, [1.5, 1, 1.5]).status, 'no-verified-route');
  const result = planner.plan(starts, [1.5, 1, 1.5], { interaction: { radius: 1.5 } });
  assert.ok(result.status === 'complete');
  assert.equal(result.points.at(-1)![1], 0);
  assert.ok(Math.hypot(...result.points.at(-1)!.map((v, i) => v - [1.5, 1, 1.5][i])) <= 1.5);
});

test('an initially unmapped query still permits later tracing on overlapping supports', () => {
  const rectangle = (
    id: string,
    left: number,
    right: number,
    near: number,
    far: number,
  ): Surface => ({
    id,
    vertices: [
      [left, 0, near],
      [right, 0, near],
      [right, 0, far],
      [left, 0, far],
    ],
  });
  const planner = createGroundPlanner(
    [rectangle('small', 0, 2, -0.5, 0.5), rectangle('large', -1, 10, -2, 2)],
    { ...options, speed: 5 },
  );
  const starts: GroundArrival[] = [
    { id: 'player', position: [1, 0, 0], cost: 0, state: 'available' },
  ];
  assert.equal(planner.plan(starts, [9, 10, 0]).status, 'unmapped');
  const result = planner.plan(starts, [9, 0, 0]);
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 1.6);
  assert.deepEqual(result.points, [
    [1, 0, 0],
    [9, 0, 0],
  ]);
  const idle: GroundConnection = {
    id: 'idle',
    mode: 'rope',
    state: 'open',
    points: [
      [1, 0, 0],
      [1, 0, 0],
    ],
    times: [0, 1],
  };
  const withActions = planner.plan(starts, [9, 0, 0], { connections: [idle] });
  assert.ok(withActions.status === 'complete');
  assert.equal(withActions.cost, 1.6);
});

test('many disconnected device supports retain only the supplied transfers between islands', () => {
  const islands: Surface[] = Array.from({ length: 80 }, (_, i) => ({
    id: String(i),
    vertices: [
      [i * 3, 0, 0],
      [i * 3 + 1, 0, 0],
      [i * 3 + 1, 0, 1],
      [i * 3, 0, 1],
    ],
  }));
  const connections: GroundConnection[] = islands.slice(1).map((_, i) => ({
    id: 'ride/' + i,
    mode: 'rope',
    state: 'open',
    points: [
      [i * 3 + 0.5, 0, 0.5],
      [(i + 1) * 3 + 0.5, 0, 0.5],
    ],
    times: [0, 1],
  }));
  const planner = createGroundPlanner(islands, options);
  const starts: GroundArrival[] = [
    { id: 'first', position: [0.5, 0, 0.5], cost: 0, state: 'available' },
  ];
  const result = planner.plan(starts, [237.5, 0, 0.5], { connections });
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 79);
  assert.equal(
    planner.plan(starts, [237.5, 0, 0.5], { connections: connections.slice(1) }).status,
    'no-verified-route',
  );
});

const observeVisibility = (planner: ReturnType<typeof createGroundPlanner>) => {
  const { straighten } = groundPreparation(planner)!,
    calls: { from: number[]; to: number[]; result: Vec3[] | null }[] = [];
  const trace = straighten.trace;
  straighten.trace = (from, to) => {
    const result = trace(from, to);
    calls.push({ from: [...from], to: [...to], result });
    return result;
  };
  return calls;
};

test('failed visibility is reused for live endpoints across target changes', () => {
  const square = (id: string, x: number, z: number): Surface => ({
    id,
    vertices: [
      [x, 0, z],
      [x + 2, 0, z],
      [x + 2, 0, z + 2],
      [x, 0, z + 2],
    ],
  });
  const scene: Surface[] = [
    square('left', 0, 0),
    square('left-turn', 0, 2),
    square('bridge', 2, 2),
    square('right-turn', 4, 2),
    square('right', 4, 0),
  ];
  const planner = createGroundPlanner(scene, options),
    calls = observeVisibility(planner);
  const starts: GroundArrival[] = [
    { id: 'player', position: [1, 0, 1], cost: 0, state: 'available' },
  ];
  const goal: Vec3 = [5, 0, 1],
    point: Vec3 = [0.5, 0, 0.5];
  const idle: GroundConnection = {
    id: 'idle',
    mode: 'rope',
    state: 'open',
    points: [point, point],
    times: [0, 1],
  };
  const extra: GroundConnection = {
    ...idle,
    id: 'extra',
    points: [
      [1.5, 0, 0.5],
      [1.5, 0, 0.5],
    ],
  };
  const check = (connections: GroundConnection[], target = goal) => {
    const query: Parameters<typeof planner.plan>[2] = { connections };
    const actual = planner.plan(starts, target, query);
    assert.deepEqual(actual, createGroundPlanner(scene, options).plan(starts, target, query));
    assert.ok(actual.status === 'complete');
    return actual;
  };
  // Both ends share one weak component, but their straight line crosses the gap.
  assert.equal(groundPreparation(planner)!.straighten.mayConnect(starts[0].position, goal), true);
  assert.ok(check([idle]).cost > 4);
  assert.equal(calls.length, 4);
  assert.ok(calls.every((call) => call.result === null));
  check([{ ...idle, points: idle.points.map((p) => [...p]) }]);
  assert.equal(calls.length, 4);
  check([idle, extra]);
  assert.equal(calls.length, 6);
  check([extra]);
  assert.equal(calls.length, 6);
  check([idle, extra]);
  assert.equal(calls.length, 8); // Restoring the removed point retraces both directions.
  point[2] = 1.5;
  check([idle, extra]);
  assert.equal(calls.length, 10);
  point[2] = 0.5;
  check([idle, extra]);
  assert.equal(calls.length, 12);
  // A target-height change projects to the same support. Fresh planners agree,
  // and the unchanged directional failure proofs remain valid.
  check([idle, extra], [5, 0.1, 1]);
  assert.equal(calls.length, 12);
  check([idle, extra]);
  assert.equal(calls.length, 12);
});

test('a cached reverse visibility failure preserves the valid one-way ground passage', () => {
  const scene: Surface[] = [
    {
      id: 'lower',
      vertices: [
        [0, 0, 0],
        [1, 0, 0],
        [1, 0, 1],
        [0, 0, 1],
      ],
      portals: [],
    },
    {
      id: 'upper',
      vertices: [
        [1, 0.2, 0],
        [2, 0.2, 0],
        [2, 0.2, 1],
        [1, 0.2, 1],
      ],
      portals: [],
    },
  ];
  const portal: Portal = {
    from: 'lower',
    to: 'upper',
    points: [
      [1, 0, 0.5],
      [1, 0.2, 0.5],
    ],
    entry: [
      [1, 0, 0],
      [1, 0, 1],
    ],
    exit: [
      [1, 0.2, 0],
      [1, 0.2, 1],
    ],
  };
  const constraints: GroundOptions = { ...options, portals: [portal] };
  const planner = createGroundPlanner(scene, constraints),
    calls = observeVisibility(planner);
  const starts: GroundArrival[] = [
    { id: 'player', position: [0.5, 0, 0.5], cost: 0, state: 'available' },
  ];
  const goal: Vec3 = [1.5, 0.2, 0.5];
  const idle: GroundConnection = {
    id: 'idle',
    mode: 'rope',
    state: 'open',
    points: [starts[0].position, starts[0].position],
    times: [0, 1],
  };
  const query: Parameters<typeof planner.plan>[2] = { connections: [idle] };
  const expected = createGroundPlanner(scene, constraints).plan(starts, goal, query);
  assert.ok(expected.status === 'complete');
  assert.deepEqual(planner.plan(starts, goal, query), expected);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], { from: goal, to: starts[0].position, result: null });
  assert.deepEqual(calls[1].result, [
    [0.5, 0, 0.5],
    [1, 0, 0.5],
    [1, 0.2, 0.5],
    [1.5, 0.2, 0.5],
  ]);
  assert.deepEqual(planner.plan(starts, goal, query), expected);
  assert.equal(calls.length, 2);
});

test('fixed device transfers survive target changes and expire with removed endpoints', () => {
  const scene: Surface[] = surfaces.slice(0, 2);
  const starts: GroundArrival[] = [
    { id: 'player', position: [0.5, 0, 1], state: 'available', cost: 0 },
  ];
  const a: Vec3 = [1, 0, 0.5],
    b: Vec3 = [3, 0, 0.5];
  const idle = (id: string, point: Vec3): GroundConnection => ({
    id,
    mode: 'rope',
    state: 'open',
    points: [point, point],
    times: [0, 1],
  });
  const connections: GroundConnection[] = [idle('a', a), idle('b', b)];
  const planner = createGroundPlanner(scene, options),
    calls = observeVisibility(planner);
  const check = (target: Vec3, edges = connections) => {
    const actual = planner.plan(starts, target, { connections: edges });
    assert.deepEqual(
      actual,
      createGroundPlanner(scene, options).plan(starts, target, { connections: edges }),
    );
    assert.ok(actual.status === 'complete');
  };
  const fixed = () =>
    calls.filter(
      (call) =>
        JSON.stringify(call.from) === JSON.stringify(a) &&
        JSON.stringify(call.to) === JSON.stringify(b),
    );
  check([3.5, 0, 1.5]);
  assert.equal(fixed().length, 1);
  assert.ok(fixed()[0].result);
  check([3.2, 0, 1.5]);
  assert.equal(fixed().length, 1);
  check([3.5, 0, 1.5], connections.slice(1));
  check([3.2, 0, 1.5]);
  assert.equal(fixed().length, 2);
  assert.equal(planner.plan(starts, [3.2, 10, 1.5]).status, 'unmapped');
  check([3.2, 0, 1.5]);
  assert.equal(fixed().length, 3);
});

test('an ordinary interaction can finish at a complete supported device exit', async () => {
  const { createPhysicalWorld, createPhysicalVerifier } =
    await import('#@/src/evaluation/index.ts');
  const floors: Surface[] = [
    {
      id: 'lower',
      vertices: [
        [0, 0.1, 0],
        [0, 0.1, 4],
        [4, 0.1, 4],
        [4, 0.1, 0],
      ],
    },
    {
      id: 'upper',
      vertices: [
        [6, 5.1, 0],
        [6, 5.1, 4],
        [10, 5.1, 4],
        [10, 5.1, 0],
      ],
    },
  ];
  const rope: GroundConnection = {
    id: 'rope',
    mode: 'rope',
    state: 'open',
    endpointTolerance: 0.2,
    points: [
      [2, 0.01, 2],
      [2, 0.01, 2],
      [2, 5.11, 2],
      [8, 5.11, 2],
      [8, 5.01, 2],
    ],
    times: [0, 0.5, 1.5, 2.5, 2.6],
  };
  const locomotion = {
    speed: 5,
    sprintSpeed: 8,
    sprintAcceleration: 10,
    stamina: {
      capacity: 8,
      initial: 8,
      activationCost: 1,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
    dash: { speed: 10, duration: 0.3, cooldown: 0.8, cost: 1 },
  };
  const settings = {
    speed: 5,
    maxVertical: 0.5,
    walls: [],
    profile: { radius: 0.2, height: 1.6 },
    locomotion,
    connections: [rope],
  };
  const starts: GroundArrival[] = [
    { id: 'player', position: [2, 0.1, 2], cost: 0, state: 'available' },
  ];
  const goal: Vec3 = [8, 5.5, 2],
    interaction = { radius: 1 };
  const planner = createGroundPlanner(floors, settings);
  const result = planner.plan(starts, goal, { interaction });
  assert.ok(result.status === 'complete');
  assert.equal(result.segments.at(-1)!.mode, 'rope');
  assert.deepEqual(result.segments.at(-1)!.points, rope.points);
  assert.deepEqual(result.segments.at(-1)!.times, rope.times);
  assert.deepEqual(result.points.at(-1), rope.points.at(-1));
  const collision = floors.map((surface) =>
    surface.vertices.map(([x, y, z]): Vec3 => [x, y - 0.1, z]),
  );
  const world = createPhysicalWorld(
    {
      ground: { surfaces: floors, options: settings },
      collision: { positions: collision.flat(2), indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7] },
      movement: {
        model: {
          gravity: 10,
          fallingGravity: 10,
          maxJumpHeight: 1,
          maxFallingSpeed: 10,
          apexTime: 0,
          maxHorizontalSpeed: 5,
          startHorizontalSpeed: 5,
          airOverspeedDeceleration: 10,
          airAcceleration: 20,
          airDeceleration: 20,
        },
        maxSlope: 45,
        runAirSpeed: 5,
        stepUp: 0.4,
        stepDown: 0.5,
      },
      locomotion,
    },
    'complete',
  );
  const evaluation = createPhysicalVerifier(() => [world])({ starts, goal, interaction }, result);
  assert.equal(evaluation.valid, true, JSON.stringify(evaluation));
  assert.ok(
    Math.abs(evaluation.costSeconds! - (rope.times.at(-1)! + 0.005 / locomotion.speed)) < 1e-9,
  );
  const narrowGoal = rope.points.at(-1)!,
    narrowInteraction = { radius: 0.01 };
  const narrow = planner.plan(starts, narrowGoal, { interaction: narrowInteraction });
  assert.ok(narrow.status === 'complete');
  assert.deepEqual(narrow.segments.at(-1)!.points, rope.points);
  assert.deepEqual(narrow.segments.at(-1)!.times, rope.times);
  const narrowEvaluation = createPhysicalVerifier(() => [world])(
    { starts, goal: narrowGoal, interaction: narrowInteraction },
    narrow,
  );
  assert.equal(narrowEvaluation.valid, true, JSON.stringify(narrowEvaluation));
  assert.equal(
    planner.plan(starts, narrowGoal, {
      interaction: { ...narrowInteraction, airborne: true },
    }).status,
    'unmapped',
  );
  assert.equal(
    planner.plan(starts, narrowGoal, {
      interaction: narrowInteraction,
      connections: [{ ...rope, state: 'closed' }],
    }).status,
    'unmapped',
  );
  for (const query of [
    {},
    { interaction: { radius: 0.1 } },
    { interaction: { radius: 1, airborne: true } },
    { interaction: { radius: 1, maxVertical: 0.45 } },
    { interaction: { radius: 1, facing: [1, 0, 0] as Vec3, halfAngle: 30 } },
  ]) {
    const target: Vec3 = query.interaction?.facing
      ? [8.5, 5.5, 2]
      : query.interaction?.radius === 0.1
        ? [9.5, 5.1, 2]
        : query.interaction
          ? goal
          : [8, 5.1, 2];
    const unchanged = planner.plan(starts, target, query);
    assert.ok(unchanged.status === 'complete', JSON.stringify({ target, query, unchanged }));
    assert.equal(unchanged.segments.at(-1)!.mode, 'walk');
  }
  assert.notEqual(
    planner.plan(starts, goal, { interaction, connections: [{ ...rope, state: 'closed' }] }).status,
    'complete',
  );
});

test('createGroundPlanner incremental wall overlay matches full prepareRoutePlanner across wall kinds, inactive walls, views, and long imported portals', () => {
  const tile = (
    id: string,
    x0: number,
    x1: number,
    y: number,
    z0: number,
    z1: number,
  ): Surface => ({
    id,
    vertices: [
      [x0, y, z0],
      [x1, y, z0],
      [x1, y, z1],
      [x0, y, z1],
    ],
  });
  const grid: Surface[] = [];
  for (let ix = 0; ix < 6; ix++) {
    for (let iz = 0; iz < 4; iz++) {
      grid.push(tile(`cell_${ix}_${iz}`, ix * 2, (ix + 1) * 2, 0, iz * 2, (iz + 1) * 2));
    }
  }
  const verifyParity = (
    scene: Surface[],
    opts: GroundOptions,
    starts: GroundArrival[],
    goal: Vec3,
    probePoints: [Vec3, Vec3][],
  ) => {
    const planner = createGroundPlanner(scene, opts);
    const prep = groundPreparation(planner)!;
    const searchSpeed = opts.locomotion?.sprintSpeed ?? opts.speed;
    const rawGraph = surfaceGraph(scene, { speed: searchSpeed, portals: opts.portals });
    const fullRouteBase = prepareRoutePlanner(rawGraph, {
      walls: opts.walls,
      profile: opts.profile,
    });

    assert.equal(prep.routeBase.graph.nodes.length, fullRouteBase.graph.nodes.length);
    assert.equal(prep.routeBase.graph.edges.length, fullRouteBase.graph.edges.length);
    for (const node of rawGraph.nodes) {
      assert.deepEqual(
        prep.routeBase.forward.get(node.id) ?? [],
        fullRouteBase.forward.get(node.id) ?? [],
      );
    }
    assert.equal(prep.routeBase.topology.count, fullRouteBase.topology.count);
    for (const node of rawGraph.nodes) {
      const actualComp = prep.routeBase.condensed.components.get(node.id)!;
      const expectedComp = fullRouteBase.condensed.components.get(node.id)!;
      assert.deepEqual(
        [...prep.routeBase.condensed.forward[actualComp]]
          .map((c) => {
            const targetId = rawGraph.nodes.find(
              (n) => prep.routeBase.condensed.components.get(n.id) === c,
            )!.id;
            return fullRouteBase.condensed.components.get(targetId)!;
          })
          .sort((a, b) => a - b),
        [...fullRouteBase.condensed.forward[expectedComp]].sort((a, b) => a - b),
      );
    }
    for (const [a, b] of probePoints) {
      assert.equal(prep.routeBase.blocked!(a, b), fullRouteBase.blocked!(a, b));
    }

    const actualRoute = planner.plan(starts, goal);
    // Compare against a fresh full-prepareRoutePlanner search on a cloned surface array
    // (fresh array skips topologyCache's unwalled reuse? No, topologyCache keys by Surface[],
    // so cloning scene gives a separate entry, and checking fullRouteBase directly confirms graph parity).
    const clonedScene = structuredClone(scene);
    const fullPlanner = createGroundPlanner(clonedScene, opts);
    const fullRoute = fullPlanner.plan(starts, goal);
    assert.equal(actualRoute.status, fullRoute.status);
    if (actualRoute.status === 'complete' && fullRoute.status === 'complete') {
      assert.ok(Math.abs(actualRoute.cost - fullRoute.cost) < 1e-12);
      assert.deepEqual(actualRoute.points, fullRoute.points);
    }
    return actualRoute;
  };

  const baseProfile = { radius: 0.25, height: 1.6 };
  const baseOpts: GroundOptions = {
    speed: 2,
    maxVertical: 0.5,
    profile: baseProfile,
    walls: [],
  };
  const starts: GroundArrival[] = [
    { id: 'player', state: 'available', position: [1, 0, 1], cost: 0 },
  ];
  const goal: Vec3 = [11, 0, 1];
  const probes: [Vec3, Vec3][] = [
    [
      [1, 0, 1],
      [11, 0, 1],
    ],
    [
      [5, 0, 1],
      [7, 0, 1],
    ],
    [
      [5, 0, 7],
      [7, 0, 7],
    ],
  ];

  // 1. All-inactive walls (raw -> roundedWalls view switch sharing one `grid` instance).
  const rawWall: Wall = { min: [5.5, -1, -0.5], max: [6.5, 2, 4.5], state: 'active' };
  const roundedInactive: Wall = { ...rawWall, state: 'inactive' };
  const roundedNarrow: Wall = { min: [5.5, -1, 1.5], max: [6.5, 2, 6.5], state: 'active' };
  const rawRoute = verifyParity(grid, { ...baseOpts, walls: [rawWall] }, starts, goal, probes);
  assert.equal(rawRoute.status, 'complete');
  if (rawRoute.status === 'complete') {
    assert.ok(rawRoute.points.some((p) => p[2] > 4.5));
  }
  const inactiveRoute = verifyParity(
    grid,
    { ...baseOpts, walls: [roundedInactive] },
    starts,
    goal,
    probes,
  );
  assert.equal(inactiveRoute.status, 'complete');
  if (inactiveRoute.status === 'complete') {
    assert.ok(Math.abs(inactiveRoute.cost - 5) < 1e-9);
  }
  const narrowRoute = verifyParity(
    grid,
    { ...baseOpts, walls: [roundedNarrow], profile: { radius: 0.3, height: 1.8 } },
    starts,
    goal,
    probes,
  );
  assert.equal(narrowRoute.status, 'complete');

  // 2. Box wall completely blocking corridor.
  const fullBlocker: Wall = { min: [5.5, -1, -1], max: [6.5, 2, 9], state: 'active' };
  const blockedRoute = verifyParity(
    grid,
    { ...baseOpts, walls: [fullBlocker] },
    starts,
    goal,
    probes,
  );
  assert.equal(blockedRoute.status, 'no-verified-route');

  // 3. Polygon wall + polyline wall.
  const polyWall: Wall = {
    min: [5, -1, 0],
    max: [7, 2, 4.5],
    polygon: [
      [5.2, 0.2],
      [6.8, 0.2],
      [6.8, 4.2],
      [5.2, 4.2],
    ],
    state: 'active',
  };
  assert.equal(
    verifyParity(grid, { ...baseOpts, walls: [polyWall] }, starts, goal, probes).status,
    'complete',
  );
  const lineWall: Wall = {
    min: [5.8, -1, -1],
    max: [6.2, 2, 9],
    points: [
      [6, -0.5],
      [6, 8.5],
    ],
    state: 'unknown',
  };
  assert.equal(
    verifyParity(grid, { ...baseOpts, walls: [lineWall] }, starts, goal, probes).status,
    'no-verified-route',
  );

  // 4. Sphere wall.
  const sphereWall: Wall = {
    min: [5.5, 0, 0.5],
    max: [6.5, 1, 1.5],
    sphere: { center: [6, 0.5, 1], radius: 1.2 },
    state: 'active',
  };
  const sphereRoute = verifyParity(
    grid,
    { ...baseOpts, walls: [sphereWall] },
    starts,
    goal,
    probes,
  );
  assert.equal(sphereRoute.status, 'complete');

  // 5. Fallback (> 50% affected) when wall spans almost all surfaces.
  const bigWall: Wall = { min: [-1, -1, -1], max: [13, 2, 9], state: 'active' };
  assert.equal(
    verifyParity(grid, { ...baseOpts, walls: [bigWall] }, starts, goal, probes).status,
    'no-verified-route',
  );

  // 6. Long vertical imported portal crossing a wall in empty space (disjoint from surface AABBs).
  const portalScene: Surface[] = [
    tile('lower', 0, 2, 0, 0, 2),
    tile('upper', 0, 2, 10, 0, 2),
    tile('pad0', 10, 12, 0, 0, 2),
    tile('pad1', 14, 16, 0, 0, 2),
    tile('pad2', 18, 20, 0, 0, 2),
    tile('pad3', 22, 24, 0, 0, 2),
  ];
  const verticalPortal: Portal = {
    from: 'lower',
    to: 'upper',
    points: [
      [1, 0, 0],
      [1, 10, 0],
    ],
  };
  const midAirWall: Wall = { min: [0, 5, -1], max: [2, 6, 1], state: 'active' };
  const portalStart: GroundArrival[] = [
    { id: 'p', state: 'available', position: [1, 0, 1], cost: 0 },
  ];
  assert.equal(
    verifyParity(
      portalScene,
      { ...baseOpts, portals: [verticalPortal], walls: [midAirWall] },
      portalStart,
      [1, 10, 1],
      [
        [
          [1, 0, 0],
          [1, 10, 0],
        ],
      ],
    ).status,
    'no-verified-route',
  );
  assert.equal(
    verifyParity(
      portalScene,
      { ...baseOpts, portals: [verticalPortal], walls: [{ ...midAirWall, state: 'inactive' }] },
      portalStart,
      [1, 10, 1],
      [
        [
          [1, 0, 0],
          [1, 10, 0],
        ],
      ],
    ).status,
    'complete',
  );

  // 7. Error parity for invalid inactive walls and invalid profile.
  assert.throws(
    () =>
      createGroundPlanner(grid, {
        ...baseOpts,
        walls: [{ min: [2, 0, 0], max: [1, 1, 1], state: 'inactive' }],
      }),
    /Invalid wall/,
  );
  assert.throws(
    () =>
      createGroundPlanner(grid, {
        ...baseOpts,
        profile: { radius: -0.1, height: 1.6 },
        walls: [],
      }),
    /Invalid wall query/,
  );

  // 8. Empty wall checker carries .empty so unwalled->walled overlays do not wrap no-ops.
  const emptyChecker = createWallChecker([], baseProfile);
  assert.equal(emptyChecker.empty, true);
  assert.equal(emptyChecker([1, 0, 1], [11, 0, 1]), false);
  const walledPlanner = createGroundPlanner(grid, { ...baseOpts, walls: [rawWall] });
  const walledBlocked = groundPreparation(walledPlanner)!.routeBase.blocked!;
  assert.equal(walledBlocked.empty, undefined);
  assert.equal(walledBlocked([1, 0, 1], [11, 0, 1]), true);
  assert.equal(walledBlocked([5, 0, 7], [7, 0, 7]), false);
});
