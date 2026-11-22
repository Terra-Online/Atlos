import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Surface } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import { prepareGangliaV2, gangliaV2Defaults } from '#@/src/solver/ganglia-v2-rust.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

test('v2 projects static feet onto a nearby moving roof when no exact moving contact exists', async () => {
  const input: PhysicalInput = {
    ...physical,
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'roof',
          family: 'platform',
          level: 'test',
          model: 'roof',
          assumption: 'phase-free-swept-support',
          transfers: [],
          poses: [{ min: [-4, 0.15, -4], max: [4, 0.15, 4] }],
          surfacePoses: [[{ body: 0, fromPose: 0, toPose: 0 }]],
          surfaces: [
            {
              id: 'roof',
              vertices: [
                [-4, 0.15, -4],
                [-4, 0.15, 4],
                [4, 0.15, 4],
                [4, 0.15, -4],
              ],
            },
          ],
        },
      ],
    },
  };
  const query = {
    starts: [
      {
        id: 'player',
        position: [0, 0, 0] as [number, number, number],
        cost: 0,
        state: 'available' as const,
      },
    ],
    goal: [2, 0.15, 0] as [number, number, number],
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    assert.ok(Math.abs(result.route.points[0][1] - 0.155) < 1e-6);
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});

test('v2 rides an authored lift between supported poses without treating its sweep as a solid', async () => {
  const roof = (y: number): Surface => ({
    id: `lift/${y}`,
    vertices: [
      [-1, y, -1],
      [-1, y, 1],
      [1, y, 1],
      [1, y, -1],
    ],
  });
  const input: PhysicalInput = {
    ...physical,
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'lift',
          family: 'platform',
          level: 'test',
          model: 'lift',
          assumption: 'phase-free-swept-support',
          surfaces: [roof(1), roof(9)],
          surfacePoses: [
            [{ body: 0, fromPose: 0, toPose: 0 }],
            [{ body: 0, fromPose: 1, toPose: 1 }],
          ],
          poses: [
            { min: [-1, 0.8, -1], max: [1, 1, 1] },
            { min: [-1, 8.8, -1], max: [1, 9, 1] },
          ],
          transfers: [{ from: [0, 1, 0], to: [0, 9, 0], speed: 2, fromPose: 0, toPose: 1 }],
        },
      ],
    },
  };
  const query = {
    starts: [
      {
        id: 'player',
        position: [0, 1, 0] as [number, number, number],
        cost: 0,
        state: 'available' as const,
      },
    ],
    goal: [0, 9, 0] as [number, number, number],
    interaction: { radius: 0.2, maxVertical: 0.1 },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const prepared = solver.preparationStats();
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    if (result.route.status !== 'complete') return;
    const ride = result.route.segments.find((s) => s.traversal === 'moving-support');
    assert.ok(ride);
    assert.equal(ride.connection, 'moving-ride/lift/0');
    assert.equal(ride.times.at(-1), 4);
    assert.ok(result.supportBoxes?.some((b) => b.device === 'lift' && b.role === 'board'));
    assert.ok(result.supportBoxes?.some((b) => b.device === 'lift' && b.role === 'leave'));
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
    assert.deepEqual(solver.preparationStats(), prepared);
  } finally {
    await solver.close();
  }
});

