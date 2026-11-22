import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3, Wall } from '#@/src/geometry.ts';
import type { GroundArrival, GroundConnection } from '#@/src/route.ts';
import { jumpConnection } from '#@/src/v1/motion/jumps.ts';
import { advanceDistanceField } from '#@/src/v1/reach/distance-field.ts';
import {
  createGroundPlanner,
  createOverlayGroundPlanner,
  groundPreparation,
  planGroundRoute,
} from '#@/src/v1/route/ground.ts';
import { findRouteShortcuts } from '#@/src/v1/route/route-shortcuts.ts';
import type { route } from '#@/src/v1/route/routes.ts';
import {
  type ShortcutCache,
  type ShortcutOptions,
  findJumpShortcuts,
  findJumpFrontier,
} from '#@/src/v1/search/shortcuts.ts';
import { findJumpConnections } from '#@/src/v1/search/traversal.ts';

const floor = (id: string, x0: number, x1: number, y: number, z0: number, z1: number): Surface => ({
  id,
  vertices: [
    [x0, y, z0],
    [x1, y, z0],
    [x1, y, z1],
    [x0, y, z1],
  ],
});
const geometry = (surfaces: Surface[]) => {
  const triangles = surfaces.flatMap((surface) => [
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
    [surface.vertices[0], surface.vertices[3], surface.vertices[2]],
  ]);
  return {
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  };
};
const profile = { radius: 0.3, height: 1.7 };
const movement = {
  gravity: 10,
  fallingGravity: 10,
  maxJumpHeight: 2,
  maxFallingSpeed: 20,
  apexTime: 0.2,
  maxHorizontalSpeed: 6.5,
};
const options: Omit<ShortcutOptions, 'from' | 'to'> = {
  profile,
  walls: [],
  speed: 7,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 300,
  maxLinks: 8,
  model: movement,
};

test('reuses physical jump evidence across full frontier searches without changing their budgets', () => {
  const surfaces = [floor('left', 0, 4, 0, -2, 2), floor('right', 6, 10, 0, -2, 2)];
  const collision = createCollisionWorld(geometry(surfaces));
  let sweeps = 0;
  const world = {
    groundAt: collision.groundAt.bind(collision),
    sweepCapsule: (...args: Parameters<typeof collision.sweepCapsule>) => {
      sweeps++;
      return collision.sweepCapsule(...args);
    },
  };
  const query = { ...options, from: [2, 0, 0] as Vec3, to: [8, 0, 0] as Vec3 };
  const search = () => findJumpFrontier(surfaces, world, query, {});
  const cold = search();
  assert.ok(cold.connections.some((connection) => connection.mode === 'jump'));
  const coldSweeps = sweeps;
  sweeps = 0;
  const warm = search();
  assert.deepEqual(warm, cold);
  assert.ok(sweeps < coldSweeps, `${sweeps} warm sweeps must be below ${coldSweeps}`);
  warm.connections[0].points[0][0] = 999;
  warm.connections[0].times[0] = 999;
  assert.deepEqual(search(), cold);

  // A different endpoint still performs its complete fresh search. Previously
  // proved arcs may participate, but no cursor or route can authorize the result.
  const changed = { ...query, to: [8, 0, 1] as Vec3 };
  const changedWarm = findJumpFrontier(surfaces, world, changed, {});
  const freshWorld = createCollisionWorld(geometry(surfaces));
  assert.deepEqual(changedWarm, findJumpFrontier(surfaces, freshWorld, changed, {}));
  const changedModel = { ...query, model: { ...movement, maxJumpHeight: 1.5 } };
  assert.deepEqual(
    findJumpFrontier(surfaces, world, changedModel, {}),
    findJumpFrontier(surfaces, freshWorld, changedModel, {}),
  );
});

test('finds a shorter drop across a gap even when a long ground ramp connects both sides', () => {
  const surfaces: Surface[] = [
    floor('upper', 0, 4, 4, -2, 2),
    {
      id: 'ramp',
      vertices: [
        [0, 4, 2],
        [4, 4, 2],
        [4, 0, 20],
        [0, 0, 20],
      ],
    },
    floor('back', 0, 15, 0, 20, 24),
    floor('lower', 7, 15, 0, -2, 20),
  ];
  const from: Vec3 = [2, 4, 0],
    to: Vec3 = [10, 0, 0],
    world = createCollisionWorld(geometry(surfaces));
  const arrivals: GroundArrival[] = [{ id: 'player', position: from, cost: 0, state: 'available' }];
  const baseline = createGroundPlanner(surfaces, options).plan(arrivals, to);
  assert.ok(baseline.status === 'complete');
  assert.equal(
    findJumpConnections(surfaces, world, { ...options, from, to }).diagnostics.reason,
    'ground-connected',
  );
  const result = findJumpShortcuts(surfaces, world, { ...options, from, to, baseline });
  assert.ok(result.connections.length > 0);
  assert.deepEqual(findJumpShortcuts(surfaces, world, { ...options, from, to, baseline }), result);
  const route = createGroundPlanner(surfaces, { ...options, connections: result.connections }).plan(
    arrivals,
    to,
  );
  assert.ok(route.status === 'complete');
  assert.ok(route.cost < baseline.cost / 2, `${route.cost} must improve ${baseline.cost}`);
  assert.ok(route.segments.some((segment) => segment.mode === 'drop' || segment.mode === 'jump'));
});

