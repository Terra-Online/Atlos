import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalWorld, createPhysicalVerifier } from '#@/src/evaluation/index.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { circularSupport } from '#@/src/model/circular-support.ts';
import { createCollisionWorld } from '#@/src/model/collision.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import { retimeGroundRoute } from '#@/src/v1/resource/locomotion.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { movingGround } from '#@/src/v1/solver/physical/moving-ground.ts';

const wheel = () =>
  circularSupport({
    id: 'wheel',
    level: 'test',
    model: 'source',
    center: [0, 4, 0],
    axis: [0, 0, 1],
    radius: 3,
    halfWidth: 0.5,
    speed: 2,
  });
const build = {
  profile: { radius: 0.2, height: 1.6 },
  maxSlope: 45,
  stepUp: 0.3,
  stepDown: 0.5,
  cellSize: 0.1,
  cellHeight: 0.05,
  bounds: { min: [-5, -2] as [number, number], max: [5, 2] as [number, number] },
};

test('source circular contacts retain the hollow centre and a closed peripheral path', () => {
  const w = wheel();
  assert.equal(createGoalProjector(w.surfaces)([0, 4, 0], { maxVertical: 0.1 }).length, 0);
  for (const t of w.transfers) {
    for (const p of [t.from, t.to]) assert.ok(Math.abs(Math.hypot(p[0], p[1] - 4) - 3) < 1e-8);
    const midpoint = t.from.map((v, i) => (v + t.to[i]) / 2);
    assert.ok(3 - Math.hypot(midpoint[0], midpoint[1] - 4) <= w.circular!.sagitta + 1e-9);
  }
  assert.deepEqual(w.transfers.at(-1)!.to, w.transfers[0].from);
  assert.throws(
    () =>
      circularSupport({
        ...w.circular!,
        id: 'bad',
        level: 'test',
        model: 'source',
        axis: [0, 1, 0],
        speed: 2,
      }),
    /horizontal/,
  );
});

test('circular routes use rim connections while external exclusions block those connections', async () => {
  const w = wheel(),
    terrain = { positions: [], indices: [] };
  const world = createCollisionWorld(terrain, { bounds: build.bounds });
  const prepare = (walls: { min: Vec3; max: Vec3; state: 'active' }[]) =>
    movingGround([w], terrain, world, { build, walls, surfaces: [], speed: 5 });
  const open = await prepare([]);
  const a = w.transfers[0].from.map((v, i) => v + (i === 1 ? 0.01 : 0)) as Vec3;
  const b = w.transfers[Math.floor(w.transfers.length / 2)].from.map(
    (v, i) => v + (i === 1 ? 0.01 : 0),
  ) as Vec3;
  const route = createGroundPlanner(open.surfaces, {
    speed: 5,
    maxVertical: 0.5,
    walls: [],
    profile: build.profile,
    connections: open.connections,
    portals: open.portals,
  }).plan([{ id: 'entry', position: a, cost: 0, state: 'available' }], b);
  assert.equal(route.status, 'complete');
  if (route.status === 'complete') {
    assert.ok(route.length > 8.5, 'must travel around the rim rather than across its diameter');
    assert.ok(route.segments.some((s) => s.traversal === 'moving-support'));
    const locomotion = { speed: 5, sprintSpeed: 5, sprintAcceleration: 10 };
    const physical = createPhysicalWorld(
      {
        ground: {
          surfaces: [],
          build,
          options: { speed: 5, maxVertical: 0.5, walls: [], profile: build.profile },
        },
        collision: terrain,
        locomotion,
        movement: {
          maxSlope: 45,
          runAirSpeed: 5,
          stepUp: 0.3,
          stepDown: 0.5,
          model: {
            gravity: 10,
            fallingGravity: 10,
            maxJumpHeight: 1.5,
            maxFallingSpeed: 10,
            apexTime: 0,
            maxHorizontalSpeed: 5,
            startHorizontalSpeed: 5,
            airOverspeedDeceleration: 10,
            airAcceleration: 20,
            airDeceleration: 20,
          },
        },
        devices: { devices: [], ropes: [], movingSupports: [w] },
      },
      'complete',
    );
    const replay = createPhysicalVerifier(() => [physical])(
      { starts: [{ id: 'entry', position: a, cost: 0, state: 'available' }], goal: b },
      retimeGroundRoute(route, locomotion),
    );
    assert.equal(replay.valid, true, JSON.stringify(replay.issues));
    const nearFloor = createPhysicalWorld(
      {
        ...physical.input,
        collision: {
          positions: [-2, 6.9, -2, -2, 6.9, 2, 2, 6.9, 2, 2, 6.9, -2],
          indices: [0, 1, 2, 0, 2, 3],
        },
      },
      'complete',
    );
    assert.deepEqual(
      nearFloor.configured([]).standing([0, 6.91, 0]),
      [0, 6.91, 0],
      'a nearby abstract rim cannot lift a valid static-ground contact',
    );
  }
  const blocked = await prepare([{ min: [-4, 3.8, -2], max: [4, 4.2, 2], state: 'active' }]);
  assert.ok(blocked.connections.length < open.connections.length);
  const rejected = createGroundPlanner(blocked.surfaces, {
    speed: 5,
    maxVertical: 0.5,
    walls: [],
    profile: build.profile,
    connections: blocked.connections,
    portals: blocked.portals,
  }).plan([{ id: 'entry', position: a, cost: 0, state: 'available' }], b);
  assert.notEqual(rejected.status, 'complete');
});

test('a stationary brace clips the full contact strip rather than checking only its centre', async () => {
  const w = wheel(),
    terrain = { positions: [], indices: [] };
  const walls = [
    { min: [-0.2, 6.8, 0.3] as Vec3, max: [0.2, 9, 1] as Vec3, state: 'active' as const },
  ];
  const result = await movingGround(
    [w],
    terrain,
    createCollisionWorld(terrain, { bounds: build.bounds }),
    { build, walls, surfaces: [], speed: 5 },
  );
  const top = result.surfaces.find((s) =>
    result.sourceFaces.get(s.id)?.some((source) => source.surface === 0),
  );
  assert.ok(top);
  assert.ok(Math.max(...top.vertices.map((p) => p[2])) < 0.1);
  assert.ok(Math.min(...top.vertices.map((p) => p[2])) < -0.49);
});
