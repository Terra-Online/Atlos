import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld, type Capsule, type CollisionWorld } from '#@/src/collision.ts';
import type { Portal, Surface, Vec3, Wall } from '#@/src/geometry.ts';
import { createGoalProjector } from '#@/src/model/goals.ts';
import type { GroundConnection } from '#@/src/route.ts';
import { jumpConnection } from '#@/src/v1/motion/jumps.ts';
import { planGroundRoute, createGroundPlanner } from '#@/src/v1/route/ground.ts';
import {
  type DiscoveryOptions,
  findJumpConnections,
  exposedBoundaries,
  standingFoot,
} from '#@/src/v1/search/traversal.ts';

const floor = (id: string, x0: number, x1: number, y: number, z0 = -2, z1 = 2): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
});
const geometry = (surfaces: Surface[]) => {
  const triangles = surfaces.flatMap((s) => [
    [s.vertices[0], s.vertices[2], s.vertices[1]],
    [s.vertices[0], s.vertices[3], s.vertices[2]],
  ]);
  return {
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, i) => i),
  };
};
const options: DiscoveryOptions = {
  profile: { radius: 0.3, height: 1.7 },
  portals: [],
  walls: [],
  from: [2, 4, 0],
  to: [9, 0, 0],
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 2,
  maxCandidates: 200,
  maxLinks: 12,
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 7,
  },
};

