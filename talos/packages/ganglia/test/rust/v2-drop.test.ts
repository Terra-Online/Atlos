import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

function ledge(height = 10): PhysicalInput {
  const upper: Vec3[] = [
    [-2, height, -2],
    [-2, height, 2],
    [0, height, 2],
    [0, height, -2],
  ];
  const lower: Vec3[] = [
    [2, 0, -2],
    [2, 0, 2],
    [8, 0, 2],
    [8, 0, -2],
  ];
  const triangles = [upper, lower].flatMap((v) => [v[0], v[1], v[2], v[0], v[2], v[3]]);
  return {
    ...physical,
    ground: {
      ...physical.ground,
      surfaces: [
        { id: 'upper', vertices: upper },
        { id: 'lower', vertices: lower },
      ],
    },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
  };
}

test('v2 proves an annotated drop beyond its automatic neighbour range', async () => {
  const from: Vec3 = [0, 16.005, 0];
  const to: Vec3 = [3, 0.005, 0];
  for (const obstructed of [false, true]) {
    const input = ledge(16);
    if (obstructed) {
      input.ground.options = {
        ...input.ground.options,
        walls: [{ min: [-3, 4, -3], max: [9, 6, 3], state: 'active' }],
      };
    }
    const solver = await prepareGangliaV2(gangliaV2Defaults, input, [], [], [], [{ from, to }]);
    try {
      const result = await solver.solve({
        starts: [{ id: 'p', position: from, cost: 0, state: 'available' }],
        goal: to,
      });
      assert.equal(result.route.status, obstructed ? 'no-verified-route' : 'complete');
      if (result.route.status === 'complete') {
        assert.ok(result.route.segments.some((segment) => segment.mode === 'drop'));
      }
    } finally {
      await solver.close();
    }
  }
});

test('v2 finds a directed drop between support regions without an annotated takeoff', async () => {
  const from: Vec3 = [-1, 16.005, 0];
  const to: Vec3 = [4, 0.005, 0];
  for (const obstructed of [false, true]) {
    const input = ledge(16);
    if (obstructed) {
      input.ground.options = {
        ...input.ground.options,
        walls: [{ min: [-3, 4, -3], max: [9, 6, 3], state: 'active' }],
      };
    }
    const solver = await prepareGangliaV2(
      gangliaV2Defaults,
      input,
      [],
      [],
      [],
      [
        {
          from: { min: [-0.6, 15.9, -0.6], max: [0, 16.1, 0.6] },
          to: { min: [2.1, -0.1, -0.6], max: [3.5, 0.1, 0.6] },
        },
      ],
    );
    try {
      const before = solver.preparationStats();
      const result = await solver.solve({
        starts: [{ id: 'p', position: from, cost: 0, state: 'available' }],
        goal: to,
      });
      assert.equal(result.route.status, obstructed ? 'no-verified-route' : 'complete');
      if (result.route.status === 'complete') {
        assert.ok(result.route.segments.some((segment) => segment.mode === 'drop'));
      }
      assert.deepEqual(solver.preparationStats(), before);
    } finally {
      await solver.close();
    }
  }
});

