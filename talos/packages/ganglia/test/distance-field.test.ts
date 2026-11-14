import assert from 'node:assert/strict';
import { test } from 'node:test';

import { type WeightedEdge, advanceDistanceField } from '#@/src/v1/reach/distance-field.ts';

const adjacency = (edges: { from: string; to: string; cost: number }[]) => {
  const forward = new Map<string, WeightedEdge[]>(),
    reverse = new Map<string, WeightedEdge[]>();
  for (const edge of edges)
    for (const [map, key] of [
      [forward, edge.from],
      [reverse, edge.to],
    ] as const) {
      const outgoing = map.get(key) ?? [];
      outgoing.push(edge);
      map.set(key, outgoing);
    }
  return { forward, reverse };
};

// Bellman-Ford is independent of the incremental queue and accepts zero-cost
// cycles. Only finite graph labels, rather than incidental map order, are compared.
const reference = (
  base: { cost: number; from: string; to: string }[],
  actions: { from: string; to: string; cost: number }[],
  roots: { id: string; cost: number }[],
  reverse: boolean,
) => {
  const costs = new Map<string, number>();
  for (const root of roots) costs.set(root.id, Math.min(costs.get(root.id) ?? Infinity, root.cost));
  const edges = [...base, ...actions];
  for (let iteration = 0; iteration <= edges.length; iteration++) {
    let changed = false;
    for (const edge of edges) {
      const from = reverse ? edge.to : edge.from,
        to = reverse ? edge.from : edge.to;
      const cost = (costs.get(from) ?? Infinity) + edge.cost;
      if (cost < (costs.get(to) ?? Infinity)) {
        costs.set(to, cost);
        changed = true;
      }
    }
    if (!changed) return costs;
  }
  throw new Error('reference did not converge');
};

test('incremental action insertion preserves full distance fields in both directions', () => {
  let seed = 257;
  const random = () => (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
  for (let trial = 0; trial < 25; trial++) {
    const edge = () => ({
      from: String(Math.floor(random() * 17)),
      to: String(Math.floor(random() * 17)),
      cost: Math.floor(random() * 25) / (trial % 3 ? 7 : 4),
    });
    const base = Array.from({ length: 38 }, edge),
      actions: WeightedEdge[] = [];
    const maps = adjacency(base);
    for (const reverse of [false, true]) {
      let state;
      const roots = [
        { id: '0', cost: 0 },
        { id: '8', cost: 0.5 },
      ];
      actions.length = 0;
      for (let step = 0; step < 10; step++) {
        state = advanceDistanceField(
          reverse ? maps.reverse : maps.forward,
          actions,
          roots,
          reverse,
          state,
        );
        assert.deepEqual(state.costs, reference(base, actions, roots, reverse));
        const repeated = advanceDistanceField(
          reverse ? maps.reverse : maps.forward,
          actions,
          roots,
          reverse,
          state,
        );
        assert.equal(repeated, state);
        assert.deepEqual(repeated.work, { reset: false, expanded: 0, edgeChecks: 0, relaxed: 0 });
        actions.push(edge(), edge());
      }
    }
  }
});

test('removed or changed actions, roots and base graphs restart without retaining stale reachability', () => {
  const base = [{ from: 'a', to: 'b', cost: 2 }],
    maps = adjacency(base);
  const actions = [
    { from: 'b', to: 'c', cost: 0 },
    { from: 'c', to: 'd', cost: 0.5 },
  ];
  const roots = [{ id: 'a', cost: 0 }];
  let state = advanceDistanceField(maps.forward, actions, roots, false);
  assert.equal(state.costs.get('d'), 2.5);
  for (const selected of [
    actions.slice(0, 1),
    [...actions].reverse(),
    [{ ...actions[0], cost: 3 }, actions[1]],
    [],
    actions,
  ]) {
    state = advanceDistanceField(maps.forward, selected, roots, false, state);
    assert.deepEqual(state.costs, reference(base, selected, roots, false));
  }
  roots[0].id = 'd';
  state = advanceDistanceField(maps.forward, actions, roots, false, state);
  assert.deepEqual(state.costs, new Map([['d', 0]]));
  roots[0].cost = 4;
  state = advanceDistanceField(maps.reverse, actions, roots, true, state);
  assert.deepEqual(state.costs, reference(base, actions, roots, true));
  const changed = [{ from: 'a', to: 'b', cost: 7 }],
    changedMaps = adjacency(changed);
  state = advanceDistanceField(changedMaps.reverse, actions, roots, true, state);
  assert.deepEqual(state.costs, reference(changed, actions, roots, true));
});

test('an irrelevant added action expands no nodes in the unchanged reachable region', () => {
  const base = [
    { from: 'a', to: 'b', cost: 1 },
    { from: 'b', to: 'c', cost: 1 },
  ];
  const maps = adjacency(base),
    roots = [{ id: 'a', cost: 0 }];
  let state = advanceDistanceField(maps.forward, [], roots, false);
  assert.equal(state.work.expanded, 3);
  state = advanceDistanceField(
    maps.forward,
    [{ from: 'unreached', to: 'c', cost: 0 }],
    roots,
    false,
    state,
  );
  assert.equal(state.work.reset, false);
  assert.equal(state.work.expanded, 0);
  assert.deepEqual(
    state.costs,
    reference(base, [{ from: 'unreached', to: 'c', cost: 0 }], roots, false),
  );
});

test('scaling original ground weights retains the same labels as pre-scaled graph copies', () => {
  const base = [
    { from: 'a', to: 'b', cost: 1 / 3 },
    { from: 'b', to: 'c', cost: 0.17 },
    { from: 'c', to: 'd', cost: 7 / 11 },
    { from: 'a', to: 'd', cost: 1.375 },
  ];
  const maps = adjacency(base);
  const actions = [{ from: 'a', to: 'c', cost: 0.14 }];
  let state;
  for (const scale of [5.5, 1, 2.1, 0.7, 5.5])
    for (const reverse of [false, true]) {
      const roots = [{ id: reverse ? 'd' : 'a', cost: 0.12 }];
      for (const selected of [[], actions, actions, []]) {
        state = advanceDistanceField(
          reverse ? maps.reverse : maps.forward,
          selected,
          roots,
          reverse,
          state,
          scale,
        );
        assert.deepEqual(
          state.costs,
          reference(
            base.map((edge) => ({ ...edge, cost: edge.cost * scale })),
            selected,
            roots,
            reverse,
          ),
        );
      }
    }
});
