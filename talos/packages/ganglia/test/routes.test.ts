import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { sampleRoute } from '#@/src/playback.ts';
import { directedComponents, canReach } from '#@/src/v1/reach/connectivity.ts';
import {
  type Arrival,
  type Edge,
  type Graph,
  type Node,
  route,
  routeFrom,
  createRoutePlanner,
} from '#@/src/v1/route/routes.ts';
import { expectStatus } from '#@/test/assertions.ts';
const nodes: Node[] = [
  { id: 'a', position: [0, 0, 0] },
  { id: 'b', position: [0, 0, 5] },
  { id: 'c', position: [5, 0, 5] },
  { id: 'upper', position: [0, 8, 0] },
];
const edge = (from: string, to: string, cost: number, state: Edge['state'] = 'open'): Edge => ({
  from,
  to,
  cost,
  state,
  points: [nodes.find((n) => n.id === from)!.position, nodes.find((n) => n.id === to)!.position],
});
test('blocked shortcut uses directed verified corridors; overlapping floor stays disconnected', () => {
  const graph: Graph = {
    nodes,
    edges: [edge('a', 'c', 1, 'unknown'), edge('a', 'b', 3), edge('b', 'c', 2)],
  };
  const result = route(graph, 'a', 'c');
  assert.ok(result.status === 'complete');
  assert.equal(result.cost, 5);
  assert.equal(result.length, 10);
  assert.deepEqual(sampleRoute(result.points, 6), [1, 0, 5]);
  assert.equal(route(graph, 'c', 'a').status, 'no-verified-route');
  assert.equal(route(graph, 'a', 'upper').status, 'no-verified-route');
  assert.equal(route(graph, 'missing', 'c').status, 'unmapped');
  assert.equal(
    expectStatus(
      route({ ...graph, edges: [...graph.edges, edge('a', 'c', 1)] }, 'a', 'c'),
      'complete',
    ).cost,
    1,
  );
});
test('rejects invalid costs and discontinuous edge geometry', () => {
  assert.throws(() => route({ nodes, edges: [edge('a', 'c', -1)] }, 'a', 'c'));
  assert.throws(() =>
    route(
      {
        nodes,
        edges: [
          {
            ...edge('a', 'c', 1),
            points: [
              [1, 0, 0],
              [5, 0, 5],
            ],
          },
        ],
      },
      'a',
      'c',
    ),
  );
});
test('animation handles duplicate points and clamps endpoints without cutting corners', () => {
  const points: Vec3[] = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 5],
    [5, 0, 5],
  ];
  assert.deepEqual(sampleRoute(points, -1), points[0]);
  assert.deepEqual(sampleRoute(points, 5), [0, 0, 5]);
  assert.deepEqual(sampleRoute(points, 99), points.at(-1));
});

test('keeps least-cost remote actions with fast and zero-cost authored transfers', () => {
  const positions: Record<string, Vec3> = {
    start: [0, 0, 0],
    goal: [10, 0, 0],
    remote: [1000, 0, 0],
  };
  for (const cost of [0, 0.001]) {
    const graph: Graph = {
      nodes: Object.entries(positions).map(([id, position]) => ({ id, position })),
      edges: (
        [
          ['start', 'goal', 10],
          ['start', 'remote', cost],
          ['remote', 'goal', 1],
        ] as [string, string, number][]
      ).map(([from, to, cost]) => ({
        from,
        to,
        cost,
        state: 'open',
        points: [positions[from], positions[to]],
      })),
    };
    const result = route(graph, 'start', 'goal');
    assert.ok(result.status === 'complete');
    assert.equal(result.cost, cost + 1);
    assert.deepEqual(result.points, [positions.start, positions.remote, positions.goal]);
  }
});

