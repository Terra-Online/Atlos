import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/index.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import type { SweptSupport } from '#@/src/solver/physical.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { movingGround } from '#@/src/v1/solver/physical/moving-ground.ts';
import { sweepSupports } from '#@/src/v1/solver/physical/supports.ts';

const floor = (id: string, x0: number, x1: number, y: number, z0 = -3, z1 = 3): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
  ],
});
const geometry = (surfaces: Surface[]) => {
  const positions = surfaces
    .flatMap((s) => [
      s.vertices[0],
      s.vertices[1],
      s.vertices[2],
      s.vertices[0],
      s.vertices[2],
      s.vertices[3],
    ])
    .flat();
  return { positions, indices: Array.from({ length: positions.length / 3 }, (_, i) => i) };
};
const build = {
  profile: { radius: 0.2, height: 1.6 },
  maxSlope: 45,
  stepUp: 0.4,
  stepDown: 0.6,
  cellSize: 0.1,
  cellHeight: 0.05,
  bounds: { min: [-10, -5] as [number, number], max: [10, 5] as [number, number] },
};
const support = (id: string, poses: Vec3[][][], speed = 4): SweptSupport => ({
  id,
  family: 'platform',
  level: 'level',
  model: 'model',
  assumption: 'phase-free-swept-support',
  ...sweepSupports(id, poses, speed),
});

test('sweep roofs preserve bends, and vertical motion produces separate caps and a ride', () => {
  const box = (x: number, y: number, z: number): Vec3[] => [
    [x - 1, y, z - 1],
    [x - 1, y, z + 1],
    [x + 1, y, z + 1],
    [x + 1, y, z - 1],
  ];
  const sweep = sweepSupports('bend', [[box(0, 0, 0)], [box(6, 0, 0)], [box(6, 0, 6)]], 2);
  assert.equal(createGoalProjector(sweep.surfaces)([0, 0, 6], { maxVertical: 0.1 }).length, 0);
  const vertical = sweepSupports('lift', [[box(0, 0, 0)], [box(0, 8, 0)]], 4);
  assert.equal(vertical.surfaces.length, 2);
  assert.deepEqual(vertical.transfers, [
    { from: [0, 0, 0], to: [0, 8, 0], speed: 4, body: 0, fromPose: 0, toPose: 1 },
  ]);
  assert.throws(() => sweepSupports('bad', [[box(0, 0, 0)], []], 2), /invalid/);
});

test('vertical ride joins ordinary ground and retains its travel time', async () => {
  const surfaces = [floor('lower', -8, -1, 0), floor('upper', 1, 8, 8)];
  const terrain = geometry(surfaces),
    world = createCollisionWorld(terrain, { bounds: build.bounds });
  const moving = support('lift', [
    [floor('a', -2, 2, 0, -2, 2).vertices],
    [floor('b', -2, 2, 8, -2, 2).vertices],
  ]);
  const before = structuredClone(surfaces);
  const result = await movingGround([moving], terrain, world, {
    build,
    walls: [],
    surfaces,
    speed: 5,
  });
  const rides = result.connections.filter((c) => c.id.startsWith('moving-ride/'));
  assert.equal(rides.length, 2);
  assert.ok(Math.abs(rides[0].times.at(-1)! - 2) < 0.03);
  const route = createGroundPlanner([...surfaces, ...result.surfaces], {
    profile: build.profile,
    maxVertical: 0.5,
    walls: [],
    speed: 5,
    connections: result.connections,
    portals: result.portals,
  }).plan([{ id: 'start', state: 'available', position: [-6, 0, 0], cost: 0 }], [6, 8, 0]);
  assert.equal(route.status, 'complete');
  assert.deepEqual(surfaces, before);
});

