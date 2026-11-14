import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { gangliaV1Defaults, prepareRouteSolver } from '#@/src/solver/index.ts';
import type { DeviceFacts, PhysicalInput } from '#@/src/solver/physical.ts';

const surface = (id: string, x0: number, x1: number, y: number, z0 = -2, z1 = 2): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
});
const device = (
  id: string,
  kind: string,
  position: Vec3,
  extra: Partial<DeviceFacts['devices'][number]> = {},
): DeviceFacts['devices'][number] => ({
  id,
  kind,
  position,
  goal: { position, interaction: { radius: 0.4 } },
  seeds: [position],
  unitScale: true,
  resolved: true,
  speed: 2,
  overhead: 0.5,
  duration: null,
  fixedLaunch: false,
  aim: null,
  height: 0,
  aimClearance: 0,
  boostMultiplier: 1,
  ...extra,
});
const physical = (
  surfaces: Surface[],
  devices: NonNullable<PhysicalInput['devices']> = { devices: [], ropes: [] },
): PhysicalInput => {
  const triangles = surfaces.flatMap(({ vertices: v }) => [
    [v[0], v[2], v[1]],
    [v[0], v[3], v[2]],
  ]);
  return {
    ground: {
      surfaces,
      options: { speed: 4, maxVertical: 0.5, profile: { radius: 0.2, height: 1.8 }, walls: [] },
    },
    collision: {
      positions: triangles.flat(2),
      indices: Array.from({ length: triangles.length * 3 }, (_, i) => i),
    },
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 20,
        maxJumpHeight: 2,
        maxFallingSpeed: 12,
        apexTime: 0.1,
        maxHorizontalSpeed: 6,
        startHorizontalSpeed: 6,
        airAcceleration: 30,
        airDeceleration: 30,
        airOverspeedDeceleration: 5,
      },
      maxSlope: 45,
      runAirSpeed: 6,
      stepUp: 0.3,
      stepDown: 0.3,
    },
    locomotion: { speed: 4, sprintSpeed: 4, sprintAcceleration: 10 },
    devices,
  };
};
const query = (position: Vec3, goal: Vec3): RouteQuery => ({
  starts: [{ id: 'player', position, state: 'available', cost: 0.25 }],
  goal,
});
async function replay(
  input: PhysicalInput,
  request: RouteQuery,
  options: {
    maxCandidates?: number;
    sampleSpacing?: number;
    maxLinks?: number;
    maxShortcutCandidates?: number;
  } = {},
) {
  const solver = await prepareRouteSolver(
    { ...gangliaV1Defaults, algorithm: 'ganglia-v1-rust', maxCandidates: 0, ...options },
    { kind: 'physical', input },
  );
  try {
    const result = await solver.solve(request);
    assert.equal(result.route.status, 'complete');
    assert.ok(result.route.status === 'complete');
    const verify = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')]);
    const evaluation = verify(request, result.route);
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    return { route: result.route, verify };
  } finally {
    await solver.close();
  }
}

test('Rust fixed launch crosses a gap with independently replayable pad controls', async () => {
  const input = physical([surface('left', -5, 0, 0), surface('right', 3, 8, 0)], {
    devices: [
      device('pad', 'launch', [-1, 0, 0], {
        fixedLaunch: true,
        aim: [4, 0, 0],
        height: 3,
        aimClearance: 0.2,
      }),
    ],
    ropes: [],
  });
  const request = query([-3, 0, 0], [6, 0, 0]);
  const { route, verify } = await replay(input, request);
  assert.equal(route.segments[0].mode, 'walk');
  assert.equal(route.segments.at(-1)!.mode, 'walk');
  const launch = route.segments.find((s) => s.mode === 'launch');
  assert.ok(launch?.flight);
  assert.equal(launch.connection, 'launch/pad');
  // Pad authority is independent of character air-control capabilities.
  const invalid = structuredClone(route);
  invalid.segments.find((s) => s.mode === 'launch')!.flight!.model.airAcceleration = 30;
  for (const block of invalid.schedule ?? [])
    for (const segment of block.segments)
      if (segment.mode === 'launch') segment.flight!.model.airAcceleration = 30;
  assert.equal(verify(request, invalid).valid, false);
});

