import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { GroundArrival, Surface, Vec3 } from '#@/src/index.ts';
import type { FollowingSupport } from '#@/src/solver/physical.ts';
import type { JumpRouteOptions } from '#@/src/v1/route/jump-planner.ts';
import { planFollowingRoute } from '#@/src/v1/solver/physical/following-route.ts';

const floor = (id: string, x0: number, x1: number, y: number, z0 = -6, z1 = 6): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x0, y, z1],
    [x1, y, z1],
    [x1, y, z0],
  ],
});
const geometry = (surfaces: Surface[]) => ({
  positions: surfaces.flatMap((surface) => surface.vertices).flat(),
  indices: surfaces.flatMap((_, i) => [i * 4, i * 4 + 1, i * 4 + 2, i * 4, i * 4 + 2, i * 4 + 3]),
});
const cuboid = (x: number, y: number, z: number): Vec3[] =>
  Array.from({ length: 8 }, (_, bits): Vec3 => [
    x + (bits & 1 ? 0.8 : -0.8),
    y + (bits & 2 ? 1.2 : 0),
    z + (bits & 4 ? 0.8 : -0.8),
  ]);
const support = (): FollowingSupport => ({
  id: 'box',
  level: 'level',
  model: 'fixture',
  geometryKind: 'box',
  initialState: 0,
  assumption: 'placement-within-activity-range',
  spawn: [0, 0, 0],
  bodies: [cuboid(0, 0, 0)],
  maxDistance: 65,
});
const build = {
  profile: { radius: 0.2, height: 1.4 },
  maxSlope: 45,
  stepUp: 0.3,
  stepDown: 0.5,
  cellSize: 0.1,
  cellHeight: 0.05,
  bounds: { min: [-8, -6] as [number, number], max: [18, 6] as [number, number] },
};
const jump: JumpRouteOptions = {
  profile: build.profile,
  speed: 3,
  maxVertical: 0.5,
  walls: [],
  locomotion: { speed: 3, sprintSpeed: 6, sprintAcceleration: 3 },
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 1.5,
    maxFallingSpeed: 15,
    apexTime: 0,
    maxHorizontalSpeed: 4,
    airAcceleration: 60,
    airDeceleration: 10,
  },
  runAirSpeed: 4,
  maxSlope: 45,
  maxDrop: 5,
  maxHorizontalDistance: 6,
  sampleSpacing: 0.5,
  maxCandidates: 640,
  maxLinks: 8,
};
const starts: GroundArrival[] = [
  { id: 'player', state: 'available', position: [-4, 0, 0], cost: 0 },
];
const base = () => [floor('lower', -8, 18, 0), floor('upper', 10, 15, 2.5, -2, 2)];
const solve = async ({
  boxes = [support()],
  surfaces = base(),
  arrivals = starts,
  target = [12, 2.5, 0],
  options = jump,
}: {
  boxes?: FollowingSupport[];
  surfaces?: Surface[];
  arrivals?: GroundArrival[];
  target?: Vec3;
  options?: JumpRouteOptions;
} = {}) => {
  const terrain = geometry(surfaces),
    world = createCollisionWorld(terrain, { bounds: { min: [-8.5, -6.5], max: [18.5, 6.5] } });
  return planFollowingRoute(boxes, terrain, world, arrivals, target, {
    surfaces,
    build,
    jump: options,
  });
};

test('one useful assumed placement supports the target without control actions or artificial travel cost', async () => {
  const boxes = [support()],
    before = structuredClone(boxes);
  const result = await solve({ boxes });
  assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
  assert.equal(result.diagnostics.assumption, 'placement-within-activity-range');
  assert.equal(result.supportBoxes.length, 1);
  assert.equal(result.supportBoxes[0].family, 'following-box');
  assert.ok(result.supportBoxes[0].min[0] > 1);
  assert.equal('operations' in result, false);
  assert.deepEqual(boxes, before);
  if (result.route.status !== 'complete') {
    return;
  }
  assert.deepEqual(result.route.points[0], starts[0].position);
  assert.deepEqual(result.route.points.at(-1), [12, 2.5, 0]);
  assert.equal(
    result.route.cost,
    result.route.arrivalCost +
      result.route.segments.reduce((sum, segment) => sum + segment.times.at(-1)!, 0),
  );
});

