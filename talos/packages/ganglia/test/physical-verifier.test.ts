import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createPhysicalWorld,
  createPhysicalVerifier,
  type VerificationPolicy,
} from '#@/src/evaluation/index.ts';
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
function verify(
  input: PhysicalInput,
  route: Extract<Route, { status: 'complete' }>,
  policy: Partial<VerificationPolicy> = {},
) {
  const world = createPhysicalWorld(input, 'complete');
  const start: GroundArrival = {
    id: 'start',
    position: route.points[0],
    cost: 0,
    state: 'available',
  };
  return createPhysicalVerifier(() => [world], policy)(
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
test('continuous support includes capsule edge contact but rejects gaps wider than its footprint', () => {
  const input = snapshot();
  for (const gap of [0.0002, 0.5]) {
    input.collision = {
      positions: [
        -10,
        0,
        -10,
        -10,
        0,
        10,
        1 - gap / 2,
        0,
        10,
        1 - gap / 2,
        0,
        -10,
        1 + gap / 2,
        0,
        -10,
        1 + gap / 2,
        0,
        10,
        10,
        0,
        10,
        10,
        0,
        -10,
      ],
      indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
    };
    assert.equal(verify(input, candidate(input, [walk()]), { walkSnap: 0 }).valid, gap < 0.4);
  }
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

test('physical walking on a slope uses capsule support independently of navmesh cell height', () => {
  const input = snapshot();
  input.movement.maxSlope = 46;
  // On y=x a radius-0.2 capsule has feet r*(sqrt(2)-1) above the
  // vertical terrain projection. Add the same 5 mm clearance as flat ground.
  input.collision.positions = input.collision.positions.map((value, index) =>
    index % 3 === 1 ? input.collision.positions[index - 1] : value,
  );
  const segment: Segment = {
    mode: 'walk',
    points: [
      [0, 0.087842712474619, 0],
      [1, 1.087842712474619, 0],
    ],
    times: [0, Math.SQRT2 / 5],
  };
  for (const cellHeight of [0.1, 0.01]) {
    input.ground.build = {
      profile: input.ground.options.profile,
      maxSlope: 46,
      stepUp: 0.4,
      stepDown: 0.5,
      cellSize: 0.1,
      cellHeight,
      tileCells: 16,
      bounds: { min: [-10, -10], max: [10, 10] },
    };
    const result = verify(input, candidate(input, [segment]));
    assert.equal(result.valid, true, JSON.stringify({ cellHeight, result }));
  }
});

test('walking beside a finite ramp edge retains its sphere-edge support', () => {
  const input = snapshot();
  input.movement.maxSlope = 46;
  input.collision = {
    positions: [-1, -1, -2, -1, -1, 2, 0, 0, 2, 0, 0, -2],
    indices: [0, 1, 2, 0, 2, 3],
  };
  input.ground.build = {
    profile: input.ground.options.profile,
    maxSlope: 46,
    stepUp: 0.4,
    stepDown: 0.5,
    cellSize: 0.1,
    cellHeight: 0.01,
    tileCells: 16,
    bounds: { min: [-10, -10], max: [10, 10] },
  };
  // The contact is on x=0. Its sphere support is sqrt(r²-dx²)-r,
  // below the infinite-plane tangent height; add 5 mm clearance.
  const segment: Segment = {
    mode: 'walk',
    points: [
      [-0.01, 0.00474984355438179, -0.5],
      [-0.01, 0.00474984355438179, 0.5],
    ],
    times: [0, 0.2],
  };
  const result = verify(input, candidate(input, [segment]));
  assert.equal(result.valid, true, JSON.stringify(result));
});

test('disabling walk snapping requires the submitted physical slope trace', () => {
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
  assert.equal(verify(input, candidate(input, [base]), { walkSnap: 0 }).valid, false);
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

test('horizontal and stationary walks respect the configured projection limit', () => {
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
    assert.equal(verify(input, route, { walkSnap: 0.2 }).valid, false);
    assert.equal(verify(input, route).valid, true);
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

test('sparse windows share following facts while each selected placement needs complete proof', () => {
  const input = snapshot();
  input.devices = {
    devices: [],
    ropes: [],
    followingSupports: [
      {
        id: 'box',
        level: 'test',
        model: 'box',
        spawn: [-7, 0, 5],
        bodies: [
          Array.from({ length: 8 }, (_, bits): Vec3 => [
            -7 + (bits & 1 ? 0.5 : -0.5),
            bits & 2 ? 1 : 0,
            5 + (bits & 4 ? 0.5 : -0.5),
          ]),
        ],
        geometryKind: 'box',
        maxDistance: 30,
        initialState: 0,
        assumption: 'placement-within-activity-range',
      },
    ],
  };
  const later = structuredClone(input);
  later.devices!.followingSupports = [];
  const sparse = (facts: PhysicalInput, min: number, max: number, missingZ?: number) =>
    createPhysicalWorld(facts, {
      bounds: { min: [min, -10], max: [max, 10] },
      tileSpan: 1,
      tiles: Array.from({ length: max - min }, (_, x) =>
        Array.from({ length: 20 }, (_, z) => ({ x: x + min, z: z - 10 })),
      )
        .flat()
        .filter(({ z }) => z !== missingZ),
    });
  const worlds = [sparse(input, -10, 2), sparse(later, -2, 10)];
  const route = candidate(
    input,
    [-4, 0].map((x): Segment => ({
      mode: 'walk',
      points: [
        [x, 0.005, 0],
        [x + 4, 0.005, 0],
      ],
      times: [0, 0.8],
    })),
  );
  route.placements = [{ device: 'box', position: [-6, 0, 5] }];
  const query = {
    starts: [{ id: 'start', position: route.points[0], cost: 0, state: 'available' as const }],
    goal: route.points.at(-1)!,
  };
  const evaluate = createPhysicalVerifier(() => worlds);
  const accepted = evaluate(query, route);
  assert.equal(accepted.valid, true, accepted.issues.join());

  const multi = structuredClone(input);
  const bodies = multi.devices!.followingSupports![0].bodies;
  bodies.push(bodies[0].map((p): Vec3 => [p[0], p[1], p[2] + 3]));
  // A slab in the gap belongs to neither body. Neither its collision nor
  // missing gap coverage can invalidate the two separately proved cuboids.
  const offset = multi.collision.positions.length / 3;
  multi.collision.positions = [
    ...multi.collision.positions,
    -7.5,
    0.5,
    6.25,
    -7.5,
    0.5,
    6.75,
    -6.5,
    0.5,
    6.75,
    -6.5,
    0.5,
    6.25,
  ];
  multi.collision.indices = [
    ...multi.collision.indices,
    offset,
    offset + 1,
    offset + 2,
    offset,
    offset + 2,
    offset + 3,
  ];
  const separateBodies = createPhysicalVerifier(() => [sparse(multi, -10, 2, 6), worlds[1]])(
    query,
    route,
  );
  assert.equal(separateBodies.valid, true, separateBodies.issues.join());

  const unknown = structuredClone(route);
  unknown.placements![0].device = 'unknown';
  assert.match(evaluate(query, unknown).issues.join(), /Unknown support placement/);

  const uncovered = structuredClone(route);
  uncovered.placements![0].position = [15, 0, 5];
  assert.equal(evaluate(query, uncovered).valid, false);

  // A global fact remains an obstacle in the later window even when omitted
  // from that window's exporter response.
  const blocker = structuredClone(input);
  blocker.devices!.followingSupports![0].spawn = [3, 0, 0];
  blocker.devices!.followingSupports![0].bodies = blocker.devices!.followingSupports![0].bodies.map(
    (body) => body.map((p): Vec3 => [p[0] + 10, p[1], p[2] - 5]),
  );
  const blocked = structuredClone(route);
  blocked.placements = [];
  assert.equal(
    createPhysicalVerifier(() => [sparse(blocker, -10, 2), sparse(later, -2, 10)])(query, blocked)
      .valid,
    false,
  );

  const conflicting = structuredClone(input);
  conflicting.devices!.followingSupports![0].maxDistance++;
  assert.match(
    createPhysicalVerifier(() => [worlds[0], sparse(conflicting, -2, 10)])(
      query,
      route,
    ).issues.join(),
    /Conflicting following support facts/,
  );
});

test('bounded walk execution snaps navigation height and charges the physical distance', () => {
  const input = snapshot();
  input.collision.positions = input.collision.positions.map((v, i) =>
    i % 3 === 1 ? 0.6 * input.collision.positions[i - 1] : v,
  );
  const submitted = candidate(input, [
    {
      mode: 'walk',
      points: [
        [-0.25, 0, 0],
        [0.25, 0, 0],
      ],
      times: [0, 0.1],
    },
  ]);
  const saved = structuredClone(submitted);
  const world = createPhysicalWorld(input, 'complete');
  const query = {
    starts: [{ id: 'start', state: 'available' as const, cost: 0, position: submitted.points[0] }],
    goal: submitted.points.at(-1)!,
  };
  const result = createPhysicalVerifier(() => [world])(query, submitted);
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.ok(Math.abs(result.costSeconds! - Math.hypot(0.5, 0.3) / 5) < 1e-6);
  assert.ok(result.execution!.maxWalkSnap > 0.15);
  assert.ok(result.execution!.costDeltaSeconds > 0);
  assert.deepEqual(submitted, saved);
  assert.equal(
    createPhysicalVerifier(() => [world], { walkSnap: 0.01 })(query, submitted).valid,
    false,
  );
});

test('goal tolerance cannot collect a point through a separating wall', () => {
  const input = snapshot();
  input.ground.options.profile.radius = 0.01;
  input.collision.positions = [
    ...input.collision.positions,
    2.02,
    0,
    -1,
    2.02,
    2,
    -1,
    2.02,
    2,
    1,
    2.02,
    0,
    1,
  ];
  input.collision.indices = [...input.collision.indices, 4, 5, 6, 4, 6, 7];
  const route = candidate(input, [walk()]);
  const world = createPhysicalWorld(input, 'complete');
  const query = {
    starts: [{ id: 'start', state: 'available' as const, cost: 0, position: route.points[0] }],
    goal: [2.04, 0.005, 0] as Vec3,
  };
  assert.equal(createPhysicalVerifier(() => [world])(query, route).valid, false);
});

test('vertical walk intent counts the correction of both endpoints', () => {
  const input = snapshot();
  for (const height of [0.3, -0.29]) {
    const submitted = candidate(input, [
      {
        mode: 'walk',
        points: [
          [0, 0.005, 0],
          [0, height, 0],
        ],
        times: [0, Math.abs(height - 0.005) / 5],
      },
    ]);
    assert.equal(verify(input, submitted, { walkSnap: 0.01 }).valid, false);
  }
});

test('grounded execution preserves boost changes inside a resource control block', () => {
  const input = snapshot();
  input.devices = {
    ropes: [],
    devices: [
      {
        id: 'speed',
        kind: 'accelerate',
        position: [0, 0.005, 0],
        goal: { position: [0, 0.005, 0], interaction: { radius: 0.2 } },
        seeds: [],
        unitScale: true,
        resolved: true,
        speed: 0,
        overhead: 0,
        duration: 10,
        fixedLaunch: false,
        aim: null,
        height: 0,
        aimClearance: 0,
        boostMultiplier: 2,
      },
    ],
  };
  const base: Segment[] = [
    {
      mode: 'walk',
      points: [
        [0, 0.1, 0],
        [1, 0.1, 0],
      ],
      times: [0, 0.1],
      boost: { id: 'speed', multiplier: 2, duration: 10 },
    },
    {
      mode: 'walk',
      points: [
        [1, 0.1, 0],
        [2, 0.1, 0],
      ],
      times: [0, 0.2],
    },
  ];
  const submitted: Extract<Route, { status: 'complete' }> = {
    status: 'complete',
    start: 'start',
    arrivalCost: 0,
    cost: 0.3,
    length: 2,
    points: [
      [0, 0.1, 0],
      [1, 0.1, 0],
      [2, 0.1, 0],
    ],
    segments: base.map((segment) => ({ ...segment, gait: 'run' })),
    schedule: [{ segments: base, allowSprint: false, allowDash: false }],
  };
  const joined = verify(input, submitted);
  assert.equal(joined.valid, true, JSON.stringify(joined));
  assert.ok(Math.abs(joined.costSeconds! - 0.3) < 1e-6);
  submitted.schedule = base.map((segment) => ({
    segments: [segment],
    allowSprint: false,
    allowDash: false,
  }));
  assert.deepEqual(verify(input, submitted), joined);
});

test('collision-free grounded feet do not require an exact artificial clearance', () => {
  const input = snapshot();
  for (const height of [0.001, 0.003, 0.005, 0.01]) {
    const motion = walk();
    motion.points = motion.points.map(([x, _y, z]) => [x, height, z]);
    assert.equal(verify(input, candidate(input, [motion]), { walkSnap: 0 }).valid, true);
  }
  const below = walk();
  below.points = below.points.map(([x, _y, z]) => [x, -0.003, z]);
  assert.equal(verify(input, candidate(input, [below]), { walkSnap: 0 }).valid, false);
});

test('physical step execution remains valid when a control block ends at its lifted corner', () => {
  const input = snapshot();
  input.collision = {
    positions: [
      -2, 0, -2, -2, 0, 2, 0, 0, 2, 0, 0, -2, 0, 0.2, -2, 0, 0.2, 2, 2, 0.2, 2, 2, 0.2, -2,
    ],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 3, 2, 5, 3, 5, 4],
  };
  const physical = createPhysicalWorld(input, 'complete').configured();
  const points = physical.walkTrace([-0.5, 0.005, 0], [0.5, 0.205, 0]);
  assert.ok(points);
  const times = [0];
  for (let i = 1; i < points.length; i++)
    times.push(times[i - 1] + Math.hypot(...points[i].map((v, j) => v - points[i - 1][j])) / 5);
  const motion: Segment = { mode: 'walk', points, times };
  const route = candidate(input, [motion]);
  const result = verify(input, route, { walkSnap: 0 });
  assert.equal(result.valid, true, JSON.stringify(result));
  const corner = points.findIndex((p) => {
    const grounded = physical.standing(p);
    return !grounded || Math.hypot(...p.map((v, i) => v - grounded[i])) > 1e-5;
  });
  assert.ok(corner > 0 && corner < points.length - 1);
  route.schedule = [
    {
      segments: [
        { ...motion, points: points.slice(0, corner + 1), times: times.slice(0, corner + 1) },
      ],
      allowSprint: false,
      allowDash: false,
    },
    {
      segments: [
        {
          ...motion,
          points: points.slice(corner),
          times: times.slice(corner).map((t) => t - times[corner]),
        },
      ],
      allowSprint: false,
      allowDash: false,
    },
  ];
  assert.equal(verify(input, route, { walkSnap: 0 }).valid, true);
});

test('walk projection accounts for a shallow valley instead of accepting a floating chord', () => {
  const input = snapshot();
  const vertices: Vec3[] = [],
    indices: number[] = [];
  for (const [lo, hi, y] of [
    [-2, -0.5, 0],
    [-0.5, 0.5, -0.1],
    [0.5, 2, 0],
  ]) {
    const offset = vertices.length;
    vertices.push([lo, y, -2], [lo, y, 2], [hi, y, 2], [hi, y, -2]);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  input.collision = { positions: vertices.flat(), indices };
  const route = candidate(input, [
    {
      mode: 'walk',
      points: [
        [-1, 0.005, 0],
        [1, 0.005, 0],
      ],
      times: [0, 0.4],
    },
  ]);
  assert.equal(verify(input, route, { walkSnap: 0 }).valid, false);
  const executed = verify(input, route);
  assert.equal(executed.valid, true, executed.issues.join());
  assert.ok(executed.length! > route.length);
  assert.ok(executed.costSeconds! > route.cost);
});

test('walking mesh contact tolerance bounds skin overlap without allowing wall crossings', () => {
  for (const offset of [0.197, 0.193, 0.18]) {
    const input = snapshot();
    input.collision.positions = [
      ...input.collision.positions,
      -1,
      0,
      offset,
      3,
      0,
      offset,
      3,
      2,
      offset,
      -1,
      2,
      offset,
    ];
    input.collision.indices = [...input.collision.indices, 4, 5, 6, 4, 6, 7];
    const route = candidate(input, [walk()]);
    assert.equal(verify(input, route, { walkContactTolerance: 0 }).valid, false);
    assert.equal(verify(input, route).valid, offset > 0.19);
    assert.equal(verify(input, route, { walkContactTolerance: 0.005 }).valid, offset === 0.197);
    const crossing = candidate(input, [
      {
        mode: 'walk',
        points: [
          [0, 0.005, -1],
          [0, 0.005, 1],
        ],
        times: [0, 0.4],
      },
    ]);
    assert.equal(verify(input, crossing).valid, false);
  }
});

function alternativeContacts(): PhysicalInput {
  const input = snapshot();
  input.ground.build = { cellHeight: 0.05 };
  input.devices = {
    devices: [],
    ropes: [],
    movingSupports: [
      {
        id: 'platform',
        family: 'platform',
        level: 'fixture',
        model: 'fixture',
        assumption: 'phase-free-swept-support',
        surfaces: [2, 2.05, 2.1].map((height, index) => ({
          id: `pose/${index}`,
          vertices: [
            [-2, height, -2],
            [-2, height, 2],
            [2, height, 2],
            [2, height, -2],
          ] as Vec3[],
        })),
        transfers: [{ from: [0, 2, 0], to: [1, 2, 0], speed: 1 }],
      },
    ],
  };
  return input;
}

test('phase-free alternative roofs preserve a supported pose contact during full ride replay', () => {
  const input = alternativeContacts(),
    physical = createPhysicalWorld(input, 'complete').configured();
  for (const height of [2, 2.05, 2.1]) {
    const feet: Vec3 = [0, height + 0.01, 0];
    assert.deepEqual(physical.standing(feet), feet);
  }
  assert.notDeepEqual(physical.standing([0, 2.3, 0]), [0, 2.3, 0]);
  const ride: Segment = {
    mode: 'rope',
    traversal: 'moving-support',
    connection: 'moving-ride/platform/0',
    points: [
      [0, 2.01, 0],
      [1, 2.01, 0],
    ],
    times: [0, 1],
  };
  const result = verify(input, candidate(input, [ride]));
  assert.equal(result.valid, true, JSON.stringify(result));
  assert.equal(result.costSeconds, 1);
});

test('retained phase-free contact still requires sphere support and complete body clearance', () => {
  const clear = alternativeContacts(),
    feet: Vec3 = [0, 2.01, 0];
  const overhead = structuredClone(clear);
  overhead.collision.positions = [
    ...overhead.collision.positions,
    -2,
    3,
    -2,
    -2,
    3,
    2,
    2,
    3,
    2,
    2,
    3,
    -2,
  ];
  overhead.collision.indices = [...overhead.collision.indices, 4, 5, 6, 4, 6, 7];
  const wall = structuredClone(clear);
  wall.ground.options.walls = [{ min: [-0.5, 2, -0.5], max: [0.5, 4, 0.5], state: 'active' }];
  const box = structuredClone(clear);
  box.devices!.followingSupports = [
    {
      id: 'box',
      level: 'fixture',
      model: 'fixture',
      spawn: [0, 0, 0],
      bodies: [
        Array.from({ length: 8 }, (_, bits): Vec3 => [
          bits & 1 ? 0.5 : -0.5,
          bits & 2 ? 3 : 0,
          bits & 4 ? 0.5 : -0.5,
        ]),
      ],
      geometryKind: 'box',
      maxDistance: 5,
      initialState: 0,
      assumption: 'placement-within-activity-range',
    },
  ];
  for (const blocked of [overhead, wall, box])
    assert.equal(createPhysicalWorld(blocked, 'complete').configured().standing(feet), null);
  const slope = structuredClone(clear);
  slope.devices!.movingSupports![0].surfaces = [
    {
      id: 'slope',
      vertices: [
        [-2, 1, -2],
        [-2, 1, 2],
        [2, 3, 2],
        [2, 3, -2],
      ],
    },
  ];
  const physical = createPhysicalWorld(slope, 'complete').configured();
  assert.notDeepEqual(
    physical.standing(feet),
    feet,
    'point support cannot bypass bottom-sphere lift',
  );
  const supported: Vec3 = [0, 2 + 0.2 * (Math.sqrt(1.25) - 1) + 0.005, 0];
  assert.deepEqual(physical.standing(supported), supported);
  slope.movement.maxSlope = 10;
  assert.equal(createPhysicalWorld(slope, 'complete').configured().standing(supported), null);
});