test('v2 discovers a flight across a drop during preparation', async () => {
  const from: Vec3 = [-1, 16.005, 0];
  const to: Vec3 = [4, 0.005, 0];
  const solver = await prepareGangliaV2(gangliaV2Defaults, ledge(16), []);
  try {
    const before = solver.preparationStats();
    const result = await solver.solve({
      starts: [{ id: 'upper', position: from, cost: 0, state: 'available' }],
      goal: to,
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status === 'complete') {
      assert.ok(
        result.route.segments.some((segment) => segment.mode === 'drop' || segment.mode === 'jump'),
      );
    }

    const reverse = await solver.solve({
      starts: [{ id: 'lower', position: to, cost: 0, state: 'available' }],
      goal: from,
    });
    assert.equal(reverse.route.status, 'no-verified-route');
    assert.equal(reverse.diagnostics?.v2?.initialization?.failureStage, 'ordinary-connectivity');
    assert.deepEqual(solver.preparationStats(), before);
  } finally {
    await solver.close();
  }
});

test('v2 falls from a supported ledge with no jump rise and keeps the prepared backbone fixed', async () => {
  const input = ledge();
  const solver = await prepareGangliaV2(
    gangliaV2Defaults,
    input,
    [],
    [
      [0, 10.005, 0],
      [3, 0.005, 0],
    ],
  );
  try {
    const before = solver.preparationStats();
    const result = await solver.solve({
      starts: [{ id: 'p', position: [0, 10.005, 0], cost: 0, state: 'available' }],
      goal: [3, 0.005, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const drop = result.route.segments.find((s) => s.mode === 'drop');
    assert.ok(drop);
    assert.equal(drop.flight?.control.mode, 'drop');
    assert.ok(drop.points.every((p, i) => i === 0 || p[1] <= drop.points[i - 1][1]));
    const duration = drop.times.at(-1)!;
    const height = drop.points[0][1] - drop.points.at(-1)![1];
    assert.ok(Math.abs(duration - Math.sqrt((2 * height) / 10)) < 1e-8);
    assert.ok(result.route.cost < 2);
    assert.deepEqual(solver.preparationStats(), before);
  } finally {
    await solver.close();
  }
});

test('v2 rejects a fall that crosses an external barrier', async () => {
  const input = ledge();
  input.ground.options = {
    ...input.ground.options,
    walls: [{ min: [-3, 4, -3], max: [9, 6, 3], state: 'active' }],
  };
  const solver = await prepareGangliaV2(
    gangliaV2Defaults,
    input,
    [],
    [
      [0, 10.005, 0],
      [3, 0.005, 0],
    ],
  );
  try {
    const result = await solver.solve({
      starts: [{ id: 'p', position: [0, 10.005, 0], cost: 0, state: 'available' }],
      goal: [3, 0.005, 0],
    });
    assert.notEqual(result.route.status, 'complete');
  } finally {
    await solver.close();
  }
});

test('v2 prepares a source rope descent beyond ordinary neighbours and respects terminal falling speed', async () => {
  const input = ledge();
  const upper = input.ground.surfaces[0].vertices.map((p) => [p[0], 20, p[2]] as Vec3);
  const lower = input.ground.surfaces[1].vertices.map((p) => [p[0] + 6, p[1], p[2]] as Vec3);
  input.ground.surfaces = [
    { id: 'upper', vertices: upper },
    { id: 'lower', vertices: lower },
  ];
  const triangles = [upper, lower].flatMap((v) => [v[0], v[1], v[2], v[0], v[2], v[3]]);
  input.collision = { positions: triangles.flat(), indices: triangles.map((_, i) => i) };
  input.movement = { ...input.movement, model: { ...input.movement.model, maxFallingSpeed: 5 } };
  const device = (id: string, position: Vec3) => ({
    id,
    position,
    kind: 'rope',
    goal: { position, interaction: { radius: 0.2 } },
    seeds: [],
    resolved: true,
    unitScale: true,
    speed: 2,
    overhead: 0,
    duration: null,
    fixedLaunch: false,
    aim: null,
    height: Number.NaN,
    aimClearance: Number.NaN,
    boostMultiplier: Number.NaN,
  });
  input.devices = {
    devices: [device('top', [0, 20.005, 0]), device('bottom', [9, 0.005, 0])],
    ropes: [{ top: 'top', bottom: 'bottom' }],
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'top', position: [0, 20.005, 0], cost: 0, state: 'available' }],
      goal: [9, 0.005, 0],
      interaction: { radius: 0.2 },
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const drop = result.route.segments.find((s) => s.mode === 'drop');
    assert.ok(drop);
    assert.ok(drop.connection?.startsWith('drop/bottom/'));
    assert.ok(!result.route.segments.some((s) => s.mode === 'rope'));
    assert.ok(drop.times.at(-1)! > 4 && drop.times.at(-1)! < 4.3);
    for (let i = 1; i < drop.points.length; i++) {
      const speed =
        (drop.points[i - 1][1] - drop.points[i][1]) / (drop.times[i] - drop.times[i - 1]);
      assert.ok(speed >= -1e-8 && speed <= 5 + 1e-8);
    }
    const n = drop.points.length - 1;
    assert.ok(
      Math.abs(
        (drop.points[n - 1][1] - drop.points[n][1]) / (drop.times[n] - drop.times[n - 1]) - 5,
      ) < 1e-8,
    );
  } finally {
    await solver.close();
  }
});

test('v2 clips a prepared falling trajectory at the first airborne goal contact', async () => {
  const input = ledge();
  const mark = { position: [2, 6, 0] as Vec3, interaction: { radius: 0.2, airborne: true } };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, [mark], [[0, 10.005, 0]]);
  try {
    const result = await solver.solve({
      starts: [{ id: 'p', position: [0, 10.005, 0], cost: 0, state: 'available' }],
      goal: mark.position,
      interaction: mark.interaction,
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const last = result.route.segments.at(-1)!;
    assert.equal(last.mode, 'drop');
    assert.equal(last.flight?.control.mode, 'drop');
    assert.ok(last.points.every((p, i) => i === 0 || p[1] <= last.points[i - 1][1]));
    const end = last.points.at(-1)!;
    assert.ok(Math.hypot(end[0] - 2, end[1] - 6, end[2]) <= 0.2 + 1e-8);
    assert.ok(last.times.at(-1)! < 1);
  } finally {
    await solver.close();
  }
});