test('moving support queries retain the static world body-padded scope', async () => {
  const surfaces = [floor('base', -12, 12, 0, -7, 7)];
  const terrain = geometry(surfaces);
  const scope = { min: [-11, -6] as [number, number], max: [11, 6] as [number, number] };
  const world = createCollisionWorld(terrain, { bounds: scope });
  const moving = support('leaf', [[floor('a', -2, 2, 4).vertices]]);
  const result = await movingGround([moving], terrain, world, {
    build,
    walls: [],
    surfaces,
    speed: 5,
  });
  const query = { maxUp: 0.1, maxDown: 0.1, maxSlope: 45, radius: build.profile.radius };
  for (const point of [
    [9.9, 0, 0],
    [10.5, 0, 0],
    [0, 0, 5.5],
  ] as Vec3[]) {
    assert.deepEqual(result.world.groundAt(point, query), world.groundAt(point, query));
  }
  assert.deepEqual(result.world.bounds, scope);
  assert.throws(() => result.world.groundAt([11, 0, 0], query), /indexed XZ bounds/);
  assert.equal(result.world.groundAt([10.5, 4, 0], query), null);
});

test('sweep support is clearance baked and active exclusions block rides', async () => {
  const surfaces = [floor('base', -8, 8, -2)];
  const ceiling = {
    ...floor('ceiling', -2, 2, 1.1, -2, 2),
    vertices: floor('ceiling', -2, 2, 1.1, -2, 2).vertices.toReversed(),
  };
  const terrain = geometry([...surfaces, ceiling]),
    world = createCollisionWorld(terrain, { bounds: build.bounds });
  const moving = support('leaf', [
    [floor('a', -3, 3, 0).vertices],
    [floor('b', -3, 3, 5).vertices],
  ]);
  const result = await movingGround([moving], terrain, world, {
    build,
    surfaces,
    speed: 5,
    walls: [{ min: [-4, 2, -4], max: [4, 3, 4], state: 'active' }],
  });
  assert.equal(createGoalProjector(result.surfaces)([0, 0, 0], { maxVertical: 0.1 }).length, 0);
  assert.equal(
    result.connections.some((c) => c.id.startsWith('moving-ride/')),
    false,
  );
  assert.equal(result.world.groundAt([0, 0, 0], { maxUp: 0.1, maxDown: 0.1, maxSlope: 45 }), null);
});

test('dense vertical poses remain alternative supports and all ride segments compose', async () => {
  const surfaces = [floor('lower', -8, -1, 0), floor('upper', 1, 8, 8)];
  const terrain = geometry(surfaces),
    world = createCollisionWorld(terrain, { bounds: build.bounds });
  const moving = support(
    'lift',
    Array.from({ length: 41 }, (_, i) => [floor('cap', -2, 2, i / 5, -2, 2).vertices]),
  );
  const result = await movingGround([moving], terrain, world, {
    build,
    walls: [],
    surfaces,
    speed: 5,
  });
  const rides = result.connections.filter((c) => c.id.startsWith('moving-ride/'));
  assert.equal(rides.length, 80);
  const fullTripTime = rides
    .filter((c) => !c.id.endsWith('/reverse'))
    .reduce((sum, c) => sum + c.times.at(-1)!, 0);
  assert.ok(Math.abs(fullTripTime - 2) < 0.01);
  assert.ok(result.world.groundAt([0, 2, 0], { maxUp: 0.05, maxDown: 0.05, maxSlope: 45 }));
  const route = createGroundPlanner([...surfaces, ...result.surfaces], {
    profile: build.profile,
    maxVertical: 0.5,
    walls: [],
    speed: 5,
    connections: result.connections,
    portals: result.portals,
  }).plan([{ id: 'start', state: 'available', position: [-6, 0, 0], cost: 0 }], [6, 8, 0]);
  assert.equal(route.status, 'complete');
});