test('keeps straight ground travel when its maximum speed already beats air movement', () => {
  const surfaces: Surface[] = [floor('flat', 0, 20, 0, -3, 3)],
    from: Vec3 = [1, 0, 0],
    to: Vec3 = [19, 0, 0];
  const baseline = createGroundPlanner(surfaces, options).plan(
    [{ id: 'player', position: from, cost: 0, state: 'available' }],
    to,
  );
  assert.ok(baseline.status === 'complete');
  const result = findJumpShortcuts(surfaces, createCollisionWorld(geometry(surfaces)), {
    ...options,
    from,
    to,
    baseline,
  });
  assert.deepEqual(result.connections, []);
  assert.throws(
    () =>
      findJumpShortcuts(surfaces, createCollisionWorld(geometry(surfaces)), {
        ...options,
        from,
        to,
        baseline: { status: 'unmapped' },
      } as unknown as Parameters<typeof findJumpShortcuts>[2]),
    /baseline/,
  );
});

test('resumes bounded frontier batches past blocked launches to reach an opening', () => {
  const surfaces: Surface[] = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  for (const opening of [true, false]) {
    const settings: ShortcutOptions = {
      ...options,
      maxCandidates: 4,
      from: [2, 0, 0],
      to: [9, 0, 0],
      walls: [{ min: [4.5, -1, -20], max: [6, 20, opening ? 1 : 20], state: 'active' }],
    };
    const cache = {
      standing: new Map(),
      motions: new Map(),
      exits: new Map(),
      approaches: new Map(),
    };
    const first = findJumpFrontier(surfaces, world, settings, cache);
    assert.equal(first.connections.length, 0);
    let found: GroundConnection[] = [];
    for (let batch = 0; batch < 16 && !found.length; batch++)
      found = findJumpFrontier(surfaces, world, settings, cache).connections;
    if (opening) {
      assert.ok(
        found.length > 0,
        'later batches must reach the opening rather than retry the blocked prefix',
      );
      const route = createGroundPlanner(surfaces, settings).plan(
        [{ id: 'player', position: settings.from, cost: 0, state: 'available' }],
        settings.to,
        { connections: found },
      );
      assert.ok(route.status === 'complete');
    } else assert.deepEqual(found, []);
  }
});

test('continues a blocked frontier queue with a larger budget without regenerating its seeds', () => {
  const surfaces: Surface[] = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = {
    ...options,
    maxCandidates: 4,
    from: [2, 0, 0],
    to: [9, 0, 0],
    walls: [{ min: [4.5, -1, -20], max: [6, 20, 20], state: 'active' }],
  };
  const cache: ShortcutCache = {};
  const first = findJumpFrontier(surfaces, world, settings, cache);
  const second = findJumpFrontier(surfaces, world, { ...settings, maxCandidates: 8 }, cache);
  assert.equal(first.connections.length, 0);
  assert.equal(second.connections.length, 0);
  assert.equal(second.diagnostics.cursor!.resumed, true);
  assert.equal(second.diagnostics.seedChecks, 0);
  assert.equal(second.diagnostics.neighbourChecks, 0);
  assert.ok(second.diagnostics.cursor!.pending < first.diagnostics.cursor!.pending);
  assert.equal(second.diagnostics.truncated, true);
});

test('prepared portal ownership avoids repeated serialization and restarts discovery for a new graph', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  let serializations = 0;
  const portals = Object.assign([], {
    toJSON() {
      serializations++;
      return [];
    },
  });
  const settings: ShortcutOptions = {
    ...options,
    portals,
    maxCandidates: 4,
    from: [2, 0, 0],
    to: [9, 0, 0],
    walls: [{ min: [4.5, -1, -20], max: [6, 20, 20], state: 'active' }],
  };
  const planner = createGroundPlanner(surfaces, settings);
  const cache: ShortcutCache = {};
  const cold = findJumpFrontier(surfaces, world, { ...settings, groundPlanner: planner }, cache);
  const continued = findJumpFrontier(
    surfaces,
    world,
    { ...settings, groundPlanner: planner },
    cache,
  );
  assert.equal(continued.diagnostics.cursor!.resumed, true);
  assert.equal(serializations, 0);
  const rebuiltPortals = [...portals];
  const rebuilt = createGroundPlanner(surfaces, { ...settings, portals: rebuiltPortals });
  const restarted = findJumpFrontier(
    surfaces,
    world,
    { ...settings, portals: rebuiltPortals, groundPlanner: rebuilt },
    cache,
  );
  assert.equal(restarted.diagnostics.cursor!.resumed, false);
  assert.deepEqual(restarted, cold);
  assert.deepEqual(
    findJumpFrontier(surfaces, world, { ...settings, groundPlanner: planner }, {}),
    cold,
  );
});

