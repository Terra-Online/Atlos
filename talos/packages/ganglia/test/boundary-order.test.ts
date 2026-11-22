import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boundaryOrder,
  boundaryOrderIterator,
  boundaryTree,
  extendBoundaryTree,
  interleaveBoundaryOrders,
} from '#@/src/v1/search/boundary-order.ts';

test('bounded discovery covers separate regions before exhausting nearby entries', () => {
  const entries = [
    ...Array.from({ length: 20 }, (_, id) => ({ id, midpoint: [0, 0, 0], score: id })),
    { id: 20, midpoint: [32, 0, 0], score: 20 },
    { id: 21, midpoint: [0, 4, 0], score: 21 },
  ];
  const tree = boundaryTree(entries, 16, 2, 0.6);
  const compare = (a: (typeof entries)[number], b: (typeof entries)[number]) => a.score - b.score;
  const all = boundaryOrder(tree, () => true, compare, entries.length);
  assert.deepEqual(
    all.slice(0, 3).map((entry) => entry.id),
    [0, 20, 21],
  );
  assert.deepEqual(
    all.map((entry) => entry.id).sort((a, b) => a - b),
    entries.map((entry) => entry.id),
  );
  for (const limit of [0, 1, 3, 9, 100])
    assert.deepEqual(
      boundaryOrder(tree, () => true, compare, limit),
      all.slice(0, limit),
    );
  const selected = boundaryOrder(tree, (entry) => entry.midpoint[1] === 0, compare, 100);
  assert.equal(selected.length, 21);
  assert.ok(selected.every((entry) => entry.id !== 21));
  assert.deepEqual(
    boundaryOrder(tree, () => false, compare, 10),
    [],
  );
  assert.deepEqual(
    boundaryOrder(tree, () => true, compare, entries.length),
    all,
  );
});

test('lazy boundary ordering resumes the same regional round-robin across tied ranks', () => {
  const entries = [
    { id: 'a0', midpoint: [0, 0, 0], score: 3 },
    { id: 'a1', midpoint: [0.1, 0, 0], score: 1 },
    { id: 'b0', midpoint: [10, 0, 0], score: 1 },
    { id: 'b1', midpoint: [10.1, 0, 0], score: 1 },
    { id: 'c0', midpoint: [0, 4, 10], score: 2 },
  ];
  const tree = boundaryTree(entries, 8, 2, 0.5);
  const compare = (a: (typeof entries)[number], b: (typeof entries)[number]) => a.score - b.score;
  const iterator = boundaryOrderIterator(tree, () => true, compare, entries.length);
  assert.equal(iterator.next().value?.id, 'a1');
  assert.equal(iterator.next().value?.id, 'b0');
  assert.deepEqual(
    Array.from(iterator, (entry) => entry.id),
    ['c0', 'a0', 'b1'],
  );
  assert.deepEqual(
    Array.from(
      boundaryOrderIterator(tree, (entry) => entry.id !== 'a0', compare, 3),
      (entry) => entry.id,
    ),
    ['a1', 'b0', 'c0'],
  );
});

test('streamed boundary merging deduplicates after raw ordering slots without draining unused tails', () => {
  const orders = [['a', 'b', 'c'], ['a', 'd'], [], ['e', 'b']];
  for (const [limit, expected] of [
    [0, []],
    [1, ['a']],
    [2, ['a']],
    [3, ['a', 'e']],
    [4, ['a', 'e', 'b']],
    [6, ['a', 'e', 'b', 'd']],
    [10, ['a', 'e', 'b', 'd', 'c']],
  ] as const) {
    assert.deepEqual(Array.from(interleaveBoundaryOrders(orders, limit)), expected);
  }
  const guarded = function* () {
    yield 'a';
    throw new Error('Unused boundary tail was consumed');
  };
  assert.deepEqual(Array.from(interleaveBoundaryOrders([guarded(), ['a', 'b']], 2)), ['a']);
});

