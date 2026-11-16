import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createCollisionWorld } from '#@/src/collision.ts';
import type { Surface, Vec3 } from '#@/src/geometry.ts';
import type { GroundArrival, GroundConnection } from '#@/src/route.ts';
import {
  actionCatalogStats,
  setActionCatalogPhase,
  selectCatalogActions,
  registerCatalogSurfaces,
} from '#@/src/v1/route/action-catalog.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import {
  planJumpRoute,
  type InitialGroundProof,
  type JumpRouteOptions,
} from '#@/src/v1/route/jump-planner.ts';

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
  const triangles = surfaces.flatMap((surface) => [
    [surface.vertices[0], surface.vertices[2], surface.vertices[1]],
    [surface.vertices[0], surface.vertices[3], surface.vertices[2]],
  ]);
  return {
    positions: triangles.flat(2),
    indices: Array.from({ length: triangles.length * 3 }, (_, index) => index),
  };
};
const options: JumpRouteOptions = {
  profile: { radius: 0.3, height: 1.7 },
  walls: [],
  speed: 7,
  runAirSpeed: 6.5,
  maxVertical: 0.5,
  maxSlope: 46,
  maxDrop: 10,
  maxHorizontalDistance: 15,
  sampleSpacing: 1,
  maxCandidates: 600,
  maxLinks: 32,
  model: {
    gravity: 10,
    fallingGravity: 10,
    maxJumpHeight: 2,
    maxFallingSpeed: 20,
    apexTime: 0.2,
    maxHorizontalSpeed: 6.5,
  },
};
const arrival = (position: Vec3): GroundArrival[] => [
  { id: 'player', position, state: 'available', cost: 0 },
];

