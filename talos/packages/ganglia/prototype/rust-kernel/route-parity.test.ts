import assert from 'node:assert/strict';
import test from 'node:test';

import { createRustRouteSearch } from '#@/prototype/rust-kernel/route-binding.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import {
  createRoutePlanner,
  createUpdatingRoutePlanner,
  prepareRoutePlanner,
  routeFrom,
  type Arrival,
  type Edge,
  type Graph,
  type RouteConstraints,
} from '#@/src/v1/route/routes.ts';
import { installRouteSearchPrototype } from '#@/src/v1/search/route-search.ts';

const graphOf = (points: Vec3[], links: [number, number, number][]): Graph => ({
  nodes: points.map((position, index) => ({ id: String(index), position })),
  edges: links.map(([from, to, cost]) => ({
    from: String(from),
    to: String(to),
    cost,
    state: 'open',
    points: [points[from], points[to]],
  })),
});
const pair = (graph: Graph, constraints?: RouteConstraints) => {
  const previous = installRouteSearchPrototype();
  try {
    const js = createRoutePlanner(graph, constraints);
    const preparedJs = prepareRoutePlanner(graph, constraints);
    installRouteSearchPrototype(createRustRouteSearch);
    return {
      js,
      native: createRoutePlanner(graph, constraints),
      preparedJs,
      preparedNative: prepareRoutePlanner(graph, constraints),
    };
  } finally {
    installRouteSearchPrototype(previous);
  }
};
const empty: Graph = { nodes: [], edges: [] };
const arrival = (id: string, node: string, cost = 0): Arrival => ({
  id,
  node,
  cost,
  state: 'available',
});

test('native prepared routes retain improving/stale arrivals, goal and parallel-edge ties, and signed zero', () => {
  const graph = graphOf(
    [
      [0, 0, 0],
      [1, 0, 0],
      [0, 0, 1],
      [1, 0, 1],
    ],
    [
      [0, 1, 1],
      [0, 2, 1],
      [0, 1, 1],
      [1, 3, 1],
      [2, 3, 1],
      [3, 1, 0],
    ],
  );
  const planners = pair(graph);
  for (const starts of [
    [arrival('costly', '0', 4), arrival('first-cheap', '0', -0), arrival('equal-cheap', '0', 0)],
    [arrival('first-cheap', '0', 0), arrival('costly', '0', 4), arrival('other', '2', 1)],
    [arrival('goal', '3', -0)],
  ])
    for (const goals of [['3'], ['2', '1', '2'], ['1', '2'], ['absent', '3']]) {
      const expected = planners.js(empty, starts, goals);
      assert.deepEqual(planners.native(empty, starts, goals), expected);
      assert.deepEqual(
        planners.preparedNative.plan(empty, starts, goals),
        planners.preparedJs.plan(empty, starts, goals),
      );
    }
  const stationary = planners.native(empty, [arrival('zero', '3', -0)], '3');
  assert.equal(stationary.status, 'complete');
  if (stationary.status === 'complete') {
    assert.ok(Object.is(stationary.cost, -0));
    assert.ok(Object.is(stationary.arrivalCost, -0));
  }
});

