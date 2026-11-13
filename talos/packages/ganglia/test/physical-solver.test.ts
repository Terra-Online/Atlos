import assert from 'node:assert/strict';
import { test } from 'node:test';

import { prepareRouteSolver, gangliaV1Defaults, type PhysicalInput } from '#@/src/solver/index.ts';
import type { GroundPlanner } from '#@/src/v1/route/ground.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import { preparePhysicalSolver } from '#@/src/v1/solver/physical/prepared.ts';
import {
  type PhysicalCache,
  type PhysicalResult,
  solvePhysicalRoute,
} from '#@/src/v1/solver/physical/solve.ts';

const input: PhysicalInput = {
  ground: {
    surfaces: [
      {
        id: 'floor',
        vertices: [
          [0, 0, 0],
          [0, 0, 10],
          [10, 0, 10],
          [10, 0, 0],
        ],
      },
    ],
    options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 1, maxVertical: 0.5 },
  },
  collision: { positions: [0, 0, 0, 0, 0, 10, 10, 0, 10], indices: [0, 1, 2] },
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
    runAirSpeed: 1,
    stepUp: 0.4,
    stepDown: 0.6,
  },
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
};

test('physical vertical candidates preserve arrival ranges and the highest target support below', async () => {
  const surfaces = [0, 0.25, 3].map((height, index) => ({
    id: `floor-${index}`,
    vertices: input.ground.surfaces[0].vertices.map(([x, , z]): [number, number, number] => [
      x,
      height,
      z,
    ]),
  }));
  const snapshot = { ...input, ground: { ...input.ground, surfaces } };
  for (const [height, targetHeight] of [
    [0, 0],
    [0.25, 2],
  ]) {
    const results: PhysicalResult[] = [];
    await solvePhysicalRoute(
      snapshot,
      {
        arrival: {
          id: 'start',
          position: [1, 0.4, 1],
          groundRange: [height, height],
          state: 'available',
          cost: 0,
        },
        target: [9, targetHeight, 1],
        walls: [],
      },
      {
        effort: 'walking',
        emit(result) {
          results.push(result);
        },
      },
      gangliaV1Defaults,
    );
    const result = results.at(-1)!;
    assert.equal(result.route?.status, 'complete', JSON.stringify(result));
    assert.deepEqual(result.route.points[0], [1, height, 1]);
    assert.deepEqual(result.groundedTarget, [9, height, 1]);
  }
});
test('physical jump planning continues its raw ground solve without repeating the same query', async () => {
  const cache = createPhysicalCache();
  let calls = 0;
  const observed: PhysicalCache = {
    release: cache.release,
    async memo(slot, key, create) {
      const prepared = await cache.memo(slot, key, create);
      if (slot === 'ground' && !prepared.reused) {
        const planner = prepared.value as GroundPlanner,
          plan = planner.plan;
        planner.plan = (...args) => {
          calls++;
          return plan(...args);
        };
      }
      return prepared;
    },
  };
  const solver = await preparePhysicalSolver(
    input,
    { ...gangliaV1Defaults, maxCandidates: 1, maxShortcutCandidates: 0 },
    { cache: observed },
  );
  const query = {
    starts: [
      {
        id: 'start',
        state: 'available' as const,
        cost: 3,
        position: [1, 0, 1] as [number, number, number],
      },
    ],
    goal: [9, 0, 1] as [number, number, number],
    waypoints: [[5, 0, 1] as [number, number, number]],
  };
  try {
    const first = await solver.solve(query);
    assert.equal(first.route.status, 'complete');
    if (first.route.status === 'complete') {
      assert.equal(first.route.arrivalCost, 3);
      assert.deepEqual(first.route.points[0], [1, 0, 1]);
      assert.deepEqual(first.route.points.at(-1), [9, 0, 1]);
      assert.ok(first.route.cost > 3);
    }
    assert.equal(calls, 1);
    assert.deepEqual(await solver.solve(query), first);
    assert.equal(calls, 2);
  } finally {
    await solver.close();
  }
});

