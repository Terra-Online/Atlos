import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { sampleJourney } from '#@/src/index.ts';
import type { GroundArrival, GroundConnection } from '#@/src/route.ts';
import { planGroundRoute } from '#@/src/v1/route/ground.ts';
import { routeFrom, type Graph } from '#@/src/v1/route/routes.ts';

const floor = (y: number): Surface => ({
  id: String(y),
  vertices: [
    [-2, y, -2],
    [2, y, -2],
    [2, y, 2],
    [-2, y, 2],
  ],
});
const surfaces: Surface[] = [floor(0), floor(8)];
const options = { speed: 1, maxVertical: 0.1, profile: { radius: 0.35, height: 1.66 }, walls: [] };
const player = (position: Vec3): GroundArrival[] => [
  { id: 'player', position, cost: 0, state: 'available' },
];
const rope: GroundConnection = {
  id: 'rope-up',
  mode: 'rope',
  state: 'open',
  points: [
    [0, 0, 0],
    [0, 8, 0],
  ],
  times: [0, 4],
};

test('grounded rope links connect floors in the authored direction and participate in arrival costs', () => {
  const result = planGroundRoute(surfaces, player([0, 0, 0]), [1, 8, 0], {
    ...options,
    connections: [rope],
  });
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 5);
  assert.equal(result.arrivalCost, 0);
  assert.equal(result.segments.find((s) => s.mode === 'rope')!.connection, 'rope-up');
  assert.deepEqual(sampleJourney(result, 2), {
    mode: 'rope',
    position: [0, 4, 0],
    connection: 'rope-up',
  });
  assert.deepEqual(sampleJourney(result, 4.5), { mode: 'walk', position: [0.5, 8, 0] });
  assert.equal(
    planGroundRoute(surfaces, player([0, 8, 0]), [0, 0, 0], { ...options, connections: [rope] })
      .status,
    'no-verified-route',
  );
  const teleported = planGroundRoute(
    surfaces,
    [...player([0, 0, 0]), { id: 'camp', position: [1, 8, 0], cost: 2, state: 'available' }],
    [1, 8, 0],
    { ...options, connections: [rope] },
  );
  assert.ok(teleported.status === 'complete');
  assert.equal(teleported.start, 'camp');
  assert.equal(teleported.cost, 2);
  assert.equal(teleported.arrivalCost, 2);
  assert.deepEqual(sampleJourney(teleported, 0), { mode: 'complete', position: [1, 8, 0] });
});

test('unknown devices, unsupported endpoints and air walls cannot grant cross-floor access', () => {
  for (const connection of [
    { ...rope, state: 'unknown' },
    {
      ...rope,
      points: [
        [0, -0.5, 0],
        [0, 8, 0],
      ],
    },
  ] satisfies GroundConnection[]) {
    assert.equal(
      planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
        ...options,
        connections: [connection],
      }).status,
      'no-verified-route',
    );
  }
  assert.equal(
    planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
      ...options,
      connections: [rope],
      walls: [{ min: [-0.5, 4, -0.5], max: [0.5, 5, 0.5], state: 'unknown' }],
    }).status,
    'no-verified-route',
  );
  assert.throws(
    () =>
      planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
        ...options,
        connections: [{ ...rope, times: [1, 4] }],
      }),
    /timing/,
  );
});

test('variable-speed drop samples preserve timing and do not create the reverse jump', () => {
  const points: Vec3[] = [
      [1, 8, 0],
      [1, 6, 0],
      [1, 0, 0],
    ],
    times = [0, 0.5, 1];
  const graph: Graph = {
    nodes: [
      { id: 'top', position: points[0] },
      { id: 'bottom', position: points.at(-1)! },
    ],
    edges: [
      {
        from: 'top',
        to: 'bottom',
        mode: 'drop',
        points,
        times,
        cost: 1,
        state: 'open',
        connection: 'drop-down',
      },
    ],
  };
  const result = routeFrom(
    graph,
    [{ id: 'camp', node: 'top', cost: 3, state: 'available' }],
    'bottom',
  );
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 4);
  assert.equal(result.arrivalCost, 3);
  assert.deepEqual(sampleJourney(result, 0.75), {
    mode: 'drop',
    position: [1, 3, 0],
    connection: 'drop-down',
  });
  assert.deepEqual(sampleJourney(result, 2), { mode: 'complete', position: [1, 0, 0] });
  assert.equal(
    routeFrom(graph, [{ id: 'player', node: 'bottom', cost: 0, state: 'available' }], 'top').status,
    'no-verified-route',
  );
  times[1] = 0.1;
  points[1][1] = 99;
  assert.deepEqual(sampleJourney(result, 0.75).position, [1, 3, 0]);
});

