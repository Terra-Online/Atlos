import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Vec3 } from '#@/src/geometry.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { FollowingSupport, PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

const box = (id: string, x: number, z: number, height: number): FollowingSupport => ({
  id,
  model: 'box',
  level: 'fixture',
  spawn: [x, -0.15, z],
  geometryKind: 'box',
  bodies: [
    Array.from({ length: 8 }, (_, bits): Vec3 => [
      x + (bits & 1 ? 1.25 : -1.25),
      bits & 2 ? height : 0,
      z + (bits & 4 ? 1.25 : -1.25),
    ]),
  ],
  maxDistance: 65,
  initialState: 0,
  assumption: 'placement-within-activity-range',
});
const scene = (boxes: FollowingSupport[]): PhysicalInput => ({
  ...physical,
  ground: {
    ...physical.ground,
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [-20, 0, -20],
          [20, 0, -20],
          [20, 0, 20],
          [-20, 0, 20],
        ],
      },
    ],
  },
  collision: {
    positions: [-20, 0, -20, 20, 0, -20, 20, 0, 20, -20, 0, 20],
    indices: [0, 2, 1, 0, 3, 2],
  },
  devices: { devices: [], ropes: [], followingSupports: boxes },
});
const settings = { ...gangliaV2Defaults, attemptsPerRound: 20, stagnantRounds: 2 };

test('v2 retains unmoved source boxes as solids, including unsupported authored shapes', async () => {
  for (const geometryKind of ['box', 'convex'] as const) {
    const input = scene([{ ...box('obstacle', 0, 0, 3), geometryKind, maxDistance: 0 }]);
    const solver = await prepareGangliaV2(settings, input, []);
    try {
      const result = await solver.solve({
        starts: [{ id: 'inside', position: [0, 0, 0], cost: 0, state: 'available' }],
        goal: [8, 0, 0],
      });
      assert.equal(result.route.status, 'no-verified-route');
    } finally {
      await solver.close();
    }
  }
});

test('v2 prepares single, double and triple source placements and keeps each optimized route in one layout', async () => {
  for (const count of [1, 2, 3]) {
    const boxes = Array.from({ length: count }, (_, i) =>
      box(`box-${i}`, i * 3.5, 8, (i + 1) * 1.5),
    );
    const layout = boxes.map((b) => ({ device: b.id, position: [b.spawn[0], -0.15, 0] as Vec3 }));
    const solver = await prepareGangliaV2(settings, scene(boxes), [], [], [layout]);
    try {
      const prepared = solver.preparationStats();
      const result = await solver.solve({
        starts: [{ id: 'player', position: [-3, 0, 0], cost: 0, state: 'available' }],
        goal: [(count - 1) * 3.5, count * 1.5, 0],
      });
      assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
      if (result.route.status !== 'complete') continue;
      assert.deepEqual(result.route.placements, layout);
      for (let i = 0; i < count; i++)
        assert.ok(
          result.route.segments.some((s) =>
            s.points.some(
              (p) =>
                Math.abs(p[1] - (i + 1) * 1.5) < 0.02 &&
                Math.abs(p[0] - i * 3.5) < 1.25 &&
                Math.abs(p[2]) < 1.25,
            ),
          ),
        );
      assert.deepEqual(solver.preparationStats(), prepared);
      assert.ok(result.diagnostics.v2.rounds.length > 0);
    } finally {
      await solver.close();
    }
  }
});

test('v2 rejects unsupported, out-of-range and intersecting complete placement layouts before serving queries', async () => {
  const boxes = [box('a', -5, 8, 1.5), box('b', 5, 8, 1.5)];
  const cases = [
    [{ device: 'a', position: [30, -0.15, 0] as Vec3 }],
    [{ device: 'a', position: [100, -0.15, 0] as Vec3 }],
    [{ device: 'a', position: [5, -0.15, 8] as Vec3 }],
    [
      { device: 'a', position: [0, -0.15, 0] as Vec3 },
      { device: 'b', position: [0, -0.15, 0] as Vec3 },
    ],
    [{ device: 'a', position: [0, 1.35, 0] as Vec3 }],
  ];
  for (const layout of cases)
    await assert.rejects(
      prepareGangliaV2(settings, scene(boxes), [], [], [layout]),
      /placement layout/,
    );
});

test('v2 requires the whole placed footprint to be supported across small holes', async () => {
  const input = scene([box('a', -5, 8, 1.5)]);
  const rectangles = [
    [-20, -20, 20, 0.5],
    [-20, 0.75, 20, 20],
    [-20, 0.5, 0.5, 0.75],
    [0.75, 0.5, 20, 0.75],
  ];
  const triangles = rectangles.flatMap(([x0, z0, x1, z1]) => [
    [x0, 0, z0],
    [x1, 0, z1],
    [x1, 0, z0],
    [x0, 0, z0],
    [x0, 0, z1],
    [x1, 0, z1],
  ]);
  input.collision = { positions: triangles.flat(), indices: triangles.map((_, i) => i) };
  await assert.rejects(
    prepareGangliaV2(settings, input, [], [], [[{ device: 'a', position: [0, -0.15, 0] }]]),
    /placement layout/,
  );
});

test('v2 never promotes an unsupported authored spawn to a proved placement', async () => {
  const source = { ...box('convex', 0, 0, 2), geometryKind: 'convex' as const };
  await assert.rejects(
    prepareGangliaV2(
      settings,
      scene([source]),
      [],
      [],
      [[{ device: source.id, position: source.spawn }]],
    ),
    /placement layout/,
  );
});

test('v2 keeps a later placement from reusing a walk through its relocated box', async () => {
  const boxes = [box('goal', 8, 8, 1.5), box('obstacle', 0, -8, 3)];
  const layout = boxes.map((b) => ({ device: b.id, position: [b.spawn[0], -0.15, 0] as Vec3 }));
  const solver = await prepareGangliaV2(
    settings,
    scene(boxes),
    [],
    [
      [-4, 0, 0],
      [4, 0, 0],
      [5, 0, 0],
      [-4, 0, 3],
      [0, 0, 3],
      [4, 0, 3],
    ],
    [layout],
  );
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [-4, 0, 0], cost: 0, state: 'available' }],
      goal: [8, 1.5, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.deepEqual(result.route.placements, layout);
    // Intersect each returned walk chord with the fixture box interior. The
    // default layout leaves this road open; the selected layout closes it.
    const enters = (a: Vec3, b: Vec3) => {
      let lo = 0,
        hi = 1;
      const min = [-1.249, 0.001, -1.249],
        max = [1.249, 2.999, 1.249];
      for (let axis = 0; axis < 3; axis++) {
        const delta = b[axis] - a[axis];
        if (delta === 0) {
          if (a[axis] < min[axis] || a[axis] > max[axis]) return false;
        } else {
          const first = (min[axis] - a[axis]) / delta,
            last = (max[axis] - a[axis]) / delta;
          lo = Math.max(lo, Math.min(first, last));
          hi = Math.min(hi, Math.max(first, last));
        }
      }
      return lo <= hi;
    };
    for (const segment of result.route.segments.filter((s) => s.mode === 'walk'))
      for (let i = 1; i < segment.points.length; i++)
        assert.equal(enters(segment.points[i - 1], segment.points[i]), false);
  } finally {
    await solver.close();
  }
});