test('placement may use another ground height without proving a route for moving the box', async () => {
  const result = await solve({
    surfaces: [
      floor('birth', -8, 2, 0),
      floor('destination', 6, 18, 0.2),
      floor('upper', 10, 15, 2.7, -2, 2),
    ],
    arrivals: [{ id: 'player', state: 'available', position: [6.5, 0.2, 0], cost: 0 }],
    target: [12, 2.7, 0],
  });
  assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
  assert.ok(Math.abs(result.supportBoxes[0].min[1] - 0.2) < 1e-8);
});

test('collider bottom offset aligns to the candidate floor, independently of the source root height', async () => {
  const box = support();
  box.spawn[1] = 3;
  box.bodies = [cuboid(0, 1, 0)];
  const result = await solve({ boxes: [box] });
  assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
  assert.equal(result.supportBoxes[0].min[1], 0);
});

test('a spherical activity limit rejects otherwise useful poses outside the source range', async () => {
  const box = support();
  box.maxDistance = 5;
  const result = await solve({ boxes: [box] });
  assert.equal(result.route.status, 'no-verified-route');
  assert.ok(
    result.diagnostics.outcomes.some(
      (outcome) => outcome.reason === 'placement-outside-activity-range',
    ),
  );
});

test('zero or invalid discovery budgets and unavailable starts return explicit finite results', async () => {
  for (const limits of [
    { maxLinks: 0 },
    { maxCandidates: 0 },
    { maxLinks: -1 },
    { maxCandidates: NaN },
    { maxCandidates: Infinity },
    { maxLinks: 1.5 },
  ]) {
    const result = await solve({ options: { ...jump, ...limits } });
    assert.equal(result.route.status, 'no-verified-route');
    assert.ok(Number.isFinite(result.diagnostics.limits.jumpCandidatesPerPlacement));
    assert.equal(result.diagnostics.placements, 0);
  }
  for (const arrivals of [
    [],
    [{ ...starts[0], state: 'locked' as const }],
    [{ ...starts[0], state: 'unknown' as const }],
  ]) {
    const result = await solve({ arrivals });
    assert.equal(result.route.status, 'no-verified-route');
    assert.equal(result.diagnostics.outcomes[0].reason, 'no-available-starts');
  }
});

test('the selected available start and its arrival cost survive with and without locomotion', async () => {
  for (const locomotion of [jump.locomotion, undefined]) {
    const arrivals: GroundArrival[] = [
      { id: 'locked', state: 'locked', position: [-4, 0, 0], cost: 0 },
      { id: 'expensive', state: 'available', position: [-4, 0, 0], cost: 500 },
      { id: 'selected', state: 'available', position: [5, 0, 0], cost: 7 },
    ];
    const result = await solve({ arrivals, options: { ...jump, locomotion } });
    assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
    if (result.route.status !== 'complete') {
      continue;
    }
    assert.equal(result.route.start, 'selected');
    assert.equal(result.route.arrivalCost, 7);
    assert.deepEqual(result.route.points[0], [5, 0, 0]);
    assert.ok(result.route.cost >= 7);
  }
});

test('initial poses retain nonzero arrival cost and reject a blocked starting point', async () => {
  const result = await solve({
    surfaces: [floor('lower', -8, 18, 0)],
    target: [0, 1.2, 0],
    arrivals: [
      { id: 'inside-box', state: 'available', position: [0, 0, 0], cost: 0 },
      { id: 'outside', state: 'available', position: [-4, 0, 0], cost: 11 },
    ],
    options: { ...jump, locomotion: undefined },
  });
  assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
  if (result.route.status !== 'complete') {
    return;
  }
  assert.equal(result.route.start, 'outside');
  assert.equal(result.route.arrivalCost, 11);
  assert.deepEqual(result.supportBoxes[0].min, [-0.8, 0, -0.8]);
});

test('unidentified original static box collision is retained and prevents relocation', async () => {
  const result = await solve({
    surfaces: [...base(), floor('original-roof', -0.8, 0.8, 1.2, -0.8, 0.8)],
  });
  assert.equal(result.route.status, 'no-verified-route');
  assert.ok(
    result.diagnostics.outcomes.some(
      (outcome) => outcome.reason === 'source-collision-ownership-unresolved',
    ),
  );
});