test('physical solver returns fresh single and batch routes through the prepared seam', async () => {
  const solver = await prepareRouteSolver(gangliaV1Defaults, { kind: 'physical', input: input });
  const query = {
    starts: [
      {
        id: 'start',
        state: 'available' as const,
        cost: 0,
        position: [1, 0, 1] as [number, number, number],
      },
    ],
    goal: [9, 0, 1] as [number, number, number],
  };
  const single = await solver.solve(query);
  assert.equal(single.route.status, 'complete');
  assert.deepEqual(single.groundedTarget, [9, 0, 1]);
  const abort = new AbortController();
  await assert.rejects(
    solver.solve(query, {
      signal: abort.signal,
      onEvent(event) {
        if (event.type === 'candidate') abort.abort(new Error('query cancelled'));
      },
    }),
    /query cancelled/,
  );
  assert.equal((await solver.solve(query)).route.status, 'complete');
  const batch = await solver.solveBatch([query, query]);
  assert.deepEqual(batch[0], single);
  assert.deepEqual(batch[1], single);
  assert.equal(batch[0].route.status, 'complete');
  batch[0].route.points[0][0] = -100;
  assert.deepEqual(batch[1], single);
  assert.deepEqual(await solver.solve(query), single);
  await solver.close();
  await assert.rejects(solver.solve(query), /closed/);
});

test('physical solver distinguishes mapped but disconnected ground from unmapped endpoints', async () => {
  const solver = await prepareRouteSolver(gangliaV1Defaults, {
    kind: 'physical',
    input: {
      ...input,
      ground: {
        ...input.ground,
        surfaces: [
          ...input.ground.surfaces,
          {
            id: 'island',
            vertices: [
              [20, 0, 0],
              [20, 0, 10],
              [30, 0, 10],
              [30, 0, 0],
            ],
          },
        ],
      },
    },
  });
  const result = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [25, 0, 1],
  });
  assert.equal(result.route.status, 'no-verified-route');
  const unmapped = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [100, 0, 1],
  });
  assert.equal(unmapped.route.status, 'unmapped');
  await solver.close();
});

test('physical solver retains incomplete placement coverage at the prepared seam', async () => {
  const surfaces: typeof input.ground.surfaces = [
    ...input.ground.surfaces,
    {
      id: 'upper',
      vertices: [
        [6, 2.5, 6],
        [6, 2.5, 9],
        [9, 2.5, 9],
        [9, 2.5, 6],
      ],
    },
  ];
  const collision = {
    positions: surfaces.flatMap((s) => s.vertices.flat()),
    indices: surfaces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]),
  };
  const solver = await prepareRouteSolver(
    { ...gangliaV1Defaults, maxCandidates: 1 },
    {
      kind: 'physical',
      input: {
        ...input,
        collision,
        ground: {
          ...input.ground,
          surfaces,
          build: { bounds: { min: [0, 0], max: [10, 10] }, cellSize: 0.25, cellHeight: 0.1 },
        },
        devices: {
          devices: [],
          ropes: [],
          followingSupports: [
            {
              id: 'box',
              level: 'fixture',
              model: 'box',
              spawn: [4, 0, 4],
              bodies: [
                Array.from({ length: 8 }, (_, bits): [number, number, number] => [
                  4 + (bits & 1 ? 0.8 : -0.8),
                  bits & 2 ? 1.2 : 0,
                  4 + (bits & 4 ? 0.8 : -0.8),
                ]),
              ],
              geometryKind: 'box',
              initialState: 0,
              maxDistance: 65,
              assumption: 'placement-within-activity-range',
            },
          ],
        },
      },
    },
  );
  const result = await solver.solve({
    starts: [{ id: 'start', state: 'available', cost: 0, position: [1, 0, 1] }],
    goal: [8, 2.5, 8],
  });
  assert.equal(result.diagnostics.truncated, true);
  await solver.close();
});
