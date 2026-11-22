import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Surface } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

const roof = (left: number, right: number, id: string): Surface => ({
  id,
  vertices: [
    [left, 1, -1],
    [left, 1, 1],
    [right, 1, 1],
    [right, 1, -1],
  ],
});
function conveyor(wrongBody = false): PhysicalInput {
  return {
    ...physical,
    ground: { ...physical.ground, surfaces: [] },
    collision: { positions: [], indices: [] },
    movement: { ...physical.movement, model: { ...physical.movement.model, maxJumpHeight: 0 } },
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'conveyor',
          family: 'conveyor',
          level: 'test',
          model: 'conveyor',
          assumption: 'phase-free-swept-support',
          surfaces: [roof(-1, 1, 'from'), roof(5, 7, 'to'), roof(-1, 7, 'sweep')],
          poses: [
            { min: [-1, 0, -1], max: [1, 1, 1] },
            { min: [5, 0, -1], max: [7, 1, 1] },
          ],
          surfacePoses: [
            [{ body: 0, fromPose: 0, toPose: 0 }],
            [{ body: wrongBody ? 1 : 0, fromPose: 1, toPose: 1 }],
            [{ body: 0, fromPose: 0, toPose: 1 }],
          ],
          // A fixed intermediate pose does not invent movement speed or a ride.
          transfers: [
            { from: [0, 1, 0], to: [6, 1, 0], fromPose: 0, toPose: 1, body: 0, speed: null },
          ],
        },
      ],
    },
  };
}

for (const wrongBody of [false, true])
  test(`v2 proves an intermediate conveyor pose from matching body caps (${wrongBody})`, async () => {
    const solver = await prepareGangliaV2(gangliaV2Defaults, conveyor(wrongBody), []);
    try {
      const prepared = solver.preparationStats();
      const result = await solver.solve({
        starts: [{ id: 'player', position: [2.7, 1, 0], state: 'available', cost: 0 }],
        goal: [3.3, 1, 0],
      });
      assert.equal(result.route.status, wrongBody ? 'no-verified-route' : 'complete');
      if (result.route.status === 'complete') {
        assert.ok(result.route.segments.every((s) => s.mode === 'walk'));
        assert.equal(result.supportBoxes?.length, 1);
        const box = result.supportBoxes![0];
        assert.equal(box.role, 'use');
        assert.ok(Math.abs(box.max[0] - box.min[0] - 2) < 1e-8);
        assert.ok(box.min[0] > -1 && box.max[0] < 7);
        assert.deepEqual(box.min.slice(1), [0, -1]);
        assert.deepEqual(box.max.slice(1), [1, 1]);
        const fixed = conveyor();
        fixed.devices!.movingSupports = [
          {
            ...fixed.devices!.movingSupports![0],
            surfaces: [roof(box.min[0], box.max[0], 'selected')],
            poses: [{ min: box.min, max: box.max }],
            surfacePoses: [[{ body: 0, fromPose: 0, toPose: 0 }]],
            transfers: [],
          },
        ];
        const contact = createPhysicalWorld(fixed, 'complete').configured();
        assert.ok(
          result.route.segments.every((segment) =>
            segment.points
              .slice(1)
              .every((point, i) => contact.supportedSpan(segment.points[i], point, 0.025)),
          ),
        );
      }
      assert.deepEqual(solver.preparationStats(), prepared);
    } finally {
      await solver.close();
    }
  });

test('v2 cannot change the interpolated pose while walking across a swept hull', async () => {
  const solver = await prepareGangliaV2(gangliaV2Defaults, conveyor(), []);
  try {
    const result = await solver.solve({
      starts: [{ id: 'player', position: [1.4, 1, 0], state: 'available', cost: 0 }],
      goal: [4.6, 1, 0],
    });
    assert.equal(result.route.status, 'no-verified-route');
  } finally {
    await solver.close();
  }
});

test('v2 preserves source-world conveyor contacts when a horizontal normal rounds below one', async () => {
  // Source conveyor 2800000050/76574/0, pose caps 12 and 13. Their normalized
  // horizontal normal has y=0.9999999999999999; exact feet must remain usable.
  const y = 177.79699730873108;
  const cap = (left: number, right: number, id: string): Surface => ({
    id,
    vertices: [
      [left, y, 726.4849143028259],
      [right, y, 726.4849143028259],
      [right, y, 725.5792946815491],
      [left, y, 725.5792946815491],
    ],
  });
  const input = conveyor();
  input.ground.options.profile = { radius: 0.3499999940395355, height: 1.659999966621399 };
  input.devices!.movingSupports = [
    {
      ...input.devices!.movingSupports![0],
      surfaces: [
        cap(-62.92643737792969, -60.99926829338074, 'from'),
        cap(-69.68844604492188, -67.76127696037292, 'to'),
        cap(-69.68844604492188, -60.99926829338074, 'sweep'),
      ],
      poses: [
        {
          min: [-62.92643737792969, 175.29699683189392, 725.5792946815491],
          max: [-60.99926829338074, y, 726.4849143028259],
        },
        {
          min: [-69.68844604492188, 175.29699683189392, 725.5792946815491],
          max: [-67.76127696037292, y, 726.4849143028259],
        },
      ],
      transfers: [
        {
          from: [-61.96285283565521, y, 726.0321044921875],
          to: [-68.7248615026474, y, 726.0321044921875],
          fromPose: 0,
          toPose: 1,
          body: 0,
          speed: null,
        },
      ],
    },
  ];
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve({
      starts: [
        {
          id: 'player',
          position: [-65.7292909860611, y, 726.0321044921875],
          state: 'available',
          cost: 0,
        },
      ],
      goal: [-64.95842335224151, y, 726.0321044921875],
    });
    assert.equal(result.route.status, 'complete');
    assert.equal(result.supportBoxes?.length, 1);
    assert.equal(result.supportBoxes![0].role, 'use');
  } finally {
    await solver.close();
  }
});
