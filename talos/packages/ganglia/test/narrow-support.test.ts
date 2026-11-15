import assert from 'node:assert/strict';
import { test } from 'node:test';

import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { Route } from '#@/src/route.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import {
  narrowGoalSupports,
  proveGroundRoute,
  checkedGroundPlanner,
} from '#@/src/v1/solver/ground-refinement.ts';
const scene: PhysicalInput = {
  ground: {
    surfaces: [],
    options: { speed: 1, maxVertical: 0.5, walls: [], profile: { radius: 0.35, height: 1.66 } },
    build: { bounds: { min: [-4, -4], max: [4, 4] }, cellSize: 0.15, cellHeight: 0.05 },
  },
  collision: {
    positions: [-2, 0, -0.07, -2, 0, 0.07, 2, 0, 0.07, 2, 0, -0.07],
    indices: [0, 1, 2, 0, 2, 3],
  },
  movement: {
    maxSlope: 45,
    stepUp: 0.4,
    stepDown: 0.6,
    runAirSpeed: 2,
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
  },
  locomotion: { speed: 1, sprintSpeed: 2, sprintAcceleration: 1 },
};
const options = (input: PhysicalInput) => ({
  build: {
    ...input.ground.build!,
    profile: input.ground.options.profile,
    maxSlope: 45,
    stepUp: input.movement.stepUp,
    stepDown: input.movement.stepDown,
    cellSize: 0.15,
    cellHeight: 0.05,
  },
  goal: [0, 1, 0] as [number, number, number],
  model: input.movement.model,
  maxCandidates: 8,
  physical: createPhysicalWorld(input, 'complete'),
});
const route: Route = {
  status: 'complete',
  start: 'start',
  arrivalCost: 0,
  cost: 2,
  length: 2,
  points: [
    [-1, 0.01, 0],
    [1, 0.01, 0],
  ],
  segments: [
    {
      mode: 'walk',
      points: [
        [-1, 0.01, 0],
        [1, 0.01, 0],
      ],
      times: [0, 2],
    },
  ],
};
test('missing narrow source charts require physical support and proved output walking spans', () => {
  const opts = options(scene),
    charts = narrowGoalSupports(scene.collision, [], opts);
  assert.equal(charts.surfaces.length, 2);
  assert.equal(proveGroundRoute(route, opts.physical, scene.ground.options).status, 'complete');
  const planner = checkedGroundPlanner(
    charts.surfaces,
    { ...scene.ground.options, locomotion: scene.locomotion },
    opts.physical,
  );
  assert.equal(
    planner.plan(
      [{ id: 'start', state: 'available', cost: 0, position: [-1, 0.01, 0] }],
      [1, 0.01, 0],
    ).status,
    'complete',
  );
  const mapped = narrowGoalSupports(scene.collision, charts.surfaces, opts);
  assert.equal(mapped.surfaces.length, 0);
  const stationary = planner.plan(
    [{ id: 'stationary', state: 'available', cost: 0, position: [0, 0.01, 0] }],
    [0, 0.01, 0],
    { interaction: { radius: 0.1 } },
  );
  assert.equal(stationary.status, 'complete');
  if (stationary.status === 'complete') assert.deepEqual(stationary.points.at(-1), [0, 0.01, 0]);
});
test('interior overhangs and walls reject a narrow cap even when both walk endpoints remain clear', () => {
  for (const kind of ['wall', 'overhang']) {
    const input = structuredClone(scene);
    if (kind === 'wall')
      input.ground.options.walls = [{ min: [-0.1, 0, -0.1], max: [0.1, 2, 0.1], state: 'active' }];
    else {
      const i = input.collision.positions.length / 3;
      input.collision.positions = [
        ...input.collision.positions,
        -0.1,
        1,
        -0.1,
        0.1,
        1,
        -0.1,
        0.1,
        1,
        0.1,
        -0.1,
        1,
        0.1,
      ];
      input.collision.indices = [...input.collision.indices, i, i + 1, i + 2, i, i + 2, i + 3];
    }
    const opts = options(input),
      physical = opts.physical.configured();
    assert.ok(physical.standing([-1, 0.01, 0]));
    assert.ok(physical.standing([1, 0.01, 0]));
    assert.equal(narrowGoalSupports(input.collision, [], opts).surfaces.length, 0);
    assert.equal(
      proveGroundRoute(route, opts.physical, input.ground.options).status,
      'no-verified-route',
    );
  }
});

