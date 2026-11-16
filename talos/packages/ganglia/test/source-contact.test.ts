import assert from 'node:assert/strict';
import { test } from 'node:test';

import { verifyRoute } from '#@/src/evaluation/index.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import { gangliaV1Defaults } from '#@/src/solver/index.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import {
  solvePhysicalRoute,
  type PhysicalCache,
  type PhysicalResult,
} from '#@/src/v1/solver/physical/solve.ts';
import { sourceContact, proveSourceContact } from '#@/src/v1/solver/physical/source-contact.ts';

const floor = {
  id: 'ground',
  vertices: [
    [2, 0, -2],
    [2, 0, 2],
    [6, 0, 2],
    [6, 0, -2],
  ] as Vec3[],
};
const cap = [
  [-1, 0, -0.05],
  [-1, 0, 0.05],
  [0, 0, 0.05],
  [0, 0, -0.05],
] as Vec3[];
const input: PhysicalInput = {
  ground: {
    surfaces: [floor],
    tiles: [
      { x: -1, z: -1 },
      { x: -1, z: 0 },
      { x: 0, z: -1 },
      { x: 0, z: 0 },
    ],
    build: { bounds: { min: [-2, -2], max: [7, 2] }, cellSize: 0.15, cellHeight: 0.05 },
    options: { speed: 1, maxVertical: 0.5, walls: [], profile: { radius: 0.2, height: 1.6 } },
  },
  collision: {
    positions: [...floor.vertices.flat(), ...cap.flat()],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  },
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
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
};
const start = {
  id: 'resolved',
  position: [-0.75, 0.005, 0] as Vec3,
  state: 'available' as const,
  cost: 0,
};
const prepare = (scene: PhysicalInput) => ({
  geometry: scene.collision,
  world: createCollisionWorld(scene.collision, { bounds: scene.ground.build!.bounds }),
});
const admit = (scene = input, arrival = start) =>
  sourceContact(
    scene,
    arrival,
    [arrival.position[1] - 0.5, arrival.position[1] + 0.5],
    prepare(scene),
    scene.ground.options.walls,
  );
const policy = { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 };

test('source admission uses actual unchanged sphere contact and declared body coverage', () => {
  const original = structuredClone(input),
    contact = admit();
  assert.equal(contact.status, 'accepted');
  if (contact.status === 'accepted') {
    assert.equal(contact.kind, 'source-triangle');
    assert.deepEqual(contact.arrival.position, start.position);
    assert.ok(
      contact.world.groundAt(start.position, {
        maxUp: 0.01,
        maxDown: 0.01,
        maxSlope: 45,
        radius: 0.2,
      }),
    );
  }
  assert.deepEqual(input, original);
  const unknown = structuredClone(input);
  delete unknown.ground.tiles;
  assert.deepEqual(admit(unknown), { status: 'rejected', reason: 'coverage-undeclared' });
  const missing = structuredClone(input);
  missing.ground.tiles = missing.ground.tiles!.filter((t) => t.x !== -1);
  assert.deepEqual(admit(missing), { status: 'rejected', reason: 'coverage-incomplete' });
  assert.equal(admit(input, { ...start, position: [-0.75, 0.1, 0] }).status, 'rejected');
  assert.deepEqual(
    sourceContact(input, { ...start, state: 'locked' }, [-1, 1], prepare(input), []),
    { status: 'rejected', reason: 'arrival-unavailable' },
  );
  const blocked = structuredClone(input);
  blocked.ground.options.walls = [
    { min: [-0.9, -0.1, -0.1], max: [-0.6, 2, 0.1], state: 'active' },
  ];
  assert.deepEqual(admit(blocked), { status: 'rejected', reason: 'body-blocked' });
  const occupied = structuredClone(input);
  occupied.devices = {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'body',
        level: 'fixture',
        model: 'fixture',
        spawn: [-0.75, 0, 0],
        geometryKind: 'box',
        bodies: [
          Array.from({ length: 8 }, (_, bits): Vec3 => [
            bits & 1 ? -0.45 : -1.05,
            bits & 2 ? 2 : -0.1,
            bits & 4 ? 0.3 : -0.3,
          ]),
        ],
        maxDistance: 1,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  };
  assert.deepEqual(admit(occupied), { status: 'rejected', reason: 'body-blocked' });
});

test('source contact charts are query-local and reuse one terrain index without mutating provider input', async () => {
  const original = structuredClone(input),
    cache = createPhysicalCache();
  let collisionCalls = 0,
    collisionBuilds = 0;
  const keys: string[] = [];
  const observed: PhysicalCache = {
    ...cache,
    async memo(slot, key, create, scope) {
      const result = await cache.memo(slot, key, create, scope);
      if (slot === 'collision') {
        collisionCalls++;
        if (!result.reused) collisionBuilds++;
      }
      if (slot === 'ground') keys.push(key);
      return result;
    },
  };
  for (const x of [-0.75, -0.7]) {
    const arrival = { ...start, position: [x, 0.005, 0] as Vec3 };
    const results: PhysicalResult[] = [];
    await solvePhysicalRoute(
      input,
      { arrival, target: [-0.65, 0.005, 0], walls: [] },
      {
        cache: observed,
        effort: 'all',
        emit(result) {
          results.push(result);
        },
      },
      policy,
    );
    const route = results.at(-1)?.route;
    assert.ok(route?.status === 'complete', JSON.stringify(results));
    assert.equal(route.points[0][0], arrival.position[0]);
    assert.equal(route.points[0][2], arrival.position[2]);
    assert.ok(Math.abs(route.points[0][1] - arrival.position[1]) <= 0.5);
  }
  assert.equal(collisionCalls, 2);
  assert.equal(collisionBuilds, 1);
  assert.notEqual(keys[0], keys.at(-1));
  assert.deepEqual(input, original);
  cache.clear();
});