test('a candidate needs complete support under its actual footprint, including narrow holes', async () => {
  const result = await solve({
    surfaces: [
      floor('left', -8, 7.9, 0, -1, 1),
      floor('right-near', 9.5, 11.95, 0, -1, 1),
      floor('right-far', 12.05, 18, 0, -1, 1),
      floor('upper', 10, 15, 2.5, -0.5, 0.5),
    ],
  });
  assert.equal(result.route.status, 'no-verified-route', JSON.stringify(result.diagnostics));
  assert.ok(
    result.diagnostics.outcomes.some((outcome) => outcome.reason === 'placement-base-unsupported'),
  );
});

test('rotated source boxes retain their real roof and unsupported geometry is rejected', async () => {
  const box = support(),
    angle = Math.PI / 4;
  box.bodies = box.bodies.map((body) =>
    body.map((p): Vec3 => [
      p[0] * Math.cos(angle) - p[2] * Math.sin(angle),
      p[1],
      p[0] * Math.sin(angle) + p[2] * Math.cos(angle),
    ]),
  );
  const result = await solve({
    boxes: [box],
    options: { ...jump, maxLinks: 16, maxCandidates: 1280 },
  });
  assert.equal(result.route.status, 'complete', JSON.stringify(result.diagnostics));
  assert.ok(result.supportBoxes[0].max[0] - result.supportBoxes[0].min[0] > 2);
  box.geometryKind = 'convex';
  const unsupported = await solve({ boxes: [box] });
  assert.equal(unsupported.route.status, 'no-verified-route');
  assert.equal(unsupported.diagnostics.outcomes[0].reason, 'solid-roof-unsupported');
});

test('other boxes retain their initial solids and malformed obstacle geometry fails conservatively', async () => {
  const obstacle = support();
  obstacle.id = 'obstacle';
  obstacle.geometryKind = 'convex';
  obstacle.spawn = [4, 0, 0];
  obstacle.bodies = [
    Array.from({ length: 8 }, (_, bits): Vec3 => [
      bits & 1 ? 4.3 : 3.7,
      bits & 2 ? 5 : 0,
      bits & 4 ? 6 : -6,
    ]),
  ];
  const before = structuredClone(obstacle);
  const result = await solve({ boxes: [support(), obstacle] });
  assert.equal(result.route.status, 'no-verified-route');
  assert.deepEqual(obstacle, before);
  obstacle.bodies = [];
  const malformed = await solve({ boxes: [support(), obstacle] });
  assert.equal(malformed.route.status, 'no-verified-route');
  assert.ok(
    malformed.diagnostics.outcomes.some(
      (outcome) => outcome.reason === 'invalid-box-obstacle-geometry',
    ),
  );
});

test('compatible known device actions remain usable and actions crossing the placed solid are rejected', async () => {
  const box = support();
  box.spawn = [8.7, 0, 0];
  box.bodies = [cuboid(8.7, 0, 0)];
  box.maxDistance = 0.01;
  const surfaces = [
    floor('entry', -8, -6, 0),
    floor('lower', 0, 18, 0),
    floor('upper', 10, 15, 2.5, -2, 2),
  ];
  const arrivals: GroundArrival[] = [
    { id: 'rope-player', state: 'available', position: [-7, 0, 0], cost: 3 },
  ];
  const connection = {
    id: 'rope',
    mode: 'rope' as const,
    state: 'open' as const,
    points: [[-6.4, 0.01, 0] as Vec3, [2, 0.01, 0] as Vec3],
    times: [0, 2],
    endpointTolerance: 0.2,
  };
  const compatible = await solve({
    boxes: [box],
    surfaces,
    arrivals,
    options: { ...jump, connections: [connection] },
  });
  assert.equal(compatible.route.status, 'complete', JSON.stringify(compatible.diagnostics));
  if (compatible.route.status === 'complete') {
    assert.ok(compatible.route.segments.some((segment) => segment.connection === 'rope'));
    assert.equal(compatible.route.arrivalCost, 3);
  }
  const crossing = {
    ...connection,
    points: [connection.points[0], [14, 0.01, 0] as Vec3, connection.points[1]],
    times: [0, 2, 4],
  };
  const blocked = await solve({
    boxes: [box],
    surfaces,
    arrivals,
    options: { ...jump, connections: [crossing] },
  });
  assert.equal(blocked.route.status, 'no-verified-route');
});