test('discovers directed model-based jumps between supported separated platforms', () => {
  const surfaces: Surface[] = [floor('upper', 0, 4, 4), floor('lower', 7, 11, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  const result = findJumpConnections(surfaces, world, options);
  assert.ok(result.connections.some((c) => c.fromSurface === 'upper' && c.toSurface === 'lower'));
  assert.equal(
    result.connections.some((c) => c.fromSurface === 'lower' && c.toSurface === 'upper'),
    false,
  );
  for (const connection of result.connections) {
    assert.equal(connection.state, 'open');
    assert.equal(connection.motionValidation, 'model-based');
    assert.ok(connection.endpointTolerance! <= options.profile.radius);
    assert.ok(connection.points[0][1] > 3.99);
  }
  const expected = structuredClone(result);
  result.connections[0].points[0][0] = 999;
  result.connections[0].times[0] = 999;
  assert.deepEqual(findJumpConnections(surfaces, world, options), expected);
  const limited = { ...options, maxCandidates: 4 };
  assert.deepEqual(
    findJumpConnections(surfaces, world, limited),
    findJumpConnections(surfaces, createCollisionWorld(geometry(surfaces)), limited),
  );
  const reverse = { ...options, from: options.to, to: options.from };
  assert.deepEqual(findJumpConnections(surfaces, world, reverse).connections, []);
  const blocked: DiscoveryOptions = {
    ...options,
    walls: [{ min: [4.5, -1, -20], max: [5, 10, 20], state: 'active' }],
  };
  assert.deepEqual(findJumpConnections(surfaces, world, blocked).connections, []);
  assert.deepEqual(findJumpConnections(surfaces, world, options), expected);
});

test('discovers a supported downhill run-off below an overhead lip', () => {
  const upper = floor('upper', 0, 3.8, 5);
  const lower = floor('lower', 4.8, 10, 0);
  const world = createCollisionWorld(
    geometry([
      floor('physical-upper', 0, 4, 5),
      floor('physical-lower', 4.5, 10, 0),
      floor('ceiling', 0, 4, 7),
    ]),
  );
  const result = findJumpConnections([upper, lower], world, {
    ...options,
    from: [3.2, 5, 0],
    to: [6, 0, 0],
    maxCandidates: 64,
    model: {
      gravity: 40,
      fallingGravity: 38,
      maxJumpHeight: 2.1,
      maxFallingSpeed: 80,
      apexTime: 0.1,
      maxHorizontalSpeed: 6.5,
      airAcceleration: 60,
      airDeceleration: 10,
    },
  });
  const crossing = result.connections.find((connection) => connection.toSurface === 'lower');
  assert.equal(crossing?.flight?.kind, 'run-off');
  assert.ok(crossing?.points.some((point) => point[0] > crossing.points[0][0] && point[1] >= 3.99));
});

test('reaches steered run-off controls when a constant-speed fall hits a hanging lip', () => {
  const upper = floor('upper', 0, 3.8, 8);
  const lower = floor('lower', 5.6, 10, 0);
  const base = geometry([
    floor('physical-upper', 0, 4, 8),
    floor('physical-lower', 5.4, 10, 0),
    floor('ceiling', 0, 4, 10),
  ]);
  const hangingLip = [
    [
      [5.3, 6.5, -10],
      [5.3, 10, -10],
      [5.3, 10, 10],
    ],
    [
      [5.3, 6.5, -10],
      [5.3, 10, 10],
      [5.3, 6.5, 10],
    ],
  ];
  const offset = base.positions.length / 3;
  const world = createCollisionWorld({
    positions: [...base.positions, ...hangingLip.flat(2)],
    indices: [...base.indices, ...Array.from({ length: 6 }, (_, i) => offset + i)],
  });
  const result = findJumpConnections([upper, lower], world, {
    ...options,
    from: [3.2, 8, 0],
    to: [5.6, 0, 0],
    maxCandidates: 64,
    model: {
      gravity: 40,
      fallingGravity: 38,
      maxJumpHeight: 2.1,
      maxFallingSpeed: 80,
      apexTime: 0.1,
      maxHorizontalSpeed: 6.5,
      airAcceleration: 60,
      airDeceleration: 10,
    },
  });
  const crossing = result.connections.find((connection) => connection.toSurface === 'lower');
  assert.equal(crossing?.flight?.kind, 'run-off');
  assert.ok(crossing?.flight?.control.exit);
  assert.ok(crossing?.flight?.control.speedFraction !== undefined);
});

test('retains supported narrow landing regions whose navigation already includes body clearance', () => {
  const upper: Surface = floor('upper', 0, 4, 4);
  const landing: Surface = floor('landing', 7, 7.3, 0, -0.1, 0.1);
  // The collision floor is wider than its baked, body-eroded navigation region.
  const world = createCollisionWorld(
    geometry([upper, floor('physical-landing', 6.6, 7.7, 0, -0.5, 0.5)]),
  );
  const result = findJumpConnections([upper, landing], world, {
    ...options,
    to: [7.15, 0, 0],
  });
  const connection = result.connections.find((entry) => entry.toSurface === 'landing');
  assert.ok(connection);
  assert.ok(world.groundAt(connection.points.at(-1)!, { maxUp: 0.1, maxDown: 0.1, maxSlope: 46 }));
  assert.equal(
    world.sweepCapsule(connection.points.at(-1)!, connection.points.at(-1)!, options.profile),
    null,
  );
  assert.equal(result.diagnostics.targetReached, true);
});

test('can discover several hops through an intermediate ground component', () => {
  const surfaces: Surface[] = [floor('a', 0, 4, 0), floor('b', 7, 11, 0), floor('c', 14, 18, 0)];
  const result = findJumpConnections(surfaces, createCollisionWorld(geometry(surfaces)), {
    ...options,
    from: [2, 0, 0],
    to: [16, 0, 0],
    model: { ...options.model, maxHorizontalSpeed: 6 },
  });
  assert.ok(result.connections.some((c) => c.fromSurface === 'a' && c.toSurface === 'b'));
  assert.ok(result.connections.some((c) => c.fromSurface === 'b' && c.toSurface === 'c'));
  assert.equal(
    result.connections.some((c) => c.fromSurface === 'a' && c.toSurface === 'c'),
    false,
  );
  const route = planGroundRoute(
    surfaces,
    [{ id: 'player', position: [2, 0, 0], cost: 0, state: 'available' }],
    [16, 0, 0],
    {
      speed: 5,
      maxVertical: 0.5,
      walls: [],
      profile: options.profile,
      connections: result.connections,
    },
  );
  assert.ok(route.status === 'complete');
  assert.equal(route.segments.filter((segment) => segment.mode === 'jump').length, 2);
});

test('discovers jumps before and after a directed known ride between ground components', () => {
  const surfaces: Surface[] = [
    floor('start', 0, 4, 0),
    floor('boarding', 7, 11, 0),
    floor('exit', 7, 11, 10),
    floor('target', 14, 18, 10),
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const query: DiscoveryOptions = { ...options, from: [2, 0, 0], to: [16, 10, 0] };
  const ride: GroundConnection = {
    id: 'lift',
    mode: 'rope',
    state: 'open',
    fromSurface: 'boarding',
    toSurface: 'exit',
    points: [
      [9, 0, 0],
      [9, 10, 0],
    ],
    times: [0, 2],
  };
  const result = findJumpConnections(surfaces, world, { ...query, connections: [ride] });
  assert.equal(result.diagnostics.targetReached, true);
  assert.deepEqual(
    result.connections.map((connection) => [connection.fromSurface, connection.toSurface]),
    [
      ['start', 'boarding'],
      ['exit', 'target'],
    ],
  );
  const route = planGroundRoute(
    surfaces,
    [{ id: 'player', position: query.from, cost: 0, state: 'available' }],
    query.to,
    {
      speed: 5,
      maxVertical: query.maxVertical,
      walls: [],
      profile: query.profile,
      connections: [ride, ...result.connections],
    },
  );
  assert.ok(route.status === 'complete');
  assert.deepEqual(
    route.segments.filter((segment) => segment.mode !== 'walk').map((segment) => segment.mode),
    ['jump', 'rope', 'jump'],
  );
  for (const change of [
    { connections: [{ ...ride, state: 'unknown' }] },
    {
      connections: [
        { ...ride, fromSurface: 'exit', toSurface: 'boarding', points: [...ride.points].reverse() },
      ],
    },
    { connections: [ride], walls: [{ min: [7, 4, -3], max: [11, 6, 3], state: 'active' }] },
  ] satisfies Partial<DiscoveryOptions>[]) {
    const rejected = findJumpConnections(surfaces, world, { ...query, ...change });
    assert.equal(rejected.diagnostics.targetReached, false);
    assert.equal(rejected.connections.length, 0);
  }
});

test('rejects blocking air walls and distant components without inventing a reverse edge', () => {
  const surfaces: Surface[] = [floor('upper', 0, 4, 4), floor('lower', 7, 11, 0)],
    world = createCollisionWorld(geometry(surfaces));
  const wall: Wall = { min: [5, -10, -20], max: [6, 20, 20], state: 'unknown' };
  assert.equal(
    findJumpConnections(surfaces, world, { ...options, walls: [wall] }).connections.length,
    0,
  );
  assert.equal(
    findJumpConnections(surfaces, world, { ...options, maxHorizontalDistance: 2 }).connections
      .length,
    0,
  );
});

test('returns no jump work when the destination is already ground reachable', () => {
  const surfaces: Surface[] = [floor('a', 0, 4, 0), floor('b', 4, 8, 0)];
  const result = findJumpConnections(surfaces, createCollisionWorld(geometry(surfaces)), {
    ...options,
    from: [2, 0, 0],
    to: [6, 0, 0],
  });
  assert.deepEqual(result.connections, []);
  assert.equal(result.diagnostics.reason, 'ground-connected');
});

test('reports sampling truncation and validates explicit motion and search limits', () => {
  const surfaces: Surface[] = [floor('a', 0, 4, 4), floor('b', 7, 11, 0)],
    world = createCollisionWorld(geometry(surfaces));
  assert.equal(
    findJumpConnections(surfaces, world, { ...options, maxCandidates: 1 }).diagnostics.truncated,
    true,
  );
  assert.throws(
    () => findJumpConnections(surfaces, world, { ...options, maxSlope: 90 }),
    /Invalid traversal/,
  );
  assert.throws(
    () => findJumpConnections(surfaces, world, { ...options, sampleSpacing: 0 }),
    /Invalid traversal/,
  );
  assert.throws(
    () =>
      findJumpConnections(surfaces, world, { ...options, model: { ...options.model, gravity: 0 } }),
    /Invalid traversal/,
  );
});

test('moves takeoff behind a thin railing when an edge-near jump intersects it', () => {
  const surfaces: Surface[] = [floor('upper', 0, 4, 4), floor('lower', 7, 11, 0)],
    base = geometry(surfaces);
  const railing = [
    [
      [3.9, 4, -10],
      [3.9, 5.9, -10],
      [3.9, 5.9, 10],
    ],
    [
      [3.9, 4, -10],
      [3.9, 5.9, 10],
      [3.9, 4, 10],
    ],
  ];
  const offset = base.positions.length / 3;
  const world = createCollisionWorld({
    positions: [...base.positions, ...railing.flat(2)],
    indices: [...base.indices, ...Array.from({ length: 6 }, (_, i) => offset + i)],
  });
  assert.equal(
    jumpConnection([3.5, 4.005, 0], [7.5, 0.005, 0], {
      ...options.model,
      profile: options.profile,
      walls: [],
      mode: 'jump',
      sweep: world.sweepCapsule,
    }),
    null,
  );
  const result = findJumpConnections(surfaces, world, options);
  const jump = result.connections.find(
    (connection) => connection.fromSurface === 'upper' && connection.toSurface === 'lower',
  );
  assert.ok(jump);
  assert.ok(jump.points[0][0] < 3);
});

test('keeps pre-budget grouping work bounded for highly imbalanced components', () => {
  const surfaces: Surface[] = Array.from({ length: 5000 }, (_, index) =>
    floor(`strip/${index}`, index / 5, (index + 1) / 5, 0, 0, 1),
  );
  for (let index = 0; index < 1000; index++)
    surfaces.push(floor(`island/${index}`, 2000 + index * 3, 2001 + index * 3, 0, 0, 1));
  const collision: CollisionWorld = {
    groundAt(position) {
      return { position: [position[0], 0, position[2]], triangle: 0, normal: [0, 1, 0] };
    },
    sweepCapsule() {
      return null;
    },
  };
  // Count indexing work instead of elapsed time so slow CI does not make the test
  // flaky. Revisiting every exhausted group makes the original loop exceed this
  // generous linear allowance before the 32 endpoint checks can be enforced.
  const get = Map.prototype.get;
  let lookups = 0,
    result;
  Map.prototype.get = function (key) {
    lookups++;
    return get.call(this, key);
  };
  try {
    result = findJumpConnections(surfaces, collision, {
      ...options,
      from: [0.5, 0, 0.5],
      to: [2000.5, 0, 0.5],
      maxCandidates: 1,
    });
  } finally {
    Map.prototype.get = get;
  }
  assert.ok(
    lookups < surfaces.length * 100,
    `${lookups} map lookups exceed the indexing work budget`,
  );
  // The optimistic region graph can now reject the large empty gap before any
  // collision work. The budget must bound work, not force it to be exhausted.
  assert.equal(result.diagnostics.endpointChecks, 0);
  assert.equal(result.diagnostics.targetReached, false);
});

test('preserves collision-world method receivers during arc sweeps', () => {
  const surfaces: Surface[] = [floor('upper', 0, 4, 4), floor('lower', 7, 11, 0)];
  const world = {
    collision: createCollisionWorld(geometry(surfaces)),
    sweeps: 0,
    groundAt(
      position: Parameters<CollisionWorld['groundAt']>[0],
      query: Parameters<CollisionWorld['groundAt']>[1],
    ) {
      return this.collision.groundAt(position, query);
    },
    sweepCapsule(start: Vec3, end: Vec3, profile: Capsule) {
      this.sweeps++;
      return this.collision.sweepCapsule(start, end, profile);
    },
  };
  const result = findJumpConnections(surfaces, world, options);
  assert.ok(result.connections.length > 0);
  assert.ok(world.sweeps > result.diagnostics.standingEndpoints);
});

test('keeps useful local jumps when sampling is denser and the distant reach bound grows', () => {
  const surfaces: Surface[] = [floor('upper', 0, 4, 4), floor('lower', 7, 11, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  for (const sampleSpacing of [1, 2])
    for (const maxHorizontalDistance of [15, 1000]) {
      const result = findJumpConnections(surfaces, world, {
        ...options,
        sampleSpacing,
        maxHorizontalDistance,
      });
      assert.ok(
        result.connections.some(
          (connection) => connection.fromSurface === 'upper' && connection.toSurface === 'lower',
        ),
      );
      assert.equal(result.diagnostics.targetReached, true);
    }
});

test('retains local routes when connected ground extends beyond the requested approach', () => {
  const base = [floor('upper', 0, 4, 4), floor('lower', 7, 11, 0)];
  const extended = [
    ...base,
    floor('upper-extension', -100, 0, 4),
    floor('lower-extension', 11, 100, 0),
  ];
  for (const surfaces of [base, extended]) {
    const result = findJumpConnections(surfaces, createCollisionWorld(geometry(surfaces)), options);
    const route = planGroundRoute(
      surfaces,
      [{ id: 'player', position: options.from, cost: 0, state: 'available' }],
      options.to,
      {
        speed: 5,
        maxVertical: options.maxVertical,
        walls: [],
        profile: options.profile,
        connections: result.connections,
      },
    );
    assert.equal(result.diagnostics.targetReached, true);
    assert.ok(route.status === 'complete');
  }
});

test('retains endpoint coverage for both requested components under a bounded global sampling budget', () => {
  const surfaces: Surface[] = [floor('upper', 0, 4, 4, -50, 50), floor('lower', 7, 11, 0, -50, 50)];
  for (let index = 0; index < 100; index++) {
    surfaces.push(floor(`distant/${index}`, 1000 + index * 3, 1001 + index * 3, 0));
  }
  const result = findJumpConnections(surfaces, createCollisionWorld(geometry(surfaces)), {
    ...options,
    maxCandidates: 16,
  });
  // A single long boundary previously exhausted the budget before reaching the
  // other platform. Lazy validation must reach both and complete the actual link.
  assert.ok(result.diagnostics.sourceEndpoints! > 0);
  assert.ok(result.diagnostics.targetEndpoints! > 0);
  assert.ok(result.diagnostics.endpointChecks <= result.diagnostics.limits.endpointChecks);
  assert.equal(result.diagnostics.targetReached, true);
  assert.ok(
    result.connections.some(
      (connection) => connection.fromSurface === 'upper' && connection.toSurface === 'lower',
    ),
  );
});

test('finds three short ascending hops through narrow box tops in translated and rotated scenes', () => {
  const base = [
    floor('ground', -4, 4, 0, -8, 3),
    floor('box-1', 5, 5.6, 1.35, -0.8, 0.8),
    floor('box-2', 6.6, 6.9, 2.7, -0.6, 0.6),
    floor('target', 7.9, 11, 4.05, -1, 1),
  ];
  const physical = [
    base[0],
    floor('solid-1', 4.65, 5.95, 1.35, -1.15, 1.15),
    floor('solid-2', 6.25, 7.25, 2.7, -0.95, 0.95),
    base[3],
  ];
  for (const angle of [0, 0.6, 1.7]) {
    const transform = ([x, y, z]: readonly number[]): Vec3 => [
      120 + x * Math.cos(angle) - z * Math.sin(angle),
      y + 37,
      -85 + x * Math.sin(angle) + z * Math.cos(angle),
    ];
    const surfaces: Surface[] = base.map((surface) => ({
      ...surface,
      vertices: surface.vertices.map(transform),
    }));
    const world = createCollisionWorld(
      geometry(
        physical.map((surface) => ({ ...surface, vertices: surface.vertices.map(transform) })),
      ),
    );
    const result = findJumpConnections(surfaces, world, {
      ...options,
      from: transform([0, 0, -6]),
      to: transform([9, 4.05, 0]),
      model: {
        ...options.model,
        gravity: 40,
        fallingGravity: 38,
        maxJumpHeight: 2.1,
        maxHorizontalSpeed: 6.5,
      },
    });
    assert.equal(result.diagnostics.targetReached, true);
    assert.equal(result.connections.length, 3);
    const route = planGroundRoute(
      surfaces,
      [{ id: 'player', position: transform([0, 0, -6]), cost: 0, state: 'available' }],
      transform([9, 4.05, 0]),
      {
        speed: 5,
        maxVertical: 0.5,
        walls: [],
        profile: options.profile,
        connections: result.connections,
      },
    );
    assert.ok(route.status === 'complete');
    assert.equal(route.segments.filter((segment) => segment.mode === 'jump').length, 3);
  }
});

test('searches all interaction faces together and deduplicates their region', () => {
  const upper: Surface = floor('upper', 0, 4, 4),
    lower = [];
  for (let index = 0; index < 20; index++)
    lower.push(floor(`lower/${index}`, 7 + index * 0.2, 7.2 + index * 0.2, 0));
  const result = findJumpConnections(
    [upper, ...lower],
    createCollisionWorld(geometry([upper, floor('physical-lower', 7, 11, 0)])),
    {
      ...options,
      to: [9, 1, 0],
      interaction: { radius: 2 },
    },
  );
  assert.ok(result.diagnostics.goalFaces > 8);
  assert.equal(result.diagnostics.goalComponents, 1);
  assert.equal(result.diagnostics.targetReached, true);
  assert.equal(result.diagnostics.validatedPairs, 1);
});

test('keeps goal-directed landing coverage on a large subdivided floor under raw-pair truncation', () => {
  const upper: Surface = floor('upper', 0, 4, 4),
    lower = [];
  for (let index = 0; index < 200; index++)
    lower.push(floor(`lower/${index}`, 7, 20, 0, -40 + index * 0.4, -40 + (index + 1) * 0.4));
  const triangles = [
    [
      [3.9, 4, -50],
      [3.9, 5.9, -50],
      [3.9, 5.9, 50],
    ],
    [
      [3.9, 4, -50],
      [3.9, 5.9, 50],
      [3.9, 4, 50],
    ],
  ];
  const base = geometry([upper, floor('physical-lower', 7, 20, 0, -40, 40)]);
  const offset = base.positions.length / 3;
  const world = createCollisionWorld({
    positions: [...base.positions, ...triangles.flat(2)],
    indices: [...base.indices, ...Array.from({ length: 6 }, (_, index) => offset + index)],
  });
  const result = findJumpConnections([upper, ...lower], world, {
    ...options,
    to: [9, 0, -20],
    maxCandidates: 64,
  });
  assert.equal(result.diagnostics.targetReached, true);
  assert.equal(result.diagnostics.truncated, true);
  assert.ok(result.diagnostics.pairChecks <= result.diagnostics.limits.pairChecks);
  assert.ok(result.connections.some((connection) => connection.fromSurface === 'upper'));
});

test('discovers supported interior landings on large floors whose boundaries are outside jump reach', () => {
  for (const [angle, offset] of [
    [0, 0],
    [Math.PI / 3, 512.8],
    [Math.PI / 2, -1024.8],
  ]) {
    const transform = ([x, y, z]: readonly number[]): Vec3 => [
      x * Math.cos(angle) - z * Math.sin(angle) + offset,
      y,
      x * Math.sin(angle) + z * Math.cos(angle) + offset,
    ];
    const surfaces: Surface[] = [floor('upper', 0, 4, 4), floor('lower', -50, 50, 0, -50, 50)].map(
      (surface) => ({ ...surface, vertices: surface.vertices.map(transform) }),
    );
    const world = createCollisionWorld(geometry(surfaces)),
      from: Vec3 = transform([2, 4, 0]),
      to: Vec3 = transform([10, 0, 0]);
    const result = findJumpConnections(surfaces, world, {
      ...options,
      from,
      to,
      maxCandidates: 500,
    });
    assert.equal(result.diagnostics.targetReached, true);
    assert.ok(result.connections.some((connection) => connection.toSurface === 'lower'));
    const route = planGroundRoute(
      surfaces,
      [{ id: 'player', position: from, state: 'available', cost: 0 }],
      to,
      {
        speed: 5,
        maxVertical: 0.5,
        walls: [],
        profile: options.profile,
        connections: result.connections,
      },
    );
    assert.ok(route.status === 'complete');
    assert.ok(route.segments.some((segment) => segment.mode === 'jump' || segment.mode === 'drop'));
  }
});

test('partial shared edges retain their exposed ledge interval and perpendicular inward normal', () => {
  const surfaces: Surface[] = [floor('a', 0, 4, 0), floor('b', 4, 8, 0, -2, 0)];
  const boundaries = exposedBoundaries(surfaces, []);
  const ledge = boundaries.find((boundary) => boundary.surface === 'a' && boundary.edge === 1);
  assert.ok(ledge);
  assert.deepEqual(ledge.a, [4, 0, 0]);
  assert.deepEqual(ledge.b, [4, 0, 2]);
  assert.equal(ledge.length, 2);
  const delta = [ledge.b[0] - ledge.a[0], ledge.b[2] - ledge.a[2]];
  assert.equal(delta[0] * ledge.inward[0] + delta[1] * ledge.inward[1], 0);
  assert.ok(ledge.inward[0] < 0);
});

test('corrected standing feet use the closest eligible navigation support', () => {
  const surfaces: Surface[] = [floor('voxel', 0, 4, 0.1), floor('support', 0, 4, 0)];
  const world = createCollisionWorld(geometry([floor('physical', 0, 4, 0)]));
  const result = standingFoot({ surface: 'voxel', position: [2, 0.1, 0] }, world, {
    ...options,
    blocked: () => false,
    project: createGoalProjector(surfaces),
  });
  assert.equal(result.surface, 'support');
  assert.ok(Math.abs(result.position[1] - 0.005) < 1e-12);
});

test('deferred validation covers alternative chain goal sides without flipping on unsupported contacts', () => {
  const surfaces = [
    floor('source', 0, 4, 0, -4, 4),
    floor('middle-a', 6, 10, 0, -4, -0.5),
    floor('middle-b', 6, 10, 0, 0.5, 4),
    floor('unsupported', 6, 10, 0, -0.1, 0.1),
    floor('goal', 12, 16, 0, -4, 4),
  ];
  const base = createCollisionWorld(geometry(surfaces.filter((s) => s.id !== 'unsupported')));
  let firstMotion: Vec3 | undefined;
  const world: CollisionWorld = {
    groundAt: (...args) => base.groundAt(...args),
    sweepCapsule(start, end, body) {
      if (!firstMotion && start.some((value, axis) => value !== end[axis])) firstMotion = start;
      return base.sweepCapsule(start, end, body);
    },
  };
  const result = findJumpConnections(
    surfaces,
    world,
    {
      ...options,
      from: [2, 0, 0],
      to: [14, 0, 0],
      walls: [{ min: [4.5, -1, -20], max: [5.5, 20, 20], state: 'active' }],
      maxHorizontalDistance: 4,
      sampleSpacing: 1,
    },
    { arcAttempts: 64 },
  );
  assert.ok(
    result.connections.some(
      (c) => ['middle-a', 'middle-b'].includes(c.fromSurface) && c.toSurface === 'goal',
    ),
  );
  assert.equal(
    result.connections.some((c) => c.fromSurface === 'source'),
    false,
  );
  assert.equal(result.diagnostics.targetReached, false);
  assert.ok(result.diagnostics.attempted <= 64);
  assert.ok(result.diagnostics.rejected.support > 0);
  assert.ok(firstMotion && firstMotion[0] < 6);
});

test('unsupported goal-side chains leave source validation work after the first arc batch', () => {
  const surfaces = [
    floor('source', 0, 4, 0, -6, 6),
    floor('middle-a', 6, 10, 0, -6, -2.1),
    floor('middle-b', 6, 10, 0, -1.95, 1.95),
    floor('middle-c', 6, 10, 0, 2.1, 6),
    floor('goal', 12, 16, 0, -6, 6),
  ];
  const result = findJumpConnections(
    surfaces,
    createCollisionWorld(geometry(surfaces.filter((s) => s.id !== 'goal'))),
    {
      ...options,
      from: [2, 0, 0],
      to: [14, 0, 0],
      walls: [{ min: [4.5, -1, -20], max: [5.5, 20, 20], state: 'active' }],
      maxHorizontalDistance: 4,
      sampleSpacing: 1,
    },
    { arcAttempts: 128, regionSearches: 4 },
  );
  assert.ok(result.diagnostics.rejected.support > 0);
  assert.ok(result.diagnostics.attempted > 32);
  assert.ok(result.diagnostics.attempted <= 128);
  assert.ok(result.diagnostics.regionSearches <= 4);
  assert.equal(result.diagnostics.targetReached, false);
  assert.deepEqual(result.connections, []);
});

test('shared traversal preparation does not retain an earlier query action overlay', () => {
  const surfaces: Surface[] = [floor('a', 0, 4, 0), floor('b', 20, 24, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  const query: DiscoveryOptions & { speed: number } = {
    ...options,
    speed: 7,
    from: [2, 0, 0],
    to: [22, 0, 0],
  };
  const groundPlanner = createGroundPlanner(surfaces, query);
  const transfer: GroundConnection = {
    id: 'rope',
    mode: 'rope',
    state: 'open',
    fromSurface: 'a',
    toSurface: 'b',
    points: [
      [2, 0, 0],
      [22, 0, 0],
    ],
    times: [0, 4],
  };
  const connected = findJumpConnections(surfaces, world, {
    ...query,
    groundPlanner,
    connections: [transfer],
  });
  assert.equal(connected.diagnostics.reason, 'known-connected');
  const reused = findJumpConnections(surfaces, world, { ...query, groundPlanner, connections: [] });
  const fresh = findJumpConnections(surfaces, world, { ...query, connections: [] });
  assert.notEqual(reused.diagnostics.reason, 'known-connected');
  assert.deepEqual(reused, fresh);
  assert.deepEqual(
    findJumpConnections(surfaces, world, { ...query, groundPlanner, connections: [transfer] }),
    connected,
  );
});

test('takeoff feet use finite ramp edge support instead of an infinite slope plane', () => {
  const ramp = floor('ramp', -1, 0, 0);
  ramp.vertices = ramp.vertices.map(([x, _y, z]) => [x, x, z]);
  const world = createCollisionWorld(geometry([ramp]));
  const result = standingFoot({ position: [-0.01, -0.01, 0] }, world, {
    ...options,
    profile: { radius: 0.2, height: 1.6 },
    blocked: () => false,
    project: createGoalProjector([ramp]),
  });
  assert.ok(result.position);
  assert.ok(Math.abs(result.position[1] - 0.00474984355438179) < 1e-9);
});

test('traversal covers decaying overspeed jumps with a legal supported sprint approach', () => {
  const profile = { radius: 0.35, height: 1.66 };
  const surfaces = [floor('source', -2, 2, 0.005), floor('landing', 7.3, 10, 0.005)];
  const world = createCollisionWorld(
    geometry([floor('source-body', -2.4, 2.4, 0), floor('landing-body', 6.9, 10.4, 0)]),
  );
  const model = {
    gravity: 40,
    fallingGravity: 38,
    maxJumpHeight: 2.1,
    maxFallingSpeed: 80,
    apexTime: 0.1,
    maxHorizontalSpeed: 6.5,
    startHorizontalSpeed: 9,
    airOverspeedDeceleration: 5,
  };
  const start: Vec3 = [2, 0.005, 0],
    end: Vec3 = [7.3, 0.005, 0];
  const arc = jumpConnection(start, end, {
    ...model,
    profile,
    walls: [],
    mode: 'jump',
    sweep: (...args) => world.sweepCapsule(...args),
  });
  assert.ok(arc, 'the unchanged physical constructor accepts this overspeed flight');
  assert.ok(arc.times.at(-1)! * model.maxHorizontalSpeed < end[0] - start[0]);
  const arrival = {
    id: 'player',
    position: [-1, 0.005, 0] as Vec3,
    state: 'available' as const,
    cost: 0,
  };
  const locomotion = {
    speed: 5,
    sprintSpeed: 7,
    sprintAcceleration: 60,
    stamina: {
      capacity: 1,
      initial: 1,
      activationCost: 1,
      recoveryRate: 0,
      recoveryDelay: 0,
      reserve: 0,
    },
  };
  const ground = { profile, walls: [], speed: 5, maxVertical: 0.01, locomotion };
  const accepted = planGroundRoute(surfaces, [arrival], [9, 0.005, 0], {
    ...ground,
    connections: [{ id: 'constructed', ...arc, state: 'open', requiredGait: 'sprint' }],
  });
  assert.ok(accepted.status === 'complete');
  const jump = accepted.segments.findIndex((segment) => segment.mode === 'jump');
  assert.ok(
    jump > 0 &&
      accepted.segments
        .slice(0, jump)
        .some((segment) => segment.gait === 'sprint' && segment.times.at(-1)! > 0),
  );
  assert.equal(accepted.locomotion!.initial - accepted.locomotion!.final, 1);
  const selected: DiscoveryOptions = {
    ...options,
    profile,
    model,
    from: arrival.position,
    to: [9, 0.005, 0],
    maxVertical: 0.01,
    maxDrop: 1,
    maxHorizontalDistance: 10,
  };
  const discovered = findJumpConnections(surfaces, world, selected);
  assert.ok(
    discovered.connections.some(
      (connection) => connection.fromSurface === 'source' && connection.toSurface === 'landing',
    ),
    JSON.stringify(discovered.diagnostics),
  );
  assert.equal(discovered.diagnostics.targetReached, true);
  assert.deepEqual(
    findJumpConnections(surfaces, world, { ...selected, maxHorizontalDistance: 5.2 }).connections,
    [],
  );
  assert.deepEqual(
    findJumpConnections(surfaces, world, {
      ...selected,
      model: { ...model, startHorizontalSpeed: model.maxHorizontalSpeed },
    }).connections,
    [],
  );
  assert.deepEqual(
    findJumpConnections(surfaces, world, {
      ...selected,
      walls: [{ min: [4, -1, -3], max: [5, 5, 3], state: 'active' }],
    }).connections,
    [],
  );
});

test('repeated findJumpConnections queries reuse cached cross-component groundTransfers identically', () => {
  const stepLowA: Surface = { ...floor('stepLowA', 6, 8, 0, -2, 0), portals: [] };
  const stepLowB: Surface = { ...floor('stepLowB', 6, 8, 0, 0, 2), portals: [] };
  const stepHighA: Surface = { ...floor('stepHighA', 8, 10, 3, -2, 0), portals: [] };
  const stepHighB: Surface = { ...floor('stepHighB', 8, 10, 3, 0, 2), portals: [] };
  const surfaces: Surface[] = [
    floor('start', 0, 4, 0, -2, 2),
    stepLowA,
    stepLowB,
    stepHighA,
    stepHighB,
    floor('mid', 10, 12, 3, -2, 2),
    floor('goal', 15, 19, 3, -2, 2),
  ];
  // Connect low pair together and high pair together, with two parallel one-way directed steps
  // from low component to high component (plus mid joined by portal to stepHighA/B).
  stepLowA.portals = [2];
  stepLowB.portals = [0];
  stepHighA.portals = [1, 2];
  stepHighB.portals = [0, 1];
  const portals: Portal[] = [
    {
      from: 'stepLowA',
      to: 'stepHighA',
      points: [
        [8, 0, -1],
        [8, 3, -1],
      ],
      entry: [
        [8, 0, -2],
        [8, 0, 0],
      ],
      exit: [
        [8, 3, -2],
        [8, 3, 0],
      ],
    },
    {
      from: 'stepLowB',
      to: 'stepHighB',
      points: [
        [8, 0, 1],
        [8, 3, 1],
      ],
      entry: [
        [8, 0, 0],
        [8, 0, 2],
      ],
      exit: [
        [8, 3, 0],
        [8, 3, 2],
      ],
    },
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const query: DiscoveryOptions & { speed: number } = {
    ...options,
    speed: 5,
    portals,
    from: [2, 0, 0],
    to: [17, 3, 0],
    maxDrop: 1,
    maxHorizontalDistance: 6,
  };
  const groundPlanner = createGroundPlanner(surfaces, query);
  const first = findJumpConnections(surfaces, world, { ...query, groundPlanner });
  const second = findJumpConnections(surfaces, world, { ...query, groundPlanner });
  const reverse = findJumpConnections(surfaces, world, {
    ...query,
    from: [17, 3, 0],
    to: [2, 0, 0],
    groundPlanner,
  });
  const third = findJumpConnections(surfaces, world, { ...query, groundPlanner });

  assert.equal(first.diagnostics.targetReached, true);
  assert.deepEqual(first, findJumpConnections(surfaces, world, query));
  assert.deepEqual(second, first);
  assert.deepEqual(third, first);
  assert.deepEqual(
    reverse,
    findJumpConnections(surfaces, world, { ...query, from: [17, 3, 0], to: [2, 0, 0] }),
  );
  assert.equal(reverse.diagnostics.targetReached, false);
});