test('reused geometric estimates preserve routes when actions, goals and endpoint positions change', () => {
  const positions: Record<string, Vec3> = {
    start: [0, 0, 0],
    near: [10, 0, 0],
    remote: [1000, 0, 0],
  };
  const base: Graph = {
    nodes: Object.entries(positions).map(([id, position]) => ({ id, position })),
    edges: [
      {
        from: 'start',
        to: 'near',
        cost: 10,
        state: 'open',
        points: [positions.start, positions.near],
      },
    ],
  };
  const plan = createRoutePlanner(base);
  const starts: Arrival[] = [{ id: 'origin', node: 'start', cost: 0, state: 'available' }];
  const empty = { nodes: [], edges: [] };
  const compare = (extra: Graph, goals: string | string[]) =>
    assert.deepEqual(
      plan(extra, starts, goals),
      routeFrom(
        { nodes: [...base.nodes, ...extra.nodes], edges: [...base.edges, ...extra.edges] },
        starts,
        goals,
      ),
    );
  compare(empty, 'near');
  // Reusing time estimates would incorrectly prune the newly added remote route.
  for (const cost of [0.001, 0]) {
    const extra: Graph = {
      nodes: [],
      edges: (
        [
          ['start', 'remote', cost],
          ['remote', 'near', 1],
        ] as [string, string, number][]
      ).map(([from, to, cost]) => ({
        from,
        to,
        cost,
        state: 'open',
        points: [positions[from], positions[to]],
      })),
    };
    compare(extra, 'near');
    assert.equal(expectStatus(plan(extra, starts, 'near'), 'complete').cost, cost + 1);
    compare(empty, 'near');
  }
  for (const position of [
    [11, 0, 0],
    [1001, 0, 0],
    [11, 0, 0],
  ] satisfies Vec3[]) {
    const extra: Graph = {
      nodes: [{ id: 'endpoint', position }],
      edges: [
        {
          from: 'near',
          to: 'endpoint',
          cost: 2,
          state: 'open',
          points: [positions.near, position] as Vec3[],
        },
      ],
    };
    compare(extra, ['remote', 'endpoint']);
    compare(extra, 'endpoint');
    compare(empty, 'remote');
  }
});

test('optimistic component checks preserve directed routes as temporary actions connect and disconnect floors', () => {
  const positions: Record<string, Vec3> = {
    start: [0, 0, 0],
    left: [1, 0, 0],
    right: [2, 0, 0],
    goal: [3, 0, 0],
  };
  const makeEdge = (from: string, to: string, cost = 1, state: Edge['state'] = 'open'): Edge => ({
    from,
    to,
    cost,
    state,
    points: [positions[from], positions[to]],
  });
  const base: Graph = {
    nodes: Object.entries(positions).map(([id, position]) => ({ id, position })),
    edges: [makeEdge('start', 'left'), makeEdge('goal', 'right')],
  };
  const plan = createRoutePlanner(base);
  const starts: Arrival[] = [{ id: 'origin', node: 'start', cost: 0, state: 'available' }];
  const compare = (extra: Graph) =>
    assert.deepEqual(
      plan(extra, starts, 'goal'),
      routeFrom(
        { nodes: [...base.nodes, ...extra.nodes], edges: [...base.edges, ...extra.edges] },
        starts,
        'goal',
      ),
    );
  const empty = { nodes: [], edges: [] };
  compare(empty); // first failed A* arms lazy component preparation
  compare(empty);
  // Weak connectivity alone must not authorize walking backwards along a passage.
  compare({ nodes: [], edges: [makeEdge('left', 'right')] });
  assert.equal(
    plan({ nodes: [], edges: [makeEdge('left', 'right')] }, starts, 'goal').status,
    'no-verified-route',
  );
  compare({ nodes: [], edges: [makeEdge('left', 'right'), makeEdge('right', 'goal')] });
  compare({ nodes: [], edges: [makeEdge('left', 'goal', 0)] });
  assert.equal(
    expectStatus(
      plan({ nodes: [], edges: [makeEdge('left', 'goal', 0)] }, starts, 'goal'),
      'complete',
    ).cost,
    1,
  );
  compare({ nodes: [], edges: [makeEdge('left', 'goal', 0, 'closed')] });
  compare({ nodes: [], edges: [makeEdge('left', 'goal', 0, 'unknown')] });
  const position: Vec3 = [2, 4, 0];
  compare({
    nodes: [{ id: 'temporary', position }],
    edges: [
      {
        from: 'left',
        to: 'temporary',
        cost: 1,
        state: 'open',
        points: [positions.left, position] as Vec3[],
      },
      {
        from: 'temporary',
        to: 'goal',
        cost: 1,
        state: 'open',
        points: [position, positions.goal] as Vec3[],
      },
    ],
  });
  compare(empty);
});