test('v2 preserves resource replay when a moving contact differs by floating point roundoff', async () => {
  const start: [number, number, number] = [
    -159.08500118904095, 136.14684927122042, -75.97876621727714,
  ];
  const end: [number, number, number] = [
    -159.17337232915227, 138.14444440268932, -76.02123939809353,
  ];
  // Source forklift roof outline, retaining the world-coordinate rounding case.
  const surfaces: Surface[] = [
    {
      id: 'moving/2100010233/0',
      vertices: [
        [-159.99112071119944, 136.14684927122042, -75.48466634822022],
        [-159.94615923379786, 136.14684927122042, -75.3562444525436],
        [-159.93147223827035, 136.14684927122042, -75.31811209279037],
        [-159.86787705983392, 136.14684927122042, -75.27883819511138],
        [-158.39561395462363, 136.14684927122042, -74.57051455016727],
        [-158.19255602175744, 136.14684927122042, -74.64188113727838],
        [-157.48338099558327, 136.14684927122042, -76.11591682070912],
        [-157.55450330850363, 136.14684927122042, -76.31906066770495],
        [-159.02676603399803, 136.14684927122042, -77.02738438806206],
        [-159.09716127069134, 136.14684927122042, -77.05251036475656],
        [-159.13611219292218, 136.14684927122042, -77.04015717799486],
        [-159.2644799059764, 136.14684927122042, -76.99504123206233],
        [-159.30021920575217, 136.14684927122042, -76.98114395064232],
        [-160.00259451366344, 136.14684927122042, -75.52125566383668],
      ],
    },
    {
      id: 'moving/2100010233/1',
      vertices: [
        [-160.0794918513108, 138.14444440268934, -75.5271395290366],
        [-160.0345303739092, 138.14444440268934, -75.39871763336],
        [-160.0198433783817, 138.14444440268934, -75.36058527360674],
        [-159.95624819994526, 138.14444440268934, -75.32131137592776],
        [-158.48398509473498, 138.14444440268934, -74.61298773098366],
        [-158.2809271618688, 138.14444440268934, -74.68435431809475],
        [-157.57175213569462, 138.14444440268934, -76.1583900015255],
        [-157.64287444861498, 138.14444440268934, -76.36153384852133],
        [-159.11513717410938, 138.14444440268934, -77.06985756887845],
        [-159.1855324108027, 138.14444440268934, -77.09498354557293],
        [-159.22448333303353, 138.14444440268934, -77.08263035881124],
        [-159.35285104608775, 138.14444440268934, -77.03751441287872],
        [-159.38859034586352, 138.14444440268934, -77.02361713145869],
        [-160.0909656537748, 138.14444440268934, -75.56372884465306],
      ],
    },
    {
      id: 'moving/2100010233/2',
      vertices: [
        [-160.0794918513108, 138.14444440268934, -75.5271395290366],
        [-160.0345303739092, 138.14444440268934, -75.39871763336],
        [-160.0198433783817, 138.14444440268934, -75.36058527360674],
        [-159.95624819994526, 138.14444440268934, -75.32131137592776],
        [-158.48398509473498, 138.14444440268934, -74.61298773098366],
        [-158.39561395462363, 138.14444440268934, -74.57051455016727],
        [-158.19255602175744, 138.14444440268934, -74.64188113727838],
        [-157.48338099558327, 138.14444440268934, -76.11591682070912],
        [-157.55450330850363, 138.14444440268934, -76.31906066770495],
        [-159.02676603399803, 138.14444440268934, -77.02738438806206],
        [-159.11513717410938, 138.14444440268934, -77.06985756887845],
        [-159.1855324108027, 138.14444440268934, -77.09498354557293],
        [-159.22448333303353, 138.14444440268934, -77.08263035881124],
        [-159.35285104608775, 138.14444440268934, -77.03751441287872],
        [-159.38859034586352, 138.14444440268934, -77.02361713145869],
        [-160.0909656537748, 138.14444440268934, -75.56372884465306],
      ],
    },
  ];
  const input: PhysicalInput = {
    ...physical,
    movement: {
      ...physical.movement,
      runAirSpeed: 4.75,
      model: {
        ...physical.movement.model,
        gravity: 40,
        fallingGravity: 38,
        maxFallingSpeed: 80,
        maxJumpHeight: 2.0999999046325684,
        apexTime: 0.10000000149011612,
        maxHorizontalSpeed: 4.75,
        startHorizontalSpeed: 4.75,
      },
    },
    devices: {
      devices: [],
      ropes: [],
      movingSupports: [
        {
          id: 'forklift',
          family: 'forklift',
          level: 'test',
          model: 'forklift',
          assumption: 'phase-free-swept-support',
          surfaces,
          // Preserve the source association between the two caps and their swept hull.
          surfacePoses: [
            [{ body: 0, fromPose: 0, toPose: 0 }],
            [{ body: 0, fromPose: 1, toPose: 1 }],
            [{ body: 0, fromPose: 0, toPose: 1 }],
          ],
          poses: [
            {
              min: [-160.00259451366344, 133.9711615628139, -77.05251036475656],
              max: [-157.01400609510668, 136.14684927122042, -74.05453197732035],
            },
            {
              min: [-160.0909656537748, 135.96875669428283, -77.09498354557293],
              max: [-157.10237723521803, 138.14444440268934, -74.09700515813674],
            },
          ],
          transfers: [{ from: start, to: end, speed: 1, fromPose: 0, toPose: 1, body: 0 }],
        },
      ],
    },
  };
  const query = {
    starts: [{ id: 'player', position: start, cost: 0, state: 'available' as const }],
    goal: end,
    interaction: { radius: 0.35, maxVertical: 0.2 },
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const result = await solver.solve(query);
    assert.equal(result.route.status, 'complete');
    const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
      query,
      result.route,
    );
    assert.equal(evaluation.valid, true, evaluation.issues.join('; '));
  } finally {
    await solver.close();
  }
});
