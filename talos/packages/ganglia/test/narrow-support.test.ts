import assert from 'node:assert/strict';
import { test } from 'node:test';

import { findGoalHit } from '#@/src/model/goals.ts';
import { createPhysicalWorld } from '#@/src/model/world.ts';
import type { PhysicalInput } from '#@/src/solver/physical.ts';
import { createGroundPlanner } from '#@/src/v1/route/ground.ts';
import { narrowGoalSupports } from '#@/src/v1/solver/ground-refinement.ts';
import { createPhysicalCache } from '#@/src/v1/solver/physical/preparation.ts';
import type { PhysicalCache } from '#@/src/v1/solver/physical/solve.ts';
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
test('missing narrow source charts require physical support and use native walking', () => {
  const opts = options(scene),
    charts = narrowGoalSupports(scene.collision, [], opts);
  assert.equal(charts.surfaces.length, 2);
  const planner = createGroundPlanner(charts.surfaces, {
    ...scene.ground.options,
    locomotion: scene.locomotion,
  });
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
  if (stationary.status === 'complete') {
    // The native chart retains its own height; the unchanged interaction volume
    // determines collection rather than a reconstructed collider-foot offset.
    assert.deepEqual(stationary.points.at(-1), [0, 0, 0]);
    const end = stationary.points.at(-1)!;
    assert.ok(findGoalHit([end, end], [0, 0.01, 0], { radius: 0.1 }));
  }
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
  }
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
  const cache = createPhysicalCache();
  let narrowBuilds = 0,
    narrowHits = 0;
  const observed: PhysicalCache = {
    ...cache,
    async memo(slot, key, create, scope) {
      const prepared = await cache.memo(
        slot,
        key,
        async (reserve) => {
          let reserved = 0;
          const value = await create((surfaces) => {
            reserved = surfaces;
            reserve?.(surfaces);
            assert.ok(
              cache.stats().resident.plannerSurfaces <= cache.stats().capacity.plannerSurfaces,
            );
          });
          if (slot === 'refinement') {
            const refinement = value as { surfaces: PhysicalInput['ground']['surfaces'] };
            if (refinement.surfaces.some((surface) => surface.id.startsWith('narrow/'))) {
              narrowBuilds++;
              assert.equal(reserved, refinement.surfaces.length);
              assert.ok(
                scope?.parent,
                'narrow preparation belongs to its original surface snapshot',
              );
            }
          }
          return value;
        },
        scope,
      );
      if (slot === 'refinement' && prepared.reused) {
        const refinement = prepared.value as { surfaces: PhysicalInput['ground']['surfaces'] };
        if (refinement.surfaces.some((surface) => surface.id.startsWith('narrow/'))) narrowHits++;
      }
      return prepared;
    },
  };
  for (let round = 0; round < 2; round++) {
    const cached: typeof results = [];
    await solvePhysicalRoute(
      input,
      { arrival, target, interaction, walls: [] },
      {
        cache: observed,
        effort: 'all',
        emit: (candidate) => {
          cached.push(candidate);
        },
      },
      { ...gangliaV1Defaults, maxCandidates: 256, maxShortcutCandidates: 0 },
    );
    assert.deepEqual(cached.at(-1)?.route, result.route);
    assert.deepEqual(cached.at(-1)?.connections, result.connections);
  }
  assert.equal(narrowBuilds, 1);
  assert.equal(narrowHits, 1);
  assert.ok(cache.stats().resident.refinement <= 2);
  cache.clear();
});

test('narrowGoalSupports clips large collision triangles to build.bounds so vertices never exceed collision scope', () => {
  const input = structuredClone(scene);
  // Large narrow strip extending far outside build.bounds [-4, 4] in X.
  input.collision = {
    positions: [-20, 0, -0.07, -20, 0, 0.07, 20, 0, 0.07, 20, 0, -0.07],
    indices: [0, 1, 2, 0, 2, 3],
  };
  const opts = options(input);
  const charts = narrowGoalSupports(input.collision, [], opts);
  assert.ok(charts.surfaces.length > 0);
  const bounds = input.ground.build!.bounds!;
  for (const surface of charts.surfaces) {
    for (const vertex of surface.vertices) {
      assert.ok(
        vertex[0] >= bounds.min[0] - 1e-6 &&
          vertex[0] <= bounds.max[0] + 1e-6 &&
          vertex[2] >= bounds.min[1] - 1e-6 &&
          vertex[2] <= bounds.max[1] + 1e-6,
        `narrow vertex ${JSON.stringify(vertex)} must stay within build bounds`,
      );
    }
  }
});
