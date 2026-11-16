import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/index.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import { sweepSupports } from '#@/src/model/supports.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { PhysicalInput } from '#@/src/solver/index.ts';
import { prepareMovingDirect } from '#@/src/v1/solver/physical/moving-direct.ts';
const body = (x: number): Vec3[] =>
  Array.from({ length: 8 }, (_, b) => [x + (b & 1 ? 2 : 0), b & 2 ? 5 : 4.5, b & 4 ? 2 : 0]);
const input: PhysicalInput = {
  ground: {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [-1, 0, -1],
          [-1, 0, 8],
          [8, 0, 8],
          [8, 0, -1],
        ],
      },
    ],
    options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
    build: { bounds: { min: [-1, -1], max: [8, 8] }, cellHeight: 0.05, cellSize: 0.2 },
  },
  collision: { positions: [-1, 0, -1, -1, 0, 8, 8, 0, 8, 8, 0, -1], indices: [0, 1, 2, 0, 2, 3] },
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
    runAirSpeed: 1,
    stepUp: 0.4,
    stepDown: 0.6,
  },
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
  devices: {
    devices: [],
    ropes: [],
    movingSupports: [
      {
        id: 'conveyor',
        family: 'conveyor',
        level: 'fixture',
        model: 'fixture',
        assumption: 'phase-free-swept-support',
        ...sweepSupports('conveyor', [[body(0)], [body(4)]], null),
      },
    ],
  },
};
const create = (scene: PhysicalInput, walls = scene.ground.options.walls) =>
  prepareMovingDirect(
    scene,
    { geometry: scene.collision, world: createCollisionWorld(scene.collision) },
    walls,
    createGoalProjector(scene.ground.surfaces),
  );
const request = {
  arrival: { id: 'player', position: [3, 5, 1] as Vec3, cost: 0, state: 'available' as const },
  target: [3.75, 5, 1] as Vec3,
  interaction: { radius: 0.2, maxVertical: 0.2 },
  walls: [],
};
test('stationary conveyor walking requires one common translating pose and retains its exact box', () => {
  const direct = create(input),
    result = direct.plan(request);
  assert.equal(result.route.status, 'complete');
  if (result.route.status !== 'complete') return;
  assert.ok(result.route.segments.every((s) => s.mode === 'walk'));
  assert.equal(result.connections.length, 0);
  const boxes = direct.annotate(result.route, result.connections);
  assert.equal(boxes.length, 1);
  const box = boxes[0];
  assert.equal(box.role, 'use');
  assert.ok(box.min[0] <= 3 && box.max[0] >= 3.75);
  assert.equal(box.max[0] - box.min[0], 2);
  const again = direct.plan({ ...request, target: [3.25, 5, 1] });
  assert.equal(again.route.status, 'complete');
  assert.deepEqual(direct.annotate(result.route, result.connections), boxes);
  assert.equal(
    createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      { starts: [request.arrival], goal: request.target, interaction: request.interaction },
      result.route,
    ).valid,
    true,
  );
  const span = {
    ...request,
    arrival: { ...request.arrival, position: [1, 5, 1] as Vec3 },
    target: [5, 5, 1] as Vec3,
  };
  assert.notEqual(direct.plan(span).route.status, 'complete');
  assert.notEqual(
    create(input, [{ min: [3.3, 4, 0], max: [3.5, 7, 2], state: 'active' }]).plan(request).route
      .status,
    'complete',
  );
});
test('bounds-compatible cap shape changes do not prove a translation', () => {
  const changed = structuredClone(input),
    support = changed.devices!.movingSupports![0];
  const cap = support.surfaces.find((_, i) =>
    support.surfacePoses![i].some((s) => s.fromPose === 1 && s.toPose === 1),
  )!;
  cap.vertices[0][0] += 0.25;
  assert.notEqual(create(changed).plan(request).route.status, 'complete');
  const multi = structuredClone(input);
  multi.devices!.movingSupports![0] = {
    ...support,
    ...sweepSupports(
      'multi',
      [
        [body(0), body(1)],
        [body(4), body(6)],
      ],
      null,
    ),
  };
  assert.notEqual(create(multi).plan(request).route.status, 'complete');
});