test('extendBoundaryTree matches full boundaryTree across empty, singleton split, multi-entry, and new cells', () => {
  type Item = { id: string; midpoint: [number, number, number]; score: number; ordinal: number };
  const compare = (a: Item, b: Item) => a.score - b.score || a.ordinal - b.ordinal;
  const tiedCompare = (a: Item, b: Item) => a.score - b.score;

  const verifyEquivalence = (
    base: Item[],
    extra: Item[],
    size: number,
    height: number,
    diversity: number,
  ) => {
    const baseTree = boundaryTree(base, size, height, diversity);
    const baseSnapshot = boundaryOrder(baseTree, () => true, compare, base.length + 10);
    const extended = extendBoundaryTree(baseTree, extra, size, height, diversity);
    const combined = [...base, ...extra];
    const fresh = boundaryTree(combined, size, height, diversity);

    // Base tree must remain completely intact.
    assert.deepEqual(
      boundaryOrder(baseTree, () => true, compare, base.length + 10),
      baseSnapshot,
    );

    const predicates = [
      () => true,
      () => false,
      (item: Item) => item.ordinal % 2 === 0,
      (item: Item) => item.midpoint[0] >= 0,
    ];
    for (const eligible of predicates) {
      for (const cmp of [compare, tiedCompare]) {
        for (const limit of [0, 1, 2, 5, 13, combined.length, combined.length + 10]) {
          assert.deepEqual(
            boundaryOrder(extended, eligible, cmp, limit).map((x) => x.id),
            boundaryOrder(fresh, eligible, cmp, limit).map((x) => x.id),
          );
        }
      }
    }
    return { baseTree, extended };
  };

  // 1. Empty extra returns baseTree in O(1) by reference.
  const simpleBase: Item[] = [
    { id: 'b0', midpoint: [0.1, 0, 0.1], score: 1, ordinal: 0 },
    { id: 'b1', midpoint: [20, 0, 0], score: 2, ordinal: 1 },
  ];
  const baseTree0 = boundaryTree(simpleBase, 16, 2, 0.5);
  assert.equal(extendBoundaryTree(baseTree0, [], 16, 2, 0.5), baseTree0);

  // 2. Empty base extended with 1 item and >=2 items.
  verifyEquivalence([], [{ id: 'e0', midpoint: [1, 0, 1], score: 1, ordinal: 0 }], 16, 2, 0.5);
  verifyEquivalence(
    [],
    [
      { id: 'e0', midpoint: [1, 0, 1], score: 2, ordinal: 0 },
      { id: 'e1', midpoint: [5, 0, 1], score: 1, ordinal: 1 },
      { id: 'e2', midpoint: [1.1, 0, 1.1], score: 1, ordinal: 2 },
    ],
    16,
    2,
    0.5,
  );

  // 3. Structural sharing + singleton leaf splitting at scale > diversity + existing multi-entry + new cells.
  const structuredBase: Item[] = [
    // Multi-entry cell [0,0,0] with entries above and below diversity
    { id: 'm0', midpoint: [0.1, 0, 0.1], score: 3, ordinal: 0 },
    { id: 'm1', midpoint: [0.2, 0, 0.2], score: 1, ordinal: 1 },
    { id: 'm2', midpoint: [6.0, 0, 0.2], score: 2, ordinal: 2 },
    // Singleton cell at [20, 0, 0] (will split at scale 8 -> 4 -> 2 -> 1 when extra arrives)
    { id: 'singleton', midpoint: [20.1, 0, 0.1], score: 5, ordinal: 3 },
    // Untouched distant cell at [100, 0, 100]
    { id: 'untouched0', midpoint: [100.1, 0, 100.1], score: 1, ordinal: 4 },
    { id: 'untouched1', midpoint: [101.5, 0, 100.1], score: 2, ordinal: 5 },
  ];
  const structuredExtra: Item[] = [
    // Joins existing cell [0,0,0] below diversity
    { id: 'extra_m', midpoint: [0.15, 0, 0.15], score: 0, ordinal: 6 },
    // Splits singleton cell [20,0,0] at scale 8 > diversity 0.5
    { id: 'extra_split_a', midpoint: [20.15, 0, 0.15], score: 2, ordinal: 7 },
    { id: 'extra_split_b', midpoint: [24.5, 0, 0.1], score: 1, ordinal: 8 },
    // Brand new root cell at [-30, 4, -10]
    { id: 'extra_new_a', midpoint: [-30, 4, -10], score: 1, ordinal: 9 },
    { id: 'extra_new_b', midpoint: [-30.2, 4, -10.2], score: 1, ordinal: 10 },
  ];
  const { baseTree, extended } = verifyEquivalence(structuredBase, structuredExtra, 16, 2, 0.5);
  // Untouched subtree at [100, 0, 100] (child index 2 in base) must be shared by reference!
  assert.ok(baseTree.children && extended.children);
  assert.equal(extended.children[2], baseTree.children[2]);
  assert.notEqual(extended.children[0], baseTree.children[0]);
  assert.notEqual(extended.children[1], baseTree.children[1]);

  // 4. Sequential extensions (extend twice) match fresh build.
  const extra2: Item[] = [
    { id: 'seq0', midpoint: [20.12, 0, 0.12], score: 0, ordinal: 11 },
    { id: 'seq1', midpoint: [100.2, 0, 100.2], score: 0, ordinal: 12 },
  ];
  const extTwice = extendBoundaryTree(extended, extra2, 16, 2, 0.5);
  const freshAll = boundaryTree([...structuredBase, ...structuredExtra, ...extra2], 16, 2, 0.5);
  assert.deepEqual(
    boundaryOrder(extTwice, () => true, tiedCompare, 100).map((x) => x.id),
    boundaryOrder(freshAll, () => true, tiedCompare, 100).map((x) => x.id),
  );

  // 5. Randomized equivalence fuzzing across diverse scales, heights, and tied scores.
  let seed = 0x12345678;
  const nextRand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  for (let trial = 0; trial < 80; trial++) {
    const size = [4, 8, 16, 32][trial % 4];
    const height = [1, 2, 4][trial % 3];
    const diversity = [0.25, 0.5, 1, 8][trial % 4];
    const baseCount = trial % 15;
    const extraCount = 1 + (trial % 10);
    const makeItem = (ordinal: number): Item => ({
      id: `item_${ordinal}`,
      midpoint: [
        Math.round((nextRand() * 40 - 20) * 4) / 4,
        Math.round((nextRand() * 10 - 5) * 2) / 2,
        Math.round((nextRand() * 40 - 20) * 4) / 4,
      ],
      score: Math.floor(nextRand() * 4),
      ordinal,
    });
    const baseItems = Array.from({ length: baseCount }, (_, i) => makeItem(i));
    const extraItems = Array.from({ length: extraCount }, (_, i) => makeItem(baseCount + i));
    verifyEquivalence(baseItems, extraItems, size, height, diversity);
  }
});
