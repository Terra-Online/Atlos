import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalVerifier } from '#@/src/evaluation/physical.ts';
import type { Vec3, Wall } from '#@/src/geometry.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { RouteQuery } from '#@/src/solver/contract.ts';
import { gangliaV2Defaults, prepareGangliaV2 } from '#@/src/solver/ganglia-v2-rust.ts';
import { physical } from '#@/test/fixtures/v2-scene.ts';

const floor = (left: number, right: number, y: number, near = -1, far = 1): Vec3[] => [
  [left, y, near],
  [left, y, far],
  [right, y, far],
  [right, y, near],
];

async function walk(faces: Vec3[][], start: Vec3, goal: Vec3, walls: Wall[] = []) {
  const triangles = faces.flatMap((v) => [v[0], v[1], v[2], v[0], v[2], v[3]]);
  const input = {
    ...physical,
    ground: {
      surfaces: [{ id: 'nav', vertices: floor(-2, 2, 0) }],
      options: { ...physical.ground.options, walls },
    },
    collision: { positions: triangles.flat(), indices: triangles.map((_, i) => i) },
    movement: { ...physical.movement, model: { ...physical.movement.model, maxJumpHeight: 0 } },
  };
  const query: RouteQuery = {
    starts: [{ id: 'player', position: start, cost: 0, state: 'available' }],
    goal,
  };
  const solver = await prepareGangliaV2(gangliaV2Defaults, input, []);
  try {
    const { route } = await solver.solve(query);
    if (route.status === 'complete') {
      const world = createPhysicalWorld(input, 'complete');
      const evaluation = createPhysicalVerifier(() => [world], { walkSnap: 0 })(query, route);
      assert.equal(evaluation.valid, true, evaluation.issues.join(', '));
    }
    return route;
  } finally {
    await solver.close();
  }
}

test('v2 cannot walk above a strip whose standing contact is obstructed', async () => {
  await walk(
    [floor(-2, -0.6, 0), floor(0.6, 2, 0), floor(-0.8, 0.8, 0.22, 0.299, 0.5)],
    [-1, 0, 0],
    [1, 0, 0],
    [{ state: 'active', min: [-0.5, -0.06, -0.02], max: [0.5, -0.01, 0.02] }],
  );
});

test('v2 follows the capsule contact around a low step edge', async () => {
  const riser: Vec3[] = [
    [0, 0, -1],
    [0, 0, 1],
    [0, 0.12, 1],
    [0, 0.12, -1],
  ];
  const route = await walk(
    [floor(-2, 0, 0), floor(0, 2, 0.12), riser],
    [-0.2, 0, 0],
    [0.2, 0.12, 0],
  );
  assert.equal(route.status, 'complete');
});
