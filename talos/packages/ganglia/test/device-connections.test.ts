import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface } from '#@/src/geometry.ts';
import type { DeviceFacts } from '#@/src/solver/physical.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { createDeviceConnections } from '#@/src/v1/solver/physical/devices.ts';

const floor = (id: string, left: number, right: number): Surface => ({
  id,
  vertices: [
    [left, 0, -2],
    [left, 0, 2],
    [right, 0, 2],
    [right, 0, -2],
  ],
});
const surfaces = [floor('entry', -5, 0), floor('landing', 3, 12)];
const facts: DeviceFacts = {
  devices: [
    {
      id: 'pad',
      kind: 'launch',
      position: [-1, 0, 0],
      goal: { position: [-1, 0, 0], interaction: { radius: 0.4 } },
      seeds: [[-1, 0, 0]],
      unitScale: true,
      resolved: true,
      speed: 0,
      overhead: 0,
      duration: null,
      fixedLaunch: false,
      freeLaunch: true,
      aim: [4, 0, 0],
      height: 3,
      aimClearance: 20,
      boostMultiplier: 1,
    },
  ],
  ropes: [],
};
const profile = { radius: 0.2, height: 1.8 };
const options = {
  surfaces,
  world: createCollisionWorld({
    positions: surfaces.flatMap((s) => s.vertices.flat()),
    indices: surfaces.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((v) => v + i * 4)),
  }),
  profile,
  walls: [],
  model: { gravity: 10, fallingGravity: 20, maxFallingSpeed: 12, apexTime: 0.1 },
  maxSlope: 45,
  runAirSpeed: 6,
};
const plan = (connections: ReturnType<typeof createDeviceConnections>['connections']) =>
  createGroundPlanner(surfaces, {
    speed: 4,
    maxVertical: 0.5,
    profile,
    connections,
    walls: [],
  }).plan([{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }], [6, 0, 0]);

test('free launch connects separated ground with timed bounded flight and preserves source facts', () => {
  const original = structuredClone(facts);
  const result = createDeviceConnections(facts, options);
  const route = plan(result.connections);
  assert.equal(route.status, 'complete', JSON.stringify(result.outcomes));
  if (route.status !== 'complete') return;
  const launch = route.segments.find((segment) => segment.mode === 'launch');
  assert.ok(launch?.flight);
  assert.equal(launch.flight.model.maxJumpHeight, 3);
  assert.ok(launch.flight.model.maxHorizontalSpeed <= options.runAirSpeed + 1e-6);
  assert.ok(launch.times.at(-1)! > 0);
  assert.ok(launch.times.every((time, i) => i === 0 || time > launch.times[i - 1]));
  assert.deepEqual(facts, original);
});

test('free launch samples other headings instead of requiring the reference aim', () => {
  const alternate = structuredClone(facts);
  alternate.devices[0].aim = [-6, 0, 0];
  assert.equal(plan(createDeviceConnections(alternate, options).connections).status, 'complete');
});

test('free launch does not invent speed or height to span an unreachable gap', () => {
  const slow = createDeviceConnections(facts, { ...options, runAirSpeed: 1 });
  assert.equal(plan(slow.connections).status, 'no-verified-route');
  const unknown = createDeviceConnections(facts, { ...options, runAirSpeed: undefined });
  assert.equal(unknown.connections.length, 0);
  const unsupported = structuredClone(facts);
  delete unsupported.devices[0].freeLaunch;
  assert.equal(createDeviceConnections(unsupported, options).connections.length, 0);
});

test('fixed launch connections are independent of the character air speed', () => {
  const fixed = structuredClone(facts);
  fixed.devices[0].fixedLaunch = true;
  fixed.devices[0].aimClearance = 0.2;
  const expected = createDeviceConnections(fixed, { ...options, runAirSpeed: undefined });
  assert.equal(expected.connections.length, 1);
  assert.deepEqual(createDeviceConnections(fixed, { ...options, runAirSpeed: 0.1 }), expected);
});

test('physical solver returns a complete free-launch route with character resource timing', async () => {
  const { gangliaV1Defaults, prepareRouteSolver } = await import('#@/src/solver/index.ts');
  const positions = surfaces.flatMap((s) => s.vertices.flat());
  const indices = surfaces.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((v) => v + i * 4));
  const solver = await prepareRouteSolver(
    { ...gangliaV1Defaults, maxCandidates: 0, maxShortcutCandidates: 0 },
    {
      kind: 'physical',
      input: {
        ground: { surfaces, options: { speed: 4, maxVertical: 0.5, profile, walls: [] } },
        collision: { positions, indices },
        movement: {
          model: {
            ...options.model,
            maxJumpHeight: 0.5,
            maxHorizontalSpeed: 6,
            startHorizontalSpeed: 6,
            airOverspeedDeceleration: 5,
            airAcceleration: 30,
            airDeceleration: 30,
          },
          maxSlope: 45,
          runAirSpeed: 6,
          stepUp: 0.3,
          stepDown: 0.3,
        },
        locomotion: { speed: 4, sprintSpeed: 4, sprintAcceleration: 10 },
        devices: facts,
      },
    },
  );
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }],
      goal: [6, 0, 0],
    });
    assert.equal(result.route.status, 'complete', JSON.stringify(result));
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.segments.some((segment) => segment.mode === 'launch'));
    assert.ok(result.route.cost > 0 && Number.isFinite(result.route.cost));
    assert.deepEqual(result.route.points.at(-1), [6, 0, 0]);
  } finally {
    await solver.close();
  }
});