test('physical walk proof preserves the selected source and rederives goal events', () => {
  const physical = createPhysicalWorld(scene, 'complete');
  const elevated = structuredClone(route);
  if (elevated.status !== 'complete') return;
  elevated.points[0][1] = 0.1;
  elevated.segments[0].points[0][1] = 0.1;
  assert.equal(
    proveGroundRoute(elevated, physical, scene.ground.options).status,
    'no-verified-route',
  );
  assert.equal(
    proveGroundRoute(route, physical, scene.ground.options, {
      position: [1, 0.1, 0],
      interaction: { radius: 0.01 },
    }).status,
    'no-verified-route',
  );
  const stale = structuredClone(route);
  if (stale.status !== 'complete') return;
  stale.goalHit = { segment: 0, position: [1, 0.01, 0], time: 0 };
  const corrected = proveGroundRoute(stale, physical, scene.ground.options, {
    position: [1, 0.01, 0],
    interaction: { radius: 0.3 },
  });
  assert.ok(corrected.status === 'complete');
  assert.ok(Math.abs(corrected.goalHit!.time - 1.7) < 1e-6);
});

test('ordinary solver recovers a narrow takeoff from the original arrival only after its first strategies fail', async () => {
  const { solvePhysicalRoute } = await import('#@/src/v1/solver/physical/solve.ts');
  const { gangliaV1Defaults } = await import('#@/src/solver/index.ts');
  const { createPhysicalVerifier } = await import('#@/src/evaluation/index.ts');
  const input = structuredClone(scene);
  const floor = {
    id: 'floor',
    vertices: [
      [-6, 0, -2],
      [-6, 0, 2],
      [-2, 0, 2],
      [-2, 0, -2],
    ] as [number, number, number][],
  };
  input.ground.surfaces = [floor];
  input.ground.build!.bounds = { min: [-6, -3], max: [4, 3] };
  const roof = Array.from(input.collision.positions, (v, i) => (i % 3 === 1 ? v + 1 : v));
  input.collision = {
    positions: [...floor.vertices.flat(), ...roof],
    indices: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7],
  };
  input.movement.model.maxHorizontalSpeed = 4;
  input.movement.model.startHorizontalSpeed = 4;
  input.movement.runAirSpeed = 4;
  const arrival = {
      id: 'original',
      position: [-4, 0.01, 0] as [number, number, number],
      state: 'available' as const,
      cost: 0,
    },
    target = [1, 1.9, 0] as [number, number, number],
    interaction = { radius: 0.3, airborne: true };
  const results: import('#@/src/v1/solver/physical/solve.ts').PhysicalResult[] = [];
  let diagnostic: Record<string, unknown> | undefined;
  await solvePhysicalRoute(
    input,
    { arrival, target, interaction, walls: [] },
    {
      effort: 'all',
      emit(result, _optimizing, details) {
        results.push(result);
        diagnostic = details;
      },
    },
    { ...gangliaV1Defaults, maxCandidates: 256, maxShortcutCandidates: 0 },
  );
  const result = results.at(-1)!;
  assert.equal(result.route?.status, 'complete', JSON.stringify({ result, diagnostic }));
  assert.ok(diagnostic?.narrowSupportFallback);
  assert.ok(result.route?.status === 'complete');
  assert.equal(result.route.start, arrival.id);
  assert.ok(Math.hypot(...result.route.points[0].map((v, i) => v - arrival.position[i])) <= 0.02);
  const evaluation = createPhysicalVerifier(() => [createPhysicalWorld(input, 'complete')])(
    { starts: [arrival], goal: target, interaction },
    result.route,
  );
  assert.equal(evaluation.valid, true, JSON.stringify(evaluation));
});

test('narrow walking correction refuses stale boost pickup and expiry clocks', () => {
  const physical = createPhysicalWorld(scene, 'complete');
  for (const kind of ['pickup', 'segment', 'expiry']) {
    const candidate: Route = structuredClone(route);
    if (candidate.status !== 'complete') return;
    const boost = { id: 'boost', multiplier: 2, duration: 1 };
    if (kind === 'pickup') candidate.boosts = [{ ...boost, position: [0, 0.01, 0], elapsed: 1 }];
    if (kind === 'segment') candidate.segments[0].boost = boost;
    if (kind === 'expiry') candidate.segments[0].boostExpiry = 0.5;
    assert.equal(
      proveGroundRoute(candidate, physical, scene.ground.options).status,
      'no-verified-route',
    );
  }
});