test('training stores motion proofs and frozen fresh starts solve through a small validated chain', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('step', 7, 11, 0), floor('goal', 14, 18, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = { ...options, groundPlanner: createGroundPlanner(surfaces, options) };
  const goal: Vec3 = [16, 0, 0];
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(surfaces, surfaces);
    const trained = planJumpRoute(surfaces, world, arrival([2, 0, 0]), goal, settings);
    assert.equal(trained.route.status, 'complete');
    assert.ok(actionCatalogStats().added > 0);
    const before = actionCatalogStats().added;
    setActionCatalogPhase('frozen');
    const starts = arrival([1, 0, 0]);
    starts[0].id = 'fresh';
    starts[0].cost = 3;
    const selected = selectCatalogActions(world, surfaces, starts, goal, settings).actions;
    assert.ok(selected.length > 0 && selected.length <= 16);
    assert.ok(selected.every((action) => action.id.startsWith('@catalog/') && !action.terminal));
    assert.deepEqual(
      selectCatalogActions(world, surfaces, starts, goal, { ...settings, connections: selected })
        .actions,
      selected,
    );
    const proof = settings.groundPlanner.plan(starts, goal, { connections: selected });
    assert.equal(proof.status, 'complete');
    const result = planJumpRoute(surfaces, world, starts, goal, settings);
    assert.equal(result.route.status, 'complete');
    assert.ok(result.route.cost <= proof.cost);
    assert.deepEqual(
      result.route,
      settings.groundPlanner.plan(starts, goal, { connections: result.connections }),
    );
    assert.equal(result.route.start, 'fresh');
    assert.ok(actionCatalogStats().hits > 0);
    selected[0].points[0][0] = 123456;
    const again = selectCatalogActions(world, surfaces, starts, goal, settings).actions;
    assert.notEqual(again[0].points[0][0], 123456);
    assert.equal(actionCatalogStats().added, before);
    assert.deepEqual(
      selectCatalogActions(world, surfaces, starts, goal, { ...settings, activeBoost: 'speed' })
        .actions,
      [],
    );
    assert.deepEqual(
      selectCatalogActions(
        createCollisionWorld(geometry(surfaces)),
        surfaces,
        starts,
        goal,
        settings,
      ).actions,
      [],
    );
    assert.deepEqual(
      selectCatalogActions(world, surfaces, starts, goal, {
        ...settings,
        profile: { ...options.profile, radius: 0.4 },
      }).actions,
      [],
    );
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('a frozen catalog miss retains original physical discovery', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('goal', 7, 11, 0)];
  const settings = { ...options, groundPlanner: createGroundPlanner(surfaces, options) };
  try {
    setActionCatalogPhase('frozen');
    const before = actionCatalogStats().added;
    const result = planJumpRoute(
      surfaces,
      createCollisionWorld(geometry(surfaces)),
      arrival([2, 0, 0]),
      [9, 0, 0],
      settings,
    );
    assert.equal(result.route.status, 'complete');
    assert.ok(result.diagnostics.searches.length > 0);
    assert.equal(actionCatalogStats().added, before);
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('coarse catalog prefixes seed the normal full-budget root search without replacing arrivals', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('step', 7, 11, 0), floor('new-goal', 14, 18, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  const planner = createGroundPlanner(surfaces, options);
  const settings = {
    ...options,
    groundPlanner: planner,
    maxCandidates: 96,
    maxShortcutCandidates: 16,
  };
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(surfaces, surfaces);
    const training = planJumpRoute(surfaces, world, arrival([2, 0, 0]), [9, 0, 0], {
      ...settings,
      maxCandidates: 16,
      maxShortcutCandidates: 0,
    });
    assert.equal(training.route.status, 'complete');
    setActionCatalogPhase('frozen');
    const before = actionCatalogStats().added;
    const starts: GroundArrival[] = [
      { id: 'costly', position: [1, 0, 0], state: 'available', cost: 30 },
      { id: 'fresh', position: [2, 0, 0], state: 'available', cost: 3 },
      { id: 'locked', position: [16, 0, 0], state: 'locked', cost: 0 },
    ];
    const goal: Vec3 = [16, 0, 0];
    for (const currentStarts of [[starts[1]], starts]) {
      const { actions, seeds } = selectCatalogActions(
        world,
        surfaces,
        currentStarts,
        goal,
        settings,
      );
      assert.deepEqual(actions, []);
      assert.ok(seeds.length > 0 && seeds.length <= 8);
      const proof: InitialGroundProof = {
        planner,
        surfaces,
        arrival: currentStarts[0],
        goal,
        connections: [],
        route: planner.plan(currentStarts, goal),
      };
      assert.notEqual(proof.route.status, 'complete');
      const plan = planner.plan;
      const queries: { starts: GroundArrival[]; connections: GroundConnection[] }[] = [];
      planner.plan = (...args) => {
        queries.push({ starts: args[0], connections: args[2]?.connections ?? [] });
        return plan(...args);
      };
      let result: ReturnType<typeof planJumpRoute>;
      try {
        result = planJumpRoute(surfaces, world, currentStarts, goal, settings, proof);
      } finally {
        planner.plan = plan;
      }
      assert.equal(result.route.status, 'complete');
      if (result.route.status === 'complete') {
        assert.equal(result.route.start, 'fresh');
        assert.equal(result.route.arrivalCost, 3);
        assert.deepEqual(result.route.points[0], starts[1].position);
        assert.deepEqual(result.route.points.at(-1), goal);
      }
      assert.deepEqual(queries[0].starts, currentStarts);
      assert.equal(queries[0].connections.length, seeds.length);
      assert.ok(queries[0].connections.every((action) => action.id.startsWith('@catalog/')));
      assert.ok(result.diagnostics.catalogSeedActions! > 0);
      assert.ok(result.diagnostics.searches.length > 0);
      assert.equal(result.diagnostics.deviceApproaches, undefined);
      assert.deepEqual(
        result.route,
        planner.plan(currentStarts, goal, { connections: result.connections }),
      );
    }
    assert.equal(actionCatalogStats().added, before);
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('alternating local chains and shared prefixes preserves selection order and refreshes after training', () => {
  const surfaces = [floor('start', 0, 4, 0), floor('step', 7, 11, 0), floor('goal', 14, 18, 0)];
  const world = createCollisionWorld(geometry(surfaces));
  const planner = createGroundPlanner(surfaces, options);
  const settings = {
    ...options,
    groundPlanner: planner,
    maxCandidates: 16,
    maxShortcutCandidates: 0,
  };
  const starts = arrival([1, 0, 0]);
  starts[0].id = 'fresh';
  starts[0].cost = 3;
  const step: Vec3 = [9, 0, 0],
    goal: Vec3 = [16, 0, 0];
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(surfaces, surfaces);
    assert.equal(
      planJumpRoute(surfaces, world, arrival([2, 0, 0]), step, settings).route.status,
      'complete',
    );
    setActionCatalogPhase('frozen');
    const local = selectCatalogActions(world, surfaces, starts, step, settings);
    const shared = selectCatalogActions(world, surfaces, starts, goal, settings);
    assert.ok(local.actions.length > 0);
    assert.deepEqual(local.seeds, []);
    assert.deepEqual(shared.actions, []);
    assert.ok(shared.seeds.length > 0);
    for (let repeat = 0; repeat < 3; repeat++) {
      assert.deepEqual(selectCatalogActions(world, surfaces, starts, step, settings), local);
      assert.deepEqual(selectCatalogActions(world, surfaces, starts, goal, settings), shared);
    }
    assert.equal(
      planner.plan(starts, goal, { connections: shared.seeds }).status,
      'no-verified-route',
    );
    setActionCatalogPhase('training');
    assert.equal(
      planJumpRoute(surfaces, world, arrival(step), goal, settings).route.status,
      'complete',
    );
    setActionCatalogPhase('frozen');
    const refreshed = selectCatalogActions(world, surfaces, starts, goal, settings);
    assert.ok(refreshed.actions.length > 0);
    assert.deepEqual(refreshed.seeds, []);
    assert.ok(
      refreshed.actions.some((action) => shared.seeds.some((prefix) => prefix.id === action.id)),
    );
    const route = planner.plan(starts, goal, { connections: refreshed.actions });
    assert.equal(route.status, 'complete');
    if (route.status === 'complete') {
      assert.equal(route.start, 'fresh');
      assert.equal(route.arrivalCost, 3);
      assert.deepEqual(route.points[0], starts[0].position);
      assert.deepEqual(route.points.at(-1), goal);
    }
    assert.deepEqual(selectCatalogActions(world, surfaces, starts, goal, settings), refreshed);
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('an uncompleted seeded search retains the ordinary discovery budget and no extra entry pass', () => {
  const surfaces = [
    floor('start', 0, 4, 0),
    floor('step', 7, 11, 0),
    floor('isolated-goal', 30, 34, 0),
  ];
  const world = createCollisionWorld(geometry(surfaces));
  const settings = {
    ...options,
    groundPlanner: createGroundPlanner(surfaces, options),
    maxCandidates: 48,
    maxShortcutCandidates: 0,
  };
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(surfaces, surfaces);
    assert.equal(
      planJumpRoute(surfaces, world, arrival([2, 0, 0]), [9, 0, 0], {
        ...settings,
        maxCandidates: 16,
      }).route.status,
      'complete',
    );
    setActionCatalogPhase('frozen');
    const before = actionCatalogStats().added;
    const result = planJumpRoute(surfaces, world, arrival([1, 0, 0]), [32, 0, 0], settings);
    assert.equal(result.route.status, 'no-verified-route');
    assert.ok(result.diagnostics.catalogSeedActions! > 0);
    assert.ok(result.connections.some((action) => action.id.startsWith('@catalog/')));
    assert.ok(result.diagnostics.searches.length > 0);
    assert.equal(result.diagnostics.unusedCandidates, 0);
    assert.equal(result.diagnostics.deviceApproaches, undefined);
    assert.equal(result.diagnostics.knownActionChains, undefined);
    assert.equal(actionCatalogStats().added, before);
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('static coarse actions cross distinct goal refinements with fresh support and resource checks', () => {
  const base = [floor('start', 0, 4, 0), floor('landing', 7, 11, 0)];
  const first = [...base, floor('refined/0', 11, 14, 0)];
  const second = [...base, floor('refined/0', 11, 16, 0)];
  const world = createCollisionWorld(geometry(second));
  const training = { ...options, groundPlanner: createGroundPlanner(first, options) };
  const current = { ...options, groundPlanner: createGroundPlanner(second, options) };
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(first, base, options.portals);
    registerCatalogSurfaces(second, base, options.portals);
    assert.equal(
      planJumpRoute(first, world, arrival([2, 0, 0]), [9, 0, 0], training).route.status,
      'complete',
    );
    setActionCatalogPhase('frozen');
    const starts = arrival([1, 0, 0]);
    const goal: Vec3 = [15, 0, 0];
    const selected = selectCatalogActions(world, second, starts, goal, current).actions;
    assert.ok(selected.length > 0);
    assert.ok(
      selected.every(
        (action) =>
          base.some((face) => face.id === action.fromSurface) &&
          base.some((face) => face.id === action.toSurface),
      ),
    );
    const route = current.groundPlanner.plan(starts, goal, { connections: selected });
    assert.equal(route.status, 'complete');
    assert.deepEqual(route.points.at(-1), goal);

    const changed = [base[0], floor('landing', 7, 11, 2), second[2]];
    registerCatalogSurfaces(changed, base);
    assert.deepEqual(
      selectCatalogActions(world, changed, starts, goal, {
        ...options,
        groundPlanner: createGroundPlanner(changed, options),
      }).actions,
      [],
    );
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('refined endpoint actions remain local while repeated refined IDs cannot cross snapshots', () => {
  const base = [floor('start', 0, 4, 0)];
  const first = [...base, floor('refined/0', 7, 11, 0)];
  const second = [...base, floor('refined/0', 14, 18, 0)];
  const world = createCollisionWorld(geometry([...first, second[1]]));
  const training = { ...options, groundPlanner: createGroundPlanner(first, options) };
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(first, base, options.portals);
    registerCatalogSurfaces(second, base, options.portals);
    const trained = planJumpRoute(first, world, arrival([2, 0, 0]), [9, 0, 0], training);
    assert.equal(trained.route.status, 'complete');
    assert.ok(trained.connections.some((action) => action.toSurface === 'refined/0'));
    setActionCatalogPhase('frozen');
    const starts = arrival([1, 0, 0]);
    const selected = selectCatalogActions(world, first, starts, [9, 0, 0], training).actions;
    assert.ok(selected.some((action) => action.toSurface === 'refined/0'));
    const proof = training.groundPlanner.plan(starts, [9, 0, 0], { connections: selected });
    assert.equal(proof.status, 'complete');
    const result = planJumpRoute(first, world, starts, [9, 0, 0], training);
    assert.equal(result.route.status, 'complete');
    assert.ok(result.route.cost <= proof.cost);
    assert.deepEqual(result.route.points.at(-1), [9, 0, 0]);
    assert.deepEqual(
      selectCatalogActions(world, second, arrival([1, 0, 0]), [16, 0, 0], {
        ...options,
        groundPlanner: createGroundPlanner(second, options),
      }).actions,
      [],
    );
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('current refinement walking connectivity replaces the catalog graph in both directions', () => {
  const base = [floor('start', 0, 4, 0), floor('goal', 7, 11, 0)];
  const bridge = [...base, floor('refined/0', 4, 7, 0)];
  const world = createCollisionWorld(geometry(bridge));
  const original = { ...options, groundPlanner: createGroundPlanner(base, options) };
  const refined = { ...options, groundPlanner: createGroundPlanner(bridge, options) };
  const starts = arrival([2, 0, 0]);
  const goal: Vec3 = [9, 0, 0];
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(base, base, options.portals);
    registerCatalogSurfaces(bridge, base, options.portals);
    assert.equal(planJumpRoute(base, world, starts, goal, original).route.status, 'complete');
    setActionCatalogPhase('frozen');
    const selected = selectCatalogActions(world, base, starts, goal, original).actions;
    assert.ok(selected.length > 0);
    assert.equal(
      original.groundPlanner.plan(starts, goal, { connections: selected }).status,
      'complete',
    );
    assert.deepEqual(selectCatalogActions(world, bridge, starts, goal, refined).actions, []);
    assert.equal(refined.groundPlanner.plan(starts, goal).status, 'complete');
    const again = selectCatalogActions(world, base, starts, goal, original).actions;
    assert.ok(again.length > 0);
    assert.equal(
      original.groundPlanner.plan(starts, goal, { connections: again }).status,
      'complete',
    );
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('fresh starts discover cheaper actions away from the trained route without growing the frozen bank', () => {
  const surfaces = [floor('start', 0, 4, 0, -10, 10), floor('goal', 7, 11, 0, -10, 10)];
  const world = createCollisionWorld(geometry(surfaces));
  const planner = createGroundPlanner(surfaces, options);
  const settings = { ...options, groundPlanner: planner };
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(surfaces, surfaces);
    const training = planJumpRoute(surfaces, world, arrival([2, 0, -8]), [9, 0, -8], {
      ...settings,
      maxCandidates: 16,
      maxShortcutCandidates: 0,
    });
    assert.equal(training.route.status, 'complete');
    setActionCatalogPhase('frozen');
    const before = actionCatalogStats().added;
    const starts = arrival([2, 0, 8]),
      goal: Vec3 = [9, 0, 8];
    const selected = selectCatalogActions(world, surfaces, starts, goal, settings).actions;
    const incumbent = planner.plan(starts, goal, { connections: selected });
    assert.equal(incumbent.status, 'complete');
    const plan = planner.plan;
    const overlays: string[] = [];
    planner.plan = (...args) => {
      overlays.push(JSON.stringify(args[2]?.connections?.map((connection) => connection.id)));
      return plan(...args);
    };
    const result = planJumpRoute(surfaces, world, starts, goal, settings);
    planner.plan = plan;
    assert.equal(result.route.status, 'complete');
    assert.ok(result.route.cost < incumbent.cost - 1);
    assert.ok(overlays.length > 1);
    assert.equal(new Set(overlays).size, overlays.length);
    assert.deepEqual(result.route, planner.plan(starts, goal, { connections: result.connections }));
    assert.equal(actionCatalogStats().added, before);
  } finally {
    setActionCatalogPhase('disabled');
  }
});

test('frozen chains honor zero and positive broad comparison limits for fresh starts', () => {
  const surfaces = [floor('start', 0, 4, 0, -10, 10), floor('goal', 7, 11, 0, -10, 10)];
  const world = createCollisionWorld(geometry(surfaces));
  const planner = createGroundPlanner(surfaces, options);
  const settings = { ...options, groundPlanner: planner };
  try {
    setActionCatalogPhase('training');
    registerCatalogSurfaces(surfaces, surfaces);
    assert.equal(
      planJumpRoute(surfaces, world, arrival([2, 0, -8]), [9, 0, -8], {
        ...settings,
        maxCandidates: 16,
        maxShortcutCandidates: 0,
      }).route.status,
      'complete',
    );
    setActionCatalogPhase('frozen');
    const starts = arrival([2, 0, 8]),
      goal: Vec3 = [9, 0, 8];
    const selected = selectCatalogActions(world, surfaces, starts, goal, settings).actions;
    const incumbent = planner.plan(starts, goal, { connections: selected });
    assert.equal(incumbent.status, 'complete');
    for (const limit of [0, 16, 64]) {
      const result = planJumpRoute(surfaces, world, starts, goal, {
        ...settings,
        maxShortcutCandidates: limit,
      });
      assert.equal(result.route.status, 'complete');
      if (!limit) {
        assert.deepEqual(result.route, incumbent);
        assert.deepEqual(result.diagnostics.searches, []);
      } else {
        assert.ok(result.route.cost < incumbent.cost - 1);
        const broad = result.diagnostics.searches.find((search) => search.reason === 'searched');
        const local = result.diagnostics.searches.filter(
          (search) => search.reason === 'route-shortcuts',
        );
        assert.ok(broad && broad.limits.arcAttempts === limit * 2);
        assert.equal(local.length, 1);
        assert.ok(local[0].limits.arcAttempts <= 256);
        assert.deepEqual(
          result.route,
          planner.plan(starts, goal, { connections: result.connections }),
        );
      }
    }
  } finally {
    setActionCatalogPhase('disabled');
  }
});
