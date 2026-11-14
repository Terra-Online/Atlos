import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { executeRoute } from '#@/src/v1/solver/physical/execution.ts';
import { localGround } from '#@/src/v1/solver/physical/local-ground.ts';

const input: PhysicalInput = {
  ground: {
    surfaces: [],
    options: {
      walls: [{ min: [4.8, -1, 3], max: [5.2, 3, 7], state: 'active' }],
      profile: { radius: 0.2, height: 1.6 },
      speed: 2,
      maxVertical: 0.5,
    },
  },
  collision: { positions: [0, 0, 0, 0, 0, 10, 12, 0, 10, 12, 0, 0], indices: [0, 1, 2, 0, 2, 3] },
  movement: {
    model: {
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
    },
    maxSlope: 45,
    runAirSpeed: 2,
    stepUp: 0.4,
    stepDown: 0.6,
  },
  locomotion: { speed: 2, sprintSpeed: 3, sprintAcceleration: 1 },
};
const query: RouteQuery = {
  starts: [{ id: 'start', state: 'available', position: [2, 0, 5], cost: 1 }],
  goal: [8, 0, 5],
};

test('local raw walking returns separately verifiable grid and smoothed wall detours', () => {
  const before = structuredClone(input),
    snapshot = createPhysicalWorld(input, 'complete');
  const result = localGround(snapshot, query, { maxExpanded: 512 });
  assert.equal(result.routes.length, 2);
  assert.ok(result.diagnostics.expanded > 0 && result.diagnostics.expanded <= 512);
  assert.ok(result.diagnostics.shortcutProofs <= 64);
  const verifier = createPhysicalVerifier(() => [snapshot]);
  for (const proposal of result.routes) {
    const route = executeRoute(proposal, query, snapshot);
    assert.equal(route.status, 'complete');
    const verified = verifier(query, route);
    assert.equal(verified.valid, true, JSON.stringify(verified));
  }
  assert.ok(result.routes[0].status === 'complete' && result.routes[1].status === 'complete');
  assert.ok(result.routes[1].length < result.routes[0].length);
  assert.deepEqual(input, before);
});

test('interaction and airborne walking proposals retain the original goal contract', () => {
  const snapshot = createPhysicalWorld(input, 'complete');
  const interacting: RouteQuery = {
    ...query,
    goal: [8, 0.5, 5],
    interaction: {
      radius: 0.8,
      maxVertical: 0.6,
      facing: [1, 0, 0],
      halfAngle: 45,
      airborne: true,
    },
  };
  const result = localGround(snapshot, interacting, { maxExpanded: 512 });
  assert.ok(result.routes.length > 0);
  for (const proposal of result.routes) {
    const route = executeRoute(proposal, interacting, snapshot);
    assert.ok(route.status === 'complete');
    assert.ok(route.goalHit);
    assert.deepEqual(route.points.at(-1), route.goalHit.position);
    const verified = createPhysicalVerifier(() => [snapshot])(interacting, route);
    assert.equal(verified.valid, true, JSON.stringify(verified));
  }
});

test('sparse coverage holes remain unknown and do not become walkable shortcuts', () => {
  const snapshot = createPhysicalWorld(
    { ...input, ground: { ...input.ground, options: { ...input.ground.options, walls: [] } } },
    {
      bounds: { min: [0, 0], max: [12, 4] },
      tileSpan: 4,
      tiles: [
        { x: 0, z: 0 },
        { x: 2, z: 0 },
      ],
    },
  );
  const result = localGround(
    snapshot,
    {
      starts: [{ ...query.starts[0], position: [2, 0, 2] }],
      goal: [10, 0, 2],
    },
    { maxExpanded: 128 },
  );
  assert.deepEqual(result.routes, []);
  assert.ok(result.diagnostics.coverageMissing > 0);
  assert.equal(result.diagnostics.truncated, true);
});

test('local walking obeys its shared expansion allowance and never ignores ordered waypoints', () => {
  const snapshot = createPhysicalWorld(input, 'complete');
  const limited = localGround(snapshot, query, { maxExpanded: 3 });
  assert.deepEqual(limited.routes, []);
  assert.equal(limited.diagnostics.expanded, 3);
  assert.equal(limited.diagnostics.reason, 'budget');
  assert.equal(limited.diagnostics.truncated, true);
  const skipped = localGround(
    snapshot,
    { ...query, waypoints: [[3, 0, 9]] },
    { maxExpanded: 10000 },
  );
  assert.deepEqual(skipped.routes, []);
  assert.equal(skipped.diagnostics.maxExpanded, 2048);
  assert.equal(skipped.diagnostics.reason, 'unsupported-query');
});

test('local walking observes cancellation during physical proof work', () => {
  const snapshot = createPhysicalWorld(input, 'complete');
  const controller = new AbortController();
  let checks = 0;
  const interruptible = {
    ...snapshot,
    covered(...args: Parameters<typeof snapshot.covered>) {
      if (++checks === 8) controller.abort();
      return snapshot.covered(...args);
    },
  };
  assert.throws(
    () => localGround(interruptible, query, { maxExpanded: 512, signal: controller.signal }),
    { name: 'AbortError' },
  );
});
