import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface } from '#@/src/geometry.ts';
import { planGroundRoute } from '#@/src/v1/route/ground.ts';
import { route, type Edge, type Graph } from '#@/src/v1/route/routes.ts';
import { expectStatus } from '#@/test/assertions.ts';
const locomotion = {
  speed: 1,
  sprintSpeed: 2,
  sprintAcceleration: 2,
  stamina: {
    capacity: 1,
    initial: 0,
    activationCost: 1,
    recoveryRate: 0,
    recoveryDelay: 0,
    reserve: 0,
  },
};
const constraints: NonNullable<Parameters<typeof route>[3]> = {
  walls: [],
  profile: { radius: 0.3, height: 1.7 },
  locomotion,
};
const ordinary: Edge & { mode: 'jump'; times: number[] } = {
  from: 'a',
  to: 'b',
  mode: 'jump',
  points: [
    [0, 0, 0],
    [4, 0, 0],
  ],
  times: [0, 6],
  cost: 6,
  state: 'open',
};
const fast: Edge & { mode: 'jump'; times: number[] } = {
  ...ordinary,
  requiredGait: 'sprint',
  times: [0, 1],
  cost: 1,
};

test('adding a resource-infeasible fast edge preserves the six-second route', () => {
  const graph: Graph = {
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [4, 0, 0] },
    ],
    edges: [ordinary],
  };
  assert.equal(expectStatus(route(graph, 'a', 'b', constraints), 'complete').cost, 6);
  graph.edges.push(fast);
  const result = route(graph, 'a', 'b', constraints);
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 6);
  assert.equal(result.search!.truncated, false);
});

test('the ordinary ground entry falls back to a resource-feasible corridor', () => {
  const surfaces: Surface[] = [
    {
      id: 'left',
      vertices: [
        [-1, 0, -1],
        [1, 0, -1],
        [1, 0, 1],
        [-1, 0, 1],
      ],
    },
    {
      id: 'right',
      vertices: [
        [3, 0, -1],
        [5, 0, -1],
        [5, 0, 1],
        [3, 0, 1],
      ],
    },
  ];
  const result = planGroundRoute(
    surfaces,
    [{ id: 'player', position: [0, 0, 0], cost: 0, state: 'available' }],
    [4, 0, 0],
    {
      ...constraints,
      speed: 1,
      maxVertical: 0.5,
      connections: [
        { ...ordinary, id: 'ordinary' },
        { ...fast, id: 'fast' },
      ],
    },
  );
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 6);
  assert.ok(result.segments.some((segment) => segment.connection === 'ordinary'));
});

test('bounded search reports unfinished work on unresolved output', () => {
  const graph: Graph = {
    nodes: [
      { id: 'a', position: [0, 0, 0] },
      { id: 'b', position: [1, 0, 0] },
      { id: 'c', position: [2, 0, 0] },
    ],
    edges: [
      {
        from: 'a',
        to: 'b',
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
        cost: 1,
        state: 'open',
      },
      {
        from: 'b',
        to: 'c',
        points: [
          [1, 0, 0],
          [2, 0, 0],
        ],
        cost: 1,
        state: 'open',
      },
    ],
  };
  const result = route(graph, 'a', 'c', {
    ...constraints,
    locomotion: { ...locomotion, search: { maxExpanded: 1 } },
  });
  assert.equal(result.status, 'no-verified-route');
  assert.equal(result.search!.truncated, true);
});