test('standalone discovery detects in-place portal changes before reusing its frontier', () => {
  const surfaces = [
    floor('start', 0, 4, 0, -2, 2),
    floor('step', 4, 4.3, 0.2, -2, 2),
    floor('goal', 7, 11, 0, -2, 2),
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = {
    ...options,
    portals: [],
    maxCandidates: 4,
    from: [2, 0, 0],
    to: [9, 0, 0],
    walls: [{ min: [4.5, -1, -20], max: [6, 20, 20], state: 'active' }],
  };
  const cache: ShortcutCache = {};
  findJumpFrontier(surfaces, world, settings, cache);
  assert.equal(
    findJumpFrontier(surfaces, world, settings, cache).diagnostics.cursor!.resumed,
    true,
  );
  settings.portals!.push({
    from: 'start',
    to: 'step',
    points: [
      [4, 0, 0],
      [4, 0.2, 0],
    ],
  });
  const changed = findJumpFrontier(surfaces, world, settings, cache);
  assert.equal(changed.diagnostics.cursor!.resumed, false);
  assert.deepEqual(changed, findJumpFrontier(surfaces, world, settings, {}));
});

test('a wider cost bound retries frontier candidates excluded by the earlier bound', () => {
  const surfaces: Surface[] = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = {
    ...options,
    maxCandidates: 1000,
    from: [2, 0, 0],
    to: [9, 0, 0],
    boundGoal: [9, 0, 0],
  };
  const cache: ShortcutCache = {};
  const tight = findJumpFrontier(surfaces, world, { ...settings, costBound: 0 }, cache);
  assert.deepEqual(tight.connections, []);
  assert.equal(tight.diagnostics.cursor!.seedExhausted, true);
  const wider = findJumpFrontier(surfaces, world, { ...settings, costBound: 20 }, cache);
  const fresh = findJumpFrontier(surfaces, world, { ...settings, costBound: 20 }, {});
  assert.ok(fresh.connections.length > 0);
  assert.equal(wider.diagnostics.cursor!.resumed, false);
  assert.deepEqual(wider.connections, fresh.connections);
});

test('invalidates frontier reachability when an existing action changes under the same id', () => {
  const surfaces: Surface[] = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const connection: GroundConnection & { boostExpiry?: number | undefined } = {
    id: 'transfer',
    state: 'closed',
    mode: 'jump',
    points: [
      [2, 0, 0],
      [9, 0, 0],
    ],
    times: [0, 2],
  };
  const settings: ShortcutOptions = {
    ...options,
    maxCandidates: 4,
    from: [2, 0, 0],
    to: [9, 0, 0],
    connections: [connection],
  };
  const cache: ShortcutCache = {};
  findJumpFrontier(surfaces, world, settings, cache);
  const repeated = findJumpFrontier(surfaces, world, settings, cache);
  assert.equal(repeated.diagnostics.cursor!.resumed, true);
  const changed = findJumpFrontier(
    surfaces,
    world,
    {
      ...settings,
      connections: [{ ...connection, state: 'open' }],
    },
    cache,
  );
  assert.equal(changed.diagnostics.cursor!.resumed, false);
  assert.deepEqual(changed.connections, []);
  assert.equal(changed.diagnostics.distanceFields!.approach.reachableNodes, 2);
});

test('reverse frontiers constrain predecessors while forward frontiers retain intermediate relays', () => {
  const surfaces: Surface[] = [
    floor('start', 0, 2, 0, -1, 1),
    floor('relay', 5, 7, 0, -1, 1),
    floor('goal', 20, 22, 0, -1, 1),
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = {
    ...options,
    maxCandidates: 1000,
    maxHorizontalDistance: 10,
    from: [1, 0, 0],
    to: [21, 0, 0],
  };
  const cache: ShortcutCache = {};
  const reverse = findJumpFrontier(surfaces, world, settings, cache, true);
  assert.deepEqual(reverse.connections, []);
  assert.ok(reverse.diagnostics.rejected.range > 0);
  assert.equal(reverse.diagnostics.neighbourChecks, 0);
  const bounds = cache.reverseCursor!.goalBounds;
  const resumed = findJumpFrontier(surfaces, world, settings, cache, true);
  assert.equal(resumed.diagnostics.cursor!.resumed, true);
  assert.equal(cache.reverseCursor!.goalBounds, bounds);
  const forward = findJumpFrontier(surfaces, world, settings, {});
  assert.ok(
    forward.connections.some((edge) => edge.fromSurface === 'start' && edge.toSurface === 'relay'),
  );
});

test('a larger link quota rebuilds frontier pools while a larger work budget resumes', () => {
  const surfaces: Surface[] = [
    floor('start', 0, 2, 0, -1, 1),
    floor('middle', 4, 6, 0, -1, 1),
    floor('goal', 9, 11, 0, -1, 1),
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = {
    ...options,
    maxCandidates: 10000,
    maxLinks: 1,
    walls: [{ min: [7, -1, -20], max: [8, 20, 20], state: 'active' }],
    from: [1, 0, 0],
    to: [10, 0, 0],
  };
  const cache: ShortcutCache = {};
  const first = findJumpFrontier(surfaces, world, settings, cache);
  assert.deepEqual(first.connections, []);
  const larger = findJumpFrontier(surfaces, world, { ...settings, maxLinks: 8 }, cache);
  assert.equal(larger.diagnostics.cursor!.resumed, false);
  assert.ok(
    larger.connections.some((edge) => edge.fromSurface === 'start' && edge.toSurface === 'middle'),
  );
  const fresh = findJumpFrontier(surfaces, world, { ...settings, maxLinks: 8 }, {});
  assert.deepEqual(larger.connections, fresh.connections);
});

test('excludes costly seed regions before projection and retries after the bound widens', () => {
  const surfaces = [floor('start', 0, 4, 0, -2, 2), floor('goal', 7, 11, 0, -2, 2)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = { ...options, from: [2, 0, 0], to: [9, 0, 0] };
  const cache = {};
  const tight = findJumpFrontier(surfaces, world, { ...settings, costBound: 0.01 }, cache);
  assert.ok(tight.diagnostics.seedChecks > 0);
  assert.equal(tight.diagnostics.seedProjections, 0);
  assert.deepEqual(tight.connections, []);
  const wider = findJumpFrontier(surfaces, world, { ...settings, costBound: 10 }, cache);
  const fresh = findJumpFrontier(surfaces, world, { ...settings, costBound: 10 }, {});
  assert.ok(wider.connections.length > 0);
  assert.deepEqual(wider.connections, fresh.connections);
  assert.equal(wider.diagnostics.seedChecks, fresh.diagnostics.seedChecks);
  assert.equal(wider.diagnostics.truncated, fresh.diagnostics.truncated);
});

test('a frontier batch retains different reachable relay regions within its link quota', () => {
  const surfaces = [
    floor('start', 0, 4, 0, -4, 4),
    floor('left', 7, 10, 0, -4, -1),
    floor('right', 7, 10, 0, 1, 4),
    floor('goal', 30, 34, 0, -2, 2),
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const settings: ShortcutOptions = {
    ...options,
    from: [2, 0, 0],
    to: [32, 0, 0],
    maxCandidates: 1000,
    maxLinks: 4,
  };
  const result = findJumpFrontier(surfaces, world, settings, {});
  assert.deepEqual(
    new Set(result.connections.map((edge) => edge.toSurface)),
    new Set(['left', 'right']),
  );
  assert.ok(result.connections.length <= settings.maxLinks);
  const planner = createGroundPlanner(surfaces, settings);
  const targets: Vec3[] = [
    [8, 0, -2],
    [8, 0, 2],
  ];
  for (const target of targets) {
    assert.equal(
      planner.plan(
        [{ id: 'player', position: settings.from, cost: 0, state: 'available' }],
        target,
        { connections: result.connections },
      ).status,
      'complete',
    );
  }
});

test('shortcut validation and incumbent pruning retain a paid overspeed improvement', () => {
  const body = { radius: 0.35, height: 1.66 };
  const surfaces = [floor('source', -2, 2, 0.005, -2, 2), floor('landing', 7.15, 10, 0.005, -2, 2)];
  const world = createCollisionWorld(
    geometry([
      floor('source-body', -2.4, 2.4, 0, -2.4, 2.4),
      floor('landing-body', 6.75, 10.4, 0, -2.4, 2.4),
    ]),
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
    end: Vec3 = [7.15, 0.005, 0];
  const arc = jumpConnection(start, end, {
    ...model,
    profile: body,
    walls: [],
    mode: 'jump',
    sweep: (...args) => world.sweepCapsule(...args),
  });
  assert.ok(arc);
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
  const ground = { profile: body, walls: [], speed: 5, maxVertical: 0.5, locomotion };
  const proof = planGroundRoute(surfaces, [arrival], end, {
    ...ground,
    connections: [{ id: 'physical', ...arc, state: 'open', requiredGait: 'sprint' }],
  });
  assert.ok(proof.status === 'complete');
  assert.ok(proof.segments.some((segment) => segment.mode === 'walk' && segment.gait === 'sprint'));
  assert.equal(proof.locomotion!.initial - proof.locomotion!.final, 1);
  const settings: ShortcutOptions = {
    ...options,
    ...ground,
    model,
    from: arrival.position,
    to: end,
    maxDrop: 1,
    maxHorizontalDistance: 10,
  };
  const frontier = findJumpFrontier(surfaces, world, settings);
  assert.ok(frontier.diagnostics.candidatePairs > 0);
  assert.ok(
    frontier.connections.some((connection) => connection.mode === 'jump'),
    JSON.stringify(frontier.diagnostics),
  );
  const rope: GroundConnection = {
    id: 'incumbent',
    mode: 'rope',
    state: 'open',
    points: [start, end],
    times: [0, 0.78],
  };
  const baseline = planGroundRoute(surfaces, [arrival], end, { ...ground, connections: [rope] });
  assert.ok(baseline.status === 'complete');
  assert.ok(proof.cost < baseline.cost);
  assert.ok(
    3 / locomotion.sprintSpeed + (end[0] - start[0]) / model.maxHorizontalSpeed > baseline.cost,
  );
  assert.equal(
    planGroundRoute(surfaces, [arrival], end, {
      ...ground,
      locomotion: { ...locomotion, stamina: { ...locomotion.stamina, initial: 0 } },
      connections: [{ id: 'physical', ...arc, state: 'open', requiredGait: 'sprint' }],
    }).status,
    'no-verified-route',
  );
  const shortcutCache: ShortcutCache = {};
  const improved = findJumpShortcuts(
    surfaces,
    world,
    {
      ...settings,
      connections: [rope],
      baseline,
    },
    shortcutCache,
  );
  assert.ok(
    improved.connections.some((connection) => connection.mode === 'jump'),
    JSON.stringify(improved.diagnostics),
  );
  const nativeImproved = planGroundRoute(surfaces, [arrival], end, {
    ...ground,
    connections: [
      ...improved.connections.map((connection) => ({
        ...connection,
        requiredGait: 'sprint' as const,
      })),
      rope,
    ],
  });
  assert.ok(nativeImproved.status === 'complete' && nativeImproved.cost < baseline.cost);
  const routeGoal: Vec3 = [8.15, 0.005, 0];
  const routeBaseline = planGroundRoute(surfaces, [arrival], routeGoal, {
    ...ground,
    connections: [rope],
  });
  assert.ok(routeBaseline.status === 'complete');
  const routeImproved = findRouteShortcuts(
    surfaces,
    world,
    { ...settings, to: routeGoal, connections: [rope], baseline: routeBaseline },
    shortcutCache,
  );
  assert.ok(
    routeImproved.connections.some((connection) => connection.mode === 'jump'),
    JSON.stringify(routeImproved.diagnostics),
  );
  const cached: ShortcutCache = {};
  const lowPeak = {
    ...settings,
    costBound: 1,
    locomotion: { ...locomotion, dash: { speed: 6, duration: 0.3, cooldown: 0.8, cost: 1 } },
  };
  assert.deepEqual(findJumpFrontier(surfaces, world, lowPeak, cached).connections, []);
  const highPeak = {
    ...lowPeak,
    locomotion: { ...lowPeak.locomotion, dash: { ...lowPeak.locomotion.dash, speed: 10 } },
  };
  const fresh = findJumpFrontier(surfaces, world, highPeak, {});
  assert.ok(fresh.connections.length > 0);
  const reused = findJumpFrontier(surfaces, world, highPeak, cached);
  assert.equal(reused.diagnostics.cursor!.resumed, false);
  // Standing evidence is physical and remains reusable across gait changes.
  assert.deepEqual(reused.connections, fresh.connections);
  assert.deepEqual(reused.diagnostics.limits, fresh.diagnostics.limits);
  assert.equal(reused.diagnostics.candidatePairs, fresh.diagnostics.candidatePairs);
  const noImpulse = findJumpFrontier(
    surfaces,
    world,
    { ...highPeak, model: { ...model, startHorizontalSpeed: model.maxHorizontalSpeed } },
    cached,
  );
  assert.equal(noImpulse.diagnostics.cursor!.resumed, false);
  assert.deepEqual(noImpulse.connections, []);
  const restored = findJumpFrontier(surfaces, world, highPeak, cached);
  assert.equal(restored.diagnostics.cursor!.resumed, false);
  assert.deepEqual(restored.connections, fresh.connections);
  assert.deepEqual(
    findJumpFrontier(surfaces, world, { ...settings, maxHorizontalDistance: 5.1 }).connections,
    [],
  );
  assert.deepEqual(
    findJumpFrontier(surfaces, world, {
      ...settings,
      walls: [{ min: [4, -1, -3], max: [5, 5, 3], state: 'active' }],
    }).connections,
    [],
  );
});

test('provided ground planners retain gait-aware shortcut bounds without repeated locomotion options', () => {
  const body = { radius: 0.35, height: 1.66 };
  const surfaces = [floor('source', -2, 2, 0.005, -2, 2), floor('landing', 7.15, 10, 0.005, -2, 2)];
  const world = createCollisionWorld(
    geometry([
      floor('source-body', -2.4, 2.4, 0, -2.4, 2.4),
      floor('landing-body', 6.75, 10.4, 0, -2.4, 2.4),
    ]),
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
    end: Vec3 = [7.15, 0.005, 0];
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
  const rope: GroundConnection = {
    id: 'incumbent',
    mode: 'rope',
    state: 'open',
    points: [start, end],
    times: [0, 0.78],
  };
  const ground = { profile: body, walls: [], speed: 5, maxVertical: 0.5, locomotion };
  const planner = createGroundPlanner(surfaces, { ...ground, connections: [rope] });
  const baseline = planner.plan([arrival], end);
  assert.ok(baseline.status === 'complete');
  const arc = jumpConnection(start, end, {
    ...model,
    profile: body,
    walls: [],
    mode: 'jump',
    sweep: (...args) => world.sweepCapsule(...args),
  });
  assert.ok(arc);
  const proof = planner.plan([arrival], end, {
    connections: [{ id: 'physical', ...arc, state: 'open', requiredGait: 'sprint' }],
  });
  assert.ok(proof.status === 'complete' && proof.cost < baseline.cost);
  assert.equal(proof.locomotion!.initial - proof.locomotion!.final, 1);
  const settings: ShortcutOptions = {
    ...options,
    profile: body,
    speed: 5,
    model,
    from: arrival.position,
    to: end,
    maxDrop: 1,
    maxHorizontalDistance: 10,
    groundPlanner: planner,
    connections: [rope],
  };
  assert.equal(settings.locomotion, undefined);
  const improved = findJumpShortcuts(surfaces, world, { ...settings, baseline });
  assert.ok(
    improved.connections.some((connection) => connection.mode === 'jump'),
    JSON.stringify(improved.diagnostics),
  );
  const scheduled = planner.plan([arrival], end, {
    connections: [
      rope,
      ...improved.connections.map((connection) => ({
        ...connection,
        requiredGait: 'sprint' as const,
      })),
    ],
  });
  assert.ok(scheduled.status === 'complete' && scheduled.cost < baseline.cost);

  const low = createGroundPlanner(surfaces, {
    ...ground,
    locomotion: { ...locomotion, dash: { speed: 6, duration: 0.3, cooldown: 0.8, cost: 1 } },
  });
  const high = createGroundPlanner(surfaces, {
    ...ground,
    locomotion: { ...locomotion, dash: { speed: 10, duration: 0.3, cooldown: 0.8, cost: 1 } },
  });
  const cache: ShortcutCache = {};
  const frontier = { ...settings, connections: [], costBound: 1, groundPlanner: low };
  assert.deepEqual(findJumpFrontier(surfaces, world, frontier, cache).connections, []);
  assert.equal(cache.geometry!.lengthScale, groundPreparation(low)!.searchSpeed);
  const fresh = findJumpFrontier(surfaces, world, { ...frontier, groundPlanner: high }, {});
  assert.ok(fresh.connections.length > 0);
  const reused = findJumpFrontier(surfaces, world, { ...frontier, groundPlanner: high }, cache);
  assert.equal(reused.diagnostics.cursor!.resumed, false);
  assert.deepEqual(reused.connections, fresh.connections);
  assert.deepEqual(reused.diagnostics.limits, fresh.diagnostics.limits);
  const geometryBefore = cache.geometry;
  const fasterSprint = createGroundPlanner(surfaces, {
    ...ground,
    locomotion: {
      ...locomotion,
      sprintSpeed: 8,
      dash: { speed: 10, duration: 0.3, cooldown: 0.8, cost: 1 },
    },
  });
  const changed = findJumpFrontier(
    surfaces,
    world,
    { ...frontier, groundPlanner: fasterSprint },
    cache,
  );
  assert.notEqual(cache.geometry, geometryBefore);
  assert.equal(cache.geometry!.lengthScale, 8);
  assert.equal(changed.diagnostics.cursor!.resumed, false);
  assert.deepEqual(
    changed.connections,
    findJumpFrontier(surfaces, world, { ...frontier, groundPlanner: fasterSprint }, {}).connections,
  );
});

test('overlay geometries sharing IndexedBoundary objects preserve differing component splits', () => {
  const staticSurfaces: Surface[] = [
    floor('left', 0, 4, 0, -2, 2),
    floor('bridge', 4, 6, 0, -0.5, 0.5),
    floor('right', 6, 10, 0, -2, 2),
    floor('ledge', 12, 16, 0, -2, 2),
  ];
  const roof: Surface = floor('roof', 0, 2, 1.5, 4, 6);
  const layoutSurfaces = [...staticSurfaces, roof];
  const splitWall: Wall = { min: [4.5, -1, -2], max: [5.5, 3, 2], state: 'active' };
  const idleWall: Wall = { min: [20, -1, 20], max: [21, 3, 21], state: 'active' };
  const world = createCollisionWorld(geometry([...staticSurfaces, roof]));
  const groundOpts = { speed: options.speed, maxVertical: options.maxVertical, walls: [], profile };

  const basePlanner = createGroundPlanner(staticSurfaces, groundOpts);
  const splitOverlay = createOverlayGroundPlanner(
    basePlanner,
    layoutSurfaces,
    [roof],
    [splitWall],
    {
      ...groundOpts,
      walls: [splitWall],
    },
  );
  const unsplitOverlay = createOverlayGroundPlanner(
    basePlanner,
    layoutSurfaces,
    [roof],
    [idleWall],
    { ...groundOpts, walls: [idleWall] },
  );

  const from: Vec3 = [2, 0, 0];
  const to: Vec3 = [14, 0, 0];
  const splitQuery: ShortcutOptions = {
    ...options,
    walls: [splitWall],
    from,
    to,
    groundPlanner: splitOverlay,
  };
  const unsplitQuery: ShortcutOptions = {
    ...options,
    walls: [idleWall],
    from,
    to,
    groundPlanner: unsplitOverlay,
  };

  const splitCache: ShortcutCache = {};
  const unsplitCache: ShortcutCache = {};
  const splitFrontier = findJumpFrontier(layoutSurfaces, world, splitQuery, splitCache);
  const unsplitFrontier = findJumpFrontier(layoutSurfaces, world, unsplitQuery, unsplitCache);

  const freshSplit = findJumpFrontier(layoutSurfaces, world, {
    ...splitQuery,
    groundPlanner: createGroundPlanner(layoutSurfaces, { ...groundOpts, walls: [splitWall] }),
  });
  const freshUnsplit = findJumpFrontier(layoutSurfaces, world, {
    ...unsplitQuery,
    groundPlanner: createGroundPlanner(layoutSurfaces, { ...groundOpts, walls: [idleWall] }),
  });

  assert.deepEqual(splitFrontier, freshSplit);
  assert.deepEqual(unsplitFrontier, freshUnsplit);
  // Shared IndexedBoundary instances must not carry stale .component tags across overlays.
  assert.equal('component' in splitCache.geometry!.boundaries[0], false);
  assert.notEqual(
    splitCache.geometry!.componentOf('left'),
    splitCache.geometry!.componentOf('right'),
  );
  assert.equal(
    unsplitCache.geometry!.componentOf('left'),
    unsplitCache.geometry!.componentOf('right'),
  );
  for (let i = 0; i < splitCache.geometry!.boundaries.length; i++) {
    const edge = splitCache.geometry!.boundaries[i];
    assert.equal(edge.ordinal, i);
    assert.equal(
      splitCache.geometry!.boundaryComponents[i],
      splitCache.geometry!.componentOf(edge.surface),
    );
  }
  for (let i = 0; i < unsplitCache.geometry!.landingSurfaces.length; i++) {
    const face = unsplitCache.geometry!.landingSurfaces[i];
    assert.equal(face.ordinal, i);
    assert.equal(
      unsplitCache.geometry!.landingComponents[i],
      unsplitCache.geometry!.componentOf(face.id),
    );
  }
  // Cold reverse frontier sharing splitOverlay PreparedGeometry matches fresh completely,
  // and warm reverse frontier on splitCache preserves identical connections.
  const freshSplitReverse = findJumpFrontier(
    layoutSurfaces,
    world,
    {
      ...splitQuery,
      groundPlanner: createGroundPlanner(layoutSurfaces, { ...groundOpts, walls: [splitWall] }),
    },
    {},
    true,
  );
  assert.deepEqual(
    findJumpFrontier(layoutSurfaces, world, splitQuery, {}, true),
    freshSplitReverse,
  );
  assert.deepEqual(
    findJumpFrontier(layoutSurfaces, world, splitQuery, splitCache, true).connections,
    freshSplitReverse.connections,
  );
  // Repeated forward findJumpShortcuts on unsplitOverlay also matches fresh non-overlay planner.
  const arrivals: GroundArrival[] = [{ id: 'player', position: from, cost: 0, state: 'available' }];
  const baseline = unsplitOverlay.plan(arrivals, [9, 0, 0]);
  assert.ok(baseline.status === 'complete');
  const shortcutQuery = { ...unsplitQuery, to: [9, 0, 0] as Vec3, baseline };
  assert.deepEqual(
    findJumpShortcuts(layoutSurfaces, world, shortcutQuery, unsplitCache),
    findJumpShortcuts(layoutSurfaces, world, {
      ...shortcutQuery,
      groundPlanner: createGroundPlanner(layoutSurfaces, { ...groundOpts, walls: [idleWall] }),
    }),
  );
});

test('single-level and nested overlays reuse base reverse adjacency and landing AABBs with exact parity', () => {
  // Static corridor with parallel detour (s0-s1-s2-s3 and b1-b2) plus disconnected goal ledge.
  const staticSurfaces: Surface[] = [
    floor('s0', 0, 4, 0, -2, 2),
    floor('s1', 4, 8, 0, -2, 2),
    floor('s2', 8, 12, 0, -2, 2),
    floor('s3', 12, 16, 0, -2, 2),
    floor('b1', 0, 4, 0, 2, 6),
    floor('b2', 4, 12, 0, 2, 6),
    floor('b3', 12, 16, 0, 2, 6),
    floor('ledge', 18, 22, 0, -2, 2),
  ];
  const roof1a = floor('roof1a', 2, 4, 1.5, -8, -5);
  const roof1b = floor('roof1b', 4, 6, 1.5, -8, -5);
  const roof2a = floor('roof2a', 12, 14, 1.5, -8, -5);
  const roof2b = floor('roof2b', 14, 16, 1.5, -8, -5);

  const wall1: Wall = { min: [7.5, -1, -2.5], max: [8.5, 3, 2.5], state: 'active' };
  const wall2: Wall = { min: [3.5, -1, -2.5], max: [4.5, 3, 2.5], state: 'active' };
  const idleWall: Wall = { min: [100, -1, 100], max: [101, 3, 101], state: 'active' };

  const layout1 = [...staticSurfaces, roof1a, roof1b];
  const layout2 = [...layout1, roof2a, roof2b];
  const allWorld = createCollisionWorld(geometry(layout2));
  const groundOpts = { speed: options.speed, maxVertical: options.maxVertical, walls: [], profile };

  const basePlanner = createGroundPlanner(staticSurfaces, groundOpts);
  const overlay1 = createOverlayGroundPlanner(basePlanner, layout1, [roof1a, roof1b], [wall1], {
    ...groundOpts,
    walls: [wall1],
  });
  const overlay2 = createOverlayGroundPlanner(overlay1, layout2, [roof2a, roof2b], [wall2], {
    ...groundOpts,
    walls: [wall1, wall2],
  });
  const noopOverlay = createOverlayGroundPlanner(basePlanner, staticSurfaces, [], [idleWall], {
    ...groundOpts,
    walls: [idleWall],
  });

  const from: Vec3 = [2, 0, 0];
  const to: Vec3 = [20, 0, 0];
  const shortcutGoal: Vec3 = [14, 0, 0];
  const arrivals: GroundArrival[] = [{ id: 'player', position: from, cost: 0, state: 'available' }];

  const baseCache: ShortcutCache = {};
  const noopCache: ShortcutCache = {};
  const cache1: ShortcutCache = {};
  const cache2: ShortcutCache = {};

  findJumpFrontier(
    staticSurfaces,
    allWorld,
    {
      ...options,
      walls: [],
      from,
      to,
      groundPlanner: basePlanner,
    },
    baseCache,
  );
  findJumpFrontier(
    staticSurfaces,
    allWorld,
    {
      ...options,
      walls: [idleWall],
      from,
      to,
      groundPlanner: noopOverlay,
    },
    noopCache,
  );

  // No-op overlay reuses base landingSurfaces and reverse reference directly.
  assert.equal(noopCache.geometry!.landingSurfaces, baseCache.geometry!.landingSurfaces);
  assert.equal(noopCache.geometry!.reverse, baseCache.geometry!.reverse);

  const checkParity = (
    surfaces: Surface[],
    walls: Wall[],
    overlayPlanner: ReturnType<typeof createGroundPlanner>,
    overlayCache: ShortcutCache,
    expectedPrefixLen: number,
    prevLanding: ShortcutCache['geometry'],
  ) => {
    const query: ShortcutOptions = {
      ...options,
      walls,
      from,
      to,
      groundPlanner: overlayPlanner,
    };
    const freshPlanner = createGroundPlanner(surfaces, { ...groundOpts, walls });
    const freshCache: ShortcutCache = {};

    const actualFrontier = findJumpFrontier(surfaces, allWorld, query, overlayCache);
    const freshFrontier = findJumpFrontier(
      surfaces,
      allWorld,
      { ...query, groundPlanner: freshPlanner },
      freshCache,
    );
    assert.deepEqual(actualFrontier, freshFrontier);

    // Reverse frontier parity.
    assert.deepEqual(
      findJumpFrontier(surfaces, allWorld, query, {}, true),
      findJumpFrontier(surfaces, allWorld, { ...query, groundPlanner: freshPlanner }, {}, true),
    );

    // Shortcut search parity (goal reachable via b1-b2-b3 detour).
    const baseline = overlayPlanner.plan(arrivals, shortcutGoal);
    assert.ok(baseline.status === 'complete');
    const shortcutQuery: ShortcutOptions & {
      baseline: Extract<typeof baseline, { status: 'complete' }>;
    } = {
      ...query,
      to: shortcutGoal,
      baseline,
    };
    const freshShortcuts = findJumpShortcuts(surfaces, allWorld, {
      ...shortcutQuery,
      groundPlanner: freshPlanner,
    });
    assert.deepEqual(findJumpShortcuts(surfaces, allWorld, shortcutQuery, {}), freshShortcuts);
    assert.deepEqual(
      findJumpShortcuts(surfaces, allWorld, shortcutQuery, overlayCache).connections,
      freshShortcuts.connections,
    );

    // LandingFace prefix reuse + ordinal integrity.
    const actualGeo = overlayCache.geometry!;
    const freshGeo = freshCache.geometry!;
    for (let i = 0; i < expectedPrefixLen; i++) {
      assert.equal(actualGeo.landingSurfaces[i], prevLanding!.landingSurfaces[i]);
    }
    for (let i = 0; i < surfaces.length; i++) {
      assert.equal(actualGeo.landingSurfaces[i].ordinal, i);
    }

    // Reverse adjacency and reverse distance field parity across every surface node.
    for (const s of surfaces) {
      assert.deepEqual(actualGeo.reverse.get(s.id), freshGeo.reverse.get(s.id));
    }
    const actualDist = advanceDistanceField(
      actualGeo.reverse,
      [],
      [{ id: 's3', cost: 0 }],
      true,
      undefined,
      actualGeo.lengthScale,
    );
    const freshDist = advanceDistanceField(
      freshGeo.reverse,
      [],
      [{ id: 's3', cost: 0 }],
      true,
      undefined,
      freshGeo.lengthScale,
    );
    assert.deepEqual(actualDist.costs, freshDist.costs);
  };

  checkParity(layout1, [wall1], overlay1, cache1, staticSurfaces.length, baseCache.geometry);
  checkParity(layout2, [wall1, wall2], overlay2, cache2, layout1.length, cache1.geometry);
});