test('a sphere-edge contact chart does not authorize walking into an actual wall', async () => {
  const scene = structuredClone(input),
    prepared = prepare(scene),
    point: Vec3 = [-0.75, 0, 0.1];
  const hit = prepared.world.groundAt(point, {
    maxUp: 0.5,
    maxDown: 0.5,
    maxSlope: 45,
    radius: 0.2,
  })!;
  const arrival = { ...start, position: [point[0], hit.position[1] + 0.005, point[2]] as Vec3 };
  const clear = sourceContact(scene, arrival, [-0.5, 0.5], prepared, []);
  assert.equal(clear.status, 'accepted');
  if (clear.status === 'accepted') assert.equal(clear.kind, 'contact-point');
  scene.ground.options.walls = [
    { min: [point[0] + 0.21, -1, -1], max: [point[0] + 1, 2, 1], state: 'active' },
  ];
  const admitted = sourceContact(scene, arrival, [-0.5, 0.5], prepared, scene.ground.options.walls);
  assert.equal(admitted.status, 'accepted');
  const results: PhysicalResult[] = [];
  await solvePhysicalRoute(
    scene,
    { arrival, target: [point[0] + 0.04, arrival.position[1], point[2]], walls: [] },
    {
      effort: 'walking',
      emit(result) {
        results.push(result);
      },
    },
    policy,
  );
  assert.ok(results.every((r) => r.route?.status !== 'complete'));
});

test('walking effort never executes an authored device after source contact admission', async () => {
  const scene = structuredClone(input);
  scene.ground.options.connections = [
    {
      id: 'authored-rope',
      mode: 'rope',
      state: 'open',
      points: [start.position, [3, 0.005, 0]],
      times: [0, 1],
      endpointTolerance: 0.2,
    },
  ];
  const cache = createPhysicalCache();
  for (const effort of ['all', 'walking'] as const) {
    const results: PhysicalResult[] = [];
    await solvePhysicalRoute(
      scene,
      { arrival: start, target: [3, 0.005, 0], walls: [] },
      {
        cache,
        effort,
        emit(result) {
          results.push(result);
        },
      },
      policy,
    );
    if (effort === 'walking') assert.ok(results.every((r) => r.route?.status !== 'complete'));
    else {
      const route = results.at(-1)?.route;
      assert.ok(route?.status === 'complete', JSON.stringify(results));
      assert.ok(route.segments.some((s) => s.mode === 'rope'));
      assert.equal(route.points[0][0], start.position[0]);
      assert.equal(route.points[0][2], start.position[2]);
      assert.ok(Math.abs(route.points[0][1] - start.position[1]) <= 0.5);
      const evaluation = verifyRoute({ starts: [start], goal: [3, 0.005, 0] }, route, {
        maxVertical: scene.ground.options.maxVertical,
      });
      assert.equal(evaluation.valid, true, JSON.stringify(evaluation));
    }
  }
});

test('source binding preserves native navigation height, geometry and boost clocks', () => {
  const scene = structuredClone(input);
  const prepared = prepare(scene);
  const contact = sourceContact(scene, start, [-0.5, 0.5], prepared, []);
  assert.ok(contact.status === 'accepted');
  assert.equal(contact.world, prepared.world);
  const surface = { ...floor, vertices: floor.vertices.map(([x, , z]): Vec3 => [x - 3, 0.07, z]) };
  const planner = createGroundPlanner([surface], scene.ground.options);
  const route = planner.plan([start], [-0.65, 0.07, 0]);
  assert.ok(route.status === 'complete');
  assert.equal(route.points[0][1], 0.07);
  const boosted = {
    ...route,
    segments: route.segments.map((segment) => ({
      ...segment,
      boost: { id: 'fixture', multiplier: 1.5, duration: 10 },
      boostExpiry: 10,
    })),
  };
  const original = structuredClone(boosted);
  assert.equal(proveSourceContact(boosted, contact), boosted);
  assert.deepEqual(boosted, original);
  for (const changed of [
    { ...boosted, start: 'other' },
    { ...boosted, arrivalCost: 1 },
    { ...boosted, points: [[-0.7, 0.07, 0] as Vec3, ...boosted.points.slice(1)] },
    { ...boosted, points: [[-0.75, 0.6, 0] as Vec3, ...boosted.points.slice(1)] },
  ])
    assert.notEqual(proveSourceContact(changed, contact).status, 'complete');
});