test('explicit collision support tolerance preserves feet without joining different floors', () => {
  const raised: GroundConnection = {
    ...rope,
    points: [
      [0, 0.02, 0],
      [0, 8.02, 0],
    ],
  };
  assert.equal(
    planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], { ...options, connections: [raised] })
      .status,
    'no-verified-route',
  );
  const result = planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
    ...options,
    connections: [{ ...raised, endpointTolerance: 0.03 }],
  });
  assert.ok(result.status === 'complete');
  assert.deepEqual(
    result.segments.find((segment) => segment.mode === 'rope')!.points,
    raised.points,
  );
  assert.throws(
    () =>
      planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
        ...options,
        connections: [{ ...raised, endpointTolerance: 0.2 }],
      }),
    /endpoint tolerance/,
  );
  assert.equal(
    planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
      ...options,
      connections: [
        {
          ...raised,
          points: [
            [0, 0.2, 0],
            [0, 8.02, 0],
          ],
          endpointTolerance: 0.03,
        },
      ],
    }).status,
    'no-verified-route',
  );
  const exact = planGroundRoute(surfaces, player([0, 0, 0]), [0, 8, 0], {
    ...options,
    maxVertical: 0,
    profile: { radius: 0, height: 1.66 },
    connections: [rope],
  });
  assert.ok(exact.status === 'complete');
});

test('required gait survives graph and ground planning and excludes unproved air links', () => {
  const jump: GroundConnection = {
    id: 'sprint-air',
    mode: 'jump',
    state: 'open',
    requiredGait: 'sprint',
    points: [
      [0, 0, 0],
      [6.5, 0, 0],
    ],
    times: [0, 1],
  };
  const graph: Graph = {
    nodes: [
      { id: 'a', position: jump.points[0] },
      { id: 'b', position: jump.points[1] },
    ],
    edges: [{ ...jump, from: 'a', to: 'b', cost: 1, connection: jump.id }],
  };
  const result = routeFrom(graph, [{ id: 'p', node: 'a', cost: 0, state: 'available' }], 'b');
  assert.ok(result.status === 'complete');
  assert.equal(result.segments[0].requiredGait, 'sprint');
  for (const requiredGait of ['run', 'fly', null]) {
    assert.throws(
      () =>
        routeFrom(
          { ...graph, edges: [{ ...graph.edges[0], requiredGait }] } as unknown as Parameters<
            typeof routeFrom
          >[0],
          [{ id: 'p', node: 'a', cost: 0, state: 'available' }],
          'b',
        ),
      /movement segment/,
    );
  }
  assert.throws(
    () =>
      routeFrom(
        { ...graph, edges: [{ ...graph.edges[0], mode: 'walk' }] },
        [{ id: 'p', node: 'a', cost: 0, state: 'available' }],
        'b',
      ),
    /movement segment/,
  );
  const platforms: Surface[] = [
    {
      id: 'a',
      vertices: [
        [-3, 0, -2],
        [2, 0, -2],
        [2, 0, 2],
        [-3, 0, 2],
      ],
    },
    {
      id: 'b',
      vertices: [
        [5, 0, -2],
        [10, 0, -2],
        [10, 0, 2],
        [5, 0, 2],
      ],
    },
  ];
  assert.equal(
    planGroundRoute(platforms, player([-2, 0, 0]), [9, 0, 0], { ...options, connections: [jump] })
      .status,
    'no-verified-route',
  );
  const locomotion = {
    speed: 5,
    sprintSpeed: 7,
    sprintAcceleration: 60,
    stamina: {
      capacity: 1,
      initial: 1,
      activationCost: 1,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
  };
  const paid = planGroundRoute(
    platforms,
    [
      { id: 'no-approach', position: [0, 0, 0], cost: 0, state: 'available' },
      { id: 'approach', position: [-2, 0, 0], cost: 0, state: 'available' },
    ],
    [9, 0, 0],
    { ...options, speed: 5, connections: [jump], locomotion },
  );
  assert.ok(paid.status === 'complete');
  // Resource search can now leave the nearer arrival, establish a paid sprint
  // on a short supported approach and return to the launch point.
  assert.equal(paid.start, 'no-approach');
  const launch = paid.segments.findIndex((segment) => segment.mode === 'jump');
  assert.ok(launch > 0);
  assert.ok(
    paid.segments
      .slice(0, launch)
      .some((segment) => segment.gait === 'sprint' && segment.times.at(-1)! > 0),
  );
  assert.equal(paid.locomotion!.initial - paid.locomotion!.final, 1);
  assert.equal(paid.segments.find((segment) => segment.mode === 'jump')!.requiredGait, 'sprint');
  assert.equal(
    planGroundRoute(platforms, player([-2, 0, 0]), [9, 0, 0], {
      ...options,
      speed: 5,
      connections: [jump],
      locomotion: {
        ...locomotion,
        stamina: { ...locomotion.stamina, initial: 0 },
      },
    }).status,
    'no-verified-route',
  );
});
