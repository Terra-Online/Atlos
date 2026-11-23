import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface, Vec3 } from '#@/src/geometry.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

test('walking cannot replace movement between overlapping poses of one platform', async () => {
  const centers = [0, 2, 4, 6];
  const poses: { min: Vec3; max: Vec3 }[] = centers.map((x) => ({
    min: [x - 1.1, 0, -1],
    max: [x + 1.1, 1, 1],
  }));
  const surfaces: Surface[] = centers.map((x, i) => ({
    id: `platform/${i}`,
    vertices: [
      [x - 1.1, 1, -1],
      [x - 1.1, 1, 1],
      [x + 1.1, 1, 1],
      [x + 1.1, 1, -1],
    ],
  }));
  const input: PhysicalInput = {
    ...physical,
    ground: { ...physical.ground, surfaces: [] },
    collision: { positions: [], indices: [] },
    movement: { ...physical.movement, model: { ...physical.movement.model, maxJumpHeight: 0 } },
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'platform',
          family: 'platform',
          level: 'test',
          model: 'platform',
          assumption: 'phase-free-swept-support',
          surfaces,
          poses,
          surfacePoses: centers.map((_, i) => [{ body: 0, fromPose: i, toPose: i }]),
          transfers: centers.slice(1).map((x, i) => ({
            from: [centers[i], 1, 0],
            to: [x, 1, 0],
            speed: 1,
            fromPose: i,
            toPose: i + 1,
            body: 0,
          })),
        },
      ],
    },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const stats = solver.preparationStats();
    const result = await solver.solve({
      starts: [{ id: 'player', position: [0, 1, 0], state: 'available', cost: 0 }],
      goal: [6, 1, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.segments.some((s) => s.traversal === 'moving-support'));
    // This also catches an optimizer replacing the initial rides by union walking.
    assert.ok(result.route.cost >= 2);
    assert.deepEqual(solver.preparationStats(), stats);
  } finally {
    await solver.close();
  }
});

test('one authored tilted pose provides a use receipt for its entire walk', async () => {
  const surface: Surface = {
    id: 'tilt',
    vertices: [
      [-1, 0.8, -1],
      [-1, 0.8, 1],
      [4, 1.8, 1],
      [4, 1.8, -1],
    ],
  };
  const pose: { min: Vec3; max: Vec3 } = { min: [-1, 0.6, -1], max: [4, 1.8, 1] };
  const input: PhysicalInput = {
    ...physical,
    ground: { ...physical.ground, surfaces: [] },
    collision: { positions: [], indices: [] },
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'tilt',
          family: 'seesaw',
          level: 'test',
          model: 'tilt',
          assumption: 'phase-free-swept-support',
          surfaces: [surface],
          poses: [pose],
          surfacePoses: [[{ body: 0, fromPose: 0, toPose: 0 }]],
          transfers: [],
        },
      ],
    },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [0, 1, 0], state: 'available', cost: 0 }],
      goal: [3, 1.6, 0],
    });
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(result.route.segments.every((s) => s.mode === 'walk'));
    assert.deepEqual(result.supportBoxes, [
      { device: 'tilt', family: 'seesaw', role: 'use', ...pose },
    ]);
  } finally {
    await solver.close();
  }
});

for (const missingMetadata of [false, true])
  test(`a swept hull cannot certify a walking pose (missing metadata: ${missingMetadata})`, async () => {
    const input: PhysicalInput = {
      ...physical,
      ground: { ...physical.ground, surfaces: [] },
      collision: { positions: [], indices: [] },
      devices: {
        devices: [],
        ropes: [],
        movingSupports: [
          {
            id: 'hull',
            family: 'platform',
            level: 'test',
            model: 'hull',
            assumption: 'phase-free-swept-support',
            surfaces: [
              {
                id: 'sweep',
                vertices: [
                  [-1, 1, -1],
                  [-1, 1, 1],
                  [7, 1, 1],
                  [7, 1, -1],
                ],
              },
            ],
            poses: [
              { min: [-1, 0, -1], max: [1, 1, 1] },
              { min: [5, 0, -1], max: [7, 1, 1] },
            ],
            surfacePoses: missingMetadata ? undefined : [[{ body: 0, fromPose: 0, toPose: 1 }]],
            transfers: [],
          },
        ],
      },
    };
    const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
    try {
      const result = await solver.solve({
        starts: [{ id: 'player', position: [0, 1, 0], state: 'available', cost: 0 }],
        goal: [6, 1, 0],
      });
      assert.equal(result.route.status, 'no-verified-route');
    } finally {
      await solver.close();
    }
  });

for (const staticLanding of [false, true])
  test(`a ride needs its destination cap or static landing (${staticLanding})`, async () => {
    const roof = (left: number, right: number, id: string): Surface => ({
      id,
      vertices: [
        [left, 1, -1],
        [left, 1, 1],
        [right, 1, 1],
        [right, 1, -1],
      ],
    });
    const input: PhysicalInput = {
      ...physical,
      ground: { ...physical.ground, surfaces: [] },
      collision: { positions: [], indices: [] },
      movement: { ...physical.movement, model: { ...physical.movement.model, maxJumpHeight: 0 } },
      devices: {
        devices: [],
        ropes: [],
        movingSupports: [
          {
            id: 'missing-target',
            family: 'platform',
            level: 'test',
            model: 'platform',
            assumption: 'phase-free-swept-support',
            surfaces: [roof(-1, 1, 'from'), roof(-1, 4, 'sweep'), roof(2, 4, 'other-pose')],
            poses: [
              { min: [-1, 0, -1], max: [1, 1, 1] },
              { min: [2, 0, -1], max: [4, 1, 1] },
              { min: [2, 0, -1], max: [4, 1, 1] },
            ],
            surfacePoses: [
              [{ body: 0, fromPose: 0, toPose: 0 }],
              [{ body: 0, fromPose: 0, toPose: 1 }],
              [{ body: 0, fromPose: 2, toPose: 2 }],
            ],
            transfers: [
              { from: [0, 1, 0], to: [3, 1, 0], speed: 1, fromPose: 0, toPose: 1, body: 0 },
            ],
          },
        ],
      },
    };
    if (staticLanding)
      input.collision = {
        positions: roof(2, 4, 'landing').vertices.flat(),
        indices: [0, 1, 2, 0, 2, 3],
      };
    const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
    try {
      const result = await solver.solve({
        starts: [{ id: 'player', position: [0, 1, 0], state: 'available', cost: 0 }],
        goal: [3.7, 1, 0],
      });
      assert.equal(result.route.status, staticLanding ? 'complete' : 'no-verified-route');
    } finally {
      await solver.close();
    }
  });