test('component early rejection retains exclusions and all existing extra-edge and arrival validation', () => {
  const base: Graph = { nodes, edges: [edge('a', 'b', 1), edge('b', 'c', 1)] };
  const constraints: Parameters<typeof createRoutePlanner>[1] = {
    profile: { radius: 0.1, height: 1 },
    walls: [{ min: [-1, -1, 2], max: [1, 3, 3], state: 'active' }],
  };
  const plan = createRoutePlanner(base, constraints);
  const starts: Arrival[] = [{ id: 'origin', node: 'a', cost: 0, state: 'available' }];
  const empty = { nodes: [], edges: [] };
  for (let index = 0; index < 2; index++)
    assert.equal(plan(empty, starts, 'upper').status, 'no-verified-route');
  assert.deepEqual(plan(empty, starts, 'c'), routeFrom(base, starts, 'c', constraints));
  assert.throws(
    () => plan({ nodes: [], edges: [edge('a', 'upper', -1)] }, starts, 'upper'),
    /corridor/,
  );
  assert.throws(
    () => plan({ nodes: [], edges: [{ ...edge('a', 'upper', 1), mode: 'rope' }] }, starts, 'upper'),
    /timing|requires sample times/,
  );
  assert.throws(
    () => plan({ nodes: [{ id: 'a', position: [0, 0, 0] }], edges: [] }, starts, 'upper'),
    /node/,
  );
  assert.throws(() => plan(empty, [{ ...starts[0], cost: -1 }], 'upper'), /arrival/);
  assert.throws(() => plan(empty, [starts[0], starts[0]], 'upper'), /arrival/);
  assert.equal(plan(empty, [{ ...starts[0], state: 'unknown' }], 'upper').status, 'unmapped');
  assert.equal(plan(empty, starts, 'absent').status, 'unmapped');
});

test('prepared component rejection agrees with fresh searches on mixed directed graph and action overlays', () => {
  let seed = 447;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 40; trial++) {
    const graphNodes: Node[] = Array.from({ length: 9 }, (_, index) => ({
      id: String(index),
      position: [index, index % 3, trial],
    }));
    const createEdge = (): Edge => {
      const from = Math.floor(random() * 8),
        to = Math.floor(random() * 8);
      return {
        from: String(from),
        to: String(to),
        cost: Math.floor(random() * 4),
        state: (['open', 'open', 'closed', 'unknown'] as const)[Math.floor(random() * 4)],
        points: [graphNodes[from].position, graphNodes[to].position],
      };
    };
    const base: Graph = { nodes: graphNodes, edges: Array.from({ length: 14 }, createEdge) };
    const plan = createRoutePlanner(base);
    const starts: Arrival[] = [{ id: 'origin', node: '0', cost: 0.5, state: 'available' }];
    plan({ nodes: [], edges: [] }, starts, '8'); // isolated node guarantees a full failed search
    for (let overlay = 0; overlay < 8; overlay++) {
      const extra: Graph = { nodes: [], edges: Array.from({ length: overlay }, createEdge) };
      const arrivals: Arrival[] = [
        ...starts,
        { id: 'other', node: '7', cost: 2, state: overlay % 2 ? 'available' : 'unknown' },
      ];
      const goals = [String(overlay), '8'];
      assert.deepEqual(
        plan(extra, arrivals, goals),
        routeFrom({ nodes: base.nodes, edges: [...base.edges, ...extra.edges] }, arrivals, goals),
      );
    }
  }
});

test('directed condensation keeps one-way component transfers and temporary endpoints distinct', () => {
  const ids = ['a', 'b', 'c', 'd'];
  const adjacency = new Map([
    ['a', [{ from: 'a', to: 'b' }]],
    [
      'b',
      [
        { from: 'b', to: 'a' },
        { from: 'b', to: 'c' },
      ],
    ],
    ['c', [{ from: 'c', to: 'd' }]],
    ['d', [{ from: 'd', to: 'c' }]],
  ]);
  const graph = directedComponents(ids, adjacency);
  assert.equal(graph.components.get('a'), graph.components.get('b'));
  assert.equal(graph.components.get('c'), graph.components.get('d'));
  assert.notEqual(graph.components.get('a'), graph.components.get('c'));
  assert.equal(canReach(graph, [], ['a'], ['d']), true);
  assert.equal(canReach(graph, [], ['d'], ['a']), false);
  assert.equal(canReach(graph, [{ from: 'd', to: 'a' }], ['d'], ['a']), true);
  assert.equal(canReach(graph, [], ['d'], ['a']), false);
  assert.equal(
    canReach(
      graph,
      [
        { from: 'd', to: 'temporary' },
        { from: 'temporary', to: 'a' },
      ],
      ['d'],
      ['a'],
    ),
    true,
  );
  assert.equal(canReach(graph, [{ from: 'd', to: 'temporary' }], ['temporary'], ['a']), false);
});
