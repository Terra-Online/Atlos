import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/index.ts';
import { supportEndpoints, sweepSupports } from '#@/src/model/supports.ts';

const box = (x: number, y: number, z: number): Vec3[] =>
  Array.from({ length: 8 }, (_, bits) => [
    x + (bits & 1 ? 1 : -1),
    y + (bits & 2 ? 1 : -1),
    z + (bits & 4 ? 1 : -1),
  ]);

test('coincident sweep faces retain every source body and pose interval', () => {
  const first = box(0, 0, 0),
    second = box(6, 0, 0);
  const bodies = [
    [first, first],
    [second, second],
    [first, first],
  ];
  const before = structuredClone(bodies);
  const result = sweepSupports('closed', bodies, 2);
  assert.equal(result.surfaces.length, 3);
  assert.equal(result.surfacePoses.length, result.surfaces.length);
  assert.deepEqual(result.surfacePoses, [
    [
      { body: 0, fromPose: 0, toPose: 0 },
      { body: 0, fromPose: 2, toPose: 2 },
      { body: 1, fromPose: 0, toPose: 0 },
      { body: 1, fromPose: 2, toPose: 2 },
    ],
    [
      { body: 0, fromPose: 1, toPose: 1 },
      { body: 1, fromPose: 1, toPose: 1 },
    ],
    [
      { body: 0, fromPose: 0, toPose: 1 },
      { body: 0, fromPose: 1, toPose: 2 },
      { body: 1, fromPose: 0, toPose: 1 },
      { body: 1, fromPose: 1, toPose: 2 },
    ],
  ]);
  assert.deepEqual(result.transfers, [
    { from: [0, 1, 0], to: [6, 1, 0], speed: 2, body: 0, fromPose: 0, toPose: 1 },
    { from: [6, 1, 0], to: [0, 1, 0], speed: 2, body: 0, fromPose: 1, toPose: 2 },
    { from: [0, 1, 0], to: [6, 1, 0], speed: 2, body: 1, fromPose: 0, toPose: 1 },
    { from: [6, 1, 0], to: [0, 1, 0], speed: 2, body: 1, fromPose: 1, toPose: 2 },
  ]);
  assert.deepEqual(result.poses, [
    { min: [-1, -1, -1], max: [1, 1, 1] },
    { min: [5, -1, -1], max: [7, 1, 1] },
    { min: [-1, -1, -1], max: [1, 1, 1] },
  ]);
  assert.deepEqual(supportEndpoints(bodies), {
    initial: result.poses[0],
    terminal: result.poses[2],
  });
  assert.deepEqual(bodies, before);
});

test('pose boxes enclose the whole support while face and ride references identify individual bodies', () => {
  const result = sweepSupports(
    'two-bodies',
    [
      [box(0, 0, 0), box(4, 2, 0)],
      [box(0, 8, 0), box(4, 10, 0)],
    ],
    null,
  );
  assert.deepEqual(result.poses, [
    { min: [-1, -1, -1], max: [5, 3, 1] },
    { min: [-1, 7, -1], max: [5, 11, 1] },
  ]);
  assert.deepEqual(result.surfacePoses, [
    [{ body: 0, fromPose: 0, toPose: 0 }],
    [{ body: 0, fromPose: 1, toPose: 1 }],
    [{ body: 1, fromPose: 0, toPose: 0 }],
    [{ body: 1, fromPose: 1, toPose: 1 }],
  ]);
  assert.deepEqual(result.transfers, [
    { from: [0, 1, 0], to: [0, 9, 0], speed: null, body: 0, fromPose: 0, toPose: 1 },
    { from: [4, 3, 0], to: [4, 11, 0], speed: null, body: 1, fromPose: 0, toPose: 1 },
  ]);
});
