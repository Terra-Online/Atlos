import { expect, it } from 'vitest';
import { clusterPositions, SpatialClusterCache } from './spatialClusters';

const points = (xs: number[]) => xs.map(x => ({ x, y: 0 }));
const direct = (xs: number[], scale = 1, radius = 1) => clusterPositions(
  points(xs).map((point, item) => ({ ...point, item })), scale, radius,
).map(({ members, x, y }) => ({ members, x, y }));

it('reuses ordered geometry while returning only indices and numerical centers', () => {
  const cache = new SpatialClusterCache();
  const first = cache.get(points([0, 0.8, 1.5]), 1, 1);
  expect(first).toEqual([{ members: [0, 1], x: 0.4, y: 0 }, { members: [2], x: 1.5, y: 0 }]);
  expect(cache.get(points([0, 0.8, 1.5]), 1, 1)).toBe(first);
});

it('invalidates changed membership, input order, coordinates, scale and radius without altering the greedy result', () => {
  const cache = new SpatialClusterCache(), original = points([0, 0.8, 1.5]);
  cache.get(original, 1, 1);
  original[1].x = 0.1;
  for (const [xs, scale, radius] of [
    [[0, 0.1, 1.5], 1, 1], [[1.5, 0.8, 0], 1, 1], [[0, 1.5], 1, 1],
    [[0, 0.8, 1.5], 0.5, 1], [[0, 0.8, 1.5], 1, 0.5],
  ] as const) {
    expect(cache.get(points([...xs]), scale, radius)).toEqual(direct([...xs], scale, radius));
  }
  expect(cache.get(points([0, 0.8, 1.5]), 1, 1)).toEqual(direct([0, 0.8, 1.5]));
});

it('bounds retained membership snapshots and scale/radius combinations', () => {
  const cache = new SpatialClusterCache(), first = cache.get(points([0]), 1, 1);
  for (let i = 1; i <= 4; i++) cache.get(points([i]), 1, 1);
  expect(cache.get(points([0]), 1, 1)).not.toBe(first);
  const layout = cache.get(points([0]), 2, 1);
  for (let scale = 3; scale <= 6; scale++) cache.get(points([0]), scale, 1);
  expect(cache.get(points([0]), 2, 1)).not.toBe(layout);
});

it('evicts old geometry at the total point budget and does not retain oversized inputs', () => {
  const cache = new SpatialClusterCache(), full = points(Array.from({ length: 8192 }, (_, i) => i * 100));
  const first = cache.get(full, 1, 1);
  cache.get(points([0]), 1, 1);
  expect(cache.get(full, 1, 1)).not.toBe(first);
  const oversized = [...full, { x: 1_000_000, y: 0 }];
  expect(cache.get(oversized, 1, 1)).not.toBe(cache.get(oversized, 1, 1));
});
