import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalWorld, createPhysicalVerifier } from '#@/src/evaluation/index.ts';
import type { Vec3 } from '#@/src/geometry.ts';
import { jumpConnection } from '#@/src/model/flight.ts';
import { createLocomotionRules } from '#@/src/model/locomotion.ts';
import type { Segment } from '#@/src/movement.ts';
import type { Route, GroundArrival } from '#@/src/route.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';

function snapshot(): PhysicalInput {
  const vertices: Vec3[] = [
    [-10, 0, -10],
    [-10, 0, 10],
    [10, 0, 10],
    [10, 0, -10],
  ];
  return {
    ground: {
      surfaces: [{ id: 'floor', vertices }],
      options: { walls: [], profile: { radius: 0.2, height: 1.6 }, speed: 5, maxVertical: 0.5 },
    },
    collision: { positions: vertices.flat(), indices: [0, 1, 2, 0, 2, 3] },
    movement: {
      model: {
        gravity: 10,
        fallingGravity: 10,
        maxJumpHeight: 1,
        maxFallingSpeed: 10,
        apexTime: 0,
        maxHorizontalSpeed: 5,
        startHorizontalSpeed: 5,
        airOverspeedDeceleration: 10,
        airAcceleration: 20,
        airDeceleration: 20,
      },
      maxSlope: 45,
      runAirSpeed: 5,
      stepUp: 0.4,
      stepDown: 0.5,
    },
    locomotion: {
      speed: 5,
      sprintSpeed: 8,
      sprintAcceleration: 10,
      stamina: {
        capacity: 10,
        initial: 10,
        activationCost: 4,
        sprintDrain: 1,
        recoveryRate: 0,
        recoveryDelay: 0,
        reserve: 0,
      },
    },
  };
}
function candidate(
  input: PhysicalInput,
  base: Segment[],
  allowSprint = false,
): Extract<Route, { status: 'complete' }> {
  const rules = createLocomotionRules(input.locomotion),
    replay = rules.advance(base, rules.initial(), { allowSprint, allowDash: false })!;
  const points = [base[0].points[0], ...replay.segments.flatMap((s) => s.points.slice(1))];
  return {
    status: 'complete',
    start: 'start',
    arrivalCost: 0,
    cost: replay.duration,
    length: points
      .slice(1)
      .reduce((sum, p, i) => sum + Math.hypot(...p.map((v, a) => v - points[i][a])), 0),
    points,
    segments: replay.segments,
    schedule: [{ segments: base, allowSprint, allowDash: false }],
  };
}
const walk = (): Segment => ({
  mode: 'walk',
  points: [
    [0, 0.005, 0],
    [2, 0.005, 0],
  ],
  times: [0, 0.4],
});
function verify(input: PhysicalInput, route: Extract<Route, { status: 'complete' }>) {
  const world = createPhysicalWorld(input, 'complete');
  const start: GroundArrival = {
    id: 'start',
    position: route.points[0],
    cost: 0,
    state: 'available',
  };
  return createPhysicalVerifier(() => [world])(
    { starts: [start], goal: route.points.at(-1)! },
    route,
  );
}
test('physical replay accepts a supported run and a chosen resource-feasible sprint', () => {
  const input = snapshot();
  assert.equal(verify(input, candidate(input, [walk()])).valid, true);
  assert.equal(verify(input, candidate(input, [walk()], true)).valid, true);
});
test('consistent claimed timing cannot turn a run into teleportation', () => {
  const input = snapshot(),
    route = candidate(input, [walk()]);
  route.segments[0].times = [0, 0.001];
  route.cost = 0.001;
  const result = verify(input, route);
  assert.equal(result.valid, false);
  assert.match(result.issues.join(), /resource replay/);
});
test('continuous support rejects a narrow raw collision gap even with a solid navigation polygon', () => {
  const input = snapshot();
  input.collision = {
    positions: [
      -10, 0, -10, -10, 0, 10, 0.9999, 0, 10, 0.9999, 0, -10, 1.0001, 0, -10, 1.0001, 0, 10, 10, 0,
      10, 10, 0, -10,
    ],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  };
  assert.equal(verify(input, candidate(input, [walk()])).valid, false);
});
test('capsule replay rejects an active wall and missing swept body coverage', () => {
  const input = snapshot(),
    route = candidate(input, [walk()]);
  input.ground.options.walls = [{ min: [0.9, 0, -1], max: [1.1, 2, 1], state: 'active' }];
  assert.equal(verify(input, route).valid, false);
  input.ground.options.walls = [];
  const world = createPhysicalWorld(input, {
    bounds: { min: [-10, -10], max: [10, 10] },
    tileSpan: 1,
    tiles: [{ x: 0, z: 0 }],
  });
  assert.equal(
    createPhysicalVerifier(() => [world])(
      {
        starts: [{ id: 'start', position: [0, 0, 0], cost: 0, state: 'available' }],
        goal: [2, 0, 0],
      },
      route,
    ).valid,
    false,
  );
});
test('flight witnesses are replayed against authoritative gravity and the swept world', () => {
  const input = snapshot(),
    world = createPhysicalWorld(input, 'complete').configured();
  const arc = jumpConnection([0, 0.01, 0], [2, 0.01, 0], {
    ...input.movement.model,
    mode: 'jump',
    profile: input.ground.options.profile,
    walls: [],
    sweep: world.world.sweepCapsule.bind(world.world),
  })!;
  const route = candidate(input, [arc]);
  assert.equal(verify(input, route).valid, true);
  route.schedule![0].segments[0].flight!.model.gravity = 1;
  assert.equal(verify(input, route).valid, false);
});
test('early airborne collection uses executed horizontal speed for the sprint requirement', () => {
  const input = snapshot(),
    world = createPhysicalWorld(input, 'complete'),
    configured = world.configured();
  const options = {
    ...input.movement.model,
    mode: 'jump' as const,
    profile: input.ground.options.profile,
    walls: [],
    sweep: configured.world.sweepCapsule.bind(configured.world),
  };
  const full = jumpConnection([0, 0.01, 0], [2, 0.01, 0], options)!;
  const goal = full.points[Math.floor(full.points.length / 4)];
  const interaction = { radius: 0.125, airborne: true };
  const arc = jumpConnection(full.flight!.start, full.flight!.end, {
    ...options,
    collection: { target: goal, interaction },
  })!;
  assert.ok(arc.times.at(-1)! < full.times.at(-1)! / 2);
  const route = candidate(input, [arc]);
  route.goalHit = {
    segment: route.segments.length - 1,
    time: route.segments.at(-1)!.times.at(-1)!,
    position: route.points.at(-1)!,
  };
  const query = {
    starts: [{ id: 'start', position: route.points[0], cost: 0, state: 'available' as const }],
    goal,
    interaction,
  };
  const accepted = createPhysicalVerifier(() => [world])(query, route);
  assert.equal(accepted.valid, true, accepted.issues.join());
  const slowRun = structuredClone(input);
  slowRun.movement.runAirSpeed = 1;
  const rejection = createPhysicalVerifier(() => [createPhysicalWorld(slowRun, 'complete')])(
    query,
    route,
  );
  assert.equal(rejection.valid, false);
  assert.match(rejection.issues.join(), /requires active sprint/);
});
test('boosts and moving-support labels cannot authorize invented actions', () => {
  const input = snapshot(),
    boosted = walk();
  boosted.boost = { id: 'invented', multiplier: 10, duration: 100 };
  assert.equal(verify(input, candidate(input, [boosted])).valid, false);
  const rope: Segment = {
    mode: 'rope',
    traversal: 'moving-support',
    connection: 'moving-join/invented',
    points: [
      [0, 0.01, 0],
      [0, 0.2, 0],
    ],
    times: [0, 0.038],
  };
  assert.equal(verify(input, candidate(input, [rope])).valid, false);
});
test('whole-route controls cannot reset stamina between sprint blocks', () => {
  const input = snapshot();
  input.locomotion.stamina!.initial = 4.01;
  const route = candidate(input, [walk()], true);
  const fake = structuredClone(route);
  fake.schedule![0].segments[0].requiredGait = undefined;
  fake.schedule!.push(structuredClone(fake.schedule![0]));
  assert.equal(verify(input, fake).valid, false);
});