test('Rust moving ride keeps authored timing while a character boost expires', async () => {
  const input = physical([surface('floor', -4, 10, 0)], {
    devices: [
      device('fast', 'accelerate', [-2, 0, 0], {
        duration: 0.5,
        boostMultiplier: 2,
        goal: { position: [-2, 0, 0], interaction: { radius: 0.15 } },
      }),
    ],
    ropes: [],
    movingSupports: [
      {
        id: 'shuttle',
        family: 'platform',
        level: 'test',
        model: 'shuttle',
        assumption: 'phase-free-swept-support',
        surfaces: [surface('sweep', -0.5, 6.5, 0, -1, 1)],
        surfacePoses: [[{ fromPose: 0, toPose: 1, body: 0 }]],
        transfers: [{ from: [0, 0, 0], to: [6, 0, 0], speed: 20, fromPose: 0, toPose: 1, body: 0 }],
      },
    ],
  });
  const { route } = await replay(input, query([-2, 0, 0], [8, 0, 0]));
  const ride = route.segments.find((s) => s.connection === 'moving-ride/shuttle/0');
  assert.ok(ride);
  assert.equal(ride.traversal, 'moving-support');
  assert.deepEqual(ride.points, [
    [0, 0.01, 0],
    [6, 0.01, 0],
  ]);
  assert.deepEqual(ride.times, [0, 0.3]);
  assert.equal(ride.boost, undefined);
  assert.ok(route.boosts?.some((boost) => boost.id === 'fast'));
  assert.ok(route.schedule!.some((block) => block.segments.some((s) => s.boost?.id === 'fast')));
  assert.equal(route.segments.at(-1)!.boost, undefined);
  assert.ok(Math.abs(route.cost - 1.3) < 1e-6);
});

test('Rust following box placement enables two independently certified jumps', async () => {
  // Exporter box vertices use the x/y/z bit ordering required by the common model.
  const body = Array.from({ length: 8 }, (_, bits): Vec3 => [
    bits & 1 ? 0.5 : -0.5,
    bits & 2 ? 0.4 : 0,
    bits & 4 ? 0.5 : -0.5,
  ]);
  const input = physical([surface('floor', -2, 6, 0), surface('upper', 3.5, 5, 0.8, -1, 1)], {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'box',
        level: 'test',
        model: 'box',
        spawn: [0, 0, 0],
        bodies: [body],
        geometryKind: 'box',
        maxDistance: 4.5,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  });
  input.movement.model.maxJumpHeight = 0.5;
  input.movement.model.maxHorizontalSpeed = 3;
  input.movement.model.startHorizontalSpeed = 3;
  input.movement.runAirSpeed = 3;
  input.movement.stepUp = 0.1;
  const request = query([-1, 0, 0], [4, 0.8, 0]);
  const { route, verify } = await replay(input, request, {
    sampleSpacing: 0.5,
    maxCandidates: 1500,
    maxLinks: 10,
    maxShortcutCandidates: 16,
  });
  assert.ok(route.placements?.some((placement) => placement.device === 'box'));
  assert.ok(route.segments.filter((s) => s.mode === 'jump').length >= 2);
  const invalid = structuredClone(route);
  invalid.placements!.find((placement) => placement.device === 'box')!.position = [10, 0, 0];
  assert.equal(verify(request, invalid).valid, false);
});

test('Rust default following body blocks floor walking and supplies its unplaced roof', async () => {
  const body = Array.from({ length: 8 }, (_, bits): Vec3 => [
    bits & 1 ? 0.5 : -0.5,
    bits & 2 ? 1 : 0,
    bits & 4 ? 0.5 : -0.5,
  ]);
  const input = physical([surface('floor', -4, 4, 0, -3, 3)], {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'default-box',
        level: 'test',
        model: 'box',
        spawn: [0, 0, 0],
        bodies: [body],
        geometryKind: 'box',
        maxDistance: 4,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  });
  const around = await replay(input, query([-2, 0, 0], [2, 0, 0]));
  assert.ok(around.route.points.some((p) => Math.abs(p[2]) > 0.5));
  await replay(input, query([-0.2, 1.01, 0], [0.2, 1.01, 0]));
});

test('Rust physical moving roof survives a higher static navigation approximation', async () => {
  const input = physical([surface('raw-floor', -3, 3, 0)], {
    devices: [],
    ropes: [],
    movingSupports: [
      {
        id: 'roof',
        family: 'platform',
        level: 'test',
        model: 'roof',
        assumption: 'phase-free-swept-support',
        surfaces: [surface('moving-roof', -2, 2, 0.05)],
        transfers: [],
      },
    ],
  });
  input.ground.surfaces = [surface('navigation', -3, 3, 0.08)];
  input.devices!.movingSupports![0].surfaces[0].vertices.reverse();
  const { route } = await replay(input, query([-1, 0.06, 0], [1, 0.06, 0]));
  assert.ok(route.points.every((p) => Math.abs(p[1] - 0.06) < 1e-6));
});

test('Rust fixed launch derives direct height from canonical landing clearance', async () => {
  const input = physical([surface('left', -5, 0, 0), surface('right', 3, 8, 2)], {
    devices: [
      device('pad', 'launch', [-1, 0, 0], {
        fixedLaunch: true,
        aim: [4, 2, 0],
        height: 0.1,
        aimClearance: 0.5,
      }),
    ],
    ropes: [],
  });
  const { route } = await replay(input, query([-3, 0, 0], [6, 2, 0]));
  const launch = route.segments.find((segment) => segment.mode === 'launch');
  assert.ok(launch?.flight);
  const { start, end, model } = launch.flight;
  assert.ok(Math.abs(model.maxJumpHeight - (end[1] + 0.5 - start[1])) < 1e-10);
});
