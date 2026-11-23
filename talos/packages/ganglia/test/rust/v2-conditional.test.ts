import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

function scene(left: number, gap = 9, initial = 8): PhysicalInput {
  const floor = (a: number, b: number): Vec3[] => [
    [a, 0, -0.1],
    [a, 0, 0.1],
    [b, 0, 0.1],
    [b, 0, -0.1],
  ];
  const surfaces = [
    { id: 'departure', vertices: floor(left, 0) },
    { id: 'landing', vertices: floor(gap, gap + 4) },
  ];
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[1], v[2], v[0], v[2], v[3]]);
  return {
    ...physical,
    ground: { ...physical.ground, surfaces },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
    movement: {
      ...physical.movement,
      model: { ...physical.movement.model, maxHorizontalSpeed: 6.5, startHorizontalSpeed: 9 },
    },
    locomotion: {
      speed: 5,
      sprintSpeed: 7,
      sprintAcceleration: 1,
      sprintThrough: ['jump', 'drop'],
      stamina: {
        capacity: 8,
        initial,
        activationCost: 1,
        sprintDrain: 0,
        recoveryRate: 0,
        recoveryDelay: 0,
        reserve: 0,
        recoveryDuringSprint: false,
        recoveryDuringNonWalk: false,
      },
    },
  };
}

async function solve(
  input: PhysicalInput,
  start: number | Vec3,
  gap = 9,
  anchors: Vec3[] = [
    [0, 0, 0],
    [gap, 0, 0],
  ],
) {
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, [], anchors);
  const before = solver.preparationStats();
  try {
    const result = await solver.solve({
      starts: [
        {
          id: 'player',
          position: typeof start === 'number' ? [start, 0, 0] : start,
          cost: 0,
          state: 'available',
        },
      ],
      goal: [gap + 2, 0, 0],
    });
    assert.deepEqual(solver.preparationStats(), before);
    return result;
  } finally {
    await solver.close();
  }
}

test('v2 proves the sprint approach before crossing a prepared fast-flight gap', async () => {
  const result = await solve(scene(-10), -8);
  assert.equal(result.route.status, 'complete');
  if (result.route.status !== 'complete') return;
  const index = result.route.segments.findIndex((segment) => segment.mode === 'jump');
  assert.ok(index > 0);
  const jump = result.route.segments[index];
  assert.equal(jump.requiredGait, 'sprint');
  const span = Math.hypot(
    jump.points.at(-1)![0] - jump.points[0][0],
    jump.points.at(-1)![2] - jump.points[0][2],
  );
  assert.ok(span / jump.times.at(-1)! > 5);
  assert.ok(result.route.segments.slice(0, index).some((segment) => segment.gait === 'sprint'));
  assert.ok(result.route.locomotion!.minimum >= 0);
  // A short departure shelf cannot establish the required speed at 1 m/s²,
  // even though its geometry and active sprint flag allow the same flight.
  assert.equal((await solve(scene(-0.1), -0.05)).route.status, 'no-verified-route');
  assert.equal((await solve(scene(-10, 9, 0), -8)).route.status, 'no-verified-route');
});

function boosted(duration: number, gap = 12): PhysicalInput {
  const input = scene(-5, gap, 0);
  input.devices = {
    ropes: [],
    devices: [
      {
        id: 'approach-boost',
        kind: 'accelerate',
        position: [-4, 0, 0],
        goal: { position: [-4, 0, 0], interaction: { radius: 0.2 } },
        seeds: [],
        unitScale: true,
        resolved: true,
        speed: Number.NaN,
        overhead: Number.NaN,
        duration,
        fixedLaunch: false,
        aim: null,
        height: Number.NaN,
        aimClearance: Number.NaN,
        boostMultiplier: 2,
      },
    ],
  };
  return input;
}

test('v2 binds a prepared boosted flight to the pickup and the whole remaining lifetime', async () => {
  const result = await solve(boosted(2.5), -4.5, 12);
  assert.equal(result.route.status, 'complete');
  if (result.route.status !== 'complete') return;
  const pickup = result.route.boosts!.find((use) => use.id === 'approach-boost');
  assert.ok(pickup);
  let elapsed = 0;
  let flights = 0;
  for (const segment of result.route.segments) {
    const end = elapsed + segment.times.at(-1)!;
    if (segment.mode === 'jump' && segment.boost) {
      flights += 1;
      assert.equal(segment.boost.id, pickup.id);
      assert.ok(elapsed >= pickup.elapsed - 1e-9);
      assert.ok(end <= pickup.elapsed + 2.5 + 1e-9);
    }
    elapsed = end;
  }
  assert.equal(flights, 1);
  // 1.6s exceeds the flight's own duration, but the approach consumes enough
  // of it that the modifier would expire before landing.
  assert.equal((await solve(boosted(1.6), -4.5, 12)).route.status, 'no-verified-route');
});