test('support correction cannot add uncharged physical distance on a slope', () => {
  const input = snapshot();
  input.collision.positions = input.collision.positions.map((v, i) =>
    i % 3 === 1 ? 0.6 * input.collision.positions[i - 1] : v,
  );
  const base: Segment = {
    mode: 'walk',
    points: [
      [-0.25, 0, 0],
      [0.25, 0, 0],
    ],
    times: [0, 0.1],
  };
  assert.equal(verify(input, candidate(input, [base])).valid, false);
});
test('flight start and landing must coincide with physical feet, not a projection interval', () => {
  const input = snapshot(),
    world = createPhysicalWorld(input, 'complete').configured();
  const arc = jumpConnection([0, 0.3, 0], [2, 0.3, 0], {
    ...input.movement.model,
    mode: 'jump',
    profile: input.ground.options.profile,
    walls: [],
    sweep: world.world.sweepCapsule.bind(world.world),
  })!;
  const result = verify(input, candidate(input, [arc]));
  assert.equal(result.valid, false);
  assert.match(result.issues.join(), /takeoff/);
});
test('moving a support through a static slab is rejected as a whole-body collision', () => {
  const input = snapshot();
  input.collision.positions = [
    ...input.collision.positions,
    -2,
    1,
    -2,
    -2,
    1,
    2,
    2,
    1,
    2,
    2,
    1,
    -2,
  ];
  input.collision.indices = [...input.collision.indices, 4, 5, 6, 4, 6, 7];
  const body: Vec3[] = Array.from({ length: 8 }, (_, bits): Vec3 => [
    5 + (bits & 1 ? 1 : -1),
    bits & 2 ? 2 : 0,
    bits & 4 ? 1 : -1,
  ]);
  input.devices = {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'box',
        level: 'test',
        model: 'box',
        spawn: [5, 0, 0],
        bodies: [body],
        geometryKind: 'box',
        maxDistance: 10,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  };
  const route = candidate(input, [
    {
      mode: 'walk',
      points: [
        [0, 2.01, 0],
        [0.5, 2.01, 0],
      ],
      times: [0, 0.1],
    },
  ]);
  route.placements = [{ device: 'box', position: [0, 0, 0] }];
  const result = verify(input, route);
  assert.equal(result.valid, false);
  assert.match(result.issues.join(), /intersects static geometry/);
});
test('an unused distant convex support does not invalidate ordinary walking', () => {
  const input = snapshot();
  input.devices = {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'convex',
        level: 'test',
        model: 'convex',
        spawn: [8, 0, 8],
        bodies: [
          [
            [7, 0, 7],
            [9, 0, 7],
            [8, 1, 9],
            [8, 0, 9],
          ],
        ],
        geometryKind: 'convex',
        maxDistance: 10,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  };
  assert.equal(verify(input, candidate(input, [walk()])).valid, true);
});
test('equivalent knot density and segment splits use the same physical acceptance', () => {
  const input = snapshot(),
    route = candidate(input, [walk()]);
  route.segments = [
    {
      ...route.segments[0],
      points: [
        [0, 0.005, 0],
        [1, 0.005, 0],
      ],
      times: [0, 0.2],
    },
    {
      ...route.segments[0],
      points: [
        [1, 0.005, 0],
        [1.5, 0.005, 0],
        [2, 0.005, 0],
      ],
      times: [0, 0.1, 0.2],
    },
  ];
  assert.equal(verify(input, route).valid, true);
});

