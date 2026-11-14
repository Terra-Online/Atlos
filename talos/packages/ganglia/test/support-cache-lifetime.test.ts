import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import { gangliaV1Defaults } from '#@/src/solver/ganglia-v1.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { verticalProjectionCandidates } from '#@/src/v1/geo/support-projector.ts';
import { landingCandidates } from '#@/src/v1/motion/landings.ts';
import { createPhysicalPreparation } from '#@/src/v1/solver/physical/host.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';
import { releaseSupportCaches } from '#@/src/v1/solver/physical/support-cache.ts';
import { physicalWork } from '#@/src/v1/solver/physical/work.ts';
import { createWindowGroundCache } from '#@/src/v1/solver/window-route.ts';

const model = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 1,
  maxFallingSpeed: 10,
  apexTime: 0,
  maxHorizontalSpeed: 2,
  startHorizontalSpeed: 2,
  airOverspeedDeceleration: 5,
  airAcceleration: 60,
  airDeceleration: 10,
};
const region = (x: number): PhysicalInput => ({
  ground: {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [x, 0, 0],
          [x, 0, 4],
          [x + 4, 0, 4],
          [x + 4, 0, 0],
        ],
      },
    ],
    options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
  },
  collision: {
    positions: [x, 0, 0, x, 0, 4, x + 4, 0, 4, x + 4, 0, 0],
    indices: [0, 1, 2, 0, 2, 3],
  },
  movement: { model, maxSlope: 45, runAirSpeed: 1, stepUp: 0.4, stepDown: 0.6 },
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
});
const query = (x: number) => ({
  starts: [{ id: 'player', position: [x + 1, 0, 1] as Vec3, state: 'available' as const, cost: 3 }],
  goal: [x + 3, 0, 1] as Vec3,
});
const translate = (input: PhysicalInput, dx: number) => {
  for (const face of input.ground.surfaces) for (const point of face.vertices) point[0] += dx;
  for (let index = 0; index < input.collision.positions.length; index += 3)
    input.collision.positions[index] += dx;
};

test('retiring support memos permits rebuilding inputs while active projectors retain their snapshot', () => {
  const input = region(0),
    surfaces = input.ground.surfaces,
    face = surfaces[0];
  const retained = createGoalProjector(surfaces);
  verticalProjectionCandidates(surfaces, [1, 0, 1], 0.5);
  [...landingCandidates(face, [1, 0, 1], [3, 0, 1], model, 0.2)];
  releaseSupportCaches(surfaces);
  translate(input, 20);
  assert.deepEqual(verticalProjectionCandidates(surfaces, [21, 0, 1], 0.5), [face]);
  const freshFace = structuredClone(face);
  assert.deepEqual(
    [...landingCandidates(face, [21, 0, 1], [23, 0, 1], model, 0.2)],
    [...landingCandidates(freshFace, [21, 0, 1], [23, 0, 1], model, 0.2)],
  );
  assert.equal(retained([1, 0, 1], { maxVertical: 0.5 })[0].surface, 'floor');
  assert.deepEqual(retained([21, 0, 1], { maxVertical: 0.5 }), []);
  assert.equal(createGoalProjector(surfaces)([21, 0, 1], { maxVertical: 0.5 })[0].surface, 'floor');
});

test('host preparation keeps a repeated region warm and rebuilds retired regions on switch or clear', async () => {
  const host = createPhysicalPreparation();
  const inputs = [region(0), region(10)];
  const reused: boolean[] = [];
  const solve = async (input: PhysicalInput, x: number, binding: string) => {
    const result = await host.solve(input, query(x), {
      binding,
      config: gangliaV1Defaults,
      work: physicalWork(0),
      onResult(_result, _optimizing, diagnostics) {
        const reuse = (diagnostics as { prepareReuse?: { ground?: boolean } }).prepareReuse;
        if (typeof reuse?.ground === 'boolean') reused.push(reuse.ground);
      },
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') {
      assert.deepEqual(result.route.points[0], query(x).starts[0].position);
      assert.deepEqual(result.route.points.at(-1), query(x).goal);
      assert.equal(result.route.arrivalCost, 3);
    }
    return result.route;
  };
  try {
    const first = await solve(inputs[0], 0, 'a');
    const repeated = await solve(inputs[0], 0, 'a');
    assert.deepEqual(repeated, first);
    assert.ok(reused.includes(true), 'Per-solve close must retain the shared host preparation');
    await solve(inputs[1], 10, 'b');
    translate(inputs[0], 20);
    await solve(inputs[0], 20, 'a-rebuilt');
    host.clear();
    translate(inputs[0], 20);
    await solve(inputs[0], 40, 'a-after-clear');
  } finally {
    host.clear();
  }
});

test('closing a directly owned physical solver retires its raw support index', async () => {
  const input = region(0);
  const first = await preparePhysicalSolver(input, gangliaV1Defaults, { effort: 'walking' });
  try {
    assert.equal((await first.solve(query(0))).route.status, 'complete');
  } finally {
    await first.close();
  }
  translate(input, 20);
  const second = await preparePhysicalSolver(input, gangliaV1Defaults, { effort: 'walking' });
  try {
    assert.equal((await second.solve(query(20))).route.status, 'complete');
  } finally {
    await second.close();
  }
});

for (const retirement of ['switch', 'clear'] as const)
  test(`window ${retirement} retires a pending load after resolution without invalidating its projector`, async () => {
    const input = region(0);
    const cache = createWindowGroundCache();
    let resolve!: (value: PhysicalInput['ground']) => void;
    const pending = cache.get('a', () => new Promise((done) => (resolve = done)));
    if (retirement === 'switch') await cache.get('b', async () => region(10).ground);
    else cache.clear();
    resolve(input.ground);
    const previous = await pending;
    translate(input, 20);
    const rebuilt = await cache.get('a-rebuilt', async () => input.ground);
    assert.equal(previous.project([1, 0, 1], { maxVertical: 0.5 })[0].surface, 'floor');
    assert.deepEqual(previous.project([21, 0, 1], { maxVertical: 0.5 }), []);
    assert.equal(rebuilt.project([21, 0, 1], { maxVertical: 0.5 })[0].surface, 'floor');
    cache.clear();
  });

test('retiring a failed window load permits a later valid load', async () => {
  const cache = createWindowGroundCache();
  let reject!: (error: Error) => void;
  const failed = cache.get('a', () => new Promise((_done, fail) => (reject = fail)));
  cache.clear();
  const rejection = assert.rejects(failed, /unavailable/);
  reject(new Error('unavailable'));
  await rejection;
  const rebuilt = await cache.get('a', async () => region(0).ground);
  assert.equal(rebuilt.project([1, 0, 1], { maxVertical: 0.5 })[0].surface, 'floor');
  cache.clear();
});
