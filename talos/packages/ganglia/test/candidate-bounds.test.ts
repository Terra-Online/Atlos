import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import type { JumpModel } from '#@/src/movement.ts';
import { jumpDuration } from '#@/src/v1/motion/jumps.ts';
import { landingCandidates } from '#@/src/v1/motion/landings.ts';
import { type Face, createCandidateBounds } from '#@/src/v1/search/candidate-bounds.ts';

const model: JumpModel = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 20,
  apexTime: 0.2,
  maxHorizontalSpeed: 20,
};
const floor = (id: string, x0: number, x1: number, y: number, z0 = 1, z1 = 2): Face => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
  min: [x0, y, z0],
  max: [x1, y, z1],
});
const distance = (a: number[], b: Vec3) => Math.hypot(...a.map((value, axis) => value - b[axis]));
const cellOf = (point: Vec3, size: number) =>
  point.map((value) => Math.floor(value / size)).join('/');

test('face bounds preserve the exact top K selected from real landing witnesses', () => {
  const diversity = 20,
    speed = 7,
    endpointTolerance = 0.3,
    limit = 2;
  const start: { cell?: string | undefined; position: Vec3; walk: number } = {
      position: [2, 0, 1.5],
      walk: 3,
      cell: '0/0/0',
    },
    to: Vec3 = [22.5, 0, 1.5];
  const surfaces: Face[] = [
    floor('best', 22, 23, 0),
    ...Array.from({ length: 24 }, (_, index) =>
      floor(`far/${index}`, 24 + index / 8, 24.5 + index / 8, 0),
    ),
    floor('apex-fallback', 26, 27, 2.1),
    floor('reach-intersection', 29, 33, 0),
  ];
  const centers = new Map<string, Vec3>(
    surfaces.map((surface) => [
      surface.id,
      surface.min.map((value, axis) => (value + surface.max[axis]) / 2) as Vec3,
    ]),
  );
  const departure = new Map(surfaces.slice(8, 16).map((surface) => [surface.id, 20]));
  const collect = (bounded: boolean) => {
    const pairs = new Map<string, { score: number; uncertain: boolean }[]>();
    const dominated = createCandidateBounds({
      model,
      endpointTolerance,
      diversity,
      speed,
      to,
      centers,
      departure,
      pairs,
      limit,
    });
    let pruned = 0;
    for (const surface of surfaces) {
      if (bounded && dominated(start, surface)) {
        pruned++;
        continue;
      }
      for (const end of landingCandidates(surface, start.position, to, model, 0.3)) {
        const span = Math.hypot(
          start.position[0] - end.position[0],
          start.position[2] - end.position[2],
        );
        const duration = jumpDuration(
          start.position[1] + endpointTolerance,
          end.position[1] - endpointTolerance,
          { ...model, mode: 'jump' },
        );
        if (duration === null || span > duration * model.maxHorizontalSpeed) continue;
        const nominal = jumpDuration(start.position[1], end.position[1], {
          ...model,
          mode: 'jump',
        });
        const remaining = departure.has(end.surface)
          ? departure.get(end.surface)! + distance(centers.get(end.surface)!, end.position)
          : distance(end.position, to);
        const candidate = {
          start,
          end,
          score: (start.walk + remaining) / speed + (nominal ?? duration),
          uncertain: nominal === null || span > nominal * model.maxHorizontalSpeed,
        };
        const key = `${start.cell}:${cellOf(end.position, diversity)}`,
          group = pairs.get(key) ?? [];
        group.push(candidate);
        group.sort((a, b) => Number(a.uncertain) - Number(b.uncertain) || a.score - b.score);
        if (group.length > limit) group.pop();
        pairs.set(key, group);
      }
    }
    return { pairs, pruned };
  };
  const full = collect(false),
    bounded = collect(true);
  assert.ok(bounded.pruned > 0);
  assert.deepEqual(bounded.pairs, full.pairs);
});

test('keeps uncertain tails, incomplete covered cells and score ties', () => {
  const pairs = new Map<string, { score: number; uncertain: boolean }[]>(),
    surface: Face = floor('face', 22, 23, 0),
    start: { cell?: string | undefined; position: Vec3; walk: number } = {
      position: [2, 0, 1.5],
      walk: 3,
      cell: '0/0/0',
    };
  const options: Parameters<typeof createCandidateBounds>[0] = {
    model,
    endpointTolerance: 0.3,
    diversity: 20,
    speed: 7,
    to: [0, 0, 0],
    centers: new Map(),
    departure: new Map(),
    pairs,
    limit: 2,
  };
  const dominated = createCandidateBounds(options),
    key = '0/0/0:1/0/0';
  pairs.set(key, [
    { score: 0, uncertain: false },
    { score: 0, uncertain: true },
  ]);
  assert.equal(dominated(start, surface), false);
  pairs.set(key, [{ score: 0, uncertain: false }]);
  assert.equal(dominated(start, surface), false);
  pairs.set(key, [
    { score: 0, uncertain: false },
    { score: 0, uncertain: false },
  ]);
  assert.equal(dominated(start, surface), true);
  assert.equal(dominated(start, floor('crosses-cell', 19, 23, 0)), false);
  const time = jumpDuration(0, 0, { ...model, mode: 'jump' });
  assert.ok(time);
  const score = (start.walk + distance([22, 0, 1], options.to)) / options.speed + time;
  pairs.set(key, [
    { score, uncertain: false },
    { score, uncertain: false },
  ]);
  assert.equal(dominated(start, surface), false);
});

test('falls back when tiny cells overflow or lose integer increments', () => {
  for (const height of [2 ** 54, -(2 ** 54)]) {
    const pairs = new Map<string, { score: number; uncertain: boolean }[]>(),
      cell = `0/${height}/0`;
    pairs.set(`${cell}:0/${height}/0`, [{ score: 0, uncertain: false }]);
    const dominated = createCandidateBounds({
      model,
      diversity: 1,
      speed: 7,
      to: [0, height, 0],
      centers: new Map(),
      departure: new Map(),
      pairs,
      limit: 1,
    });
    const surface: Face = floor('high', 0.1, 0.2, height, 0.1, 0.2);
    const start: { cell?: string | undefined; position: Vec3; walk: number } = {
      position: [0, height, 0],
      walk: 0,
      cell,
    };
    assert.equal(dominated(start, surface), false);
    assert.equal(dominated(start, surface), false);
  }
  const dominated = createCandidateBounds({
    model,
    diversity: Number.MIN_VALUE,
    speed: 7,
    to: [0, 0, 0],
    centers: new Map(),
    departure: new Map(),
    pairs: new Map(),
    limit: 1,
  });
  assert.equal(dominated({ position: [0, 0, 0], walk: 0 }, floor('overflow', 1, 2, 0)), false);
});