test('horizontal and stationary walks must use supported feet rather than nearby projections', () => {
  const input = snapshot();
  for (const endX of [0, 2]) {
    const floating: Segment = {
      mode: 'walk',
      points: [
        [0, 0.3, 0],
        [endX, 0.3, 0],
      ],
      times: [0, endX / 5],
    };
    const route = candidate(input, [floating]);
    if (!endX) delete route.schedule;
    assert.equal(verify(input, route).valid, false);
  }
  const stationary = candidate(input, [
    {
      mode: 'walk',
      points: [
        [0, 0.005, 0],
        [0, 0.005, 0],
      ],
      times: [0, 0],
    },
  ]);
  delete stationary.schedule;
  assert.equal(verify(input, stationary).valid, true);
});
test('a submitted flight within representation tolerance still cannot penetrate a wall', () => {
  const input = snapshot();
  input.collision.positions = [
    ...input.collision.positions,
    -1,
    0,
    0.202,
    3,
    0,
    0.202,
    3,
    3,
    0.202,
    -1,
    3,
    0.202,
  ];
  input.collision.indices = [...input.collision.indices, 4, 5, 6, 4, 6, 7];
  const world = createPhysicalWorld(input, 'complete').configured();
  const arc = jumpConnection([0, 0.01, 0], [2, 0.01, 0], {
    ...input.movement.model,
    mode: 'jump',
    profile: input.ground.options.profile,
    walls: [],
    sweep: world.world.sweepCapsule.bind(world.world),
  })!;
  assert.ok(arc);
  const route = candidate(input, [arc]);
  assert.equal(verify(input, route).valid, true);
  route.segments = structuredClone(route.segments);
  for (const segment of route.segments)
    for (const point of segment.points.slice(1, -1)) point[2] = 0.004;
  route.points = [route.segments[0].points[0], ...route.segments.flatMap((s) => s.points.slice(1))];
  route.length = route.points
    .slice(1)
    .reduce((sum, p, i) => sum + Math.hypot(...p.map((v, a) => v - route.points[i][a])), 0);
  const result = verify(input, route);
  assert.equal(result.valid, false);
  assert.match(result.issues.join(), /Submitted trajectory/);
});