test('native prepared routes reset tiny overlays and heuristic state as actions and temporary coordinates change', () => {
  const graph = graphOf(
    [
      [0, 0, 0],
      [10, 0, 0],
      [1000, 0, 0],
    ],
    [[0, 1, 10]],
  );
  const { js, native } = pair(graph);
  const starts = [arrival('root', '0', 0.25)];
  const check = (extra: Graph, goals: string | string[]) =>
    assert.deepEqual(native(extra, starts, goals), js(extra, starts, goals));
  for (let repeat = 0; repeat < 3; repeat++) {
    for (const cost of [0, 0.001]) {
      check(
        {
          nodes: [],
          edges: [
            {
              from: '0',
              to: '2',
              cost,
              state: 'open',
              points: [graph.nodes[0].position, graph.nodes[2].position],
            },
            {
              from: '2',
              to: '1',
              cost: 1,
              state: 'open',
              points: [graph.nodes[2].position, graph.nodes[1].position],
            },
          ],
        },
        '1',
      );
      check(empty, '1');
    }
    for (const position of [
      [11, 0, 0],
      [1001, 0, 0],
      [11, 0, 0],
    ] satisfies Vec3[]) {
      const extra: Graph = {
        nodes: [{ id: 'temporary', position }],
        edges: [
          {
            from: '1',
            to: 'temporary',
            cost: 2,
            state: 'open',
            points: [graph.nodes[1].position, position],
          },
        ],
      };
      check(extra, ['2', 'temporary']);
      check(extra, 'temporary');
      check(empty, '2');
    }
    check({ nodes: [], edges: [{ ...graph.edges[0], state: 'closed', cost: 0 }] }, '1');
  }
});

