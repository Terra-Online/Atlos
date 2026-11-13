import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  boundaryOrder,
  boundaryOrderIterator,
  boundaryTree,
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
