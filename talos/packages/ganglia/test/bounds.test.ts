import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { type Bounds, createBoundsIndex } from '#@/src/model/bounds.ts';

test('nearest bounds traversal orders in 3D and retains rectangle exclusions', () => {
  const entries = Array.from({ length: 40 }, (_, index) => ({
    id: index,
    min: [index % 5, Math.floor(index / 5), 0],
    max: [index % 5, Math.floor(index / 5), 0],
  }));
  const query = createBoundsIndex(entries),
    target = [1, 3.2, 0];
  const bounds = { min: [0, 1, -1], max: [3, 6, 1] };
  const expected = [...query(bounds)].map((entry) => entry.id).sort((a, b) => a - b);
  const nearest = [...query.nearest(bounds, target)];
  assert.deepEqual(
    nearest.map((entry) => entry.id).sort((a, b) => a - b),
    expected,
  );
  // The heap orders squared lower bounds. hypot can differ by one ulp for
  // equal squared bounds, so it cannot establish their ordering independently.
  const distances = nearest.map((entry) =>
    entry.min.reduce((sum, value, axis) => sum + (value - target[axis]) ** 2, 0),
  );
  assert.deepEqual(
    distances,
    [...distances].sort((a, b) => a - b),
  );
  assert.equal(nearest[0].id, 16);
});

test('filtered spatial views preserve range and nearest coverage without changing the base', () => {
  const entries = Array.from({ length: 80 }, (_, id) => ({
    id,
    min: [id % 9, id / 7, -id / 13],
    max: [(id % 9) + 0.5, id / 7 + 1, -id / 13 + 0.25],
  }));
  const base = createBoundsIndex(entries),
    selected = base.filter((entry) => entry.id % 3 === 0);
  const bounds = { min: [-100, -100, -100], max: [100, 100, 100] },
    target = [3, 2, -1];
  const distance = (entry: Bounds) =>
    entry.min.reduce(
      (sum, value, axis) =>
        sum + Math.max(value - target[axis], 0, target[axis] - entry.max[axis]) ** 2,
      0,
    );
  const expected = entries.filter((entry) => entry.id % 3 === 0);
  assert.deepEqual(
    [...selected(bounds)].map((entry) => entry.id).sort((a, b) => a - b),
    expected.map((entry) => entry.id),
  );
  assert.deepEqual(
    [...selected.nearest(bounds, target)].map(distance),
    expected.map(distance).sort((a, b) => a - b),
  );
  assert.equal([...base(bounds)].length, entries.length);
  assert.equal([...selected.filter((entry) => entry.id % 2 === 0)(bounds)].length, 14);
  assert.deepEqual([...base.filter(() => false).nearest(bounds, target)], []);
  assert.equal([...selected(bounds)].length, expected.length);
});

test('median partitions preserve overlapping, coincident and elongated bounds without mutating entries', () => {
  const entries = Array.from({ length: 257 }, (_, id) => ({
    id,
    min: [id % 3 === 0 ? -500 : (id * 37) % 101, id % 7, id % 3 === 0 ? -500 : -id % 11],
    max: [
      id % 3 === 0 ? 500 : ((id * 37) % 101) + 2,
      (id % 7) + 1,
      id % 3 === 0 ? 500 : (-id % 11) + 2,
    ],
  }));
  const original = structuredClone(entries),
    query = createBoundsIndex(entries);
  for (let i = 0; i < 31; i++) {
    const bounds = {
      min: [i * 3 - 1, i % 7, -i % 11],
      max: [i * 3 + 5, (i % 7) + 2, (-i % 11) + 3],
    };
    const expected = entries
      .filter((entry) =>
        entry.min.every(
          (value, axis) => value <= bounds.max[axis] && entry.max[axis] >= bounds.min[axis],
        ),
      )
      .map((entry) => entry.id);
    assert.deepEqual(
      [...query(bounds)].map((entry) => entry.id).sort((a, b) => a - b),
      expected,
    );
  }
  assert.deepEqual(entries, original);
});

test('group filtering preserves exact traversal prefixes including tied nearest bounds', () => {
  for (const pattern of [0, 1, 2]) {
    const entries = Array.from({ length: 193 }, (_, id) => ({
      id,
      group: pattern === 0 ? Math.floor(id / 32) : pattern === 1 ? id % 7 : 0,
      min: [id % 3, id % 5, -id % 11],
      max: [(id % 3) + 0.5, (id % 5) + 1, (-id % 11) + 2],
    }));
    const base = createBoundsIndex(entries),
      grouped = createBoundsIndex(entries, (entry) => entry.group);
    for (let mask = 0; mask < 16; mask++) {
      const eligible = (group: number) => ((mask >> (group % 4)) & 1) !== 0;
      const expected = base.filter((entry) => eligible(entry.group));
      const actual = grouped.filterGroups(eligible);
      for (const bounds of [
        { min: [-100, -100, -100], max: [100, 100, 100] },
        { min: [0, 2, -5], max: [2, 4, 0] },
      ]) {
        assert.deepEqual([...actual(bounds)], [...expected(bounds)]);
        for (const target of [
          [0, 0, 0],
          [2, 3, -1],
          [1, 1, 1],
        ] satisfies Vec3[]) {
          const a = [...actual.nearest(bounds, target)],
            b = [...expected.nearest(bounds, target)];
          assert.deepEqual(a, b);
        }
        assert.deepEqual(
          [...actual.filter((entry) => entry.id % 2 === 0)(bounds)],
          [...expected.filter((entry) => entry.id % 2 === 0)(bounds)],
        );
        assert.deepEqual(
          [...actual.filterGroups((group) => group % 2 === 0)(bounds)],
          [...expected.filter((entry) => entry.group % 2 === 0)(bounds)],
        );
      }
    }
  }
});
