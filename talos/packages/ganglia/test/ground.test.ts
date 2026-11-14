import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Portal, Surface, Vec3, Wall } from '#@/src/geometry.ts';
import type { GroundArrival, GroundConnection, GroundOptions } from '#@/src/route.ts';
import { createGroundPlanner, planGroundRoute, groundPreparation } from '#@/src/v1/route/ground.ts';
import { route } from '#@/src/v1/route/routes.ts';
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
