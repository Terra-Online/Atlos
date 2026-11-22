import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

function input(initial: number, reserve: number, recoveryRate: number): PhysicalInput {
  const vertices: Vec3[] = [
    [0, 0, -2],
    [0, 0, 2],
    [40, 0, 2],
    [40, 0, -2],
  ];
  const triangles = [vertices[0], vertices[1], vertices[2], vertices[0], vertices[2], vertices[3]];
  return {
    ...physical,
    ground: {
      ...physical.ground,
      options: { ...physical.ground.options, walls: [] },
      surfaces: [{ id: 'floor', vertices }],
    },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
    locomotion: {
      speed: 5,
      sprintSpeed: 7,
      sprintAcceleration: 10,
      dash: { speed: 10, duration: 0.3, cooldown: 0.8, cost: 1 },
      sprintThrough: ['jump', 'drop'],
      stamina: {
        capacity: 8,
        initial,
        activationCost: 1,
        sprintDrain: 0,
        recoveryRate,
        recoveryDelay: 0.9,
        reserve,
        recoveryDuringSprint: true,
        recoveryDuringNonWalk: true,
      },
    },
  };
}

test('v2 recovers from empty stamina before sprinting or dashing', async () => {
  const solver = await prepareGangliaV2(gangliaV2Defaults, input(0, 0, 2), []);
  const before = solver.preparationStats();
  try {
    const result = await solver.solve({
      starts: [{ id: 'p', position: [1, 0, 0], cost: 0, state: 'available' }],
      goal: [31, 0, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.locomotion);
    const route = result.route;
    assert.ok(route.locomotion);
    assert.equal(route.segments[0].gait, 'run');
    assert.ok(route.segments.some((s) => s.gait === 'dash'));
    assert.ok(route.cost < 6);
    assert.equal(route.locomotion.initial, 0);
    assert.ok(route.locomotion.minimum >= 0);
    let elapsed = 0;
    for (const segment of route.segments) {
      if (segment.gait === 'dash' || segment.gait === 'sprint') {
        assert.ok(elapsed >= 0.5 - 1e-8);
        break;
      }
      elapsed += segment.times.at(-1)!;
    }
    assert.deepEqual(solver.preparationStats(), before);
  } finally {
    await solver.close();
  }
});

test('v2 shares one reserve-limited stamina pool across a whole route', async () => {
  const world = input(2, 1, 0);
  world.ground.options.walls = [{ min: [10, -1, -0.5], max: [20, 2, 0.5], state: 'active' }];
  const solver = await prepareGangliaV2(gangliaV2Defaults, world, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'p', position: [1, 0, 0], cost: 0, state: 'available' }],
      goal: [31, 0, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.locomotion);
    assert.equal(result.route.locomotion.minimum, 1);
    assert.equal(result.route.locomotion.final, 1);
    assert.equal(result.route.locomotion.dashes, 1);
    assert.ok(result.route.segments.some((s) => s.gait === 'dash'));
    assert.ok(result.route.points.some((p) => Math.abs(p[2]) > 0.5));
  } finally {
    await solver.close();
  }
});

test('v2 walks through a source boost and stops using its multiplier at expiry', async () => {
  const world = input(0, 0, 0);
  world.locomotion = { speed: 5, sprintSpeed: 5, sprintAcceleration: 10 };
  world.devices = {
    devices: [
      {
        id: 'fast',
        kind: 'accelerate',
        position: [10, 0, 0],
        goal: { position: [10, 0, 0], interaction: { radius: 0.5 } },
        seeds: [],
        unitScale: true,
        resolved: true,
        speed: Number.NaN,
        overhead: Number.NaN,
        duration: 1.5,
        fixedLaunch: false,
        aim: null,
        height: Number.NaN,
        aimClearance: Number.NaN,
        boostMultiplier: 2,
      },
    ],
    ropes: [],
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, world, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'p', position: [1, 0, 0], cost: 0, state: 'available' }],
      goal: [31, 0, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.boosts);
    assert.ok(Math.abs(result.route.cost - 4.5) < 1e-6);
    assert.equal(result.route.boosts.length, 1);
    assert.equal(result.route.boosts[0].id, 'fast');
    assert.ok(Math.abs(result.route.boosts[0].elapsed - 1.7) < 1e-3);
    let elapsed = 0;
    for (const segment of result.route.segments) {
      const end = elapsed + segment.times.at(-1)!;
      if (segment.boost) {
        assert.ok(
          elapsed >= result.route.boosts[0].elapsed - 1e-6 &&
            end <= result.route.boosts[0].elapsed + 1.5 + 1e-6,
        );
        assert.equal(segment.boost.multiplier, 2);
      }
      elapsed = end;
    }
  } finally {
    await solver.close();
  }
});

test('v2 can seed a useful detour through a prepared boost contact', async () => {
  const world = input(0, 0, 0);
  world.locomotion = { speed: 5, sprintSpeed: 5, sprintAcceleration: 10 };
  const vertices: Vec3[] = [
    [0, 0, -5],
    [0, 0, 5],
    [40, 0, 5],
    [40, 0, -5],
  ];
  const triangles = [vertices[0], vertices[1], vertices[2], vertices[0], vertices[2], vertices[3]];
  world.ground.surfaces = [{ id: 'floor', vertices }];
  world.collision = { positions: triangles.flat(), indices: triangles.map((_, i) => i) };
  world.devices = {
    devices: [
      {
        id: 'detour',
        kind: 'accelerate',
        position: [10, 0, 4],
        goal: { position: [10, 0, 4], interaction: { radius: 0.2 } },
        seeds: [],
        unitScale: true,
        resolved: true,
        speed: Number.NaN,
        overhead: Number.NaN,
        duration: 2,
        fixedLaunch: false,
        aim: null,
        height: Number.NaN,
        aimClearance: Number.NaN,
        boostMultiplier: 4,
      },
    ],
    ropes: [],
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, world, []);
  try {
    const before = solver.preparationStats();
    const result = await solver.solve({
      starts: [{ id: 'p', position: [1, 0, 0], cost: 0, state: 'available' }],
      goal: [31, 0, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.boosts?.some((boost) => boost.id === 'detour'));
    assert.ok(result.route.cost < 6);
    assert.ok(result.route.points.some((point) => point[2] > 3.5));
    assert.deepEqual(solver.preparationStats(), before);
  } finally {
    await solver.close();
  }
});