test('v2 keeps a boosted run alternative when an unboosted sprint has insufficient energy', async () => {
  // This gap is within the unboosted sprint cap. Zero stamina must not remove
  // the distinct source-boosted run strategy for exactly the same flight.
  const result = await solve(boosted(2.5, 9), -4.5, 9);
  assert.equal(result.route.status, 'complete');
  if (result.route.status !== 'complete') return;
  const flight = result.route.segments.find((segment) => segment.mode === 'jump');
  assert.ok(flight);
  assert.equal(flight.requiredGait, undefined);
  assert.equal(flight.boost?.id, 'approach-boost');
  assert.equal(result.route.locomotion!.initial, 0);
  assert.equal(result.route.locomotion!.final, 0);
});

function replaceSurfaces(input: PhysicalInput, surfaces: PhysicalInput['ground']['surfaces']) {
  input.ground.surfaces = surfaces;
  const triangles = surfaces.flatMap(({ vertices: v }) => [v[0], v[1], v[2], v[0], v[2], v[3]]);
  input.collision = { positions: triangles.flat(), indices: triangles.map((_, i) => i) };
  return input;
}

test('v2 cannot carry a perpendicular sprint into a fast-flight gap', async () => {
  const input = scene(-10);
  replaceSurfaces(input, [
    {
      id: 'perpendicular-approach',
      vertices: [
        [-0.1, 0, -10],
        [-0.1, 0, 0],
        [0.1, 0, 0],
        [0.1, 0, -10],
      ],
    },
    input.ground.surfaces[1],
  ]);
  // The long approach establishes speed along Z; the flight leaves along X.
  // There is insufficient width to accelerate again after making that turn.
  assert.equal((await solve(input, [0, 0, -8])).route.status, 'no-verified-route');
});

test('v2 re-establishes entry speed after an ordinary jump even when sprint survives it', async () => {
  for (const [width, expected] of [
    [0.1, 'no-verified-route'],
    [8, 'complete'],
  ] as const) {
    const takeoff = 3 + width;
    const landing = takeoff + 9;
    const input = scene(-10, landing);
    replaceSurfaces(input, [
      input.ground.surfaces[0],
      {
        id: 'intermediate-shelf',
        vertices: [
          [3, 0, -0.1],
          [3, 0, 0.1],
          [takeoff, 0, 0.1],
          [takeoff, 0, -0.1],
        ],
      },
      input.ground.surfaces[1],
    ]);
    // An ordinary jump reaches the shelf and resets velocity/direction. The
    // wide shelf supports a new run-up; preserving the gait alone cannot help
    // the short shelf pass the same 9m gap.
    const result = await solve(input, -8, landing, [
      [0, 0, 0],
      [3, 0, 0],
      [takeoff, 0, 0],
      [landing, 0, 0],
    ]);
    assert.equal(result.route.status, expected);
    if (result.route.status === 'complete') {
      assert.ok(result.route.segments.filter((segment) => segment.mode === 'jump').length >= 2);
      assert.ok(result.route.segments.some((segment) => segment.requiredGait === 'sprint'));
    }
  }
});

test('v2 requires a proven sprint approach to collect a prepared airborne target outside run range', async () => {
  const goal: Vec3 = [7, 1.2, 0];
  const interaction = { radius: 0.2, airborne: true };
  for (const energy of [8, 0]) {
    const solver = await prepareGangliaV2(
      gangliaV2Defaults,
      scene(-10, 100, energy),
      [{ position: goal, interaction }],
      [[0, 0, 0]],
    );
    try {
      const result = await solver.solve({
        starts: [{ id: 'player', position: [-8, 0, 0], cost: 0, state: 'available' }],
        goal,
        interaction,
      });
      assert.equal(result.route.status, energy ? 'complete' : 'no-verified-route');
      if (result.route.status === 'complete') {
        assert.equal(result.route.segments.at(-1)?.requiredGait, 'sprint');
        assert.ok(result.route.segments.slice(0, -1).some((s) => s.gait === 'sprint'));
      }
    } finally {
      await solver.close();
    }
  }
});