test('native search preserves Infinity priorities and original edge identity across overlay replacement', () => {
  // The full endpoint distance overflows, while each individual edge's speed
  // remains finite. A* therefore starts with an infinite priority.
  const huge = graphOf(
    [
      [-1e308, 0, 0],
      [0, 0, 0],
      [1e308, 0, 0],
    ],
    [
      [0, 1, 1],
      [1, 2, 1],
    ],
  );
  const planners = pair(huge);
  const starts = [arrival('costly', '0', 4), arrival('cheap', '0', 0)];
  assert.deepEqual(planners.native(empty, starts, '2'), planners.js(empty, starts, '2'));

  const graph = graphOf(
    [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
    [[0, 1, 1]],
  );
  const native = createRustRouteSearch(graph);
  const link: Edge = {
    from: '1',
    to: '2',
    cost: 2,
    state: 'open',
    points: [graph.nodes[1].position, graph.nodes[2].position],
  };
  const query = {
    nodes: [],
    links: [link],
    seeds: [{ node: '0', origin: 'original', travelled: 0, priority: 0 }],
    goals: ['2'],
    targetKey: 'goal2',
  };
  const result = native.search(query);
  assert.ok(result);
  assert.strictEqual(result.reversePath[0], link);
  assert.strictEqual(result.reversePath[1], graph.edges[0]);
  assert.equal(native.search({ ...query, links: [] }), undefined);
  const changed: Edge = { ...link, cost: 3 };
  const replacement = native.search({ ...query, links: [changed] });
  assert.ok(replacement);
  assert.strictEqual(replacement.reversePath[0], changed);
  assert.equal(replacement.cost, 4);
});

test('native prepared routes retain corridor, blocked-goal and arrival guard ordering', () => {
  const graph = graphOf(
    [
      [0, 0, 0],
      [0, 0, 5],
      [5, 0, 5],
      [0, 8, 0],
    ],
    [
      [0, 1, 3],
      [1, 2, 2],
    ],
  );
  const constraints: RouteConstraints = {
    profile: { radius: 0.1, height: 1 },
    walls: [{ min: [-1, -1, 2], max: [1, 3, 3], state: 'active' }],
  };
  const planners = pair(graph, constraints);
  const starts = [arrival('root', '0')];
  for (const goal of ['2', '3', 'missing'])
    assert.deepEqual(planners.native(empty, starts, goal), planners.js(empty, starts, goal));
  const invalid = [{ ...starts[0], cost: -1 }];
  assert.deepEqual(planners.native(empty, invalid, 'missing'), { status: 'unmapped' });
  assert.throws(() => planners.native(empty, invalid, '3'), /arrival/);
  assert.throws(() => planners.native(empty, [...starts, ...starts], '3'), /arrival/);
  assert.throws(
    () =>
      planners.native({ nodes: [], edges: [{ ...graph.edges[0], cost: -1 }] }, invalid, 'missing'),
    /corridor/,
  );
  assert.throws(
    () =>
      planners.native({ nodes: [{ id: '0', position: [0, 0, 0] }], edges: [] }, starts, 'missing'),
    /node/,
  );

  const blocked = pair(graph, {
    profile: { radius: 0.1, height: 1 },
    walls: [{ min: [4, -1, 4], max: [6, 2, 6], state: 'active' }],
  });
  assert.deepEqual(blocked.native(empty, invalid, '2'), { status: 'no-verified-route' });
  assert.deepEqual(blocked.native(empty, [{ ...starts[0], state: 'unknown' }], '3'), {
    status: 'unmapped',
  });
});

test('resource, updating and standalone paths retain their TypeScript search and resource-feasible alternative', () => {
  const graph = graphOf(
    [
      [0, 0, 0],
      [1, 0, 0],
      [2, 0, 0],
    ],
    [
      [0, 1, 1],
      [1, 2, 1],
    ],
  );
  graph.edges.unshift({
    from: '0',
    to: '2',
    cost: 0.1,
    state: 'open',
    mode: 'jump',
    requiredGait: 'sprint',
    times: [0, 0.1],
    points: [graph.nodes[0].position, graph.nodes[2].position],
  });
  const starts = [arrival('root', '0')];
  const policy = {
    speed: 1,
    sprintSpeed: 2,
    sprintAcceleration: 2,
    stamina: {
      capacity: 1,
      initial: 0,
      activationCost: 1,
      sprintDrain: 0,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
  };
  let calls = 0,
    factories = 0;
  const previous = installRouteSearchPrototype((base) => {
    factories++;
    const native = createRustRouteSearch(base);
    return {
      search(query) {
        calls++;
        return native.search(query);
      },
    };
  });
  try {
    const standalone = routeFrom(graph, starts, '2');
    const updating = createUpdatingRoutePlanner(graph);
    assert.deepEqual(updating.plan(starts, '2').route, standalone);
    assert.equal(factories, 0);
    const prepared = createRoutePlanner(graph);
    assert.equal(factories, 1);
    const resource = prepared(empty, starts, '2', policy);
    assert.equal(calls, 0);
    assert.equal(resource.status, 'complete');
    if (resource.status === 'complete')
      assert.ok(resource.segments.every((segment) => segment.mode === 'walk'));
    assert.deepEqual(prepared(empty, starts, '2'), standalone);
    assert.equal(calls, 1);
  } finally {
    installRouteSearchPrototype(previous);
  }
});

test('seeded prepared graph overlays agree with standalone TypeScript through repeated exhaustion and target changes', () => {
  let seed = 0x38fa451;
  const random = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
  for (let trial = 0; trial < 40; trial++) {
    const graph = graphOf(
      Array.from({ length: 9 }, (_, id) => [id, id % 3, trial] as Vec3),
      [],
    );
    const edge = (): Edge => {
      const from = Math.floor(random() * 8),
        to = Math.floor(random() * 8);
      return {
        from: String(from),
        to: String(to),
        cost: Math.floor(random() * 4),
        state: (['open', 'open', 'closed', 'unknown'] as const)[Math.floor(random() * 4)],
        points: [graph.nodes[from].position, graph.nodes[to].position],
      };
    };
    graph.edges = Array.from({ length: 14 }, edge);
    const { js, native } = pair(graph);
    const starts = [
      arrival('root', '0', 0.5),
      arrival('costly-root', '0', 2),
      arrival('other', '7', 2),
    ];
    assert.deepEqual(native(empty, starts, '8'), js(empty, starts, '8'));
    for (let overlay = 0; overlay < 8; overlay++) {
      const extra = { nodes: [], edges: Array.from({ length: overlay }, edge) };
      const goals = [String(overlay), '8'];
      assert.deepEqual(
        native(extra, starts, goals),
        js(extra, starts, goals),
        `trial=${trial} overlay=${overlay}`,
      );
    }
  }
});