test('a diagonally rising platform retains boarding caps and a timed transport', async () => {
  const surfaces = [floor('lower', -8, -1, 0), floor('upper', 2, 8, 10)];
  const terrain = geometry(surfaces),
    world = createCollisionWorld(terrain, { bounds: build.bounds });
  const moving = support('diagonal', [
    [floor('a', -2, 2, 0, -2, 2).vertices],
    [floor('b', -1, 3, 10, -2, 2).vertices],
  ]);
  assert.equal(moving.transfers.length, 1);
  const result = await movingGround([moving], terrain, world, {
    build,
    walls: [],
    surfaces,
    speed: 5,
  });
  const rides = result.connections.filter((c) => c.id.startsWith('moving-ride/'));
  assert.equal(rides.length, 2);
  assert.ok(Math.abs(rides[0].times.at(-1)! - Math.sqrt(101) / 4) < 0.03);
  const route = createGroundPlanner([...surfaces, ...result.surfaces], {
    profile: build.profile,
    maxVertical: 0.5,
    walls: [],
    speed: 5,
    connections: result.connections,
    portals: result.portals,
  }).plan([{ id: 'start', state: 'available', position: [-6, 0, 0], cost: 0 }], [6, 10, 0]);
  assert.equal(route.status, 'complete');
});

test('distant support clusters bake separately and omit vertically irrelevant static triangles', async () => {
  const distantBuild = {
    ...build,
    bounds: { min: [-70, -5] as [number, number], max: [70, 5] as [number, number] },
  };
  const terrain = geometry([floor('deep', -65, 65, -100), floor('high', -65, 65, 100)]);
  const world = createCollisionWorld(terrain, { bounds: distantBuild.bounds });
  const left = support('left', [
    [floor('a', -52, -48, 0).vertices],
    [floor('b', -51, -47, 0).vertices],
  ]);
  const right = support('right', [
    [floor('a', 48, 52, 0).vertices],
    [floor('b', 49, 53, 0).vertices],
  ]);
  const result = await movingGround([left, right], terrain, world, {
    build: distantBuild,
    walls: [],
    surfaces: [],
    speed: 5,
  });
  assert.equal(result.builds.length, 2);
  assert.ok(result.builds.every((bake) => bake.bounds.max[0] - bake.bounds.min[0] < 10));
  assert.ok(result.builds.every((bake) => bake.triangles === 0));
  assert.equal(createGoalProjector(result.surfaces)([0, 0, 0], { maxVertical: 0.2 }).length, 0);
});

test('an overlapping native mesh preserves existing terrain portal ownership and route cost', async () => {
  const terrain = geometry([floor('terrain', -3, 3, 0)]);
  const world = createCollisionWorld(terrain, { bounds: build.bounds });
  const moving = support('same-floor', [
    [floor('a', -2, 2, 0, -2, 2).vertices],
    [floor('b', -2, 2, 0, -2, 2).vertices],
  ]);
  const seed = await movingGround([moving], terrain, world, {
    build,
    walls: [],
    surfaces: [],
    speed: 5,
  });
  const base = seed.surfaces.map((surface) => ({
    id: 'base/' + surface.id,
    vertices: surface.vertices,
  }));
  const options = { profile: build.profile, maxVertical: 0.5, walls: [], speed: 5 };
  const starts = [
    { id: 'start', state: 'available' as const, position: [-1.5, 0.1, -1.5] as Vec3, cost: 0 },
  ];
  const goal: Vec3 = [1.5, 0.1, 1.5];
  const before = createGroundPlanner(base, options).plan(starts, goal);
  assert.equal(before.status, 'complete');
  const added = await movingGround([moving], terrain, world, {
    build,
    walls: [],
    surfaces: base,
    speed: 5,
  });
  assert.ok(added.portals.length > 0);
  assert.ok(added.surfaces.every((surface) => surface.portals?.length === 0));
  const after = createGroundPlanner([...base, ...added.surfaces], {
    ...options,
    portals: added.portals,
    connections: added.connections,
  }).plan(starts, goal);
  assert.equal(after.status, 'complete');
  if (before.status === 'complete' && after.status === 'complete') {
    assert.ok(after.cost <= before.cost + 1e-6);
  }
});
